import { JobConfig } from '../jobs/JobConfig.js';
import { DatabaseConfig } from '../config/database.js';
import { JobLogger } from '../utils/logger.js';
import { OpenAIConcurrentClient, CompletionSettings } from './OpenAIConcurrentClient.js';
import { ConcurrentProcessor, ProcessedResult } from './ConcurrentProcessor.js';
import { extractJsonFromResponse } from '../utils/validators.js';

/**
 * Concurrent Runner Options
 */
export interface ConcurrentOptions {
  concurrencyLimit?: number;
  timeout?: number; // Timeout per request in milliseconds
}

/**
 * Concurrent Runner
 *
 * Orchestrates concurrent processing of decisions using OpenAI GPT-5-mini.
 * Processes all decisions in parallel with controlled concurrency.
 */
export class ConcurrentRunner {
  private config: JobConfig;
  private options: Required<ConcurrentOptions>;
  private logger: JobLogger;
  private client: OpenAIConcurrentClient;
  private processor: ConcurrentProcessor;

  constructor(config: JobConfig, options: ConcurrentOptions = {}) {
    this.config = config;
    this.options = {
      concurrencyLimit: options.concurrencyLimit || 50,
      timeout: options.timeout || 300000, // 5 minutes default
    };
    this.logger = new JobLogger(`ConcurrentRunner:${config.id}`);
    this.client = new OpenAIConcurrentClient(config.id);
    this.processor = new ConcurrentProcessor(config);
  }

  /**
   * Run concurrent processing
   *
   * Main orchestration method that:
   * 1. Loads decisions from database
   * 2. Executes concurrent API calls
   * 3. Processes and validates results
   * 4. Displays summary
   */
  async run(): Promise<void> {
    this.logger.started();

    try {
      // Step 1: Load decisions
      this.logger.info('Step 1: Loading decisions from database');
      const decisions = await this.loadDecisions();
      this.logger.info(`Loaded ${decisions.length} decisions`);

      // Step 2: Execute concurrent API calls
      this.logger.info(`Step 2: Processing ${decisions.length} decisions concurrently`, {
        concurrencyLimit: this.options.concurrencyLimit,
      });
      const results = await this.executeConcurrent(decisions);

      // Step 3: Process and validate results
      this.logger.info('Step 3: Processing and validating results');
      const summary = await this.processor.process(results);

      // Step 4: Display summary
      console.log('\n✅ Concurrent processing completed!\n');
      console.log(`Output directory: ${summary.outputDirectory}`);
      console.log(`Total records: ${summary.totalRecords}`);
      console.log(`Successful: ${summary.successfulRecords} (${summary.successRate})`);
      console.log(`Failed: ${summary.failedRecords}`);
      console.log(`Validation errors: ${summary.validationErrors}`);
      console.log(`Total tokens: ${summary.totalTokens.toLocaleString()}`);
      console.log(`Average tokens per request: ${summary.averageTokensPerRequest.toLocaleString()}`);

      if (summary.errorsByType && Object.keys(summary.errorsByType).length > 0) {
        console.log('\nErrors by type:');
        for (const [type, count] of Object.entries(summary.errorsByType)) {
          console.log(`  ${type}: ${count}`);
        }
      }

      console.log('\nFiles saved:');
      console.log(`  - extracted-data.json (${summary.successfulRecords} records)`);
      console.log(`  - successful-results.json`);
      if (summary.failedRecords > 0) {
        console.log(`  - failures.json (${summary.failedRecords} records)`);
      }
      console.log(`  - summary.json\n`);

      this.logger.completed();
    } catch (error) {
      this.logger.failed(error);
      throw error;
    }
  }

  /**
   * Load decisions from database
   *
   * Uses job config query and parameters to fetch decisions.
   * Applies preprocessing if defined.
   *
   * @returns Array of decision rows
   */
  private async loadDecisions(): Promise<any[]> {
    this.logger.debug('Executing database query');

    // Execute database query
    const rows = await DatabaseConfig.executeReadOnlyQuery(
      this.config.dbQuery,
      this.config.dbQueryParams || []
    );

    if (rows.length === 0) {
      throw new Error('Database query returned no rows');
    }

    this.logger.info(`Fetched ${rows.length} records from database`);

    // Apply preprocessing if defined
    let processedRows = rows;
    if (this.config.preprocessRow) {
      this.logger.info('Preprocessing rows with custom hook');
      processedRows = await Promise.all(
        rows.map((row, index) => {
          this.logger.debug(`Preprocessing row ${index + 1}/${rows.length}`);
          return this.config.preprocessRow!(row);
        })
      );
      this.logger.info('Preprocessing completed');
    }

    return processedRows;
  }

