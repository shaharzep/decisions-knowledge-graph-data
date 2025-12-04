/**
 * Azure GPT-4.1 Judge Scorer - 3-Tier Severity System
 *
 * Evaluates extraction quality using Azure GPT-4.1 as an LLM judge
 * with production-readiness focus
 */

import { formatJudgePrompt, isMapCitedDecisionsPrompt } from '../utils/prompt-loader.js';
import { callAzureJudge } from '../config/openai.js';
import { EvaluationResult, Verdict, Recommendation, Confidence } from '../types.js';

/**
 * Map-cited-decisions specific evaluation result
 * Different schema from standard EvaluationResult
 */
export interface MapDecisionsEvaluation {
  match_correctness: 'CORRECT' | 'PARTIALLY_CORRECT' | 'INCORRECT' | 'FALSE_POSITIVE' | 'FALSE_NEGATIVE' | 'CORRECT_NO_MATCH';
  correct_decision_id: string | null;
  court_alignment_handling: 'CORRECT_ALIGNMENT' | 'MISSED_COURT_MATCH' | 'WRONG_COURT_ACCEPTED' | 'WRONG_JURISDICTION_OVERPUNISHED' | 'WRONG_JURISDICTION_UNDERPUNISHED' | 'SKIPPED_COURT_CHECK';
  cited_court_classification: 'NATIONAL' | 'SPECIFIC' | 'GENERIC';
  confidence_calibration: 'WELL_CALIBRATED' | 'OVERCONFIDENT' | 'UNDERCONFIDENT';
  expected_confidence_range: [number, number];
  applicable_ceiling: string | null;
  reasoning_quality: number; // 1-5
  errors: string[];
  evaluation_notes: string;
  improvement_suggestions: string | null;
}

/**
 * Score a single extraction using Azure GPT-4.1 judge
 *
 * @param decisionId - ECLI identifier
 * @param originalDocument - Source markdown text
 * @param extractedJSON - Extracted data object
 * @param judgePromptTemplate - The loaded judge prompt markdown content
 * @param jobType - Optional job type for context
 * @returns Structured evaluation result
 */
export async function scoreExtraction(
  decisionId: string,
  originalDocument: string,
  extractedJSON: any,
  judgePromptTemplate: string,
  jobType?: string
): Promise<EvaluationResult> {
  // Extract extractedReferences for Agent 2B evaluation (enrich-provisions)
  const extractedReferences = extractedJSON.extractedReferences || undefined;

  // Format the judge prompt with inputs
  const prompt = formatJudgePrompt(
    judgePromptTemplate,
    decisionId,
    originalDocument,
    extractedJSON,
    jobType,
    extractedReferences
  );

  // Call Azure GPT-4.1 for evaluation
  const responseText = await callAzureJudge(prompt);

  // Parse response based on prompt type
  if (isMapCitedDecisionsPrompt(judgePromptTemplate)) {
    // Map-cited-decisions uses a different response schema
    const mapEval = parseMapDecisionsResponse(responseText);
    return adaptMapDecisionsToEvaluationResult(mapEval);
  }

  // Standard evaluation flow
  const evaluation = parseJudgeResponse(responseText);

  // Validate result structure
  validateEvaluationResult(evaluation);

  return evaluation;
}

/**
 * Parse Azure GPT-4.1 response into structured evaluation result
 *
 * Extracts JSON from markdown code blocks or plain JSON
 *
 * @param responseText - Response from Azure GPT-4.1
 * @returns Parsed evaluation result
 */
