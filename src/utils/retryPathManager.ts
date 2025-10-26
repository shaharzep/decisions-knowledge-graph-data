import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

/**
 * Retry Path Configuration
 *
 * Defines all paths for a retry operation
 */
export interface RetryPaths {
  /** Source run directory (original failures) */
  sourceDirectory: string;

  /** Retry output directory (full-data/<job>/<timestamp>-retry-N) */
  retryDirectory: string;

  /** JSONs subdirectory for per-decision files */
  jsonDirectory: string;

  /** Retry number (1, 2, 3, etc.) */
  retryNumber: number;

  /** Original timestamp being retried */
  originalTimestamp: string;

  /** New timestamp for this retry */
  retryTimestamp: string;
}

/**
 * Retry Path Manager
 *
 * Manages all directory paths and naming for retry operations.
 * Handles automatic retry numbering and directory creation.
 *
 * Features:
 * - Automatic retry number detection (retry-1, retry-2, etc.)
 * - Consistent directory structure
 * - Safe directory creation
 * - Path validation
 *
 * Directory structure:
 * full-data/<job>/
 *   <original-timestamp>/              # Original run
 *   <original-timestamp>-retry-1/      # First retry
 *   <original-timestamp>-retry-2/      # Second retry (retry of retry)
 */
export class RetryPathManager {
  private jobId: string;
  private originalTimestamp: string;
  private baseDir: string;

  constructor(jobId: string, originalTimestamp: string, baseDir: string = 'full-data') {
    this.jobId = jobId;
    this.originalTimestamp = originalTimestamp;
    this.baseDir = baseDir;
  }

  /**
   * Prepare retry paths
   *
   * Determines retry number, creates directories, and returns all paths
   *
   * @returns Retry path configuration
   */
  async prepareRetryPaths(): Promise<RetryPaths> {
    const retryNumber = await this.determineRetryNumber();
    const retryTimestamp = new Date().toISOString().replace(/[:.]/g, '-');

    const sourceDirectory = path.join(
      process.cwd(),
      this.baseDir,
      this.jobId,
      this.originalTimestamp
    );

    const retryDirectoryName = this.buildRetryDirectoryName(retryNumber);
    const retryDirectory = path.join(
      process.cwd(),
      this.baseDir,
      this.jobId,
      retryDirectoryName
    );

    const jsonDirectory = path.join(retryDirectory, 'jsons');

    // Validate source exists
    await this.validateSourceDirectory(sourceDirectory);

    // Create retry directories
    await this.createRetryDirectories(retryDirectory, jsonDirectory);

    const paths: RetryPaths = {
      sourceDirectory,
      retryDirectory,
      jsonDirectory,
      retryNumber,
      originalTimestamp: this.originalTimestamp,
      retryTimestamp,
    };

    logger.info('Retry paths prepared', {
      retryNumber,
      sourceDirectory,
      retryDirectory,
    });

    return paths;
  }

  /**
   * Determine next retry number
   *
   * Searches for existing retry-N directories and returns next number
   *
   * @returns Next retry number (1, 2, 3, etc.)
   */
  private async determineRetryNumber(): Promise<number> {
    const jobDirectory = path.join(process.cwd(), this.baseDir, this.jobId);

    try {
      const entries = await fs.readdir(jobDirectory, { withFileTypes: true });

      // Find all retry directories for this original timestamp
      const retryPattern = new RegExp(
        `^${this.escapeRegex(this.originalTimestamp)}-retry-(\\d+)$`
      );

      let maxRetryNumber = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const match = entry.name.match(retryPattern);
        if (match) {
          const retryNum = parseInt(match[1], 10);
          maxRetryNumber = Math.max(maxRetryNumber, retryNum);
        }
      }

      return maxRetryNumber + 1;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Job directory doesn't exist yet
        return 1;
      }
      throw error;
    }
  }

  /**
   * Build retry directory name
   *
   * @param retryNumber Retry attempt number
   * @returns Directory name (e.g., '2025-10-25T06-02-48-674Z-retry-1')
   */
  private buildRetryDirectoryName(retryNumber: number): string {
    return `${this.originalTimestamp}-retry-${retryNumber}`;
  }

  /**
   * Validate source directory exists
   *
   * @param sourceDirectory Path to validate
   * @throws Error if directory doesn't exist
   */
  private async validateSourceDirectory(sourceDirectory: string): Promise<void> {
    try {
      const stats = await fs.stat(sourceDirectory);
      if (!stats.isDirectory()) {
        throw new Error(`Source path exists but is not a directory: ${sourceDirectory}`);
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        throw new Error(
          `Source run directory not found: ${sourceDirectory}\n\n` +
          `Please verify the job ID and timestamp are correct.\n` +
          `Expected format: <jobId> <timestamp>\n` +
          `Example: extract-comprehensive 2025-10-25T06-02-48-674Z`
        );
      }
      throw error;
    }
  }

  /**
   * Create retry directories
   *
   * @param retryDirectory Main retry directory
   * @param jsonDirectory Subdirectory for JSON files
   */
  private async createRetryDirectories(
    retryDirectory: string,
    jsonDirectory: string
  ): Promise<void> {
    await fs.mkdir(jsonDirectory, { recursive: true });
    logger.info(`Created retry directory: ${retryDirectory}`);
  }

  /**
   * Escape special regex characters
   *
   * @param str String to escape
   * @returns Escaped string
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Get legacy output directory path (for backward compatibility)
   *
   * Used when job config has useFullDataPipeline = true
   *
   * @param modelName Model name from config
   * @param retryTimestamp Timestamp for this retry
   * @returns Path to legacy concurrent/results directory
   */
  getLegacyOutputDirectory(modelName: string, retryTimestamp: string): string {
    return path.join(
      process.cwd(),
      'concurrent',
      'results',
      this.jobId,
      modelName,
      retryTimestamp
    );
  }

  /**
   * Check if a run is itself a retry
   *
   * @param timestamp Timestamp to check
   * @returns True if this is a retry run
   */
  static isRetryRun(timestamp: string): boolean {
    return /-retry-\d+$/.test(timestamp);
  }

  /**
   * Extract original timestamp from retry timestamp
   *
   * @param retryTimestamp Retry timestamp (e.g., '2025-10-25T06-02-48-674Z-retry-1')
   * @returns Original timestamp (e.g., '2025-10-25T06-02-48-674Z')
   */
  static extractOriginalTimestamp(retryTimestamp: string): string {
    const match = retryTimestamp.match(/^(.+)-retry-\d+$/);
    return match ? match[1] : retryTimestamp;
  }

  /**
   * Extract retry number from retry timestamp
   *
   * @param retryTimestamp Retry timestamp
   * @returns Retry number or 0 if not a retry
   */
  static extractRetryNumber(retryTimestamp: string): number {
    const match = retryTimestamp.match(/-retry-(\d+)$/);
    return match ? parseInt(match[1], 10) : 0;
  }
}
