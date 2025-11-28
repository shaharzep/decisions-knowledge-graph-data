import path from 'path';
import fs from 'fs/promises';
import { JobConfig } from '../jobs/JobConfig.js';
import { DatabaseConfig } from '../config/database.js';
import { JobLogger } from '../utils/logger.js';
import { OpenAIConcurrentClient, CompletionSettings as OpenAICompletionSettings } from './OpenAIConcurrentClient.js';
import { ClaudeConcurrentClient, CompletionSettings as ClaudeCompletionSettings } from './ClaudeConcurrentClient.js';
import { ConcurrentProcessor, ProcessedResult } from './ConcurrentProcessor.js';
import { extractJsonFromResponse } from '../utils/validators.js';
import { DependencyResolver } from '../core/DependencyResolver.js';
import pLimit from 'p-limit';

// Union type for completion settings
type CompletionSettings = OpenAICompletionSettings | ClaudeCompletionSettings;

/**
 * Concurrent Runner Options
 */
export interface ConcurrentOptions {
  concurrencyLimit?: number;
  timeout?: number; // Timeout per request in milliseconds
  resumeFrom?: string | string[]; // Directory to resume from (full-data pipeline)
}

/**
 * Callback for streaming result processing
 * Called immediately as each API request completes
 */
export type ResultCallback = (result: ProcessedResult) => Promise<void> | void;

/**
 * Concurrent Runner
 *
 * Orchestrates concurrent processing of decisions using OpenAI GPT-5-mini.
 * Processes all decisions in parallel with controlled concurrency.
 */
export class ConcurrentRunner {
  private config: JobConfig;
  private options: ConcurrentOptions & { concurrencyLimit: number; timeout: number };
  private logger: JobLogger;
  private client: OpenAIConcurrentClient | ClaudeConcurrentClient;
  private processor: ConcurrentProcessor;
  private dependencyResolver: DependencyResolver | null;

  constructor(config: JobConfig, options: ConcurrentOptions = {}) {
    this.config = config;
    this.options = {
      concurrencyLimit:
        options.concurrencyLimit ??
        config.concurrencyLimit ??
        200,
      timeout: options.timeout || 600000, // 10 minutes default (required for Claude)
      resumeFrom: options.resumeFrom,
    };
    this.logger = new JobLogger(`ConcurrentRunner:${config.id}`);

    // Select client based on provider
    this.client = config.provider === 'anthropic'
      ? new ClaudeConcurrentClient(config.id)
      : new OpenAIConcurrentClient(config.id, {
          openaiProvider: config.openaiProvider,
          model: config.model,
          maxConcurrentApiCalls: config.maxConcurrentApiCalls,
          requestsPerSecond: config.requestsPerSecond,
        });

    this.processor = new ConcurrentProcessor(config);

    // Initialize dependency resolver if dependencies are configured
    this.dependencyResolver =
      config.dependencies && config.dependencies.length > 0
        ? new DependencyResolver(config.id, config.dependencies)
        : null;
  }

