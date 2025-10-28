import path from 'path';
import { JobConfig } from '../jobs/JobConfig.js';
import { DatabaseConfig } from '../config/database.js';
import { JobLogger } from '../utils/logger.js';
import { OpenAIConcurrentClient, CompletionSettings as OpenAICompletionSettings } from './OpenAIConcurrentClient.js';
import { ClaudeConcurrentClient, CompletionSettings as ClaudeCompletionSettings } from './ClaudeConcurrentClient.js';
import { ConcurrentProcessor, ProcessedResult } from './ConcurrentProcessor.js';
import { extractJsonFromResponse } from '../utils/validators.js';
import { DependencyResolver } from '../core/DependencyResolver.js';
import { chunkDecisionText } from '../utils/chunkDecisionText.js';

// Union type for completion settings
type CompletionSettings = OpenAICompletionSettings | ClaudeCompletionSettings;

/**
 * Concurrent Runner Options
 */
export interface ConcurrentOptions {
  concurrencyLimit?: number;
  timeout?: number; // Timeout per request in milliseconds
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
  private options: Required<ConcurrentOptions>;
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
      timeout: options.timeout || 300000, // 10 minutes default (required for Claude)
    };
    this.logger = new JobLogger(`ConcurrentRunner:${config.id}`);

    // Select client based on provider
    this.client = config.provider === 'anthropic'
      ? new ClaudeConcurrentClient(config.id)
      : new OpenAIConcurrentClient(config.id);

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
   * Enriches rows with dependency data.
   * Applies preprocessing if defined.
   *
   * @returns Array of decision rows
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

    // Step 3: Enrich rows with dependencies and apply preprocessing
    let processedRows = rows;
    if (this.config.preprocessRow || this.dependencyResolver) {
      this.logger.info('Preprocessing rows with dependencies and custom hooks');
      processedRows = await Promise.all(
        rows.map(async (row, index) => {
          this.logger.debug(`Processing row ${index + 1}/${rows.length}`);

          // First, enrich with dependencies (if configured)
          let enrichedRow = row;
          if (this.dependencyResolver) {
            enrichedRow = await this.dependencyResolver.enrichRow(enrichedRow);
          }

          // Then, apply custom preprocessing (if defined)
          if (this.config.preprocessRow) {
            enrichedRow = await this.config.preprocessRow(enrichedRow);
          }

          return enrichedRow;
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
    const metadata = this.extractMetadata(row);

    try {
      const sourceText =
        row.full_md || row.full_markdown || row.fullText || row.text || '';
      const shouldChunk =
        this.config.chunking &&
        typeof sourceText === 'string' &&
        sourceText.length > this.config.chunking.maxChunkSize;

      if (shouldChunk) {
        return await this.processChunkedDecision(
          row,
          sourceText,
          metadata,
          customId
        );
      }

      const prompt = this.config.promptTemplate(row);
      const { data: parsedData, usage } = await this.executePrompt(prompt);

      return {
        customId,
        success: true,
        data: parsedData, // Pure model output (not merged yet)
        metadata, // Metadata to merge after validation
        tokenUsage: usage,
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

  private async processChunkedDecision(
    row: any,
    sourceText: string,
    metadata: Record<string, any> | undefined,
    customId: string
  ): Promise<ProcessedResult> {
    const chunking = this.config.chunking!;
    const chunks = chunkDecisionText(sourceText, chunking);

    const allProvisions: any[] = [];
    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;

    for (const chunk of chunks) {
      const chunkSnippets = (row.provisionSnippets || []).filter(
        (snippet: any) =>
          snippet.char_start < chunk.end && snippet.char_end > chunk.start
      );

      const formattedSnippets = chunkSnippets.length
        ? chunkSnippets
            .map((snippet: any, index: number) => {
              const relStart = Math.max(snippet.char_start - chunk.start, 0);
              const relEnd = Math.max(snippet.char_end - chunk.start, relStart);
              return `[${index + 1}] local ${relStart}-${relEnd} (global ${snippet.char_start}-${snippet.char_end}): "${snippet.snippet}"`;
            })
            .join('\n')
        : '(No snippets extracted in this segment)';

      const chunkRow = {
        ...row,
        full_md: chunk.text,
        chunkMetadata: {
          index: chunk.index,
          total: chunks.length,
          start: chunk.start,
          end: chunk.end,
          label: chunk.label,
        },
        provisionSnippets: chunkSnippets,
        formattedProvisionSnippets: formattedSnippets,
      };

      const prompt = this.config.chunkPromptTemplate
        ? this.config.chunkPromptTemplate({
            row: chunkRow,
            chunk: {
              index: chunk.index,
              total: chunks.length,
              start: chunk.start,
              end: chunk.end,
              label: chunk.label,
              text: chunk.text,
            },
            chunkIndex: chunk.index,
            totalChunks: chunks.length,
            provisionSnippets: chunkSnippets,
            formattedSnippets,
          })
        : this.config.promptTemplate(chunkRow);

      const { data, usage } = await this.executePrompt(prompt);
      const chunkProvisions = Array.isArray(data?.citedProvisions)
        ? data.citedProvisions
        : [];

      allProvisions.push(...chunkProvisions);

      if (usage) {
        promptTokens += usage.promptTokens ?? 0;
        completionTokens += usage.completionTokens ?? 0;
        totalTokens += usage.totalTokens ?? 0;
      }
    }

    const tokenUsage =
      promptTokens + completionTokens + totalTokens > 0
        ? {
            promptTokens,
            completionTokens,
            totalTokens,
          }
        : undefined;

    return {
      customId,
      success: true,
      data: { citedProvisions: allProvisions },
      metadata,
      tokenUsage,
    };
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

  private async executePrompt(prompt: string) {
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

    const settings: CompletionSettings = {
      model: this.config.model || this.config.deploymentName || 'gpt-5-mini',
      maxOutputTokens: this.config.maxCompletionTokens,
      reasoningEffort: this.config.reasoningEffort,
      verbosity: this.config.verbosity,
    };

    const completion = await Promise.race([
      this.client.complete(messages, responseFormat, settings),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Request timeout after ${this.options.timeout}ms`)),
          this.options.timeout
        )
      ),
    ]);

    const messageContent = completion.choices[0]?.message?.content;
    if (!messageContent) {
      throw new Error('No content in response');
    }

    const finishReason = completion.choices[0]?.finish_reason;
    if (finishReason === 'length') {
      const tokens = completion.usage?.completion_tokens ?? 'unknown';
      throw new Error(`Response truncated - hit token limit (${tokens} tokens)`);
    }

    let parsedData: any;
    try {
      parsedData = extractJsonFromResponse(messageContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`JSON parse error: ${message}`);
    }

    const usage = completion.usage
      ? {
          promptTokens: completion.usage.prompt_tokens,
          completionTokens: completion.usage.completion_tokens,
          totalTokens: completion.usage.total_tokens,
        }
      : undefined;

    return { data: parsedData, usage };
  }

  /**
   * Execute concurrent API calls
   *
   * Uses batch processing with delays to avoid rate limits.
   * Processes in batches of N concurrent requests with 500ms delay between batches.
   * Tracks progress and logs every 10 completions.
   *
   * @param decisions Array of decision rows
   * @param onResult Optional callback invoked immediately after each result completes
   * @returns Array of processed results
   */
  private async executeConcurrent(
    decisions: any[],
    onResult?: ResultCallback
  ): Promise<ProcessedResult[]> {
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
          this.logger.info(`Progress: ${completedCount}/${totalCount} completed${onResult ? ' (streaming)' : ''}`);
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
