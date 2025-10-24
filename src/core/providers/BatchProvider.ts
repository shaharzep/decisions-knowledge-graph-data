/**
 * Batch Provider Interface
 *
 * Abstract interface for batch processing providers (Azure OpenAI, OpenAI, etc.)
 * Defines the contract that all batch providers must implement.
 */

/**
 * Normalized batch status response
 * Provider-agnostic status information
 */
export interface BatchStatus {
  id: string;
  status:
    | 'validating'
    | 'failed'
    | 'in_progress'
    | 'finalizing'
    | 'completed'
    | 'expired'
    | 'cancelling'
    | 'cancelled';
  inputFileId: string;
  outputFileId?: string;
  errorFileId?: string;
  createdAt: number;
  completedAt?: number;
  failedAt?: number;
  requestCounts?: {
    total: number;
    completed: number;
    failed: number;
  };
  errors?: Array<{
    code: string;
    message: string;
  }>;
  metadata?: Record<string, string>;
}

/**
 * Result of batch job submission
 */
export interface BatchSubmitResult {
  batchId: string;
  fileId: string;
}

/**
 * Batch Provider Interface
 *
 * All batch providers (Azure, OpenAI, etc.) must implement this interface
 */
export interface BatchProvider {
  /**
   * Upload JSONL file to provider storage
   *
   * @param filePath Path to the JSONL file
   * @returns File ID from provider
   */
  uploadFile(filePath: string): Promise<string>;

  /**
   * Create a batch job
   *
   * @param inputFileId File ID from uploadFile()
   * @param metadata Optional metadata to attach to the batch
   * @returns Batch job ID
   */
  createBatch(
    inputFileId: string,
    metadata?: Record<string, string>
  ): Promise<string>;

  /**
   * Get batch job status
   *
   * @param batchId Batch job ID
   * @returns Normalized batch status
   */
  getBatchStatus(batchId: string): Promise<BatchStatus>;

  /**
   * Wait for batch to complete (with polling)
   *
   * @param batchId Batch job ID
   * @param pollIntervalMs Polling interval in milliseconds
   * @param maxWaitMs Maximum wait time in milliseconds
   * @returns Final batch status
   */
  waitForCompletion(
    batchId: string,
    pollIntervalMs?: number,
    maxWaitMs?: number
  ): Promise<BatchStatus>;

  /**
   * Download output file from provider
   *
   * @param fileId Output file ID from batch status
   * @param outputPath Path to save the downloaded file
   */
  downloadFile(fileId: string, outputPath: string): Promise<void>;

  /**
   * Complete workflow: Upload file and create batch
   *
   * @param filePath Path to JSONL file
   * @param metadata Optional metadata
   * @returns Batch job ID and file ID
   */
  submitBatchJob(
    filePath: string,
    metadata?: Record<string, string>
  ): Promise<BatchSubmitResult>;

  /**
   * Cancel a batch job
   *
   * @param batchId Batch job ID
   */
  cancelBatch(batchId: string): Promise<void>;

  /**
   * Get provider name (for logging)
   */
  getProviderName(): string;
}
