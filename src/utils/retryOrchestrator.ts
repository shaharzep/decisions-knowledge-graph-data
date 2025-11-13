import { JobConfig } from '../jobs/JobConfig.js';
import { ConcurrentRunner } from '../concurrent/ConcurrentRunner.js';
import { FailureLoader } from './failureLoader.js';
import { RetryPathManager } from './retryPathManager.js';
import { RetryMetadataGenerator } from './retryMetadataGenerator.js';
import { logger } from './logger.js';

/**
 * Retry Options
 */
export interface RetryOptions {
  /** Base directory (default: 'full-data') */
  baseDir?: string;

  /** Filter by failure reason (optional) */
  filterReason?: string;

  /** Dry run - analyze only, don't execute (default: false) */
  dryRun?: boolean;

  /** Concurrency override (optional) */
  concurrencyLimit?: number;
}

/**
 * Retry Orchestrator
 *
 * Main coordinator for retry operations.
 * Handles the complete workflow from loading failures to executing retry.
 *
 * Workflow:
 * 1. Load job configuration
 * 2. Load failures from source run
 * 3. Analyze failures and extract decision keys
 * 4. Prepare retry paths and directories
 * 5. Generate retry metadata
 * 6. Create custom config with failed decision keys
 * 7. Execute concurrent processing
 * 8. Report results
 *
 * Features:
 * - Automatic retry numbering
 * - Comprehensive traceability
 * - Reuses existing ConcurrentRunner
 * - Works with any job configuration
 * - Supports dry-run mode for analysis
 */
export class RetryOrchestrator {
  /**
   * Retry failed decisions from a specific job run
   *
   * @param jobId Job identifier (e.g., 'extract-comprehensive')
   * @param originalTimestamp Source run timestamp (e.g., '2025-10-25T06-02-48-674Z')
   * @param options Retry options
   */
  static async retryFailedDecisions(
    jobId: string,
    originalTimestamp: string,
    options: RetryOptions = {}
  ): Promise<void> {
    const {
      baseDir = 'full-data',
      filterReason,
      dryRun = false,
      concurrencyLimit,
    } = options;

    console.log('\n🔄 Starting Retry Operation\n');
    console.log(`Job: ${jobId}`);
    console.log(`Source run: ${originalTimestamp}`);
    console.log(`Base directory: ${baseDir}`);

    if (dryRun) {
      console.log(`⚠️  DRY RUN MODE - No execution, analysis only\n`);
    } else {
      console.log('');
    }

    try {
      // Step 1: Load job configuration
      console.log('📦 Loading job configuration...');
      const config = await this.loadJobConfig(jobId);
      console.log(`✓ Loaded config for: ${config.id}\n`);

      // Step 2: Load failures
      console.log('📥 Loading failures...');
      let failures = await FailureLoader.loadFailures(jobId, originalTimestamp, baseDir);

      // Apply filter if specified
      if (filterReason) {
        const beforeCount = failures.length;
        failures = FailureLoader.filterByReason(failures, filterReason);
        console.log(`Filtered ${beforeCount} → ${failures.length} failures (reason: ${filterReason})`);
      }

      // Step 3: Analyze failures
      console.log('📊 Analyzing failures...');
      const stats = FailureLoader.analyzeFailures(failures);
      FailureLoader.printAnalysis(stats);

      if (stats.retryable === 0) {
        console.log('⚠️  No retryable failures found. All failures are missing decision_id or language.');
        console.log('Cannot proceed with retry.\n');
        return;
      }

      // Step 4: Extract decision keys
      const decisionKeys = FailureLoader.extractDecisionKeys(failures);

      if (dryRun) {
        console.log('✅ Dry run complete. Exiting without execution.\n');
        return;
      }

      // Step 5: Prepare retry paths
      console.log('📁 Preparing retry directories...');
      const pathManager = new RetryPathManager(jobId, originalTimestamp, baseDir);
      const paths = await pathManager.prepareRetryPaths();
      console.log(`✓ Retry directory: ${paths.retryDirectory}\n`);

      // Step 6: Generate metadata
      console.log('📋 Generating retry metadata...');
      const metadata = await RetryMetadataGenerator.generateMetadata(
        config,
        paths,
        decisionKeys,
        failures.length
      );
      await RetryMetadataGenerator.saveMetadata(metadata, paths.retryDirectory);
      RetryMetadataGenerator.printMetadata(metadata);

      // Step 7: Create custom config for retry with decision keys
      console.log('⚙️  Creating retry configuration...');
      const retryConfig = this.createRetryConfig(config, decisionKeys, paths.retryDirectory, concurrencyLimit);
      console.log(`✓ Config will process ${decisionKeys.length} decisions`);
      console.log(`✓ Custom output directory: ${retryConfig.customOutputDirectory}`);
      console.log(`✓ Use full-data pipeline: ${retryConfig.useFullDataPipeline}\n`);

      // Step 8: Execute concurrent processing
      console.log('⚡ Starting concurrent processing...\n');
      const runner = new ConcurrentRunner(retryConfig, {
        concurrencyLimit: concurrencyLimit || config.concurrencyLimit,
      });

      await runner.run();

      console.log('\n✅ Retry operation completed!\n');
      console.log(`Results: ${paths.retryDirectory}`);
      console.log(`Metadata: ${paths.retryDirectory}/retry-metadata.json\n`);

    } catch (error) {
      logger.error('Retry operation failed', { error });
      console.error('\n❌ Retry operation failed:', error instanceof Error ? error.message : error);
      throw error;
    }
  }

