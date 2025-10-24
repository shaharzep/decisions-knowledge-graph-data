/**
 * Evaluation System Type Definitions
 *
 * Core types for the LLM judge evaluation system
 */

/**
 * Evaluation verdict - production readiness assessment
 */
export type Verdict = 'PASS' | 'FAIL' | 'REVIEW_REQUIRED';

/**
 * Recommendation based on evaluation results
 */
export type Recommendation = 'PROCEED' | 'FIX_PROMPT' | 'REVIEW_SAMPLES';

/**
 * Judge confidence in evaluation
 */
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * Complete evaluation result from LLM judge (3-tier severity system)
 */
export interface EvaluationResult {
  verdict: Verdict;
  score: number; // 0-100
  criticalIssues: string[];
  majorIssues: string[];
  minorIssues: string[];
  recommendation: Recommendation;
  confidence: Confidence;
  summary: string;
}

/**
 * Metadata about an extraction experiment
 */
export interface ExperimentMetadata {
  jobType: string;
  timestamp: string;
  model: string;
  totalRecords: number;
  successfulRecords: number;
  failedRecords: number;
  extractionDate: string;
}

/**
 * Options for running evaluations
 */
export interface EvalOptions {
  /** Sample size (evaluate first N decisions) */
  sampleSize?: number;

  /** Number of parallel workers for evaluation */
  parallelWorkers?: number;

  /** Skip caching of source documents */
  skipCache?: boolean;

  /** Save results locally in addition to Braintrust */
  saveLocal?: boolean;

  /** Load results from batch processing (results/) instead of concurrent (concurrent/results/) - DEFAULT is concurrent */
  batch?: boolean;

  /** Output directory for local results */
  outputDir?: string;
}

/**
 * Single decision input for evaluation
 */
export interface DecisionEvaluationInput {
  decisionId: string;
  sourceDocument: string;
  extractedData: any;
  metadata?: {
    id?: number;
    language?: string;
    url?: string;
    decision_type_ecli_code?: string;
    decision_type_name?: string;
    court_ecli_code?: string;
    court_name?: string;
    decision_date?: string;
    md_length?: number;
    length_category?: string;
  };
}

/**
 * Aggregate statistics across evaluations
 */
export interface AggregateStats {
  totalEvaluated: number;
  avgScore: number;

  // Verdict distribution
  verdictDistribution: {
    pass: number;
    fail: number;
    reviewRequired: number;
  };

  // Issue counts
  avgCriticalIssues: number;
  avgMajorIssues: number;
  avgMinorIssues: number;

  // Most common issues
  topCriticalIssues: Array<{ issue: string; count: number }>;
  topMajorIssues: Array<{ issue: string; count: number }>;

  // Recommendations
  recommendationDistribution: Record<Recommendation, number>;

  // Confidence
  confidenceDistribution: Record<Confidence, number>;
}

/**
 * Comparison report between multiple experiments
 */
export interface ComparisonReport {
  experiments: Array<{
    id: string;
    name: string;
    metadata: ExperimentMetadata;
    stats: AggregateStats;
  }>;

  comparisons: {
    scoreDiff: number;
    passRateDiff: number;
    betterExperiment: string;
  };

  commonCriticalIssues: Array<{
    issue: string;
    frequency: number;
    affectedExperiments: string[];
  }>;

  commonMajorIssues: Array<{
    issue: string;
    frequency: number;
    affectedExperiments: string[];
  }>;

  recommendations: string[];
  generatedAt: string;
}

/**
 * Issue frequency analysis
 */
export interface IssueFrequency {
  issue: string;
  count: number;
  percentage: number;
  affectedDecisions: string[];
}

/**
 * Braintrust experiment reference
 */
export interface BraintrustExperiment {
  id: string;
  name: string;
  projectId: string;
  metadata: Record<string, any>;
  createdAt: string;
}

/**
 * Progress tracker for long-running evaluations
 */
export interface EvaluationProgress {
  total: number;
  completed: number;
  failed: number;
  currentDecision?: string;
  startTime: Date;
  estimatedTimeRemaining?: number;
}
