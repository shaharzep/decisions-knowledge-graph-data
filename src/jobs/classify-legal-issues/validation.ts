/**
 * ULIT Classification Validation (Stage 4)
 *
 * Validation rules, confidence scoring, review tier routing.
 * No LLM calls - pure TypeScript logic from n8n workflow.
 */

import { TeachingInput, Stage1Result, Stage2Result, Stage3Result } from './stages.js';

/**
 * Validation result for classification
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  productionRulesSatisfied: string[];
}

/**
 * Confidence scores for classification
 */
export interface ConfidenceScores {
  overall: number;
  topic_set: number;
  issue_type_set: number;
  per_topic: Array<{ id: string; confidence: number }>;
  per_issue_type: Array<{ id: string; confidence: number }>;
}

/**
 * Review tier for classification
 */
export type ReviewTier = 'auto_accept' | 'expedited_review' | 'mandatory_review';

/**
 * Final classification output
 */
export interface ClassificationOutput {
  teaching_id: string;
  classification: {
    topic_set: string[];
    topic_set_details: Stage2Result['topic_set'];
    issue_type_set: string[];
    issue_type_set_details: Stage3Result['issue_type_set'];
    issue_key: string;
  };
  confidence: ConfidenceScores;
  validation: ValidationResult;
  review_tier: ReviewTier;
  retrieval_info: {
    description: string;
    retrieval_queries: string;
  };
  alternatives: {
    rejected_topics: Stage2Result['rejected_candidates'];
    rejected_issue_types: Stage3Result['rejected_candidates'];
  };
  reasoning_trace: {
    stage1_concepts: string[];
    stage2_analysis: Stage2Result['analysis'];
    stage3_materiality: Stage3Result['materiality_analysis'];
    production_rules_applied: string[];
    processed_at: string;
  };
}

/**
 * Validate classification against rules (ULIT v2.5.0)
 *
 * Checks:
 * - Topic set size (1-3)
 * - Issue type set size (1-4)
 * - Original production rules for A18.x topics
 * - New v2.5.0 production rules (R1-R9)
 */
