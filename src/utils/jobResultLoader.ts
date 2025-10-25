import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

/**
 * Composite key for matching decisions across jobs
 *
 * Uses all three fields to ensure exact match, even when same ECLI
 * exists in multiple languages.
 */
export interface DecisionMatchKey {
  /** Database serial ID (optional safety guard) */
  id?: number;

  /** ECLI identifier (can have multiple language versions) */
  decision_id: string;

  /** Procedural language (FR/NL) - distinguishes language versions */
  language: string;
}

/**
 * Job Result Loader
 *
 * Loads results from previous jobs using composite key matching.
 * Includes caching for performance when processing multiple decisions.
 *
 * Key Features:
 * - Composite key matching (id + decision_id + language)
 * - In-memory caching (1 file read instead of N)
 * - Clear error messages with actionable guidance
 * - Handles multiple language versions of same decision
 */
export class JobResultLoader {
  /**
   * Cache of loaded results by job type
   * Key: jobType, Value: array of result objects
   */
  private static cache = new Map<string, any[]>();

  private static cacheKey(jobType: string, baseDir: string): string {
    return `${baseDir}::${jobType}`;
  }

  /**
   * Load result for specific decision using composite key matching
   *
   * @param jobType Job type to load results from (e.g., 'extract-provisions')
   * @param matchKey Composite key with id, decision_id, and language
   * @returns Matched result object
   * @throws Error if job not found, results not found, or decision not found
   */
  static async loadForDecision(
    jobType: string,
    matchKey: DecisionMatchKey,
    baseDir: string = 'results'
  ): Promise<any> {
    logger.debug(`Loading result for decision`, {
      jobType,
      id: matchKey.id,
      decision_id: matchKey.decision_id,
      language: matchKey.language,
      baseDir,
    });

    // Load all results (from cache or file)
    const results = await this.loadAllResults(jobType, baseDir);

    // Find matching result using composite key
    const match = results.find((r) => this.matchesKey(r, matchKey));

    // Throw clear error if not found
    if (!match) {
      throw new Error(
        `Decision not found in ${jobType} results:\n` +
          `  ID: ${matchKey.id}\n` +
          `  Decision ID: ${matchKey.decision_id}\n` +
          `  Language: ${matchKey.language}\n\n` +
          `Please ensure ${jobType} job has processed this decision.\n` +
          `Total results in ${jobType}: ${results.length}`
      );
    }

    logger.debug(`Successfully loaded result for decision ${matchKey.id}`);
    return match;
  }

  /**
   * Load all results from latest results directory for job type
   *
   * Uses cache if available, otherwise reads from file system.
   *
   * @param jobType Job type to load results from
   * @returns Array of all result objects
   * @throws Error if no results directory or file not found
   */
  static async loadAllResults(jobType: string, baseDir: string = 'results'): Promise<any[]> {
    // Check cache first
    const cacheKey = this.cacheKey(jobType, baseDir);
    if (this.cache.has(cacheKey)) {
      logger.debug(`Using cached results for ${jobType}`, { baseDir });
      return this.cache.get(cacheKey)!;
    }

    // Find latest results directory
    const resultsDir = await this.findLatestResultsDirectory(jobType, baseDir);

    // Load extracted-data.json
    const dataPath = path.join(resultsDir, 'extracted-data.json');

    logger.info(`Loading results from ${jobType}`, { path: dataPath });

    try {
      const content = await fs.readFile(dataPath, 'utf-8');
      const results = JSON.parse(content);

      // Validate results is array
      if (!Array.isArray(results)) {
        throw new Error(
          `Invalid results format in ${dataPath}. Expected array, got ${typeof results}`
        );
      }

      // Cache results
      this.cache.set(cacheKey, results);

      logger.info(`Loaded ${results.length} results from ${jobType}`, { baseDir });
      return results;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          `Results file not found: ${dataPath}\n\n` +
            `The ${jobType} job may not have been processed yet.\n` +
            `Please run:\n` +
            `  npm run dev process ${jobType}`
        );
      }

      if (error instanceof SyntaxError) {
        throw new Error(
          `Failed to parse results from ${jobType}:\n` +
            `  Path: ${dataPath}\n` +
            `  Error: ${error.message}\n\n` +
            `The results file may be corrupted. Try reprocessing the job.`
        );
      }

