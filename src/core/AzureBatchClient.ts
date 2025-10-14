import fs from 'fs/promises';
import { AzureConfig } from '../config/azure.js';
import { JobLogger } from '../utils/logger.js';
import OpenAI from 'openai';

/**
 * Azure Batch API Status Response
 */
export interface AzureBatchStatus {
  id: string;
  object: 'batch';
  endpoint: string;
  errors?: {
    data?: Array<{
      code: string;
      message: string;
    }>;
  };
  input_file_id: string;
  completion_window: string;
  status:
    | 'validating'
    | 'failed'
    | 'in_progress'
    | 'finalizing'
    | 'completed'
    | 'expired'
    | 'cancelling'
    | 'cancelled';
  output_file_id?: string;
  error_file_id?: string;
  created_at: number;
  in_progress_at?: number;
  expires_at?: number;
  finalizing_at?: number;
  completed_at?: number;
  failed_at?: number;
  expired_at?: number;
  cancelling_at?: number;
  cancelled_at?: number;
  request_counts?: {
    total: number;
    completed: number;
    failed: number;
  };
  metadata?: Record<string, string>;
}

/**
 * Azure Batch Client
 *
 * Handles interactions with Azure OpenAI Batch API:
 * - Upload JSONL files
 * - Submit batch jobs
 * - Check batch status
 * - Download results
 */
export class AzureBatchClient {
  private client: OpenAI;
  private logger: JobLogger;

  constructor(jobId: string) {
    this.client = AzureConfig.getClient();
    this.logger = new JobLogger(`AzureBatch:${jobId}`);
  }

  /**
   * Upload JSONL file to Azure OpenAI
   *
   * @param filePath Path to the JSONL file
   * @param purpose Purpose of the file (always 'batch' for batch API)
   * @returns File ID from Azure
   */
  async uploadFile(filePath: string): Promise<string> {
    this.logger.info('Uploading file to Azure', { path: filePath });

    try {
      // Read file content
      const fileContent = await fs.readFile(filePath);
      const fileStats = await fs.stat(filePath);

      this.logger.debug('File details', {
        sizeKB: Math.round(fileStats.size / 1024),
        sizeMB: (fileStats.size / (1024 * 1024)).toFixed(2),
      });

      // Check file size (Azure limit is 200 MB)
      if (fileStats.size > 200 * 1024 * 1024) {
        throw new Error(
          `File size (${(fileStats.size / (1024 * 1024)).toFixed(2)} MB) exceeds Azure limit of 200 MB`
        );
      }

      // Upload file using OpenAI SDK
      // Convert buffer to File object for the SDK
      const file = new File([fileContent], filePath.split('/').pop() || 'batch.jsonl', {
        type: 'application/jsonl',
      });

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
   * Create a batch job in Azure OpenAI
   *
   * @param inputFileId File ID from uploadFile()
   * @param metadata Optional metadata to attach to the batch
   * @returns Batch job ID
   */
  async createBatch(
    inputFileId: string,
    metadata?: Record<string, string>
  ): Promise<string> {
    this.logger.info('Creating batch job', { inputFileId });

    try {
      const response = await this.client.batches.create({
        input_file_id: inputFileId,
        endpoint: '/v1/chat/completions',
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
   *
   * @param batchId Batch job ID
   * @returns Batch status details
   */
  async getBatchStatus(batchId: string): Promise<AzureBatchStatus> {
    try {
      const response = await this.client.batches.retrieve(batchId);

      this.logger.debug('Batch status retrieved', {
        batchId,
        status: response.status,
        requestCounts: response.request_counts,
      });

      return response as AzureBatchStatus;
    } catch (error) {
      this.logger.error('Failed to get batch status', error, { batchId });
      throw error;
    }
  }

  /**
   * Wait for batch to complete
   *
   * Polls batch status until it reaches a terminal state
   *
   * @param batchId Batch job ID
   * @param pollIntervalMs Polling interval in milliseconds (default: 30000)
   * @param maxWaitMs Maximum wait time in milliseconds (default: 24 hours)
   * @returns Final batch status
   */
  async waitForCompletion(
    batchId: string,
    pollIntervalMs: number = 30000,
    maxWaitMs: number = 24 * 60 * 60 * 1000
  ): Promise<AzureBatchStatus> {
    this.logger.info('Waiting for batch completion', {
      batchId,
      pollIntervalSeconds: pollIntervalMs / 1000,
      maxWaitHours: maxWaitMs / (60 * 60 * 1000),
    });

    const startTime = Date.now();
    const terminalStatuses = [
      'completed',
      'failed',
      'expired',
      'cancelled',
    ] as const;

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
      if (status.request_counts) {
        const { total, completed, failed } = status.request_counts;
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
      if (terminalStatuses.includes(status.status as any)) {
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
   * Download output file from Azure
   *
   * @param fileId Output file ID from batch status
   * @param outputPath Path to save the downloaded file
   */
  async downloadFile(fileId: string, outputPath: string): Promise<void> {
    this.logger.info('Downloading output file', { fileId, outputPath });

    try {
      // Get file content
      const fileResponse = await this.client.files.content(fileId);

      // Azure SDK returns the content as a response, we need to get the text
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
   *
   * @param batchId Batch job ID
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
   * List all batch jobs
   *
   * @param limit Maximum number of batches to return
   */
  async listBatches(limit: number = 20): Promise<AzureBatchStatus[]> {
    try {
      const response = await this.client.batches.list({ limit });
      return response.data as AzureBatchStatus[];
    } catch (error) {
      this.logger.error('Failed to list batches', error);
      throw error;
    }
  }

  /**
   * Complete workflow: Upload file and create batch
   *
   * @param filePath Path to JSONL file
   * @param metadata Optional metadata
   * @returns Batch job ID
   */
  async submitBatchJob(
    filePath: string,
    metadata?: Record<string, string>
  ): Promise<{ batchId: string; fileId: string }> {
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