export function parseJudgeResponse(responseText: string): EvaluationResult {
  try {
    // Try to extract JSON from markdown code blocks
    let jsonText = responseText.trim();

    // Check for markdown code block
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1];
    } else {
      // Try to find JSON object boundaries
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
    }

    const parsed = JSON.parse(jsonText);

    // Map to ensure correct types (required fields)
    const evaluation: EvaluationResult = {
      verdict: parsed.verdict as Verdict,
      score: Number(parsed.score),
      criticalIssues: Array.isArray(parsed.criticalIssues) ? parsed.criticalIssues : [],
      majorIssues: Array.isArray(parsed.majorIssues) ? parsed.majorIssues : [],
      minorIssues: Array.isArray(parsed.minorIssues) ? parsed.minorIssues : [],
      recommendation: parsed.recommendation as Recommendation,
      confidence: parsed.confidence as Confidence,
      summary: parsed.summary || '',
    };

    // Optional detailed tracking fields (Stage 3: Cited Decisions)
    if (parsed.counts) {
      evaluation.counts = parsed.counts;
    }
    if (Array.isArray(parsed.missing)) {
      evaluation.missing = parsed.missing;
    }
    if (Array.isArray(parsed.hallucinated)) {
      evaluation.hallucinated = parsed.hallucinated;
    }
    if (Array.isArray(parsed.foreignCourts)) {
      evaluation.foreignCourts = parsed.foreignCourts;
    }
    if (Array.isArray(parsed.wrongTreatments)) {
      evaluation.wrongTreatments = parsed.wrongTreatments;
    }
    if (Array.isArray(parsed.notVerbatim)) {
      evaluation.notVerbatim = parsed.notVerbatim;
    }
    if (Array.isArray(parsed.administrativeBodyErrors)) {
      evaluation.administrativeBodyErrors = parsed.administrativeBodyErrors;
    }
    if (Array.isArray(parsed.sequencingErrors)) {
      evaluation.sequencingErrors = parsed.sequencingErrors;
    }

    // Optional detailed tracking fields (Stage 5: Legal Teachings)
    if (parsed.courtLevelDetection) {
      evaluation.courtLevelDetection = parsed.courtLevelDetection;
    }
    if (Array.isArray(parsed.teachingAnalysis)) {
      evaluation.teachingAnalysis = parsed.teachingAnalysis;
    }
    if (parsed.aggregateStatistics) {
      evaluation.aggregateStatistics = parsed.aggregateStatistics;
    }
    if (parsed.deductionBreakdown) {
      evaluation.deductionBreakdown = parsed.deductionBreakdown;
    }
    if (parsed.expectedVsActual) {
      evaluation.expectedVsActual = parsed.expectedVsActual;
    }

    return evaluation;
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Failed to parse Azure GPT-4.1 judge response as JSON: ${error.message}\n` +
          `Response preview: ${responseText.substring(0, 500)}...`
      );
    }
    throw error;
  }
}

/**
 * Validate that evaluation result has all required fields
 *
 * @param result - Evaluation result to validate
 * @throws Error if validation fails
 */
export function validateEvaluationResult(result: any): void {
  const required = [
    'verdict',
    'score',
    'criticalIssues',
    'majorIssues',
    'minorIssues',
    'recommendation',
    'confidence',
    'summary',
  ];

  for (const field of required) {
    if (!(field in result)) {
      throw new Error(`Missing required field in evaluation: ${field}`);
    }
  }

  // Validate verdict
  const validVerdicts: Verdict[] = ['PASS', 'FAIL', 'REVIEW_REQUIRED'];
  if (!validVerdicts.includes(result.verdict)) {
    throw new Error(
      `Invalid verdict: ${result.verdict}. Must be one of: ${validVerdicts.join(', ')}`
    );
  }

  // Validate score range
  if (typeof result.score !== 'number' || result.score < 0 || result.score > 100) {
    throw new Error(
      `Invalid score: ${result.score}. Must be a number between 0-100`
    );
  }

  // Validate recommendation (supports both legacy and new values)
  const validRecommendations: Recommendation[] = [
    'PROCEED', 'FIX_PROMPT', 'REVIEW_SAMPLES',  // Legacy
    'ACCEPT', 'REJECT', 'REVIEW_MANUALLY'       // New
  ];
  if (!validRecommendations.includes(result.recommendation)) {
    throw new Error(
      `Invalid recommendation: ${result.recommendation}. Must be one of: ${validRecommendations.join(', ')}`
    );
  }

  // Validate confidence
  const validConfidence: Confidence[] = ['HIGH', 'MEDIUM', 'LOW'];
  if (!validConfidence.includes(result.confidence)) {
    throw new Error(
      `Invalid confidence: ${result.confidence}. Must be one of: ${validConfidence.join(', ')}`
    );
  }

  // Validate issue arrays
  if (!Array.isArray(result.criticalIssues)) {
    throw new Error('criticalIssues must be an array');
  }
  if (!Array.isArray(result.majorIssues)) {
    throw new Error('majorIssues must be an array');
  }
  if (!Array.isArray(result.minorIssues)) {
    throw new Error('minorIssues must be an array');
  }
}

/**
 * Extract scores for Braintrust logging
 *
 * @param evaluation - Full evaluation result
 * @returns Object with scores for Braintrust
 */
export function extractScoresForBraintrust(evaluation: EvaluationResult): {
  verdict: Verdict;
  overall_score: number;
  critical_issues_count: number;
  major_issues_count: number;
  minor_issues_count: number;
  recommendation: Recommendation;
  confidence: Confidence;
  production_ready: boolean;
} {
  return {
    verdict: evaluation.verdict,
    overall_score: evaluation.score,
    critical_issues_count: evaluation.criticalIssues.length,
    major_issues_count: evaluation.majorIssues.length,
    minor_issues_count: evaluation.minorIssues.length,
    recommendation: evaluation.recommendation,
    confidence: evaluation.confidence,
    production_ready: evaluation.verdict === 'PASS',
  };
}

// ============================================================================
// MAP-CITED-DECISIONS SPECIFIC PARSING AND ADAPTATION
// ============================================================================

/**
 * Parse map-cited-decisions judge response
 *
 * This response uses a different schema than standard evaluations.
 *
 * @param responseText - Raw response from Azure GPT-4.1
 * @returns Parsed MapDecisionsEvaluation
 */
export function parseMapDecisionsResponse(responseText: string): MapDecisionsEvaluation {
  try {
    let jsonText = responseText.trim();

    // Extract JSON from markdown code blocks if present
    const codeBlockMatch = jsonText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (codeBlockMatch) {
      jsonText = codeBlockMatch[1];
    } else {
      // Try to find JSON object boundaries
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonText = jsonMatch[0];
      }
    }

    const parsed = JSON.parse(jsonText);

    // Validate and map to MapDecisionsEvaluation
    const evaluation: MapDecisionsEvaluation = {
      match_correctness: parsed.match_correctness || 'INCORRECT',
      correct_decision_id: parsed.correct_decision_id || null,
      court_alignment_handling: parsed.court_alignment_handling || 'CORRECT_ALIGNMENT',
      cited_court_classification: parsed.cited_court_classification || 'GENERIC',
      confidence_calibration: parsed.confidence_calibration || 'WELL_CALIBRATED',
      expected_confidence_range: Array.isArray(parsed.expected_confidence_range)
        ? parsed.expected_confidence_range
        : [0, 100],
      applicable_ceiling: parsed.applicable_ceiling || null,
      reasoning_quality: typeof parsed.reasoning_quality === 'number'
        ? parsed.reasoning_quality
        : 3,
      errors: Array.isArray(parsed.errors) ? parsed.errors : [],
      evaluation_notes: parsed.evaluation_notes || '',
      improvement_suggestions: parsed.improvement_suggestions || null,
    };

    return evaluation;
  } catch (error: any) {
    if (error instanceof SyntaxError) {
      throw new Error(
        `Failed to parse map-cited-decisions judge response as JSON: ${error.message}\n` +
        `Response preview: ${responseText.substring(0, 500)}...`
      );
    }
    throw error;
  }
}

/**
 * Adapt MapDecisionsEvaluation to standard EvaluationResult
 *
 * Converts the domain-specific evaluation schema to the standard format
 * for Braintrust logging and aggregation.
 *
 * Mapping logic:
 * - match_correctness → verdict (CORRECT/PARTIALLY→PASS, INCORRECT/FALSE→FAIL, etc.)
 * - reasoning_quality × 20 → base score (1-5 becomes 20-100)
 * - court_alignment_handling → score adjustments
 * - errors → criticalIssues/majorIssues based on severity
 * - confidence_calibration → confidence
 * - evaluation_notes → summary
 *
 * @param mapEval - Domain-specific evaluation
 * @returns Standard EvaluationResult
 */
export function adaptMapDecisionsToEvaluationResult(
  mapEval: MapDecisionsEvaluation
): EvaluationResult {
  // Map match_correctness to verdict
  let verdict: Verdict;
  switch (mapEval.match_correctness) {
    case 'CORRECT':
    case 'CORRECT_NO_MATCH':
      verdict = 'PASS';
      break;
    case 'PARTIALLY_CORRECT':
      verdict = 'REVIEW_REQUIRED';
      break;
    case 'INCORRECT':
    case 'FALSE_POSITIVE':
    case 'FALSE_NEGATIVE':
      verdict = 'FAIL';
      break;
    default:
      verdict = 'REVIEW_REQUIRED';
  }

  // Calculate score from reasoning_quality (1-5 → 20-100)
  let baseScore = mapEval.reasoning_quality * 20;

  // Adjust based on match correctness
  if (mapEval.match_correctness === 'CORRECT' || mapEval.match_correctness === 'CORRECT_NO_MATCH') {
    baseScore = Math.max(baseScore, 80);
  } else if (mapEval.match_correctness === 'PARTIALLY_CORRECT') {
    baseScore = Math.min(baseScore, 75);
  } else {
    baseScore = Math.min(baseScore, 50);
  }

  // Adjust for court alignment handling
  switch (mapEval.court_alignment_handling) {
    case 'CORRECT_ALIGNMENT':
      // No penalty
      break;
    case 'WRONG_COURT_ACCEPTED':
      baseScore -= 20; // Critical: accepted wrong court type
      break;
    case 'SKIPPED_COURT_CHECK':
      baseScore -= 15; // Critical: didn't verify court alignment first
      break;
    case 'MISSED_COURT_MATCH':
      baseScore -= 10; // Major: failed FR/NL equivalence
      break;
    case 'WRONG_JURISDICTION_UNDERPUNISHED':
      baseScore -= 10; // Major: gave >55% to different jurisdiction
      break;
    case 'WRONG_JURISDICTION_OVERPUNISHED':
      baseScore -= 5; // Minor: penalized generic citation
      break;
  }

  // Adjust for confidence calibration
  if (mapEval.confidence_calibration === 'OVERCONFIDENT') {
    baseScore -= 10;
  } else if (mapEval.confidence_calibration === 'UNDERCONFIDENT') {
    baseScore -= 5;
  }

  const score = Math.max(0, Math.min(100, baseScore));

  // Categorize errors by severity
  const criticalErrors = [
    // Case number errors
    'CASE_NUMBER_IGNORED',
    'CASE_NUMBER_FALSE_MATCH',
    'ECLI_MISMATCH_IGNORED',
    // Court alignment errors (severe)
    'COURT_TYPE_MISMATCH_IGNORED',
    'JURISDICTION_MISMATCH_IGNORED',
    // Calibration errors
    'CEILING_VIOLATED',
  ];

  const majorErrors = [
    // Court alignment errors
    'COURT_CHECK_SKIPPED',
    'FR_NL_CONFUSION',
    'ABBREVIATION_MISSED',
    'GENERIC_OVERPUNISHED',
    // Case number errors
    'MISSING_CASE_NUMBER_PENALIZED',
    // Context errors
    'CONTEXT_MISREAD',
    'OVERFIT_TO_KEYWORDS',
  ];

  const criticalIssues: string[] = [];
  const majorIssues: string[] = [];
  const minorIssues: string[] = [];

  for (const error of mapEval.errors) {
    if (error === 'NONE') continue;
    if (criticalErrors.includes(error)) {
      criticalIssues.push(error);
    } else if (majorErrors.includes(error)) {
      majorIssues.push(error);
    } else {
      minorIssues.push(error);
    }
  }

  // Add court alignment issue if not correct
  if (mapEval.court_alignment_handling !== 'CORRECT_ALIGNMENT') {
    const alignmentIssue = `COURT_ALIGNMENT_${mapEval.court_alignment_handling}`;
    if (['WRONG_COURT_ACCEPTED', 'SKIPPED_COURT_CHECK'].includes(mapEval.court_alignment_handling)) {
      criticalIssues.push(alignmentIssue);
    } else {
      majorIssues.push(alignmentIssue);
    }
  }

  // Add calibration issue if not well-calibrated
  if (mapEval.confidence_calibration !== 'WELL_CALIBRATED') {
    majorIssues.push(`CONFIDENCE_${mapEval.confidence_calibration}`);
  }

  // Map confidence_calibration to Confidence
  let confidence: Confidence;
  if (mapEval.match_correctness === 'CORRECT' || mapEval.match_correctness === 'CORRECT_NO_MATCH') {
    confidence = 'HIGH';
  } else if (mapEval.match_correctness === 'PARTIALLY_CORRECT') {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  // Map to recommendation
  let recommendation: Recommendation;
  if (verdict === 'PASS') {
    recommendation = 'ACCEPT';
  } else if (verdict === 'FAIL') {
    recommendation = mapEval.improvement_suggestions ? 'FIX_PROMPT' : 'REJECT';
  } else {
    recommendation = 'REVIEW_MANUALLY';
  }

  // Build summary with court classification context
  let summary = `[${mapEval.match_correctness}] [${mapEval.cited_court_classification}] ${mapEval.evaluation_notes}`;
  if (mapEval.applicable_ceiling) {
    summary += ` (Ceiling: ${mapEval.applicable_ceiling})`;
  }
  if (mapEval.improvement_suggestions) {
    summary += ` Suggestions: ${mapEval.improvement_suggestions}`;
  }

  return {
    verdict,
    score,
    criticalIssues,
    majorIssues,
    minorIssues,
    recommendation,
    confidence,
    summary,
  };
}
