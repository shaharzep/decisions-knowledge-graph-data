import { JobConfig, JobStatus } from '../jobs/JobConfig.js';
import { BatchJobGenerator } from './BatchJobGenerator.js';
import { BatchProvider } from './providers/BatchProvider.js';
import { ProviderFactory, ProviderType } from './providers/ProviderFactory.js';
import { JobStatusTracker } from './JobStatusTracker.js';
import { ResultProcessor } from './ResultProcessor.js';
import { JobLogger } from '../utils/logger.js';

/**
 * Batch Job Runner
 *
 * Orchestrates the complete workflow for a batch job:
 * 1. Generate JSONL file from database
 * 2. Submit to Azure OpenAI Batch API
 * 3. Monitor status
 * 4. Download and process results
 */
export class BatchJobRunner {
  private config: JobConfig;
  private generator: BatchJobGenerator;
  private provider: BatchProvider;
  private providerType: ProviderType;
  private statusTracker: JobStatusTracker;
  private resultProcessor: ResultProcessor;
  private logger: JobLogger;

  constructor(config: JobConfig) {
    this.config = config;
    this.generator = new BatchJobGenerator(config);
    this.statusTracker = new JobStatusTracker(config.id);
    this.logger = new JobLogger(`JobRunner:${config.id}`);

    // Determine provider type
    this.providerType = config.provider || ProviderFactory.getDefaultProvider();

    // Provider will be initialized with specific job ID during run
    this.provider = null as any;
    this.resultProcessor = new ResultProcessor(config);
  }

  /**
   * Run the complete batch job workflow
   *
   * Steps:
   * 1. Generate JSONL input file
   * 2. Submit batch job to Azure
   * 3. Monitor status (optional wait)
   * 4. Download results (when complete)
   * 5. Process and validate results
   *
   * @param options Execution options
   */
  async run(options: {
    waitForCompletion?: boolean;
    pollIntervalMs?: number;
  } = {}): Promise<void> {
    const { waitForCompletion = false, pollIntervalMs = 30000 } = options;

    this.logger.started();

    try {
      // Check if a job is already running
      if (await this.statusTracker.isJobRunning()) {
        throw new Error(
          `A job of type '${this.config.id}' is already running. ` +
          'Check status or wait for completion before starting a new job.'
        );
      }

      // Initialize job metadata
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const jobId = `${this.config.id}-${timestamp}`;
      let metadata = this.statusTracker.initializeJob(jobId);
      await this.statusTracker.save(metadata);

      // Initialize provider with job ID
      this.provider = ProviderFactory.createProvider(this.providerType, jobId);

      // Step 1: Generate JSONL file
      this.logger.info('Step 1: Generating JSONL input file');
      const { filePath, recordCount } = await this.generator.generate();

      metadata = await this.statusTracker.updateStatus(
        metadata,
        JobStatus.GENERATED,
        {
          inputFile: filePath,
          totalRecords: recordCount,
        }
      );

      // Optional: Validate and estimate cost
      await this.generator.validateFile(filePath);
      const { estimatedPromptTokens, estimatedCostUSD } =
        await this.generator.estimateCost(filePath);

      this.logger.info('Cost estimate', {
        estimatedPromptTokens,
        estimatedCostUSD: `$${estimatedCostUSD.toFixed(2)}`,
      });

      // Step 2: Submit batch job to provider
      this.logger.info(`Step 2: Submitting batch job to ${this.provider.getProviderName()}`);
      const { batchId, fileId } = await this.provider.submitBatchJob(filePath, {
        jobType: this.config.id,
        jobId,
      });

      metadata = await this.statusTracker.updateStatus(
        metadata,
        JobStatus.SUBMITTED,
        {
          azureBatchJobId: batchId,
          metadata: {
            ...metadata.metadata,
            inputFileId: fileId,
          },
        }
      );

      this.logger.info('Batch job submitted', {
        batchId,
        fileId,
      });

      // Step 3: Monitor status
      if (waitForCompletion) {
        this.logger.info('Step 3: Waiting for batch completion');
        await this.monitorAndComplete(metadata, pollIntervalMs);
      } else {
        this.logger.info(
          'Batch job submitted. Use "status" command to check progress.'
        );
        this.logger.info(`Azure Batch ID: ${batchId}`);
        this.logger.info(
          `To check status: node dist/cli.js status ${this.config.id}`
        );
      }
    } catch (error) {
      this.logger.failed(error);

      // Update status to failed
      const metadata = await this.statusTracker.load();
      if (metadata) {
        await this.statusTracker.updateStatus(metadata, JobStatus.FAILED);
        await this.statusTracker.addError(metadata, error as Error);
      }

      throw error;
    }
  }

