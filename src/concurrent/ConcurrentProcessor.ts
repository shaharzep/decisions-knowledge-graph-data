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
 * Experiment Configuration Snapshot
 *
 * Captures all critical model and processing settings from JobConfig
 * at the time of execution for full reproducibility.
 */
export interface ExperimentConfig {
  provider: 'azure' | 'openai' | 'anthropic';
  model: string;
  maxCompletionTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  verbosity?: 'minimal' | 'low' | 'medium' | 'high';
  outputSchemaName?: string;
  concurrencyLimit?: number;
  useFullDataPipeline: boolean;
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
  fullDataDirectory?: string;
  jsonDirectory?: string;
  errorsByType?: Record<string, number>;
  experimentConfig: ExperimentConfig;
}

interface FailureRecord {
  customId: string;
  reason: string;
  error: string;
  decision_id: string | null;
  language: string | null;
  metadata?: Record<string, any>;
}

/**
 * Concurrent Processor
 *
 * Validates results against schema and saves output files.
 * Supports two modes via config.useFullDataPipeline:
 *
 * 1. Standard Pipeline (default):
 *    - Creates 4 aggregated JSON files in concurrent/results/
 *    - Required for dependency resolution
 *    - All data in memory
 *
 * 2. Full-Data Pipeline (opt-in):
 *    - Creates per-decision JSON files in full-data/
 *    - Incremental streaming for durability
 *    - Suitable for large datasets
 */
export class ConcurrentProcessor {
  private config: JobConfig;
  private logger: JobLogger;
  private streamingState?: {
    jsonDirectory: string;
    successCount: number;
    failures: FailureRecord[];
    errorsByType: Record<string, number>;
    totalTokens: number;
  };

  constructor(config: JobConfig) {
    this.config = config;
    this.logger = new JobLogger(`ConcurrentProcessor:${config.id}`);

    // Compile the output schema for validation
    validator.compileSchema(config.id, config.outputSchema);
  }

  /**
   * Create streaming callback for incremental file writes (full-data pipeline only)
   *
   * Sets up output directories and returns a callback that validates and writes
   * each result immediately as it completes.
   *
   * @returns Callback function for streaming writes
   */
  async createStreamingCallback(): Promise<(result: ProcessedResult) => Promise<void>> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Use custom output directory if specified (for retry operations)
    // Otherwise generate default path with timestamp
    const fullDataDirectory = this.config.customOutputDirectory ||
      path.join(process.cwd(), 'full-data', this.config.id, timestamp);
    const jsonDirectory = path.join(fullDataDirectory, 'jsons');

    // Create output directory
    await fs.mkdir(jsonDirectory, { recursive: true });

    // Initialize streaming state
    this.streamingState = {
      jsonDirectory,
      successCount: 0,
      failures: [],
      errorsByType: {},
      totalTokens: 0,
    };

    this.logger.info('Streaming callback initialized', {
      jsonDirectory,
      usingCustomPath: !!this.config.customOutputDirectory,
      customOutputDirectory: this.config.customOutputDirectory,
    });