export function validateClassification(
  topicSet: Stage2Result['topic_set'],
  issueTypeSet: Stage3Result['issue_type_set']
): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const productionRulesSatisfied: string[] = [];

  const topicIds = topicSet.map((t) => t.topic_id);
  const issueIds = issueTypeSet.map((it) => it.issue_type_id);

  // Rule 1: Topic set size (1-3)
  if (topicIds.length < 1) {
    errors.push('Minimum 1 topic required');
  }
  if (topicIds.length > 3) {
    errors.push('Maximum 3 topics allowed');
  }

  // Rule 2: Issue type set size (1-4)
  if (issueIds.length < 1) {
    errors.push('Minimum 1 issue type required');
  }
  if (issueIds.length > 4) {
    errors.push('Maximum 4 issue types allowed');
  }

  // ========== ORIGINAL PRODUCTION RULES ==========
  // R-orig-1: A18.2 requires B22
  if (topicIds.some((t) => t.startsWith('A18.2')) && !issueIds.includes('B22')) {
    errors.push('R-orig-1: A18.2 requires B22');
  } else if (topicIds.some((t) => t.startsWith('A18.2'))) {
    productionRulesSatisfied.push('R-orig-1: A18.2 → B22 satisfied');
  }

  // R-orig-2: A18.1/A18.4/A18.5/A18.6 requires B21
  const proceduralTopics = ['A18.1', 'A18.4', 'A18.5', 'A18.6'];
  const hasProceduralTopic = topicIds.some((t) =>
    proceduralTopics.some((p) => t.startsWith(p))
  );
  if (hasProceduralTopic && !issueIds.includes('B21')) {
    errors.push('R-orig-2: A18.1/A18.4/A18.5/A18.6 requires B21');
  } else if (hasProceduralTopic) {
    productionRulesSatisfied.push('R-orig-2: A18.1/4/5/6 → B21 satisfied');
  }

  // R-orig-3: A18.3 requires B8 AND B21
  if (topicIds.some((t) => t.startsWith('A18.3'))) {
    if (!issueIds.includes('B8') || !issueIds.includes('B21')) {
      errors.push('R-orig-3: A18.3 requires B8 AND B21');
    } else {
      productionRulesSatisfied.push('R-orig-3: A18.3 → B8 + B21 satisfied');
    }
  }

  // R-orig-4: B3 should not include B21 (warning)
  if (issueIds.includes('B3') && issueIds.includes('B21')) {
    warnings.push('R-orig-4: B3 + B21 unusual unless procedure inside forum');
  }

  // ========== NEW v2.5.0 PRODUCTION RULES ==========
  // R1: A4.2 requires B7
  if (topicIds.some((t) => t === 'A4.2') && !issueIds.includes('B7')) {
    errors.push('R1: A4.2 (Validity defects) requires B7');
  } else if (topicIds.some((t) => t === 'A4.2')) {
    productionRulesSatisfied.push('R1: A4.2 → B7 satisfied');
  }

  // R2: A4.5 requires B11
  if (topicIds.some((t) => t === 'A4.5') && !issueIds.includes('B11')) {
    errors.push('R2: A4.5 (Non-performance) requires B11');
  } else if (topicIds.some((t) => t === 'A4.5')) {
    productionRulesSatisfied.push('R2: A4.5 → B11 satisfied');
  }

  // R3: A4.7 requires B20.1
  if (topicIds.some((t) => t === 'A4.7') && !issueIds.includes('B20.1')) {
    errors.push('R3: A4.7 (Contract remedies) requires B20.1');
  } else if (topicIds.some((t) => t === 'A4.7')) {
    productionRulesSatisfied.push('R3: A4.7 → B20.1 satisfied');
  }

  // R4: A18.6 requires B23
  if (topicIds.some((t) => t.startsWith('A18.6')) && !issueIds.includes('B23')) {
    errors.push('R4: A18.6 (Enforcement) requires B23');
  } else if (topicIds.some((t) => t.startsWith('A18.6'))) {
    productionRulesSatisfied.push('R4: A18.6 → B23 satisfied');
  }

  // R5: B20.3 requires A15.*
  if (issueIds.includes('B20.3') && !topicIds.some((t) => t.startsWith('A15'))) {
    errors.push('R5: B20.3 (Criminal sanctions) requires A15.*');
  } else if (issueIds.includes('B20.3')) {
    productionRulesSatisfied.push('R5: B20.3 → A15.* satisfied');
  }

  // R6: B20.4 requires A13.9.*/A6.*/A13.10/A7.1
  if (issueIds.includes('B20.4')) {
    const hasAnchor = topicIds.some(
      (t) => t.startsWith('A13.9') || t.startsWith('A6') || t === 'A13.10' || t === 'A7.1'
    );
    if (!hasAnchor) {
      errors.push('R6: B20.4 (Disciplinary) requires A13.9.*/A6.*/A13.10/A7.1');
    } else {
      productionRulesSatisfied.push('R6: B20.4 → anchor satisfied');
    }
  }

  // R7: A13.9.* + B20.4 should not include B20.1 unless A5.4
  if (
    topicIds.some((t) => t.startsWith('A13.9')) &&
    issueIds.includes('B20.4') &&
    issueIds.includes('B20.1')
  ) {
    if (!topicIds.includes('A5.4')) {
      errors.push('R7: A13.9.* + B20.4 + B20.1 requires A5.4');
    } else {
      productionRulesSatisfied.push('R7: A13.9.* + B20.4 + B20.1 + A5.4 satisfied');
    }
  }

  // R8: A18.7 requires B3/B23/B24
  if (topicIds.some((t) => t.startsWith('A18.7'))) {
    if (!issueIds.includes('B3') && !issueIds.includes('B23') && !issueIds.includes('B24')) {
      errors.push('R8: A18.7 (Arbitration) requires B3/B23/B24');
    } else {
      productionRulesSatisfied.push('R8: A18.7 → B3/B23/B24 satisfied');
    }
  }

  // R9 (SOFT): A15.10 + B22 should include A18.2
  if (
    topicIds.some((t) => t.startsWith('A15.10')) &&
    issueIds.includes('B22') &&
    !topicIds.some((t) => t.startsWith('A18.2'))
  ) {
    warnings.push('R9: A15.10 + B22 should include A18.2 (soft)');
  }

  // No production rules applied
  if (productionRulesSatisfied.length === 0) {
    productionRulesSatisfied.push('No production rules applicable');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    productionRulesSatisfied,
  };
}

