/**
 * Job Configuration Interface
 *
 * Defines the structure for configuring batch extraction jobs.
 * Each extraction job (parties, provisions, decisions, etc.) will
 * implement this interface with specific prompts and schemas.
 */

export interface JobConfig {
  /**
   * Unique identifier for the job
   * Examples: "extract-parties", "extract-provisions"
   */
  id: string;

  /**
   * Human-readable description of what this job does
   */
  description: string;

  /**
   * SQL query to fetch input data from PostgreSQL
   * Must be a SELECT query (READ-ONLY enforced by DatabaseConfig)
   *
   * The query results will be used to generate batch API requests.
   * Each row becomes one batch request.
   *
   * Example:
   * "SELECT id, html_content, official_url FROM decisions WHERE status = 'pending'"
   */
  dbQuery: string;

  /**
   * Parameters for the database query
   * Optional array of values to safely parameterize the query
   *
   * Example:
   * dbQueryParams: ['pending', 100]
   * Used with: "SELECT * FROM decisions WHERE status = $1 LIMIT $2"
   */
  dbQueryParams?: any[];

  /**
   * Function that generates the prompt for each database row
   * Takes a row from the query result and returns a prompt string
   *
   * This allows dynamic prompt generation based on the data.
   *
   * @param row A single row from the database query result
   * @returns The prompt string to send to the model
   */
  promptTemplate: (row: any) => string;

  /**
   * JSON schema for validating the output
   * Used by ResultProcessor to validate that the model's response
   * matches the expected structure.
   *
   * Should be a valid JSON Schema object (draft-07 or later)
   *
   * Example:
   * {
   *   type: "object",
   *   properties: {
   *     parties: {
   *       type: "array",
   *       items: { type: "object" }
   *     }
   *   },
   *   required: ["parties"]
   * }
   */
  outputSchema: object;

  /**
   * Azure OpenAI deployment name to use
   * Should match a deployment in your Azure OpenAI resource
   *
   * Example: "gpt-4o-2", "gpt-4-turbo"
   */
  deploymentName: string;

  /**
   * Maximum tokens for the completion
   * Optional - defaults to model's maximum if not specified
   */
  maxTokens?: number;

  /**
   * Temperature for generation (0.0 - 2.0)
   * Optional - defaults to 0.0 for deterministic extraction
   */
  temperature?: number;

  /**
   * Custom ID prefix for batch requests
   * Used to generate unique custom_id for each request in the batch
   *
   * Default: job id + row index
   * Example: "extract-parties-001", "extract-parties-002"
   */
  customIdPrefix?: string;

  /**
   * Optional preprocessing function
   * Called for each database row before prompt generation
   *
   * Use cases:
   * - Enrich row data with additional information
   * - Filter large datasets (e.g., taxonomies) based on row content
   * - Transform data before prompt generation
   *
   * @param row A single row from the database query result
   * @returns The processed row (can include additional fields)
   *
   * Example:
   * preprocessRow: async (row) => {
   *   const extraData = await someService.enrich(row.id);
   *   return { ...row, extraData };
   * }
   */
  preprocessRow?: (row: any) => Promise<any>;

  /**
   * Optional row metadata fields to track
   *
   * Specifies which fields from database rows should be saved to a metadata
   * mapping file and merged into the final output JSON.
   *
   * Use case: When you need to merge results across multiple jobs, you can
   * include common fields (e.g., id, decision_id, language) that will be
   * automatically added to each result.
   *
   * @example
   * rowMetadataFields: ['id', 'decision_id', 'language_metadata']
   *
   * This creates a mapping file during generation:
   * input/<job-id>-<timestamp>-metadata.json
   *
   * During result processing, these fields are merged into output JSON:
   * {
   *   "id": "123",
   *   "decision_id": "ECLI:BE:...",
   *   "language": "FR",
   *   ...modelOutput
   * }
   */
  rowMetadataFields?: string[];
}

/**
 * Job Status
 * Tracks the current state of a batch job
 */
export enum JobStatus {
  /** Job created but not yet submitted to Azure */
  PENDING = 'pending',

  /** JSONL file generated, ready for submission */
  GENERATED = 'generated',

  /** Submitted to Azure, waiting for processing */
  SUBMITTED = 'submitted',

  /** Azure is validating the batch */
  VALIDATING = 'validating',

  /** Azure is processing the batch */
  IN_PROGRESS = 'in_progress',

  /** Azure is finalizing the batch */
  FINALIZING = 'finalizing',

  /** Batch completed successfully */
  COMPLETED = 'completed',

  /** Batch failed */
  FAILED = 'failed',

  /** Batch was cancelled */
  CANCELLED = 'cancelled',

  /** Results downloaded and validated */
  PROCESSED = 'processed',
}

/**
 * Job Metadata
 * Stored in status/[job-id].json
 */
export interface JobMetadata {
  /** Unique job identifier */
  jobId: string;

  /** Job type (matches JobConfig.id) */
  jobType: string;

  /** Current job status */
  status: JobStatus;

  /** Azure Batch API job ID */
  azureBatchJobId?: string;

  /** Timestamp when job was created */
  createdAt: string;

  /** Timestamp when job was submitted to Azure */
  submittedAt?: string;

  /** Timestamp when job completed */
  completedAt?: string;

  /** Path to input JSONL file */
  inputFile?: string;

  /** Path to output JSONL file from Azure */
  outputFile?: string;

  /** Path to processed results directory */
  resultsDirectory?: string;

  /** Total number of records in the batch */
  totalRecords?: number;

  /** Number of records successfully processed */
  recordsProcessed?: number;

  /** Number of records that failed */
  recordsFailed?: number;

  /** Array of error messages */
  errors: string[];

  /** Additional metadata */
  metadata?: {
    /** Azure batch details */
    azureStatus?: string;
    azureCreatedAt?: string;
    azureCompletedAt?: string;

    /** File IDs from Azure */
    inputFileId?: string;
    outputFileId?: string;
    errorFileId?: string;

    /** Token usage */
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

/**
 * Batch Request Item
 * Format for Azure OpenAI Batch API JSONL input
 */
export interface BatchRequestItem {
  /** Unique identifier for this request (used to match responses) */
  custom_id: string;

  /** HTTP method (always "POST" for chat completions) */
  method: 'POST';

  /** API endpoint path */
  url: '/chat/completions';

  /** Request body */
  body: {
    /** Model/deployment name */
    model: string;

    /** Messages array */
    messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }>;

    /** Maximum tokens for completion */
    max_tokens?: number;

    /** Temperature */
    temperature?: number;

    /** Response format */
    response_format?: {
      type: 'json_object' | 'text';
    };
  };
}

/**
 * Batch Response Item
 * Format of each line in Azure OpenAI Batch API JSONL output
 */
export interface BatchResponseItem {
  /** Custom ID from the request */
  custom_id: string;

  /** Response details */
  response: {
    /** HTTP status code */
    status_code: number;

    /** Request ID */
    request_id: string;

    /** Response body */
    body: {
      /** Unique ID for this completion */
      id: string;

      /** Object type */
      object: 'chat.completion';

      /** Creation timestamp */
      created: number;

      /** Model used */
      model: string;

      /** Choices array */
      choices: Array<{
        /** Choice index */
        index: number;

        /** Message content */
        message: {
          role: 'assistant';
          content: string;
        };

        /** Finish reason */
        finish_reason: 'stop' | 'length' | 'content_filter';
      }>;

      /** Token usage */
      usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };
  };

  /** Error details (if request failed) */
  error?: {
    message: string;
    type: string;
    code: string;
  };
}