  /**
   * Check the status of the current job
   */
  async checkStatus(): Promise<void> {
    let metadata = await this.statusTracker.load();

    if (!metadata) {
      this.logger.info(`No job found for type: ${this.config.id}`);
      return;
    }

    this.logger.info('Job status:', {
      jobId: metadata.jobId,
      status: metadata.status,
      totalRecords: metadata.totalRecords,
      recordsProcessed: metadata.recordsProcessed,
      recordsFailed: metadata.recordsFailed,
    });

    // If job has batch ID, get provider status
    if (metadata.azureBatchJobId) {
      this.provider = ProviderFactory.createProvider(this.providerType, metadata.jobId);
      const batchStatus = await this.provider.getBatchStatus(
        metadata.azureBatchJobId
      );

      this.logger.info('Batch status:', {
        provider: this.provider.getProviderName(),
        status: batchStatus.status,
        requestCounts: batchStatus.requestCounts,
      });

      // Update local status if batch status changed
      const statusMap: Record<string, JobStatus> = {
        validating: JobStatus.VALIDATING,
        in_progress: JobStatus.IN_PROGRESS,
        finalizing: JobStatus.FINALIZING,
        completed: JobStatus.COMPLETED,
        failed: JobStatus.FAILED,
        cancelled: JobStatus.CANCELLED,
      };

      const newStatus = statusMap[batchStatus.status];
      if (newStatus && newStatus !== metadata.status) {
        metadata = await this.statusTracker.updateStatus(metadata, newStatus, {
          metadata: {
            ...metadata.metadata,
            azureStatus: batchStatus.status,
            outputFileId: batchStatus.outputFileId,
            errorFileId: batchStatus.errorFileId,
          },
        });
      }

      // Update progress from batch request counts
      if (batchStatus.requestCounts) {
        const { completed, failed } = batchStatus.requestCounts;
        metadata = await this.statusTracker.updateProgress(
          metadata,
          completed,
          failed
        );
      }
    }

    // Print summary
    const summary = await this.statusTracker.getSummary();
    if (summary) {
      console.log('\n' + summary);
    }
  }

  /**
   * Process completed job results
   */
  async processResults(): Promise<void> {
    const metadata = await this.statusTracker.load();

    if (!metadata) {
      throw new Error(`No job found for type: ${this.config.id}`);
    }

    if (metadata.status !== JobStatus.COMPLETED) {
      throw new Error(
        `Cannot process results. Job status is ${metadata.status}. ` +
        'Job must be completed first.'
      );
    }

    if (!metadata.azureBatchJobId) {
      throw new Error('No batch job ID found');
    }

    this.provider = ProviderFactory.createProvider(this.providerType, metadata.jobId);

    // Get batch status to get output file ID
    const batchStatus = await this.provider.getBatchStatus(
      metadata.azureBatchJobId
    );

    if (!batchStatus.outputFileId) {
      throw new Error('No output file available from provider');
    }

    // Download output file
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputPath = `output/${this.config.id}-${timestamp}-output.jsonl`;

    this.logger.info(`Downloading results from ${this.provider.getProviderName()}`);
    await this.provider.downloadFile(batchStatus.outputFileId, outputPath);

    // Process results
    this.logger.info('Processing and validating results');
    const summary = await this.resultProcessor.process(
      outputPath,
      metadata.inputFile // Pass input file path for metadata mapping
    );

    // Update job metadata
    await this.statusTracker.updateStatus(metadata, JobStatus.PROCESSED, {
      outputFile: outputPath,
      resultsDirectory: summary.outputDirectory,
      recordsProcessed: summary.successfulRecords,
      recordsFailed: summary.failedRecords,
      metadata: {
        ...metadata.metadata,
        totalTokens: summary.totalTokens,
      },
    });

    this.logger.completed({
      successfulRecords: summary.successfulRecords,
      failedRecords: summary.failedRecords,
      outputDirectory: summary.outputDirectory,
    });

    console.log('\n✅ Results processed successfully!');
    console.log(`Output directory: ${summary.outputDirectory}`);
    console.log(`Successful: ${summary.successfulRecords}/${summary.totalRecords}`);
    console.log(`Failed: ${summary.failedRecords}/${summary.totalRecords}`);
    console.log(`Total tokens: ${summary.totalTokens.toLocaleString()}`);
  }

  /**
   * Monitor job and complete when done
   * Private helper for run() with waitForCompletion
   */
  private async monitorAndComplete(
    metadata: any,
    pollIntervalMs: number
  ): Promise<void> {
    const finalStatus = await this.provider.waitForCompletion(
      metadata.azureBatchJobId,
      pollIntervalMs
    );

    // Update progress from final request counts
    if (finalStatus.requestCounts) {
      const { completed, failed } = finalStatus.requestCounts;
      metadata = await this.statusTracker.updateProgress(
        metadata,
        completed,
        failed
      );
    }

    // Update status
    const statusMap: Record<string, JobStatus> = {
      completed: JobStatus.COMPLETED,
      failed: JobStatus.FAILED,
      cancelled: JobStatus.CANCELLED,
      expired: JobStatus.FAILED,
    };

    const newStatus = statusMap[finalStatus.status] || JobStatus.FAILED;
    await this.statusTracker.updateStatus(metadata, newStatus, {
      metadata: {
        ...metadata.metadata,
        azureStatus: finalStatus.status,
        outputFileId: finalStatus.outputFileId,
        errorFileId: finalStatus.errorFileId,
      },
    });

    if (finalStatus.status === 'completed') {
      // Automatically process results
      await this.processResults();
    } else {
      throw new Error(
        `Batch job ended with status: ${finalStatus.status}`
      );
    }
  }
}
