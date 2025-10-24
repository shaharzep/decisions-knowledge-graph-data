import fs from 'fs/promises';
import path from 'path';
import { JobConfig, BatchResponseItem } from '../jobs/JobConfig.js';
import { JobLogger } from '../utils/logger.js';
import {
  validator,
  validateBatchResponseItem,
  extractJsonFromResponse,
  ValidationResult,
} from '../utils/validators.js';

/**
 * Processed Result
 */
export interface ProcessedResult {
  customId: string;
  success: boolean;
  data?: any;
  error?: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Processing Summary
 */
export interface ProcessingSummary {
  totalRecords: number;
  successfulRecords: number;
  failedRecords: number;
  validationErrors: number;
  totalTokens: number;
  outputDirectory: string;
}

/**
 * Result Processor
 *
 * Downloads, validates, and processes batch API results
 */
export class ResultProcessor {
  private config: JobConfig;
  private logger: JobLogger;

  constructor(config: JobConfig) {
    this.config = config;
    this.logger = new JobLogger(`ResultProcessor:${config.id}`);

    // Compile the output schema for validation
    validator.compileSchema(config.id, config.outputSchema);
  }

  /**
   * Process batch results from JSONL output file
   *
   * @param outputFilePath Path to the JSONL output file from Azure
   * @param inputFilePath Optional path to input JSONL file (used to derive metadata file path)
   * @returns Processing summary
   */
  async process(
    outputFilePath: string,
    inputFilePath?: string
  ): Promise<ProcessingSummary> {
    this.logger.info('Starting result processing', { path: outputFilePath });

    try {
      // Load metadata mapping if available
      let metadataMap: Map<string, any> | undefined;
      if (inputFilePath) {
        metadataMap = await this.loadMetadataMapping(inputFilePath);
        if (metadataMap.size > 0) {
          this.logger.info(`Loaded metadata mapping for ${metadataMap.size} records`);
        }
      }

      // Read and parse JSONL file
      const responses = await this.readJsonl(outputFilePath);
      this.logger.info(`Loaded ${responses.length} responses`);

      // Process each response
      const results: ProcessedResult[] = [];
      let totalTokens = 0;
      let validationErrors = 0;
      let successCount = 0;
      let failCount = 0;
      const totalResponses = responses.length;
      const logInterval = Math.max(1, Math.floor(totalResponses / 10)); // Log 10 times during processing

      for (let i = 0; i < responses.length; i++) {
        const response = responses[i];

        // Log progress periodically BEFORE processing (to isolate hangs)
        if (i % logInterval === 0 && i > 0) {
          this.logger.info(`Progress: ${i}/${totalResponses} responses processed (${successCount} success, ${failCount} failed)`);
        }

        // Log every 10 records to track progress
        if ((i + 1) % 10 === 0) {
          this.logger.info(`Processing record ${i + 1}/${totalResponses}: ${response.custom_id}`);
        }

        const result = await this.processResponse(response, metadataMap);
        results.push(result);

        // Update counters incrementally (avoid filtering large arrays)
        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }

        if (result.tokenUsage) {
          totalTokens += result.tokenUsage.totalTokens;
        }

        if (!result.success && result.error?.includes('validation')) {
          validationErrors++;
        }
      }

      // Final progress log
      this.logger.info(`Progress: ${totalResponses}/${totalResponses} responses processed (${successCount} success, ${failCount} failed)`);

      // Save results to files
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const outputDir = path.join(
        process.cwd(),
        'results',
        this.config.id,
        timestamp
      );

      await this.saveResults(outputDir, results);

      const summary: ProcessingSummary = {
        totalRecords: results.length,
        successfulRecords: results.filter((r) => r.success).length,
        failedRecords: results.filter((r) => !r.success).length,
        validationErrors,
        totalTokens,
        outputDirectory: outputDir,
      };

      this.logger.info('Result processing completed', summary);

      return summary;
    } catch (error) {
      this.logger.error('Result processing failed', error);
      throw error;
    }
  }

