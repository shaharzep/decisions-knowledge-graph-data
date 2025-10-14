import fs from 'fs/promises';
import path from 'path';
import { JobMetadata, JobStatus } from '../jobs/JobConfig.js';
import { JobLogger } from '../utils/logger.js';

/**
 * Job Status Tracker
 *
 * Manages job status persistence in JSON files
 * Each job has its own status file: status/[job-type].json
 */
export class JobStatusTracker {
  private jobType: string;
  private statusDir: string;
  private logger: JobLogger;

  constructor(jobType: string, statusDir: string = 'status') {
    this.jobType = jobType;
    this.statusDir = statusDir;
    this.logger = new JobLogger(`StatusTracker:${jobType}`);
  }

  /**
   * Get the path to the status file for this job type
   */
  private getStatusFilePath(): string {
    return path.join(process.cwd(), this.statusDir, `${this.jobType}.json`);
  }

  /**
   * Initialize a new job metadata record
   *
   * @param jobId Unique job identifier
   * @returns Initial job metadata
   */
  initializeJob(jobId: string): JobMetadata {
    const metadata: JobMetadata = {
      jobId,
      jobType: this.jobType,
      status: JobStatus.PENDING,
      createdAt: new Date().toISOString(),
      errors: [],
    };

    this.logger.info('Job initialized', { jobId });
    return metadata;
  }

  /**
   * Save job metadata to status file
   *
   * @param metadata Job metadata to save
   */
  async save(metadata: JobMetadata): Promise<void> {
    try {
      const filePath = this.getStatusFilePath();

      // Ensure directory exists
      await fs.mkdir(path.dirname(filePath), { recursive: true });

      // Write JSON file (pretty-printed for readability)
      const content = JSON.stringify(metadata, null, 2);
      await fs.writeFile(filePath, content, 'utf-8');

      this.logger.debug('Status saved', {
        jobId: metadata.jobId,
        status: metadata.status,
        path: filePath,
      });
    } catch (error) {
      this.logger.error('Failed to save status', error, {
        jobId: metadata.jobId,
      });
      throw error;
    }
  }

