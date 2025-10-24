import fs from 'fs/promises';
import OpenAI from 'openai';
import { OpenAIConfig } from '../../config/openai.js';
import { JobLogger } from '../../utils/logger.js';
import { BatchProvider, BatchStatus, BatchSubmitResult } from './BatchProvider.js';

/**
 * OpenAI Batch Provider
 *
 * Implements batch processing using standard OpenAI Batch API
 */
export class OpenAIBatchProvider implements BatchProvider {
  private client: OpenAI;
  private logger: JobLogger;

  constructor(jobId: string) {
    this.client = OpenAIConfig.getClient();
    this.logger = new JobLogger(`OpenAI:${jobId}`);
  }

  getProviderName(): string {
    return 'OpenAI';
  }

  /**
   * Upload JSONL file to OpenAI
   */
  async uploadFile(filePath: string): Promise<string> {
    this.logger.info('Uploading file to OpenAI', { path: filePath });

    try {
      const fileContent = await fs.readFile(filePath);
      const fileStats = await fs.stat(filePath);

      this.logger.debug('File details', {
        sizeKB: Math.round(fileStats.size / 1024),
        sizeMB: (fileStats.size / (1024 * 1024)).toFixed(2),
      });

      // Check file size (OpenAI limit is 100 MB for batch files)
      if (fileStats.size > 100 * 1024 * 1024) {
        throw new Error(
          `File size (${(fileStats.size / (1024 * 1024)).toFixed(2)} MB) exceeds OpenAI limit of 100 MB`
        );
      }

      // Create File object for the SDK
      const file = new File(
        [fileContent],
        filePath.split('/').pop() || 'batch.jsonl',
        { type: 'application/jsonl' }
      );

      const uploadResponse = await this.client.files.create({
        file: file,
        purpose: 'batch',
      });

      this.logger.info('File uploaded successfully', {
        fileId: uploadResponse.id,
        filename: uploadResponse.filename,
        bytes: uploadResponse.bytes,
      });

      return uploadResponse.id;
    } catch (error) {
      this.logger.error('File upload failed', error);
      throw error;
    }
  }

  /**
   * Create a batch job in OpenAI
   */
  async createBatch(
    inputFileId: string,
    metadata?: Record<string, string>
  ): Promise<string> {
    this.logger.info('Creating batch job', { inputFileId });

    try {
      const response = await this.client.batches.create({
        input_file_id: inputFileId,
        endpoint: '/v1/responses',
        completion_window: '24h',
        metadata,
      });

      this.logger.info('Batch job created', {
        batchId: response.id,
        status: response.status,
        createdAt: new Date(response.created_at * 1000).toISOString(),
      });

      return response.id;
    } catch (error) {
      this.logger.error('Batch creation failed', error);
      throw error;
    }
  }

  /**
   * Get batch job status
   */
  async getBatchStatus(batchId: string): Promise<BatchStatus> {
    try {
      const response = await this.client.batches.retrieve(batchId);

      this.logger.debug('Batch status retrieved', {
        batchId,
        status: response.status,
        requestCounts: response.request_counts,
      });

      // Normalize to BatchStatus interface
      return {
        id: response.id,
        status: response.status as BatchStatus['status'],
        inputFileId: response.input_file_id,
        outputFileId: response.output_file_id,
        errorFileId: response.error_file_id,
        createdAt: response.created_at,
        completedAt: response.completed_at ?? undefined,
        failedAt: response.failed_at ?? undefined,
        requestCounts: response.request_counts
          ? {
              total: response.request_counts.total,
              completed: response.request_counts.completed,
              failed: response.request_counts.failed,
            }
          : undefined,
        errors: response.errors?.data?.map((err) => ({
          code: err.code || 'unknown',
          message: err.message || 'Unknown error',
        })),
        metadata: response.metadata ?? undefined,
      };
    } catch (error) {
      this.logger.error('Failed to get batch status', error, { batchId });
      throw error;
    }
  }

  /**
   * Wait for batch to complete
   */
  async waitForCompletion(
    batchId: string,
    pollIntervalMs: number = 30000,
    maxWaitMs: number = 24 * 60 * 60 * 1000
  ): Promise<BatchStatus> {
    this.logger.info('Waiting for batch completion', {
      batchId,
      pollIntervalSeconds: pollIntervalMs / 1000,
      maxWaitHours: maxWaitMs / (60 * 60 * 1000),
    });

    const startTime = Date.now();
    const terminalStatuses: BatchStatus['status'][] = [
      'completed',
      'failed',
      'expired',
      'cancelled',
    ];

    while (true) {
      // Check timeout
      if (Date.now() - startTime > maxWaitMs) {
        throw new Error(
          `Batch job did not complete within ${maxWaitMs / (60 * 60 * 1000)} hours`
        );
      }

      // Get current status
      const status = await this.getBatchStatus(batchId);

      // Log progress
      if (status.requestCounts) {
        const { total, completed, failed } = status.requestCounts;
        const progress = ((completed + failed) / total) * 100;
        this.logger.info('Batch progress', {
          status: status.status,
          progress: `${progress.toFixed(1)}%`,
          completed,
          failed,
          total,
        });
      }

      // Check if terminal state reached
      if (terminalStatuses.includes(status.status)) {
        this.logger.info('Batch reached terminal state', {
          status: status.status,
          batchId,
        });
        return status;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  /**
   * Download output file from OpenAI
   */
  async downloadFile(fileId: string, outputPath: string): Promise<void> {
    this.logger.info('Downloading output file', { fileId, outputPath });

    try {
      // Get file content
      const fileResponse = await this.client.files.content(fileId);

      // Get the text content
      const content = await fileResponse.text();

      // Ensure output directory exists
      const dir = outputPath.substring(0, outputPath.lastIndexOf('/'));
      await fs.mkdir(dir, { recursive: true });

      // Write to file
      await fs.writeFile(outputPath, content, 'utf-8');

      const stats = await fs.stat(outputPath);
      this.logger.info('File downloaded successfully', {
        fileId,
        outputPath,
        sizeKB: Math.round(stats.size / 1024),
      });
    } catch (error) {
      this.logger.error('File download failed', error, { fileId });
      throw error;
    }
  }

  /**
   * Cancel a batch job
   */
  async cancelBatch(batchId: string): Promise<void> {
    this.logger.info('Cancelling batch job', { batchId });

    try {
      await this.client.batches.cancel(batchId);
      this.logger.info('Batch job cancelled', { batchId });
    } catch (error) {
      this.logger.error('Failed to cancel batch', error, { batchId });
      throw error;
    }
  }

  /**
   * Complete workflow: Upload file and create batch
   */
  async submitBatchJob(
    filePath: string,
    metadata?: Record<string, string>
  ): Promise<BatchSubmitResult> {
    this.logger.info('Starting batch job submission', { filePath });

    try {
      // Upload file
      const fileId = await this.uploadFile(filePath);

      // Create batch
      const batchId = await this.createBatch(fileId, metadata);

      this.logger.info('Batch job submitted successfully', {
        batchId,
        fileId,
      });

      return { batchId, fileId };
    } catch (error) {
      this.logger.error('Batch job submission failed', error);
      throw error;
    }
  }
}
