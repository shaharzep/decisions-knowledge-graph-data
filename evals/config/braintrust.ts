/**
 * Braintrust Configuration
 *
 * Client setup and experiment management for Braintrust evaluation platform
 */

import { init, initExperiment, login } from 'braintrust';
import dotenv from 'dotenv';

dotenv.config();

let isInitialized = false;

/**
 * Initialize Braintrust client
 */
export function initBraintrustClient(): void {
  if (isInitialized) {
    return;
  }

  const apiKey = process.env.BRAINTRUST_API_KEY;
  if (!apiKey) {
    throw new Error('BRAINTRUST_API_KEY not found in environment variables');
  }

  // Login to Braintrust with API key
  login({
    apiKey,
  });

  isInitialized = true;
}

/**
 * Ensure Braintrust is initialized
 */
export function ensureBraintrustInitialized(): void {
  if (!isInitialized) {
    initBraintrustClient();
  }
}

/**
 * Create a new experiment
 *
 * @param projectName - Name of the project
 * @param experimentName - Name of the experiment (e.g., "extract-comprehensive-o4-mini-2025-10-18")
 * @param metadata - Additional metadata about the extraction run
 * @returns Experiment instance
 */
export function createExperiment(
  projectName: string,
  experimentName: string,
  metadata: Record<string, any> = {}
) {
  ensureBraintrustInitialized();

  const experiment = init(projectName, {
    experiment: experimentName,
    metadata: {
      ...metadata,
      createdAt: new Date().toISOString(),
      evaluator: 'gpt-5-judge',
    },
  });

  return experiment;
}

/**
 * Log a single evaluation to Braintrust experiment
 *
 * @param experiment - Braintrust experiment instance
 * @param input - Input data (decision ID, source doc, extracted JSON)
 * @param output - Evaluation result from judge
 * @param scores - Extracted scores for metrics
 * @param metadata - Decision metadata from CSV test set (court, language, decision_type, etc.)
 */
export function logEvaluation(
  experiment: any,
  input: {
    decisionId: string;
    sourceDocument: string | null;  // Allow null for RFTC jobs
    extractedData: any;
    url?: string;
    rftcData?: any;  // RFTC data (transformed HTML + dependencies)
  },
  output: any,
  scores: {
    verdict: string;
    overall_score: number;
    critical_issues_count: number;
    major_issues_count: number;
    minor_issues_count: number;
    recommendation: string;
    confidence: string;
    production_ready: boolean;
  },
  metadata?: {
    id?: number;
    language?: string;
    decision_type_ecli_code?: string;
    decision_type_name?: string;
    court_ecli_code?: string;
    court_name?: string;
    courtcategory?: string;
    decision_date?: string;
    md_length?: number;
    length_category?: string;
  }
) {
  // Build base input object
  const braintrustInput: any = {
    decision_id: input.decisionId,
    url: input.url || 'N/A',
    source_document_length: input.sourceDocument?.length || 0,  // Handle null for RFTC jobs
    extracted_data: input.extractedData, // Full extracted JSON for viewing
  };

  // Add RFTC-specific data for block-based citation jobs (for review in Braintrust)
  if (input.rftcData) {
    // Include full legal teachings from Stage 5A input (not just IDs)
    const legalTeachings = input.rftcData.dependencies?.legalTeachingsInput || [];

    braintrustInput.transformed_html = input.rftcData.transformedHtml;
    braintrustInput.legal_teachings = legalTeachings;  // Full teaching objects
    braintrustInput.legal_teachings_count = legalTeachings.length;
  }

  experiment.log({
    input: braintrustInput,
    output: output, // Full evaluation result with all details
    scores: {
      // ONLY overall score as a score column (normalized to 0-1 for Braintrust)
      score: scores.overall_score / 100,
    },
    metadata: {
      // Decision identification
      decision_id: input.decisionId,
      url: input.url || 'N/A',

      // Evaluation verdict and details
      verdict: scores.verdict,
      overall_score: scores.overall_score,
      production_ready: scores.production_ready,

      // Issue counts
      critical_issues_count: scores.critical_issues_count,
      major_issues_count: scores.major_issues_count,
      minor_issues_count: scores.minor_issues_count,

      // Recommendation and confidence
      recommendation: scores.recommendation,
      confidence: scores.confidence,

      // Extracted data (for easy reference without opening input)
      extracted_json: JSON.stringify(input.extractedData, null, 2),

      // Decision metadata from CSV test set (for aggregation/analysis)
      language: metadata?.language,
      decision_type_ecli_code: metadata?.decision_type_ecli_code,
      decision_type_name: metadata?.decision_type_name,
      court_ecli_code: metadata?.court_ecli_code,
      court_name: metadata?.court_name,
      courtcategory: metadata?.courtcategory,
      decision_date: metadata?.decision_date,
      md_length: metadata?.md_length,
      length_category: metadata?.length_category,
    },
  });
}

/**
 * Summarize experiment results
 *
 * @param experiment - Braintrust experiment instance
 */
export async function summarizeExperiment(experiment: any) {
  // Braintrust will automatically compute summary statistics
  const summary = await experiment.summarize();
  return summary;
}

/**
 * Validate Braintrust configuration
 */
export function validateBraintrustConfig(): boolean {
  const apiKey = process.env.BRAINTRUST_API_KEY;

  if (!apiKey) {
    console.error('❌ BRAINTRUST_API_KEY not found in .env');
    return false;
  }

  if (!apiKey.startsWith('sk-')) {
    console.error('❌ BRAINTRUST_API_KEY appears to be invalid (should start with sk-)');
    return false;
  }

  console.log('✅ Braintrust configuration valid');
  return true;
}

/**
 * Reset client (useful for testing or config changes)
 */
export function resetBraintrustClient(): void {
  isInitialized = false;
}
