import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

/**
 * Failure Record Structure
 *
 * Matches the structure written by ConcurrentProcessor
 */
export interface FailureRecord {
  customId: string;
  reason: string;
  error: string;
  decision_id: string | null;
  language: string | null;
  metadata?: Record<string, any>;
}

/**
 * Decision Key for Database Query
 *
 * Minimal information needed to re-fetch a decision from database
 */
export interface DecisionKey {
  decision_id: string;
  language: string;
}

/**
 * Failure Statistics
 */
export interface FailureStats {
  total: number;
  byReason: Record<string, number>;
  withoutDecisionId: number;
  withoutLanguage: number;
  retryable: number;
}

/**
 * Failure Loader
 *
 * Loads and validates failure records from a completed job run.
 * Provides utilities to extract decision keys for retry and analyze failure patterns.
 *
 * Features:
 * - Validates failures.json structure
 * - Filters out non-retryable failures (missing decision_id or language)
 * - Provides failure statistics for analysis
 * - Type-safe extraction of decision keys
 */
export class FailureLoader {
  /**
   * Load failures from a specific job run
   *
   * @param jobId Job identifier (e.g., 'extract-comprehensive')
   * @param timestamp Run timestamp (e.g., '2025-10-25T06-02-48-674Z')
   * @param baseDir Base directory ('full-data' or 'concurrent/results')
   * @returns Array of failure records
   * @throws Error if failures.json not found or invalid
   */
  static async loadFailures(
    jobId: string,
    timestamp: string,
    baseDir: string = 'full-data'
  ): Promise<FailureRecord[]> {
    const failuresPath = this.buildFailuresPath(jobId, timestamp, baseDir);

    logger.info(`Loading failures from: ${failuresPath}`);

    try {
      const content = await fs.readFile(failuresPath, 'utf-8');
      const failures = JSON.parse(content);

      // Validate structure
      if (!Array.isArray(failures)) {
        throw new Error(
          `Invalid failures.json format: expected array, got ${typeof failures}`
        );
      }

      logger.info(`Loaded ${failures.length} failure records`);
      return failures;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          `Failures file not found: ${failuresPath}\n\n` +
          `Please ensure the job run completed and generated a failures.json file.`
        );
      }

      if (error instanceof SyntaxError) {
        throw new Error(
          `Failed to parse failures.json: ${error.message}\n` +
          `File may be corrupted: ${failuresPath}`
        );
      }

      throw error;
    }
  }

  /**
   * Extract retryable decision keys from failures
   *
   * Filters out failures missing decision_id or language,
   * as these cannot be re-queried from database.
   *
   * @param failures Array of failure records
   * @returns Array of decision keys ready for retry
   */
  static extractDecisionKeys(failures: FailureRecord[]): DecisionKey[] {
    const keys: DecisionKey[] = [];
    const seen = new Set<string>();

    for (const failure of failures) {
      // Skip if missing required fields
      if (!failure.decision_id || !failure.language) {
        logger.warn(
          `Skipping failure without decision_id or language: ${failure.customId}`
        );
        continue;
      }

      // Deduplicate (same decision might have failed multiple times)
      const key = `${failure.decision_id}|${failure.language}`;
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      keys.push({
        decision_id: failure.decision_id,
        language: failure.language,
      });
    }

    logger.info(
      `Extracted ${keys.length} unique retryable decisions from ${failures.length} failures`
    );

    return keys;
  }

  /**
   * Analyze failure patterns
   *
   * Provides statistics about failures for debugging and decision-making.
   *
   * @param failures Array of failure records
   * @returns Failure statistics
   */
  static analyzeFailures(failures: FailureRecord[]): FailureStats {
    const byReason: Record<string, number> = {};
    let withoutDecisionId = 0;
    let withoutLanguage = 0;
    let retryable = 0;

    for (const failure of failures) {
      // Count by reason
      byReason[failure.reason] = (byReason[failure.reason] || 0) + 1;

      // Check retryability
      if (!failure.decision_id) withoutDecisionId++;
      if (!failure.language) withoutLanguage++;
      if (failure.decision_id && failure.language) retryable++;
    }

    return {
      total: failures.length,
      byReason,
      withoutDecisionId,
      withoutLanguage,
      retryable,
    };
  }

  /**
   * Filter failures by reason
   *
   * Useful for selective retry (e.g., only retry rate limit errors)
   *
   * @param failures Array of failure records
   * @param reason Reason to filter by
   * @returns Filtered array of failures
   */
  static filterByReason(
    failures: FailureRecord[],
    reason: string
  ): FailureRecord[] {
    return failures.filter((f) => f.reason === reason);
  }

  /**
   * Build path to failures.json
   *
   * Handles both full-data and concurrent/results directory structures
   *
   * @param jobId Job identifier
   * @param timestamp Run timestamp
   * @param baseDir Base directory
   * @returns Full path to failures.json
   */
  private static buildFailuresPath(
    jobId: string,
    timestamp: string,
    baseDir: string
  ): string {
    if (baseDir === 'full-data') {
      return path.join(process.cwd(), 'full-data', jobId, timestamp, 'failures.json');
    } else {
      // For concurrent/results, we need to find the model subdirectory
      // For now, assume structure is known or we search
      // This is simplified - may need enhancement
      return path.join(process.cwd(), baseDir, jobId, timestamp, 'failures.json');
    }
  }

  /**
   * Print failure analysis to console
   *
   * User-friendly display of failure statistics
   *
   * @param stats Failure statistics
   */
  static printAnalysis(stats: FailureStats): void {
    console.log('\n📊 Failure Analysis:\n');
    console.log(`Total failures: ${stats.total}`);
    console.log(`Retryable: ${stats.retryable} (${((stats.retryable / stats.total) * 100).toFixed(1)}%)`);

    if (stats.withoutDecisionId > 0) {
      console.log(`⚠️  Missing decision_id: ${stats.withoutDecisionId}`);
    }

    if (stats.withoutLanguage > 0) {
      console.log(`⚠️  Missing language: ${stats.withoutLanguage}`);
    }

    console.log('\nFailures by reason:');
    const sorted = Object.entries(stats.byReason)
      .sort((a, b) => b[1] - a[1]);

    for (const [reason, count] of sorted) {
      const percentage = ((count / stats.total) * 100).toFixed(1);
      console.log(`  ${reason}: ${count} (${percentage}%)`);
    }

    console.log('');
  }
}