    // Return callback that validates and writes immediately
    return async (result: ProcessedResult) => {
      if (!this.streamingState) {
        throw new Error('Streaming state not initialized');
      }

      const metadata = result.metadata ?? {};
      const decisionId = this.extractDecisionId(metadata);
      const language = this.extractLanguage(metadata);

      // Handle request failures
      if (!result.success) {
        this.recordFailure(
          this.streamingState.failures,
          this.streamingState.errorsByType,
          'Request Error',
          result.error || 'Unknown error',
          result.customId,
          metadata,
          decisionId,
          language
        );
        return;
      }

      // Validate schema
      const schemaValidation = this.validateExtractedData(result.data);

      if (!schemaValidation.valid) {
        const validationMessage = validator.formatErrors(schemaValidation.errors);
        this.recordFailure(
          this.streamingState.failures,
          this.streamingState.errorsByType,
          'Schema Validation',
          `Schema validation failed: ${validationMessage}`,
          result.customId,
          metadata,
          decisionId,
          language
        );
        return;
      }

      // Apply post-processing if defined
      let processedData = result.data;
      if (this.config.postProcessRow) {
        try {
          processedData = await this.config.postProcessRow(metadata, processedData);
        } catch (postProcessError) {
          this.recordFailure(
            this.streamingState.failures,
            this.streamingState.errorsByType,
            'Post-Processing Error',
            `postProcessRow failed: ${postProcessError instanceof Error ? postProcessError.message : String(postProcessError)}`,
            result.customId,
            metadata,
            decisionId,
            language
          );
          return;
        }
      }

      // Success - merge metadata and write immediately
      const finalData = metadata && Object.keys(metadata).length > 0
        ? { ...metadata, ...processedData }
        : processedData;

      try {
        await this.writeSuccessJson(
          this.streamingState.jsonDirectory,
          finalData,
          decisionId,
          language,
          result.customId,
          metadata
        );
        this.streamingState.successCount++;
        if (result.tokenUsage) {
          this.streamingState.totalTokens += result.tokenUsage.totalTokens;
        }
      } catch (writeError) {
        this.recordFailure(
          this.streamingState.failures,
          this.streamingState.errorsByType,
          'Write Error',
          writeError instanceof Error ? writeError.message : String(writeError),
          result.customId,
          metadata,
          decisionId,
          language
        );
      }
    };
  }

  /**
   * Process all concurrent results
   *
   * Routes to appropriate pipeline based on config.useFullDataPipeline
   *
   * @param results Array of processed results from concurrent execution
   * @returns Processing summary
   */
  async process(results: ProcessedResult[]): Promise<ConcurrentSummary> {
    this.logger.info('Starting result processing', {
      totalResults: results.length,
      pipeline: this.config.useFullDataPipeline ? 'full-data' : 'standard',
      streamingUsed: !!this.streamingState,
    });

    if (this.config.useFullDataPipeline && this.streamingState) {
      return this.finalizeStreamingResults(results);
    } else if (this.config.useFullDataPipeline) {
      return this.processFullDataPipeline(results);
    } else {
      return this.processStandardPipeline(results);
    }
  }

  /**
   * Finalize Streaming Results
   *
   * Called when streaming callback was used.
   * Individual JSONs already written - just create summary and failures files.
   */
  private async finalizeStreamingResults(results: ProcessedResult[]): Promise<ConcurrentSummary> {
    if (!this.streamingState) {
      throw new Error('Streaming state not found - createStreamingCallback must be called first');
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const modelName = this.config.model || 'unknown-model';

    // Extract directory from jsonDirectory (remove /jsons suffix)
    const fullDataDirectory = path.dirname(this.streamingState.jsonDirectory);

    const legacyOutputDir = path.join(
      process.cwd(),
      'concurrent',
      'results',
      this.config.id,
      modelName,
      timestamp
    );

    await fs.mkdir(legacyOutputDir, { recursive: true });

    const totalRecords = results.length;
    const successfulRecords = this.streamingState.successCount;
    const failedRecords = this.streamingState.failures.length;
    const validationErrors = this.streamingState.failures.filter(
      f => f.reason === 'Schema Validation'
    ).length;

    const summary: ConcurrentSummary = {
      processedAt: new Date().toISOString(),
      jobType: this.config.id,
      model: modelName,
      totalRecords,
      successfulRecords,
      failedRecords,
      validationErrors,
      totalTokens: this.streamingState.totalTokens,
      averageTokensPerRequest: totalRecords > 0 ? Math.round(this.streamingState.totalTokens / totalRecords) : 0,
      successRate: totalRecords > 0 ? `${((successfulRecords / totalRecords) * 100).toFixed(1)}%` : '0.0%',
      outputDirectory: fullDataDirectory,
      fullDataDirectory,
      jsonDirectory: this.streamingState.jsonDirectory,
      errorsByType: this.streamingState.errorsByType,
      experimentConfig: this.extractExperimentConfig(),
    };

    // Write summary and failures to both locations
    await Promise.all([
      this.persistRunArtifacts(fullDataDirectory, summary, this.streamingState.failures),
      this.persistRunArtifacts(legacyOutputDir, summary, this.streamingState.failures),
    ]);

    this.logger.info('Streaming results finalized', {
      fullDataDirectory,
      jsonDirectory: this.streamingState.jsonDirectory,
      legacyOutputDirectory: legacyOutputDir,
      successfulRecords,
      failedRecords,
      validationErrors,
    });

    // Clear streaming state
    this.streamingState = undefined;

    return summary;
  }

  /**
   * Standard Pipeline (Default)
   *
   * Creates 5 aggregated JSON files:
   * - all-results.json: All results (successes + failures)
   * - extracted-data.json: Model outputs with metadata (successes only)
   * - successful-results.json: Same as extracted-data (kept for backward compatibility)
   * - failures.json: Array of failures
   * - summary.json: Statistics
   *
   * All data accumulated in memory, written at end.
   * Required for dependency resolution and evaluation.
   */
  private async processStandardPipeline(results: ProcessedResult[]): Promise<ConcurrentSummary> {
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

    await fs.mkdir(outputDir, { recursive: true });

    // Accumulate results in memory
    const extractedData: any[] = [];
    const successfulResults: any[] = [];
    const allResults: any[] = []; // All results (successes + failures)
    const failures: FailureRecord[] = [];
    const errorsByType: Record<string, number> = {};

    let validationErrors = 0;
    let totalTokens = 0;

    // Process each result
    for (const result of results) {
      const metadata = result.metadata ?? {};
      const decisionId = this.extractDecisionId(metadata);
      const language = this.extractLanguage(metadata);

      // Handle request failures
      if (!result.success) {
        this.recordFailure(
          failures,
          errorsByType,
          'Request Error',
          result.error || 'Unknown error',
          result.customId,
          metadata,
          decisionId,
          language
        );
        // Add to all-results with failure info
        allResults.push({
          customId: result.customId,
          success: false,
          error: result.error,
          metadata,
          tokenUsage: result.tokenUsage,
        });
        continue;
      }

      // Validate schema
      const schemaValidation = this.validateExtractedData(result.data);

      if (!schemaValidation.valid) {
        validationErrors++;
        const validationMessage = validator.formatErrors(schemaValidation.errors);
        this.recordFailure(
          failures,
          errorsByType,
          'Schema Validation',
          `Schema validation failed: ${validationMessage}`,
          result.customId,
          metadata,
          decisionId,
          language
        );
        // Add to all-results with validation failure
        allResults.push({
          customId: result.customId,
          success: false,
          error: `Schema validation failed: ${validationMessage}`,
          data: result.data,
          metadata,
          tokenUsage: result.tokenUsage,
        });
        continue;
      }

      // Apply post-processing if defined
      let processedData = result.data;
      if (this.config.postProcessRow) {
        try {
          processedData = await this.config.postProcessRow(metadata, processedData);
        } catch (postProcessError) {
          validationErrors++;
          this.recordFailure(
            failures,
            errorsByType,
            'Post-Processing Error',
            `postProcessRow failed: ${postProcessError instanceof Error ? postProcessError.message : String(postProcessError)}`,
            result.customId,
            metadata,
            decisionId,
            language
          );
          allResults.push({
            customId: result.customId,
            success: false,
            error: `Post-processing failed: ${postProcessError instanceof Error ? postProcessError.message : String(postProcessError)}`,
            data: result.data,
            metadata,
            tokenUsage: result.tokenUsage,
          });
          continue;
        }
      }

      // Success - merge metadata with model output
      const dataWithMetadata = metadata && Object.keys(metadata).length > 0
        ? { ...metadata, ...processedData }
        : processedData;

      // Both extracted-data and successful-results include metadata
      // This ensures evaluation and dependency systems always have decision_id, language, etc.
      extractedData.push(dataWithMetadata);
      successfulResults.push(dataWithMetadata);

      // Add to all-results with success
      allResults.push({
        customId: result.customId,
        success: true,
        data: dataWithMetadata,
        metadata,
        tokenUsage: result.tokenUsage,
      });

      if (result.tokenUsage) {
        totalTokens += result.tokenUsage.totalTokens;
      }
    }

    const totalRecords = results.length;
    const successfulRecords = extractedData.length;
    const failedRecords = failures.length;

    const summary: ConcurrentSummary = {
      processedAt: new Date().toISOString(),
      jobType: this.config.id,
      model: modelName,
      totalRecords,
      successfulRecords,
      failedRecords,
      validationErrors,
      totalTokens,
      averageTokensPerRequest: totalRecords > 0 ? Math.round(totalTokens / totalRecords) : 0,
      successRate: totalRecords > 0 ? `${((successfulRecords / totalRecords) * 100).toFixed(1)}%` : '0.0%',
      outputDirectory: outputDir,
      errorsByType,
      experimentConfig: this.extractExperimentConfig(),
    };

    // Write all 5 files
    await Promise.all([
      fs.writeFile(
        path.join(outputDir, 'all-results.json'),
        JSON.stringify(allResults, null, 2),
        'utf-8'
      ),
      fs.writeFile(
        path.join(outputDir, 'extracted-data.json'),
        JSON.stringify(extractedData, null, 2),
        'utf-8'
      ),
      fs.writeFile(
        path.join(outputDir, 'successful-results.json'),
        JSON.stringify(successfulResults, null, 2),
        'utf-8'
      ),
      fs.writeFile(
        path.join(outputDir, 'failures.json'),
        JSON.stringify(failures, null, 2),
        'utf-8'
      ),
      fs.writeFile(
        path.join(outputDir, 'summary.json'),
        JSON.stringify(summary, null, 2),
        'utf-8'
      ),
    ]);

    this.logger.info('Standard pipeline completed', {
      outputDirectory: outputDir,
      successfulRecords,
      failedRecords,
      validationErrors,
    });

    return summary;
  }

  /**
   * Full-Data Pipeline (Opt-in via config.useFullDataPipeline = true)
   *
   * Creates per-decision JSON files for durability during long runs.
   * - Streams each success to full-data/<job>/<timestamp>/jsons/<decisionId>_<language>.json
   * - Writes summary.json and failures.json to full-data/<job>/<timestamp>/
   * - Also writes summary & failures to concurrent/results/ for backward compatibility
   *
   * Suitable for large datasets (50k+ decisions).
   */
  private async processFullDataPipeline(results: ProcessedResult[]): Promise<ConcurrentSummary> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const modelName = this.config.model || this.config.deploymentName || 'unknown-model';

    // Use custom output directory if specified (for retry operations)
    // Otherwise generate default path
    const fullDataDirectory = this.config.customOutputDirectory ||
      path.join(process.cwd(), 'full-data', this.config.id, timestamp);
    const jsonDirectory = path.join(fullDataDirectory, 'jsons');

    this.logger.debug('Full-data pipeline paths', {
      customOutputDirectory: this.config.customOutputDirectory,
      fullDataDirectory,
      jsonDirectory,
      usingCustomPath: !!this.config.customOutputDirectory,
    });

    const legacyOutputDir = path.join(
      process.cwd(),
      'concurrent',
      'results',
      this.config.id,
      modelName,
      timestamp
    );

    // Create both directories
    await Promise.all([
      fs.mkdir(jsonDirectory, { recursive: true }),
      fs.mkdir(legacyOutputDir, { recursive: true }),
    ]);

    const failures: FailureRecord[] = [];
    const errorsByType: Record<string, number> = {};

    let successfulRecords = 0;
    let failedRecords = 0;
    let validationErrors = 0;
    let totalTokens = 0;

    // Process each result incrementally
    for (const result of results) {
      const metadata = result.metadata ?? {};
      const decisionId = this.extractDecisionId(metadata);
      const language = this.extractLanguage(metadata);

      // Handle request failures
      if (!result.success) {
        failedRecords++;
        this.recordFailure(
          failures,
          errorsByType,
          'Request Error',
          result.error || 'Unknown error',
          result.customId,
          metadata,
          decisionId,
          language
        );
        continue;
      }

      // Validate schema
      const schemaValidation = this.validateExtractedData(result.data);

      if (!schemaValidation.valid) {
        validationErrors++;
        failedRecords++;
        const validationMessage = validator.formatErrors(schemaValidation.errors);
        this.recordFailure(
          failures,
          errorsByType,
          'Schema Validation',
          `Schema validation failed: ${validationMessage}`,
          result.customId,
          metadata,
          decisionId,
          language
        );
        continue;
      }

      // Apply post-processing if defined
      let processedData = result.data;
      if (this.config.postProcessRow) {
        try {
          processedData = await this.config.postProcessRow(metadata, processedData);
        } catch (postProcessError) {
          validationErrors++;
          failedRecords++;
          this.recordFailure(
            failures,
            errorsByType,
            'Post-Processing Error',
            `postProcessRow failed: ${postProcessError instanceof Error ? postProcessError.message : String(postProcessError)}`,
            result.customId,
            metadata,
            decisionId,
            language
          );
          continue;
        }
      }

      // Success - merge metadata and write immediately
      const finalData = metadata && Object.keys(metadata).length > 0
        ? { ...metadata, ...processedData }
        : processedData;

      try {
        await this.writeSuccessJson(jsonDirectory, finalData, decisionId, language, result.customId, metadata);
        successfulRecords++;
        if (result.tokenUsage) {
          totalTokens += result.tokenUsage.totalTokens;
        }
      } catch (writeError) {
        failedRecords++;
        this.recordFailure(
          failures,
          errorsByType,
          'Write Error',
          writeError instanceof Error ? writeError.message : String(writeError),
          result.customId,
          metadata,
          decisionId,
          language
        );
      }
    }

    const totalRecords = results.length;
    const summary: ConcurrentSummary = {
      processedAt: new Date().toISOString(),
      jobType: this.config.id,
      model: modelName,
      totalRecords,
      successfulRecords,
      failedRecords,
      validationErrors,
      totalTokens,
      averageTokensPerRequest: totalRecords > 0 ? Math.round(totalTokens / totalRecords) : 0,
      successRate: totalRecords > 0 ? `${((successfulRecords / totalRecords) * 100).toFixed(1)}%` : '0.0%',
      outputDirectory: fullDataDirectory,
      fullDataDirectory,
      jsonDirectory,
      errorsByType,
      experimentConfig: this.extractExperimentConfig(),
    };

    // Write summary and failures to both locations
    await Promise.all([
      this.persistRunArtifacts(fullDataDirectory, summary, failures),
      this.persistRunArtifacts(legacyOutputDir, summary, failures),
    ]);

    this.logger.info('Full-data pipeline completed', {
      fullDataDirectory,
      jsonDirectory,
      legacyOutputDirectory: legacyOutputDir,
      successfulRecords,
      failedRecords,
      validationErrors,
    });

    return summary;
  }

  /**
   * Extract experiment configuration for metadata tracking
   *
   * Captures all settings that affect model behavior and output for full reproducibility.
   */
  private extractExperimentConfig(): ExperimentConfig {
    return {
      provider: this.config.provider || 'azure',
      model: this.config.model || this.config.deploymentName || 'unknown',
      maxCompletionTokens: this.config.maxCompletionTokens,
      temperature: this.config.temperature,
      reasoningEffort: this.config.reasoningEffort,
      verbosity: this.config.verbosity,
      outputSchemaName: this.config.outputSchemaName,
      concurrencyLimit: this.config.concurrencyLimit,
      useFullDataPipeline: this.config.useFullDataPipeline || false,
    };
  }

  /**
   * Validate extracted data against schema
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
   * Record a failure with enriched metadata
   */
  private recordFailure(
    failures: FailureRecord[],
    errorsByType: Record<string, number>,
    reason: string,
    message: string,
    customId: string,
    metadata: Record<string, any>,
    decisionId: string | null,
    language: string | null
  ): void {
    errorsByType[reason] = (errorsByType[reason] || 0) + 1;
    failures.push({
      customId,
      reason,
      error: message,
      decision_id: decisionId,
      language,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  }

  /**
   * Extract decision_id from metadata (multiple field fallbacks)
   */
  private extractDecisionId(metadata: Record<string, any>): string | null {
    return (
      metadata.decision_id ??
      metadata.decisionId ??
      metadata.id ??
      null
    );
  }

  /**
   * Extract language from metadata (multiple field fallbacks)
   */
  private extractLanguage(metadata: Record<string, any>): string | null {
    return (
      metadata.language ??
      metadata.language_metadata ??
      metadata.proceduralLanguage ??
      metadata.procedureLanguage ??
      null
    );
  }

  /**
   * Write success JSON to per-decision file (full-data pipeline only)
   */
  private async writeSuccessJson(
    directory: string,
    data: any,
    decisionId: string | null,
    language: string | null,
    fallbackId: string,
    metadata: Record<string, any> = {}
  ): Promise<void> {
    const safeName = ConcurrentProcessor.generateFileName(metadata, decisionId, language, fallbackId);
    const filePath = path.join(directory, `${safeName}.json`);

    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * Generate filename based on metadata (public static for reuse by ConcurrentRunner)
   */
  public static generateFileName(
    metadata: Record<string, any>,
    decisionId: string | null,
    language: string | null,
    fallbackId: string
  ): string {
    let baseName: string;

    // Priority 1: Internal Parent Act ID (for provision mapping)
    if (metadata.internal_parent_act_id) {
      baseName = String(metadata.internal_parent_act_id);
    }
    // Priority 2: Internal Decision ID (for cited decision mapping)
    else if (metadata.internal_decision_id) {
      baseName = String(metadata.internal_decision_id);
    }
    // Priority 3: Decision ID + Language (for decision-based jobs)
    else {
      const parts: string[] = [];
      if (decisionId) parts.push(decisionId);
      if (language) parts.push(language);
      baseName = parts.length > 0 ? parts.join('_') : fallbackId;
    }

    return ConcurrentProcessor.sanitizeFileName(baseName);
  }

  /**
   * Sanitize filename to remove unsafe characters
   */
  public static sanitizeFileName(name: string): string {
    const sanitized = name.replace(/[^a-zA-Z0-9._-]+/g, '_');
    
    // Truncate to 200 chars to avoid ENAMETOOLONG
    if (sanitized.length > 200) {
      // Create a simple hash of the full name to ensure uniqueness even after truncation
      let hash = 0;
      for (let i = 0; i < name.length; i++) {
        const char = name.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
      }
      const hashSuffix = Math.abs(hash).toString(16);
      
      return `${sanitized.substring(0, 190)}_${hashSuffix}`;
    }
    
    return sanitized;
  }



  /**
   * Persist summary and failures to directory
   */
  private async persistRunArtifacts(
    directory: string,
    summary: ConcurrentSummary,
    failures: FailureRecord[]
  ): Promise<void> {
    await fs.mkdir(directory, { recursive: true });

    await Promise.all([
      fs.writeFile(
        path.join(directory, 'summary.json'),
        JSON.stringify(summary, null, 2),
        'utf-8'
      ),
      fs.writeFile(
        path.join(directory, 'failures.json'),
        JSON.stringify(failures, null, 2),
        'utf-8'
      ),
    ]);
  }
}
