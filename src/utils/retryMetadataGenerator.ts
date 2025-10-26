import fs from 'fs/promises';
import path from 'path';
import { JobConfig } from '../jobs/JobConfig.js';
import { DecisionKey } from './failureLoader.js';
import { RetryPaths } from './retryPathManager.js';
import { logger } from './logger.js';

/**
 * Retry Metadata
 *
 * Complete traceability information for a retry operation
 */
export interface RetryMetadata {
  /** Retry attempt number (1, 2, 3, etc.) */
  retryNumber: number;

  /** When this retry was executed */
  retryTimestamp: string;

  /** Source run information */
  sourceRun: {
    /** Original timestamp being retried */
    timestamp: string;

    /** Full path to source directory */
    directory: string;

    /** Number of failures from source run */
    totalFailures: number;

    /** Source run summary (if available) */
    summary?: any;
  };

  /** Retry configuration */
  retryConfig: {
    /** Job identifier */
    jobId: string;

    /** Model used */
    model: string;

    /** Reasoning effort setting */
    reasoningEffort?: string;

    /** Concurrency limit */
    concurrencyLimit?: number;

    /** Full-data pipeline mode */
    useFullDataPipeline?: boolean;

    /** Provider (openai/azure) */
    provider?: string;
  };

  /** Decisions being retried */
  decisionsToRetry: DecisionKey[];

  /** Number of decisions to retry */
  retryCount: number;
}

/**
 * Retry Metadata Generator
 *
 * Generates comprehensive metadata for retry operations.
 * Ensures full traceability and auditability.
 *
 * Features:
 * - Captures job configuration
 * - Links to source run
 * - Records retry attempt number
 * - Tracks decisions being retried
 * - Includes timestamps for debugging
 */
export class RetryMetadataGenerator {
  /**
   * Generate retry metadata
   *
   * @param config Job configuration
   * @param paths Retry paths
   * @param decisionKeys Decisions to retry
   * @param totalFailures Total failures from source
   * @returns Complete retry metadata
   */
  static async generateMetadata(
    config: JobConfig,
    paths: RetryPaths,
    decisionKeys: DecisionKey[],
    totalFailures: number
  ): Promise<RetryMetadata> {
    // Load source run summary if available
    const sourceSummary = await this.loadSourceSummary(paths.sourceDirectory);

    const metadata: RetryMetadata = {
      retryNumber: paths.retryNumber,
      retryTimestamp: paths.retryTimestamp,

      sourceRun: {
        timestamp: paths.originalTimestamp,
        directory: paths.sourceDirectory,
        totalFailures,
        summary: sourceSummary,
      },

      retryConfig: {
        jobId: config.id,
        model: config.model || 'unknown',
        reasoningEffort: config.reasoningEffort,
        concurrencyLimit: config.concurrencyLimit,
        useFullDataPipeline: config.useFullDataPipeline,
        provider: config.provider,
      },

      decisionsToRetry: decisionKeys,
      retryCount: decisionKeys.length,
    };

    return metadata;
  }

  /**
   * Save metadata to retry directory
   *
   * @param metadata Retry metadata
   * @param retryDirectory Path to retry directory
   */
  static async saveMetadata(
    metadata: RetryMetadata,
    retryDirectory: string
  ): Promise<void> {
    const metadataPath = path.join(retryDirectory, 'retry-metadata.json');

    await fs.writeFile(
      metadataPath,
      JSON.stringify(metadata, null, 2),
      'utf-8'
    );

    logger.info(`Saved retry metadata: ${metadataPath}`);
  }

  /**
   * Load source run summary (if exists)
   *
   * @param sourceDirectory Source run directory
   * @returns Summary data or undefined
   */
  private static async loadSourceSummary(
    sourceDirectory: string
  ): Promise<any | undefined> {
    const summaryPath = path.join(sourceDirectory, 'summary.json');

    try {
      const content = await fs.readFile(summaryPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      // Summary not available - not critical
      return undefined;
    }
  }

  /**
   * Print metadata to console
   *
   * User-friendly display of retry information
   *
   * @param metadata Retry metadata
   */
  static printMetadata(metadata: RetryMetadata): void {
    console.log('\n📋 Retry Configuration:\n');
    console.log(`Retry attempt: #${metadata.retryNumber}`);
    console.log(`Source run: ${metadata.sourceRun.timestamp}`);
    console.log(`Original failures: ${metadata.sourceRun.totalFailures}`);
    console.log(`Retrying: ${metadata.retryCount} decisions`);

    if (metadata.sourceRun.totalFailures > metadata.retryCount) {
      const skipped = metadata.sourceRun.totalFailures - metadata.retryCount;
      console.log(`Skipped: ${skipped} (missing decision_id or language)`);
    }

    console.log('\nJob configuration:');
    console.log(`  Model: ${metadata.retryConfig.model}`);

    if (metadata.retryConfig.reasoningEffort) {
      console.log(`  Reasoning effort: ${metadata.retryConfig.reasoningEffort}`);
    }

    if (metadata.retryConfig.concurrencyLimit) {
      console.log(`  Concurrency: ${metadata.retryConfig.concurrencyLimit}`);
    }

    if (metadata.retryConfig.useFullDataPipeline !== undefined) {
      console.log(
        `  Pipeline: ${metadata.retryConfig.useFullDataPipeline ? 'full-data' : 'standard'}`
      );
    }

    console.log('');
  }

  /**
   * Load retry metadata from directory
   *
   * @param retryDirectory Path to retry directory
   * @returns Retry metadata or null if not found
   */
  static async loadMetadata(
    retryDirectory: string
  ): Promise<RetryMetadata | null> {
    const metadataPath = path.join(retryDirectory, 'retry-metadata.json');

    try {
      const content = await fs.readFile(metadataPath, 'utf-8');
      return JSON.parse(content);
    } catch (error) {
      return null;
    }
  }
}
