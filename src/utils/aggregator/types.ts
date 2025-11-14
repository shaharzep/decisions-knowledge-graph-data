/**
 * Type definitions for job results aggregator
 */

/**
 * Composite key for uniquely identifying a decision
 */
export interface DecisionKey {
  decision_id: string;
  language: string;
}

/**
 * Options for merge operation
 */
export interface MergeOptions {
  /** Model directory to use (e.g., "gpt-5-mini") */
  model: string;

  /** Output directory for aggregated results */
  outputDir: string;

  /** Base directory containing job results (default: "concurrent/results") */
  baseDir?: string;

  /** Whether to log verbose output */
  verbose?: boolean;
}

/**
 * Mapping from job ID to output field name in aggregated structure
 */
export interface JobMapping {
  jobId: string;
  outputField: string;
  description: string;
}

/**
 * Result of loading a job's data
 */
export interface JobLoadResult {
  jobId: string;
  timestamp: string;
  decisionCount: number;
  data: Map<string, any>; // Key: "decision_id|language", Value: decision object
}

/**
 * Statistics about the merge operation
 */
export interface MergeStatistics {
  totalJobs: number;
  jobsLoaded: number;
  jobsFailed: string[];
  totalDecisionsAcrossJobs: number;
  decisionsInAllJobs: number;
  decisionsSkipped: number;
  skippedDecisions: Array<{
    decision_id: string;
    language: string;
    missingFrom: string[];
  }>;
}

/**
 * Aggregated decision with all job outputs
 */
export interface AggregatedDecision {
  decision_id: string;
  language: string;
  metadata: DecisionMetadata;

  // Job outputs
  comprehensive?: any;
  provisions?: any;
  citedDecisions?: any;
  keywords?: any;
  legalTeachings?: any;
  microSummary?: any;
  provisionCitations?: any;
  teachingCitations?: any;
}

/**
 * Common metadata extracted from decisions
 */
export interface DecisionMetadata {
  id?: number;
  court_ecli_code?: string;
  court_name?: string;
  decision_date?: string;
  decision_type_ecli_code?: string;
  decision_type_name?: string;
  md_length?: number;
  length_category?: string;
  courtcategory?: string;
}
