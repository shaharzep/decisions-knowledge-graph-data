import fs from 'fs/promises';
import path from 'path';
import { JobConfig } from '../jobs/JobConfig.js';
import { JobLogger } from '../utils/logger.js';
import {
  validator,
  ValidationResult,
} from '../utils/validators.js';

/**
 * Processed Result (concurrent execution)
 */
export interface ProcessedResult {
  customId: string;
  success: boolean;
  data?: any;
  metadata?: any; // Metadata to merge after validation
  error?: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/**
 * Concurrent Processing Summary
 */
export interface ConcurrentSummary {
  processedAt: string;
  jobType: string;
  model: string;
  totalRecords: number;
  successfulRecords: number;
  failedRecords: number;
  validationErrors: number;
  totalTokens: number;
  averageTokensPerRequest: number;
  successRate: string;
  outputDirectory: string;
  errorsByType?: Record<string, number>;
}

/**
 * Concurrent Processor
 *
 * Validates results against schema and saves output files.
 * Mirrors ResultProcessor behavior but for concurrent execution.
 */
export class ConcurrentProcessor {
  private config: JobConfig;
  private logger: JobLogger;

  constructor(config: JobConfig) {
    this.config = config;
    this.logger = new JobLogger(`ConcurrentProcessor:${config.id}`);

    // Compile the output schema for validation
    validator.compileSchema(config.id, config.outputSchema);
  }

  /**
   * Process all concurrent results
   *
   * @param results Array of processed results from concurrent execution
   * @returns Processing summary
   */
  async process(results: ProcessedResult[]): Promise<ConcurrentSummary> {
    this.logger.info('Starting result processing', {
      totalResults: results.length,
    });

    try {
      // Validate and enrich results
      const validatedResults: ProcessedResult[] = [];
      let validationErrors = 0;
      let totalTokens = 0;

      for (const result of results) {
        // If already failed (API error, timeout, etc.), skip validation
        if (!result.success) {
          validatedResults.push(result);
          continue;
        }

        // Validate against schema (BEFORE merging metadata)
        const schemaValidation = this.validateExtractedData(result.data);

        if (!schemaValidation.valid) {
          this.logger.warn('Schema validation failed', {
            customId: result.customId,
            errors: validator.formatErrors(schemaValidation.errors),
          });

          validationErrors++;
          validatedResults.push({
            ...result,
            success: false,
            error: `Schema validation failed: ${validator.formatErrors(schemaValidation.errors)}`,
          });
        } else {
          // Validation passed - now merge metadata if available
          let finalData = result.data;
          if (result.metadata) {
            finalData = {
              ...result.metadata,
              ...result.data,
            };
          }

          validatedResults.push({
            ...result,
            data: finalData,
          });
        }

        // Accumulate token usage
        if (result.tokenUsage) {
          totalTokens += result.tokenUsage.totalTokens;
        }
      }

      // Save results to files
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const modelName = this.config.model || this.config.deploymentName || 'unknown-model';
      const outputDir = path.join(
        process.cwd(),
        'concurrent',
        'results',
        this.config.id,
        modelName,
        timestamp
      );

      await this.saveResults(outputDir, validatedResults);

      // Generate summary
      const summary = this.generateSummary(validatedResults, outputDir, totalTokens, validationErrors);

      this.logger.info('Result processing completed', summary);

      return summary;
    } catch (error) {
      this.logger.error('Result processing failed', error);
      throw error;
    }
  }

  /**
   * Validate extracted data against schema
   *
   * @param data Extracted data from API response
   * @returns Validation result
   */
  private validateExtractedData(data: any): ValidationResult {
    try {
      return validator.validate(this.config.id, data);
    } catch (error) {
      return {
        valid: false,
        errors: [],
      };
    }
  }

  /**
   * Save processed results to files
   *
   * @param outputDir Output directory path
   * @param results Validated results
   */
  private async saveResults(
    outputDir: string,
    results: ProcessedResult[]
  ): Promise<void> {
    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    this.logger.info('Saving results to directory', { outputDir });

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

    this.logger.info('Results saved successfully', {
      directory: outputDir,
      successful: successfulResults.length,
      failed: failedResults.length,
    });
  }

  /**
   * Generate processing summary
   *
   * @param results All validated results
   * @param outputDir Output directory path
   * @param totalTokens Total token count
   * @param validationErrors Count of validation errors
   * @returns Summary object
   */
  private generateSummary(
    results: ProcessedResult[],
    outputDir: string,
    totalTokens: number,
    validationErrors: number
  ): ConcurrentSummary {
    const successfulResults = results.filter((r) => r.success);
    const failedResults = results.filter((r) => !r.success);

    const summary: ConcurrentSummary = {
      processedAt: new Date().toISOString(),
      jobType: this.config.id,
      model: this.config.model || this.config.deploymentName || 'unknown-model',
      totalRecords: results.length,
      successfulRecords: successfulResults.length,
      failedRecords: failedResults.length,
      validationErrors,
      totalTokens,
      averageTokensPerRequest:
        results.length > 0
          ? Math.round(totalTokens / results.length)
          : 0,
      successRate: `${((successfulResults.length / results.length) * 100).toFixed(1)}%`,
      outputDirectory: outputDir,
      errorsByType: this.categorizeErrors(failedResults),
    };

    // Save summary file
    const summaryPath = path.join(outputDir, 'summary.json');
    fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8').catch((err) => {
      this.logger.error('Failed to save summary file', err);
    });

    return summary;
  }

  /**
   * Categorize errors by type
   *
   * @param failedResults Failed results
   * @returns Error counts by category
   */
  private categorizeErrors(failedResults: ProcessedResult[]): Record<string, number> {
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
      } else if (error.includes('timeout')) {
        category = 'Timeout';
      } else if (error.includes('rate limit')) {
        category = 'Rate Limit';
      }

      categories[category] = (categories[category] || 0) + 1;
    }

    return categories;
  }
}
