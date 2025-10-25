/**
 * Job Dependency
 *
 * Declares a dependency on the results of a previously processed job.
 * Dependency data is automatically loaded and merged into the database row
 * before preprocessRow and promptTemplate are executed.
 */
export interface DependencyMatchField {
  /**
   * Property name (dot path supported) on the database row used for matching.
   */
  row: string;

  /**
   * Property name on the dependency result used for matching.
   * Defaults to the same name as the row field when omitted.
   */
  dependency?: string;
}

export type DependencySource = 'batch' | 'concurrent';

export interface JobDependency {
  /** Upstream job to pull results from (e.g., 'extract-comprehensive') */
  jobId: string;

  /** Field name to attach the resolved data under (defaults to jobId) */
  alias?: string;

  /** When false, missing dependency data resolves to null instead of throwing */
  required?: boolean;

  /** Location of results; defaults to batch results directory */
  source?: DependencySource;

  /**
   * Fields used to match the dependency result to the current row.
   * Defaults to:
   *   id (row)            ↔ id (dependency)
   *   decision_id (row)   ↔ decision_id (dependency)
   *   language_metadata   ↔ language
   */
  matchOn?: DependencyMatchField[];

  /**
   * Optional transformer applied to the resolved dependency record.
   * Return value is assigned to the alias. When undefined is returned,
   * the original dependency record is used.
   */
  transform?: (dependency: any, row: any) => any | Promise<any>;
}

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
   * Schema name for structured outputs (json_schema response format)
   * Used when response_format type is 'json_schema'
   * Should be a descriptive name for your schema (e.g., "comprehensive_extraction", "provision_extraction")
   *
   * If not provided, falls back to legacy json_object mode (not recommended)
   */
  outputSchemaName?: string;

  /**
   * Batch provider to use for this job
   * Options: 'azure' | 'openai'
   *
   * If not specified, falls back to:
   * 1. BATCH_PROVIDER environment variable
   * 2. Default: 'azure'
   */
  provider?: 'azure' | 'openai';

  /**
   * Model/deployment name to use
   *
   * For Azure: deployment name (e.g., "o4-mini", "gpt-4o")
   * For OpenAI: model name (e.g., "gpt-4o-mini", "gpt-4o")
   *
   * Note: This field replaces the legacy 'deploymentName' field
   */
  model?: string;

  /**
   * Azure OpenAI deployment name (legacy field)
   * Use 'model' instead for new configurations
   *
   * @deprecated Use 'model' field instead
   */
  deploymentName?: string;

  /**
   * Maximum tokens for the completion
   * For reasoning models (o4-mini, o3-mini, o1), use max_completion_tokens
   * Optional - defaults to model's maximum if not specified
   */
  maxCompletionTokens?: number;

  /**
   * Temperature for generation (0.0 - 2.0)
   * NOTE: Not supported by reasoning models (o4-mini, o3-mini, o1)
   * Optional - defaults to 0.0 for deterministic extraction
   */
  temperature?: number;

  /**
   * Reasoning effort for reasoning models (o4-mini, o3-mini, o1)
   * Options: 'minimal' | 'low' | 'medium' | 'high'
   * Higher effort = more reasoning tokens = better quality
   * Recommended: 'high' for legal analysis
   */
  reasoningEffort?: 'low' | 'medium' | 'high';

  /**
   * Verbosity for reasoning models (gpt-5, gpt-5-mini)
   * Options: 'minimal' | 'low' | 'medium' | 'high'
   * Controls how much of the reasoning process is shown
   */
  verbosity?: 'minimal' | 'low' | 'medium' | 'high';

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

  /**
   * Optional dependencies on previously processed job results.
   * Each dependency is loaded and merged into the database row before
   * preprocessRow and promptTemplate execute.
   */
  dependencies?: JobDependency[];
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

  /** HTTP method (always "POST" for batch requests) */
  method: 'POST';

  /** API endpoint path */
  url: '/v1/chat/completions' | '/v1/responses';

  /** Request body */
  body: {
    /** Model/deployment name */
    model: string;

    /** Messages array */
    messages: Array<{
      role: 'system' | 'user' | 'assistant';
      content: string;
    }>;

    /** Maximum completion tokens (for reasoning models like o4-mini) */
    max_completion_tokens?: number;

    /** Temperature (not supported by reasoning models) */
    temperature?: number;

    /** Reasoning effort (for reasoning models: minimal, low, medium, high) */
    reasoning_effort?: 'minimal' | 'low' | 'medium' | 'high';

    /** Response format */
    response_format?:
      | { type: 'json_object' | 'text' }
      | {
          type: 'json_schema';
          json_schema: {
            name: string;
            schema: object;
            strict?: boolean;
          };
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