  /**
   * Load job configuration dynamically
   *
   * @param jobId Job identifier
   * @returns Job configuration
   */
  private static async loadJobConfig(jobId: string): Promise<JobConfig> {
    try {
      const configModule = await import(`../jobs/configs/${jobId}.js`);
      return configModule.default;
    } catch (error: any) {
      if (error.code === 'ERR_MODULE_NOT_FOUND') {
        throw new Error(
          `Job configuration not found: ${jobId}\n\n` +
          `Please ensure the job exists at: src/jobs/configs/${jobId}.ts\n` +
          `Available jobs can be listed with: npm run dev list`
        );
      }
      throw error;
    }
  }

  /**
   * Create retry-specific config
   *
   * Creates a clean retry configuration that queries only the failed decisions.
   * Uses a standardized unnest pattern for maximum compatibility.
   *
   * @param originalConfig Original job config
   * @param decisionKeys Decision keys to retry
   * @param retryDirectory Output directory for retry results
   * @param concurrencyLimit Optional concurrency override
   * @returns Modified config for retry
   */
  private static createRetryConfig(
    originalConfig: JobConfig,
    decisionKeys: Array<{ decision_id: string; language: string }>,
    retryDirectory: string,
    concurrencyLimit?: number
  ): JobConfig {
    // Extract arrays for query parameters
    const decisionIds = decisionKeys.map((k) => k.decision_id);
    const languages = decisionKeys.map((k) => k.language);

    // Use a standardized query that works for all jobs
    // Includes all metadata fields to ensure retry results have complete information
    // This matches the pattern from extract-comprehensive but filters to retry set
    const retryDbQuery = `
      SELECT
        d.id,
        d.decision_id,
        d.language_metadata,
        d.decision_type_ecli_code,
        d.court_ecli_code,
        d.decision_date,
        dm.full_md,
        LENGTH(dm.full_md) as md_length
      FROM decisions1 d
      INNER JOIN decisions_md dm
        ON dm.decision_id = d.decision_id
        AND dm.language = d.language_metadata
      INNER JOIN unnest($1::text[], $2::text[]) AS retry_set(decision_id, language)
        ON d.decision_id = retry_set.decision_id
        AND d.language_metadata = retry_set.language
      WHERE dm.full_md IS NOT NULL
        AND dm.full_md != ''
    `.trim();

    const retryDbQueryParams = [decisionIds, languages];

    // Create a copy of the config with modified query
    const retryConfig: JobConfig = {
      ...originalConfig,

      // Override dbQuery to filter only failed decisions
      dbQuery: retryDbQuery,
      dbQueryParams: retryDbQueryParams,

      // Preserve original preprocessRow if it exists
      // This is critical for jobs that load dependencies (e.g., Agent 2C loads Agent 2B data)
      // If no preprocessRow, add minimal one to compute length_category
      preprocessRow: originalConfig.preprocessRow
        ? originalConfig.preprocessRow
        : async (row: any) => {
            // Compute length category based on markdown length
            let length_category = 'unknown';
            if (row.md_length) {
              if (row.md_length < 10000) length_category = 'short';
              else if (row.md_length < 30000) length_category = 'medium';
              else if (row.md_length < 60000) length_category = 'long';
              else length_category = 'very_long';
            }

            return {
              ...row,
              length_category,
            };
          },

      // Override concurrency if specified
      concurrencyLimit: concurrencyLimit !== undefined
        ? concurrencyLimit
        : originalConfig.concurrencyLimit,

      // Force full-data pipeline mode for retries
      // This ensures each retry decision is saved separately
      useFullDataPipeline: true,

      // Set custom output directory to use the prepared retry directory
      // This ensures results go to full-data/<job>/<timestamp>-retry-N/
      customOutputDirectory: retryDirectory,
    };

    return retryConfig;
  }
}