  /**
   * Process a single batch response item
   *
   * @param response Batch response item from Azure
   * @param metadataMap Optional metadata mapping (custom_id -> metadata fields)
   */
  private async processResponse(
    response: BatchResponseItem,
    metadataMap?: Map<string, any>
  ): Promise<ProcessedResult> {
    const customId = response.custom_id;

    try {
      // Validate response structure
      const structureValidation = validateBatchResponseItem(response);
      if (!structureValidation.valid) {
        return {
          customId,
          success: false,
          error: `Invalid response structure: ${validator.formatErrors(structureValidation.errors)}`,
        };
      }

      // Check for API errors
      if (response.error) {
        return {
          customId,
          success: false,
          error: `API error: ${response.error.message} (${response.error.code})`,
        };
      }

      // Check response status code
      if (response.response.status_code !== 200) {
        return {
          customId,
          success: false,
          error: `HTTP ${response.response.status_code}`,
        };
      }

      // Check if response was truncated due to token limit
      const finishReason = response.response.body.choices[0]?.finish_reason;
      if (finishReason === 'length') {
        return {
          customId,
          success: false,
          error: `Response truncated - hit token limit (${response.response.body.usage?.completion_tokens || 'unknown'} tokens). Decision too long for extraction.`,
        };
      }

      // Extract message content
      const messageContent =
        response.response.body.choices[0]?.message?.content;

      if (!messageContent) {
        return {
          customId,
          success: false,
          error: 'No content in response',
        };
      }

      // Parse JSON from content
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

      // Validate against schema (with timeout protection)
      let schemaValidation: ValidationResult;
      try {
        schemaValidation = await Promise.race([
          Promise.resolve(validator.validate(this.config.id, parsedData)),
          new Promise<ValidationResult>((_, reject) =>
            setTimeout(() => reject(new Error('Validation timeout after 30s')), 30000)
          )
        ]);
      } catch (error) {
        return {
          customId,
          success: false,
          error: `Validation timeout or error: ${error instanceof Error ? error.message : String(error)}`,
          data: parsedData, // Include data for debugging
        };
      }

      if (!schemaValidation.valid) {
        this.logger.warn('Schema validation failed', {
          customId,
          errors: validator.formatErrors(schemaValidation.errors),
        });

        return {
          customId,
          success: false,
          error: `Schema validation failed: ${validator.formatErrors(schemaValidation.errors)}`,
          data: parsedData, // Include data anyway for debugging
        };
      }

      // Merge metadata if available
      let finalData = parsedData;
      if (metadataMap && metadataMap.has(customId)) {
        const metadata = metadataMap.get(customId);
        // Merge metadata at top level (id, decision_id, language, etc.)
        finalData = {
          ...metadata,
          ...parsedData,
        };
      }

      // Success!
      return {
        customId,
        success: true,
        data: finalData,
        tokenUsage: response.response.body.usage
          ? {
              promptTokens: response.response.body.usage.prompt_tokens,
              completionTokens: response.response.body.usage.completion_tokens,
              totalTokens: response.response.body.usage.total_tokens,
            }
          : undefined,
      };
    } catch (error) {
      this.logger.error('Error processing response', error, { customId });
      return {
        customId,
        success: false,
        error: `Processing error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Read JSONL file and parse each line
   */
  private async readJsonl(filePath: string): Promise<BatchResponseItem[]> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    const items: BatchResponseItem[] = [];

    for (let i = 0; i < lines.length; i++) {
      try {
        const item = JSON.parse(lines[i]) as BatchResponseItem;
        items.push(item);
      } catch (error) {
        this.logger.error(`Failed to parse line ${i + 1}`, error);
        throw new Error(`Invalid JSON at line ${i + 1}: ${lines[i]}`);
      }
    }

    return items;
  }

  /**
   * Load metadata mapping file
   *
   * Derives metadata file path from input JSONL file path and loads the mapping.
   * Returns a Map of custom_id -> metadata object.
   *
   * @param inputFilePath Path to input JSONL file
   * @returns Map of custom_id to metadata fields
   */
  private async loadMetadataMapping(
    inputFilePath: string
  ): Promise<Map<string, any>> {
    // Derive metadata file path
    // Example: input/extract-outcome-2025.jsonl -> input/extract-outcome-2025-metadata.json
    const metadataFilePath = inputFilePath.replace('.jsonl', '-metadata.json');

    try {
      // Check if metadata file exists
      const content = await fs.readFile(metadataFilePath, 'utf-8');
      const mapping = JSON.parse(content);

      // Convert to Map for efficient lookup
      const metadataMap = new Map<string, any>();
      for (const [customId, metadata] of Object.entries(mapping)) {
        metadataMap.set(customId, metadata);
      }

      this.logger.debug('Metadata mapping loaded', {
        path: metadataFilePath,
        recordCount: metadataMap.size,
      });

      return metadataMap;
    } catch (error: any) {
      // If file doesn't exist, return empty map (backwards compatible)
      if (error.code === 'ENOENT') {
        this.logger.debug('No metadata mapping file found (this is OK)', {
          path: metadataFilePath,
        });
        return new Map();
      }

      // Other errors should be logged but not fail the process
      this.logger.warn('Failed to load metadata mapping', {
        path: metadataFilePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return new Map();
    }
  }

  /**
   * Save processed results to files
   */
  private async saveResults(
    outputDir: string,
    results: ProcessedResult[]
  ): Promise<void> {
    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    // Save all results (including failures)
    const allResultsPath = path.join(outputDir, 'all-results.json');
    await fs.writeFile(
      allResultsPath,
      JSON.stringify(results, null, 2),
      'utf-8'
    );

    // Save successful results only
    const successfulResults = results.filter((r) => r.success);
    if (successfulResults.length > 0) {
      const successPath = path.join(outputDir, 'successful-results.json');
      await fs.writeFile(
        successPath,
        JSON.stringify(
          successfulResults.map((r) => ({ customId: r.customId, data: r.data })),
          null,
          2
        ),
        'utf-8'
      );

      // Save just the extracted data (most useful for downstream processing)
      const dataPath = path.join(outputDir, 'extracted-data.json');
      await fs.writeFile(
        dataPath,
        JSON.stringify(
          successfulResults.map((r) => r.data),
          null,
          2
        ),
        'utf-8'
      );
    }

    // Save failures
    const failedResults = results.filter((r) => !r.success);
    if (failedResults.length > 0) {
      const failuresPath = path.join(outputDir, 'failures.json');
      await fs.writeFile(
        failuresPath,
        JSON.stringify(failedResults, null, 2),
        'utf-8'
      );
    }

    // Save summary
    const summary = {
      processedAt: new Date().toISOString(),
      jobType: this.config.id,
      totalRecords: results.length,
      successful: successfulResults.length,
      failed: failedResults.length,
      successRate: `${((successfulResults.length / results.length) * 100).toFixed(1)}%`,
      totalTokens: results.reduce(
        (sum, r) => sum + (r.tokenUsage?.totalTokens || 0),
        0
      ),
      averageTokensPerRequest:
        results.length > 0
          ? Math.round(
              results.reduce(
                (sum, r) => sum + (r.tokenUsage?.totalTokens || 0),
                0
              ) / results.length
            )
          : 0,
    };

    const summaryPath = path.join(outputDir, 'summary.json');
    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

    this.logger.info('Results saved', {
      directory: outputDir,
      files: ['all-results.json', 'successful-results.json', 'extracted-data.json', 'failures.json', 'summary.json'],
    });
  }

  /**
   * Generate error report
   */
  async generateErrorReport(
    results: ProcessedResult[],
    outputPath: string
  ): Promise<void> {
    const failedResults = results.filter((r) => !r.success);

    if (failedResults.length === 0) {
      this.logger.info('No errors to report');
      return;
    }

    const report = {
      generatedAt: new Date().toISOString(),
      totalErrors: failedResults.length,
      errorsByType: this.categorizeErrors(failedResults),
      errors: failedResults.map((r) => ({
        customId: r.customId,
        error: r.error,
        data: r.data,
      })),
    };

    await fs.writeFile(outputPath, JSON.stringify(report, null, 2), 'utf-8');

    this.logger.info('Error report generated', { path: outputPath });
  }

  /**
   * Categorize errors by type
   */
  private categorizeErrors(
    failedResults: ProcessedResult[]
  ): Record<string, number> {
    const categories: Record<string, number> = {};

    for (const result of failedResults) {
      const error = result.error || 'Unknown error';

      let category = 'Other';
      if (error.includes('validation')) {
        category = 'Schema Validation';
      } else if (error.includes('JSON parse')) {
        category = 'JSON Parse Error';
      } else if (error.includes('API error')) {
        category = 'API Error';
      } else if (error.includes('HTTP')) {
        category = 'HTTP Error';
      }

      categories[category] = (categories[category] || 0) + 1;
    }

    return categories;
  }
}