  /**
   * Load job metadata from status file
   *
   * @returns Job metadata or null if file doesn't exist
   */
  async load(): Promise<JobMetadata | null> {
    try {
      const filePath = this.getStatusFilePath();
      const content = await fs.readFile(filePath, 'utf-8');
      const metadata = JSON.parse(content) as JobMetadata;

      this.logger.debug('Status loaded', {
        jobId: metadata.jobId,
        status: metadata.status,
      });

      return metadata;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist - this is okay
        this.logger.debug('No existing status file found');
        return null;
      }

      this.logger.error('Failed to load status', error);
      throw error;
    }
  }

  /**
   * Update job status
   *
   * @param metadata Current job metadata
   * @param newStatus New status
   * @param additionalData Additional data to merge into metadata
   * @returns Updated metadata
   */
  async updateStatus(
    metadata: JobMetadata,
    newStatus: JobStatus,
    additionalData?: Partial<JobMetadata>
  ): Promise<JobMetadata> {
    const previousStatus = metadata.status;

    const updated: JobMetadata = {
      ...metadata,
      ...additionalData,
      status: newStatus,
    };

    // Auto-set timestamps based on status
    if (newStatus === JobStatus.SUBMITTED && !updated.submittedAt) {
      updated.submittedAt = new Date().toISOString();
    }

    if (
      (newStatus === JobStatus.COMPLETED ||
        newStatus === JobStatus.FAILED ||
        newStatus === JobStatus.CANCELLED) &&
      !updated.completedAt
    ) {
      updated.completedAt = new Date().toISOString();
    }

    await this.save(updated);

    this.logger.statusChange(previousStatus, newStatus, {
      jobId: metadata.jobId,
    });

    return updated;
  }

  /**
   * Add error to job metadata
   *
   * @param metadata Current job metadata
   * @param error Error message or Error object
   * @returns Updated metadata
   */
  async addError(
    metadata: JobMetadata,
    error: string | Error
  ): Promise<JobMetadata> {
    const errorMessage = error instanceof Error ? error.message : error;

    const updated: JobMetadata = {
      ...metadata,
      errors: [...metadata.errors, errorMessage],
    };

    await this.save(updated);

    this.logger.error('Error added to job', error, { jobId: metadata.jobId });

    return updated;
  }

  /**
   * Update job progress (record counts)
   *
   * @param metadata Current job metadata
   * @param processed Number of records processed
   * @param failed Number of records failed
   * @returns Updated metadata
   */
  async updateProgress(
    metadata: JobMetadata,
    processed: number,
    failed: number
  ): Promise<JobMetadata> {
    const updated: JobMetadata = {
      ...metadata,
      recordsProcessed: processed,
      recordsFailed: failed,
    };

    await this.save(updated);

    this.logger.debug('Progress updated', {
      jobId: metadata.jobId,
      processed,
      failed,
      total: metadata.totalRecords,
    });

    return updated;
  }

  /**
   * Check if a job is currently running
   *
   * @returns True if a job is in progress
   */
  async isJobRunning(): Promise<boolean> {
    const metadata = await this.load();

    if (!metadata) {
      return false;
    }

    const runningStatuses = [
      JobStatus.GENERATED,
      JobStatus.SUBMITTED,
      JobStatus.VALIDATING,
      JobStatus.IN_PROGRESS,
      JobStatus.FINALIZING,
    ];

    return runningStatuses.includes(metadata.status);
  }

  /**
   * Get job summary for display
   *
   * @returns Human-readable job summary
   */
  async getSummary(): Promise<string | null> {
    const metadata = await this.load();

    if (!metadata) {
      return null;
    }

    const lines: string[] = [
      `Job: ${metadata.jobId}`,
      `Type: ${metadata.jobType}`,
      `Status: ${metadata.status}`,
      `Created: ${new Date(metadata.createdAt).toLocaleString()}`,
    ];

    if (metadata.submittedAt) {
      lines.push(`Submitted: ${new Date(metadata.submittedAt).toLocaleString()}`);
    }

    if (metadata.completedAt) {
      lines.push(`Completed: ${new Date(metadata.completedAt).toLocaleString()}`);
    }

    if (metadata.totalRecords) {
      lines.push(`Records: ${metadata.recordsProcessed || 0}/${metadata.totalRecords}`);
    }

    if (metadata.recordsFailed && metadata.recordsFailed > 0) {
      lines.push(`Failed: ${metadata.recordsFailed}`);
    }

    if (metadata.errors.length > 0) {
      lines.push(`Errors: ${metadata.errors.length}`);
    }

    if (metadata.azureBatchJobId) {
      lines.push(`Azure Batch ID: ${metadata.azureBatchJobId}`);
    }

    return lines.join('\n');
  }

  /**
   * Delete status file
   * Use with caution - this removes all job history
   */
  async deleteStatus(): Promise<void> {
    try {
      const filePath = this.getStatusFilePath();
      await fs.unlink(filePath);
      this.logger.info('Status file deleted', { path: filePath });
    } catch (error: any) {
      if (error.code !== 'ENOENT') {
        this.logger.error('Failed to delete status file', error);
        throw error;
      }
    }
  }

  /**
   * List all status files
   *
   * @returns Array of job types with status files
   */
  static async listAllJobs(statusDir: string = 'status'): Promise<string[]> {
    try {
      const dirPath = path.join(process.cwd(), statusDir);
      const files = await fs.readdir(dirPath);

      return files
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.replace('.json', ''));
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get status for all jobs
   *
   * @returns Map of job type to metadata
   */
  static async getAllStatuses(
    statusDir: string = 'status'
  ): Promise<Map<string, JobMetadata>> {
    const jobTypes = await this.listAllJobs(statusDir);
    const statuses = new Map<string, JobMetadata>();

    for (const jobType of jobTypes) {
      const tracker = new JobStatusTracker(jobType, statusDir);
      const metadata = await tracker.load();
      if (metadata) {
        statuses.set(jobType, metadata);
      }
    }

    return statuses;
  }
}