  /**
   * Run concurrent processing
   *
   * Main orchestration method that:
   * 1. Loads decisions from database
   * 2. Executes concurrent API calls with optional streaming
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

      // Step 2: Setup streaming callback for full-data pipeline
      let streamingCallback: ResultCallback | undefined;
      if (this.config.useFullDataPipeline) {
        this.logger.info('Full-data pipeline enabled - setting up incremental persistence');
        streamingCallback = await this.processor.createStreamingCallback();
      }

      // Step 3: Execute concurrent API calls
      this.logger.info(`Step ${streamingCallback ? '3' : '2'}: Processing ${decisions.length} decisions concurrently`, {
        concurrencyLimit: this.options.concurrencyLimit,
        streamingEnabled: !!streamingCallback,
      });
      const results = await this.executeConcurrent(decisions, streamingCallback);

      // Step 4: Process and validate results (or finalize streaming results)
      this.logger.info(`Step ${streamingCallback ? '4' : '3'}: ${streamingCallback ? 'Finalizing' : 'Processing and validating'} results`);
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

      console.log('\nArtifacts:');
      if (this.config.useFullDataPipeline) {
        // Full-data pipeline output
        console.log(`  - Per-decision JSONs: ${summary.jsonDirectory}`);
        console.log(`  - Summary: ${path.join(summary.outputDirectory, 'summary.json')}`);
        console.log(`  - Failures: ${path.join(summary.outputDirectory, 'failures.json')} (${summary.failedRecords} records)`);
      } else {
        // Standard pipeline output
        console.log(`  - Extracted data: ${path.join(summary.outputDirectory, 'extracted-data.json')}`);
        console.log(`  - Successful results: ${path.join(summary.outputDirectory, 'successful-results.json')}`);
        console.log(`  - Failures: ${path.join(summary.outputDirectory, 'failures.json')} (${summary.failedRecords} records)`);
        console.log(`  - Summary: ${path.join(summary.outputDirectory, 'summary.json')}`);
      }
      console.log('');

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
   * Preloads dependencies if configured.
   *
   * @returns Array of raw decision rows
   */
  private async loadDecisions(): Promise<any[]> {
    this.logger.debug('Executing database query');

    // Step 1: Execute database query
    const rows = await DatabaseConfig.executeReadOnlyQuery(
      this.config.dbQuery,
      this.config.dbQueryParams || []
    );

    if (rows.length === 0) {
      throw new Error('Database query returned no rows');
    }

    this.logger.info(`Fetched ${rows.length} records from database`);

    // Step 2: Preload dependency results if required
    if (this.dependencyResolver) {
      this.logger.info('Preloading job dependencies');
      await this.dependencyResolver.preload();
    }

    // NOTE: Preprocessing is now done just-in-time in executeConcurrent
    // to avoid OOM errors when processing large datasets with heavy preprocessing.

    // Step 3: Filter already processed decisions if resuming
    if (this.options.resumeFrom) {
      const resumePaths = Array.isArray(this.options.resumeFrom) 
        ? this.options.resumeFrom 
        : (this.options.resumeFrom ? [this.options.resumeFrom] : []);

      if (resumePaths.length > 0) {
        this.logger.info(`Resuming from director${resumePaths.length > 1 ? 'ies' : 'y'}: ${resumePaths.join(', ')}`);
        
        const processedIds = new Set<string>();
        for (const resumeDir of resumePaths) {
          const ids = await this.getProcessedIds(resumeDir);
          ids.forEach(id => processedIds.add(id));
        }
      
      if (processedIds.size > 0) {
        const originalCount = rows.length;
        const filteredRows = rows.filter((row, index) => {
          const metadata = this.extractMetadata(row) || {};
          // Recreate the filename logic to check existence
          // Note: We need to use the same fallback ID logic as processSingleDecision
          const customIdPrefix = this.config.customIdPrefix || this.config.id;
          const customId = `${customIdPrefix}-${String(index + 1).padStart(4, '0')}`;
          
          const expectedFileName = ConcurrentProcessor.generateFileName(
            metadata,
            metadata.decision_id || null,
            metadata.language || null,
            customId
          );
          
          return !processedIds.has(expectedFileName);
        });
        
        this.logger.info(`Resuming: Skipped ${originalCount - filteredRows.length} already processed records. Remaining: ${filteredRows.length}`);
        return filteredRows;
      } else {
        this.logger.warn('Resume director(y/ies) found but contained no valid JSON files. Processing all records.');
      }
      }
    }

    return rows;
  }

  /**
   * Get set of processed IDs from resume directory
   */
  private async getProcessedIds(resumeDir: string): Promise<Set<string>> {
    const processedIds = new Set<string>();
    const jsonsDir = path.join(resumeDir, 'jsons');

    try {
      await fs.access(jsonsDir);
      const files = await fs.readdir(jsonsDir);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          // Remove extension to get the ID/basename
          const id = path.basename(file, '.json');
          processedIds.add(id);
        }
      }
      
