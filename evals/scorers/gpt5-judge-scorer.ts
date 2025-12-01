/**
 * Azure GPT-4.1 Judge Scorer - 3-Tier Severity System
 *
 * Evaluates extraction quality using Azure GPT-4.1 as an LLM judge
 * with production-readiness focus
 */

import { formatJudgePrompt } from '../utils/prompt-loader.js';
import { callAzureJudge } from '../config/openai.js';
import { EvaluationResult, Verdict, Recommendation, Confidence } from '../types.js';

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

  // Parse and validate response
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
