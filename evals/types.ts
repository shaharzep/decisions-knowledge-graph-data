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
 * Experiment Configuration (from concurrent processing summary)
 */
export interface ExperimentConfig {
  provider: 'azure' | 'openai';
  model: string;
  maxCompletionTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  verbosity?: 'minimal' | 'low' | 'medium' | 'high';
  outputSchemaName?: string;
  concurrencyLimit?: number;
  useFullDataPipeline: boolean;
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
  experimentConfig?: ExperimentConfig;
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

  /** Optional CSV test set (decision_id, language) to filter evaluation set */
  testSetPath?: string;
}

/**
 * Snippet-based ground truth (for provision extraction evaluations)
 */
export interface GroundTruthSnippets {
  snippets: string[];
  format: 'snippets';
}

/**
 * Ground truth data format for evaluations
 * Can be either full text (string) or snippet-based
 */
export type GroundTruthData = string | GroundTruthSnippets;

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

/**
 * Braintrust API Event Structure
 * Raw event from Braintrust /v1/experiment/{id}/fetch endpoint
 */
export interface BraintrustEvent {
  id: string;
  span_id: string;
  root_span_id: string;
  input: {
    decision_id: string;
    url: string;
    source_document_length: number;
    extracted_data: any;
  };
  output: any; // Full evaluation result
  scores: {
    score: number; // Normalized 0-1
  };
  metadata: {
    // Decision identification
    decision_id: string;
    url: string;

    // Evaluation results
    verdict: string;
    overall_score: number;
    production_ready: boolean;

    // Issue counts
    critical_issues_count: number;
    major_issues_count: number;
    minor_issues_count: number;

    // Recommendation and confidence
    recommendation: string;
    confidence: string;

    // Decision metadata (from CSV test set)
    language?: string;
    decision_type_ecli_code?: string;
    decision_type_name?: string;
    court_ecli_code?: string;
    court_name?: string;
    courtcategory?: string;
    decision_date?: string;
    md_length?: number;
    length_category?: string;
  };
  created: string;
  _xact_id: string;
}

/**
 * Braintrust API Fetch Response
 */
export interface BraintrustFetchResponse {
  events: BraintrustEvent[];
  cursor?: string | null;
}

/**
 * Parsed experiment evaluation (from Braintrust event)
 */
export interface ExperimentEvaluation {
  decisionId: string;
  verdict: Verdict;
  overallScore: number;
  productionReady: boolean;
  criticalIssuesCount: number;
  majorIssuesCount: number;
  minorIssuesCount: number;
  recommendation: Recommendation;
  confidence: Confidence;

  // Decision metadata
  language?: string;
  decisionTypeEcliCode?: string;
  decisionTypeName?: string;
  courtEcliCode?: string;
  courtName?: string;
  courtCategory?: string;
  decisionDate?: string;
  mdLength?: number;
  lengthCategory?: string;
}

/**
 * Statistics for a single dimension value (e.g., one court, one language)
 */
export interface DimensionGroupStats {
  label: string;
  count: number;
  avgScore: number;
  passRate: number; // Percentage
  failRate: number; // Percentage
  reviewRate: number; // Percentage
  avgCriticalIssues: number;
  avgMajorIssues: number;
  avgMinorIssues: number;
}

/**
 * Breakdown of results by a metadata dimension
 */
export interface DimensionBreakdown {
  dimension: string; // e.g., "court_ecli_code", "language", "length_category"
  groups: DimensionGroupStats[];
}

/**
 * Complete analysis report for an experiment
 */
export interface AnalysisReport {
  experimentId: string;
  totalEvaluations: number;

  // Overall stats
  overallStats: {
    avgScore: number;
    passRate: number;
    failRate: number;
    reviewRate: number;
    passCount: number;
    failCount: number;
    reviewCount: number;
  };

  // Breakdowns by dimension
  byLanguage: DimensionBreakdown;
  byCourt: DimensionBreakdown;
  byDecisionType: DimensionBreakdown;
  byLength: DimensionBreakdown;

  generatedAt: string;
}