      this.logger.info(`Found ${processedIds.size} processed records in resume directory`);
    } catch (error) {
      this.logger.warn(`Could not read resume directory: ${jsonsDir}`, error!);
    }

    return processedIds;
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
    const metadata = this.extractMetadata(row);

    try {
      // Check for custom execution (e.g., two-stage processing)
      if (this.config.customExecution) {
        const data = await this.config.customExecution(row, this.client);
        return {
          customId,
          success: true,
          data,
          metadata,
        };
      }

      // Standard single-stage execution
      // Generate prompt
      const prompt = this.config.promptTemplate!(row);

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
        temperature: this.config.temperature,
        top_p: this.config.top_p,
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
          metadata,
        };
      }

      // Check finish reason
      const finishReason = completion.choices[0]?.finish_reason;
      if (finishReason === 'length') {
        return {
          customId,
          success: false,
          error: `Response truncated - hit token limit (${completion.usage?.completion_tokens || 'unknown'} tokens)`,
          metadata,
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
          metadata,
        };
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
        metadata,
      };
    }
  }
  
  private extractMetadata(row: any): Record<string, any> | undefined {
    const metadata: Record<string, any> = {};
    const fields = this.config.rowMetadataFields ?? [];

    const assign = (targetKey: string, sourceKey: string) => {
      const value = row[sourceKey];
      if (value !== undefined && value !== null) {
        metadata[targetKey] = value;
      }
    };

    for (const fieldName of fields) {
      const outputFieldName = fieldName === 'language_metadata' ? 'language' : fieldName;
      assign(outputFieldName, fieldName);
    }

    // Ensure core identifiers are present even if not explicitly listed
    assign('decision_id', 'decision_id');
    assign('language', 'language');
    if (metadata.language === undefined) {
      assign('language', 'language_metadata');
    }

    return Object.keys(metadata).length > 0 ? metadata : undefined;
  }

  /**
   * Execute concurrent API calls
   *
   * Uses batch processing with delays to avoid rate limits.
   * Processes in batches of N concurrent requests with 500ms delay between batches.
   * Performs Just-In-Time (JIT) preprocessing to keep memory usage low.
   * Tracks progress and logs every 10 completions.
   *
   * @param decisions Array of raw decision rows
   * @param onResult Optional callback invoked immediately after each result completes
   * @returns Array of processed results
   */
  private async executeConcurrent(
    decisions: any[],
    onResult?: ResultCallback
  ): Promise<ProcessedResult[]> {
    const batchSize = this.options.concurrencyLimit;
    let completedCount = 0; // Tracks completed API calls
    let processedCount = 0; // Tracks successfully preprocessed rows (for ID generation)
    const totalCount = decisions.length;
    const results: ProcessedResult[] = [];

    // Process in batches
    for (let batchStart = 0; batchStart < decisions.length; batchStart += batchSize) {
      const rawBatch = decisions.slice(batchStart, Math.min(batchStart + batchSize, decisions.length));
      
      // JIT Preprocessing for this batch
      // We use p-limit here as well to ensure we don't overload if batch size is huge (though it matches concurrencyLimit)
      const limit = pLimit(this.options.concurrencyLimit);
      
      const preprocessedBatchPromises = rawBatch.map((row) => 
        limit(async () => {
          let enrichedRow = row;
          
          // 1. Enrich with dependencies
          if (this.dependencyResolver) {
            enrichedRow = await this.dependencyResolver.enrichRow(enrichedRow);
          }
          
          // 2. Apply custom preprocessing
          if (this.config.preprocessRow) {
            enrichedRow = await this.config.preprocessRow(enrichedRow);
          }
          
          return enrichedRow;
        })
      );

      const preprocessedBatchResults = await Promise.all(preprocessedBatchPromises);
      
      // Filter out nulls
      const validBatchItems: any[] = [];
      for (const item of preprocessedBatchResults) {
        if (item !== null) {
          validBatchItems.push(item);
        }
      }

      // Process valid items in parallel
      const batchPromises = validBatchItems.map(async (decision) => {
        // Use a running count for the ID to ensure uniqueness and stability across batches
        // This replaces the global index from the pre-filtered array approach
        const currentIdIndex = processedCount++; 
        
        const result = await this.processSingleDecision(decision, currentIdIndex);

        // Stream result immediately if callback provided
        if (onResult) {
          try {
            await onResult(result);
          } catch (error) {
            this.logger.error(`Error in streaming callback for result ${result.customId}`, error);
          }
        }

        // Update progress
        completedCount++;

        // Log progress every 10 completions or at the end
        if (completedCount % 10 === 0 || completedCount === totalCount) {
          this.logger.info(`Progress: ${completedCount}/${totalCount} processed${onResult ? ' (streaming)' : ''}`);
        }

        return result;
      });

      // Wait for batch execution to complete
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