/**
 * Calculate confidence scores
 *
 * Weighted average: 55% topics, 45% issue types.
 */
export function calculateConfidence(
  topicSet: Stage2Result['topic_set'],
  issueTypeSet: Stage3Result['issue_type_set']
): ConfidenceScores {
  const topicConfs = topicSet.map((t) => t.confidence ?? 0.8);
  const issueConfs = issueTypeSet.map((it) => it.confidence ?? 0.8);

  const avgTopicConf =
    topicConfs.length > 0
      ? topicConfs.reduce((a, b) => a + b, 0) / topicConfs.length
      : 0.8;
  const avgIssueConf =
    issueConfs.length > 0
      ? issueConfs.reduce((a, b) => a + b, 0) / issueConfs.length
      : 0.8;

  // Weight topics slightly more (primary retrieval anchor)
  const overall = 0.55 * avgTopicConf + 0.45 * avgIssueConf;

  return {
    overall: Math.round(overall * 1000) / 1000,
    topic_set: avgTopicConf,
    issue_type_set: avgIssueConf,
    per_topic: topicSet.map((t) => ({
      id: t.topic_id,
      confidence: t.confidence ?? 0.8,
    })),
    per_issue_type: issueTypeSet.map((it) => ({
      id: it.issue_type_id,
      confidence: it.confidence ?? 0.8,
    })),
  };
}

/**
 * Determine review tier based on confidence and validation
 *
 * - ≥0.85 confidence + valid → auto_accept
 * - ≥0.65 confidence + valid → expedited_review
 * - else → mandatory_review
 */
export function determineReviewTier(
  confidence: ConfidenceScores,
  validation: ValidationResult
): ReviewTier {
  if (!validation.valid) {
    return 'mandatory_review';
  }
  if (confidence.overall >= 0.85) {
    return 'auto_accept';
  }
  if (confidence.overall >= 0.65) {
    return 'expedited_review';
  }
  return 'mandatory_review';
}

/**
 * Build set-based issue key
 *
 * Format: {A9.1,A15.10}|{B5,B7} (sorted alphabetically)
 */
export function buildIssueKey(topicIds: string[], issueTypeIds: string[]): string {
  const sortedTopics = [...topicIds].sort();
  const sortedIssueTypes = [...issueTypeIds].sort();
  return `{${sortedTopics.join(',')}}|{${sortedIssueTypes.join(',')}}`;
}

/**
 * Build final classification output
 *
 * Assembles all stage results into complete classification.
 */
export function buildFinalClassification(
  teaching: TeachingInput,
  stage1: Stage1Result,
  stage2: Stage2Result,
  stage3: Stage3Result
): ClassificationOutput {
  const topicSet = stage2.topic_set;
  const issueTypeSet = stage3.issue_type_set;

  const topicSetIds = topicSet.map((t) => t.topic_id).sort();
  const issueTypeSetIds = issueTypeSet.map((it) => it.issue_type_id).sort();

  const validation = validateClassification(topicSet, issueTypeSet);
  const confidence = calculateConfidence(topicSet, issueTypeSet);
  const reviewTier = determineReviewTier(confidence, validation);
  const issueKey = buildIssueKey(topicSetIds, issueTypeSetIds);

  return {
    teaching_id: teaching.teachingId,
    classification: {
      topic_set: topicSetIds,
      topic_set_details: topicSet,
      issue_type_set: issueTypeSetIds,
      issue_type_set_details: issueTypeSet,
      issue_key: issueKey,
    },
    confidence,
    validation,
    review_tier: reviewTier,
    retrieval_info: {
      description:
        'Use set intersection for retrieval: match sources where topic_set ∩ query_topics ≠ ∅ AND issue_type_set ∩ query_issue_types ≠ ∅',
      retrieval_queries: stage2.analysis?.retrieval_consideration || '',
    },
    alternatives: {
      rejected_topics: stage2.rejected_candidates || [],
      rejected_issue_types: stage3.rejected_candidates || [],
    },
    reasoning_trace: {
      stage1_concepts: stage1.legal_concepts,
      stage2_analysis: stage2.analysis,
      stage3_materiality: stage3.materiality_analysis,
      production_rules_applied: stage3.production_rules_applied || validation.productionRulesSatisfied,
      processed_at: new Date().toISOString(),
    },
  };
}