  /**
   * Process a single decision
   *
   * @param row Decision row from database
   * @param index Row index
   * @returns Processed result
   */
  private async processSingleDecision(
    row: any,
    index: number
  ): Promise<ProcessedResult> {
    const customIdPrefix = this.config.customIdPrefix || this.config.id;
    const customId = `${customIdPrefix}-${String(index + 1).padStart(4, '0')}`;

    try {
      // Generate prompt
      const prompt = this.config.promptTemplate(row);

      // Prepare messages
      const messages = [
        {
          role: 'system' as const,
          content:
            'Return ONLY a single JSON object matching the schema. No markdown, no prose, no code blocks.',
        },
        {
          role: 'user' as const,
          content: prompt,
        },
      ];

      // Prepare response format
      const responseFormat = this.config.outputSchemaName
        ? {
            type: 'json_schema' as const,
            json_schema: {
              name: this.config.outputSchemaName,
              schema: this.config.outputSchema,
              strict: true,
            },
          }
        : { type: 'json_object' as const };

      // Prepare completion settings
      const settings: CompletionSettings = {
        model: this.config.model || this.config.deploymentName || 'gpt-5-mini',
        maxOutputTokens: this.config.maxCompletionTokens,
        reasoningEffort: this.config.reasoningEffort,
        verbosity: this.config.verbosity,
      };

      // Call API with timeout
      const completion = await Promise.race([
        this.client.complete(messages, responseFormat, settings),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Request timeout after ${this.options.timeout}ms`)),
            this.options.timeout
          )
        ),
      ]);

      // Extract response content from Chat Completions API
      const messageContent = completion.choices[0]?.message?.content;

      if (!messageContent) {
        return {
          customId,
          success: false,
          error: 'No content in response',
        };
      }

      // Check finish reason
      const finishReason = completion.choices[0]?.finish_reason;
      if (finishReason === 'length') {
        return {
          customId,
          success: false,
          error: `Response truncated - hit token limit (${completion.usage?.completion_tokens || 'unknown'} tokens)`,
        };
      }

      // Parse JSON
      let parsedData: any;
      try {
        parsedData = extractJsonFromResponse(messageContent);
      } catch (error) {
        return {
          customId,
          success: false,
          error: `JSON parse error: ${error instanceof Error ? error.message : String(error)}`,
        };
      }

      // Extract metadata separately (will be merged after validation)
      let metadata: Record<string, any> | undefined;
      if (this.config.rowMetadataFields && this.config.rowMetadataFields.length > 0) {
        metadata = {};
        for (const fieldName of this.config.rowMetadataFields) {
          // Special handling for language_metadata -> language
          const outputFieldName = fieldName === 'language_metadata' ? 'language' : fieldName;
          metadata[outputFieldName] = row[fieldName];
        }
      }

      // Success!
      return {
        customId,
        success: true,
        data: parsedData, // Pure model output (not merged yet)
        metadata, // Metadata to merge after validation
        tokenUsage: completion.usage
          ? {
              promptTokens: completion.usage.prompt_tokens,
              completionTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error: any) {
      this.logger.error(`Error processing decision ${customId}`, error);

      return {
        customId,
        success: false,
        error: `Processing error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Execute concurrent API calls
   *
   * Uses batch processing with delays to avoid rate limits.
   * Processes in batches of N concurrent requests with 500ms delay between batches.
   * Tracks progress and logs every 10 completions.
   *
   * @param decisions Array of decision rows
   * @returns Array of processed results
   */
  private async executeConcurrent(decisions: any[]): Promise<ProcessedResult[]> {
    const batchSize = this.options.concurrencyLimit;
    let completedCount = 0;
    const totalCount = decisions.length;
    const results: ProcessedResult[] = [];

    // Process in batches
    for (let batchStart = 0; batchStart < decisions.length; batchStart += batchSize) {
      const batch = decisions.slice(batchStart, Math.min(batchStart + batchSize, decisions.length));

      // Process batch in parallel
      const batchPromises = batch.map(async (decision, batchIndex) => {
        const globalIndex = batchStart + batchIndex;
        const result = await this.processSingleDecision(decision, globalIndex);

        // Update progress
        completedCount++;

        // Log progress every 10 completions or at the end
        if (completedCount % 10 === 0 || completedCount === totalCount) {
          this.logger.info(`Progress: ${completedCount}/${totalCount} completed`);
        }

        return result;
      });

      // Wait for batch to complete
      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      // Add delay between batches to avoid rate limits (skip on last batch)
      if (batchStart + batchSize < decisions.length) {
        await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms between batches
      }
    }

    return results;
  }
}