      throw error;
    }
  }

  /**
   * Find latest results directory for job type
   *
   * Searches results/<jobType>/ or concurrent/results/<jobType>/<model>/
   * and returns most recent directory (ISO timestamp directories sort correctly alphabetically).
   *
   * For concurrent results, searches across all model subdirectories to find the latest.
   *
   * @param jobType Job type to search for
   * @param baseDir Base directory (default: 'results', can use 'concurrent/results')
   * @returns Full path to latest results directory
   * @throws Error if no results directory found
   */
  static async findLatestResultsDirectory(jobType: string, baseDir: string = 'results'): Promise<string> {
    const jobResultsDir = path.join(process.cwd(), baseDir, jobType);

    try {
      // Read all directories in results/<jobType>/
      const entries = await fs.readdir(jobResultsDir, { withFileTypes: true });

      // Filter to directories only
      let directories = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);

      if (directories.length === 0) {
        throw new Error('NO_RESULTS_FOUND');
      }

      // Check if this is concurrent results (has model subdirectories)
      // Concurrent: concurrent/results/{jobType}/{model}/{timestamp}/
      // Batch: results/{jobType}/{timestamp}/
      const isConcurrent = baseDir.includes('concurrent');

      if (isConcurrent) {
        // For concurrent results, we need to search within model subdirectories
        let allTimestampDirs: Array<{ path: string; timestamp: string }> = [];

        for (const modelDir of directories) {
          const modelPath = path.join(jobResultsDir, modelDir);
          try {
            const modelEntries = await fs.readdir(modelPath, { withFileTypes: true });
            const timestampDirs = modelEntries
              .filter((entry) => entry.isDirectory())
              .map((entry) => ({
                path: path.join(modelPath, entry.name),
                timestamp: entry.name,
              }));
            allTimestampDirs.push(...timestampDirs);
          } catch (error) {
            // Skip if not a valid model directory
            continue;
          }
        }

        if (allTimestampDirs.length === 0) {
          throw new Error('NO_RESULTS_FOUND');
        }

        // Sort by timestamp and return latest
        allTimestampDirs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        const latest = allTimestampDirs[allTimestampDirs.length - 1];

        logger.debug(`Found latest results directory for ${jobType}`, {
          path: latest.path,
          timestamp: latest.timestamp,
        });

        return latest.path;
      } else {
        // For batch results, timestamps are directly in jobType directory
        // Sort by name (ISO timestamps sort correctly)
        directories.sort();

        // Return most recent (last in sorted list)
        const latest = directories[directories.length - 1];
        const latestPath = path.join(jobResultsDir, latest);

        logger.debug(`Found latest results directory for ${jobType}`, {
          path: latestPath,
          timestamp: latest,
        });

        return latestPath;
      }
    } catch (error: any) {
      if (error.code === 'ENOENT' || error.message === 'NO_RESULTS_FOUND') {
        throw new Error(
          `No results directory found for job type '${jobType}'.\n\n` +
            `Please run the ${jobType} job first:\n` +
            `  npm run dev submit ${jobType}\n` +
            `  npm run dev process ${jobType}`
        );
      }

      throw error;
    }
  }

  /**
   * Check if result matches composite key
   *
   * Returns true only if ALL THREE fields match:
   * - id (database serial ID)
   * - decision_id (ECLI identifier)
   * - language (procedural language)
   *
   * This ensures we get the exact right result, even when the same
   * ECLI exists in multiple languages.
   *
   * @param result Result object from extracted-data.json
   * @param key Composite match key
   * @returns True if all three fields match
   */
  private static matchesKey(result: any, key: DecisionMatchKey): boolean {
    const idMatches =
      key.id === undefined ||
      key.id === null ||
      result.id === key.id;

    return (
      idMatches &&
      result.decision_id === key.decision_id &&
      result.language === key.language
    );
  }

  /**
   * Clear all cached results
   *
   * Useful to free memory after job submission completes.
   */
  static clearCache(): void {
    const cacheSize = this.cache.size;
    this.cache.clear();
    logger.debug(`Cleared result cache`, { jobTypesCached: cacheSize });
  }

  /**
   * Get cache statistics
   *
   * @returns Object with cache information
   */
  static getCacheStats(): { jobTypes: string[]; totalJobs: number } {
    return {
      jobTypes: Array.from(this.cache.keys()),
      totalJobs: this.cache.size,
    };
  }
}

/**
 * Helper functions for evaluation system
 */

/**
 * Get results directory for a specific timestamp
 *
 * @param jobType - Job type
 * @param timestamp - Timestamp directory name
 * @param baseDir - Base directory (default: 'results', can use 'concurrent/results')
 * @returns Full path to results directory
 */
export function getResultsByTimestamp(
  jobType: string,
  timestamp: string,
  baseDir: string = 'results'
): string {
  return path.join(process.cwd(), baseDir, jobType, timestamp);
}

/**
 * Load extracted data from results directory
 *
 * @param resultsDir - Path to results directory
 * @returns Array of extracted data objects
 */
export async function loadExtractedData(resultsDir: string): Promise<any[]> {
  const dataPath = path.join(resultsDir, 'extracted-data.json');

  try {
    const content = await fs.readFile(dataPath, 'utf-8');
    return JSON.parse(content);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`extracted-data.json not found in ${resultsDir}`);
    }
    throw new Error(`Failed to load extracted data: ${error.message}`);
  }
}

/**
 * Load summary from results directory
 *
 * @param resultsDir - Path to results directory
 * @returns Summary object
 */
export async function loadSummary(resultsDir: string): Promise<any> {
  const summaryPath = path.join(resultsDir, 'summary.json');

  try {
    const content = await fs.readFile(summaryPath, 'utf-8');
    return JSON.parse(content);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`summary.json not found in ${resultsDir}`);
    }
    throw new Error(`Failed to load summary: ${error.message}`);
  }
}

/**
 * List all available result timestamps for a job type
 *
 * @param jobType - Job type
 * @returns Array of timestamp directory names (sorted newest first)
 */
export async function listAvailableResults(jobType: string): Promise<string[]> {
  const resultsDir = path.join(process.cwd(), 'results', jobType);

  try {
    const entries = await fs.readdir(resultsDir, { withFileTypes: true });

    return entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort()
      .reverse();
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw new Error(`Failed to list results: ${error.message}`);
  }
}

/**
 * Get latest results with metadata
 *
 * @param jobType - Job type
 * @param baseDir - Base directory (default: 'results', can use 'concurrent/results')
 * @returns Object with data, summary, and resultsDir
 */
export async function getLatestResults(jobType: string, baseDir: string = 'results'): Promise<{
  data: any[];
  summary: any;
  resultsDir: string;
}> {
  const resultsDir = await JobResultLoader.findLatestResultsDirectory(jobType, baseDir);
  const data = await loadExtractedData(resultsDir);
  const summary = await loadSummary(resultsDir);

  return {
    data,
    summary,
    resultsDir,
  };
}
