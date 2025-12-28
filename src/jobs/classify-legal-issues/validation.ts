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
 * Validate classification against rules
 *
 * Checks:
 * - Topic set size (1-3)
 * - Issue type set size (1-4)
 * - Production rules for A18.x topics
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

  // Rule 3: Production rules for A18.x topics
  // A18.2 → MUST include B22
  if (topicIds.some((t) => t.startsWith('A18.2')) && !issueIds.includes('B22')) {
    errors.push('A18.2 in topic set requires B22 in issue type set');
  } else if (topicIds.some((t) => t.startsWith('A18.2'))) {
    productionRulesSatisfied.push('A18.2 → B22 satisfied');
  }

  // A18.1/A18.4/A18.5/A18.6 → MUST include B21
  const proceduralTopics = ['A18.1', 'A18.4', 'A18.5', 'A18.6'];
  const hasProceduralTopic = topicIds.some((t) =>
    proceduralTopics.some((p) => t.startsWith(p))
  );
  if (hasProceduralTopic && !issueIds.includes('B21')) {
    errors.push('A18.1/A18.4/A18.5/A18.6 in topic set requires B21');
  } else if (hasProceduralTopic) {
    productionRulesSatisfied.push('A18.1/4/5/6 → B21 satisfied');
  }

  // A18.3 → MUST include B8 AND B21
  if (topicIds.some((t) => t.startsWith('A18.3'))) {
    if (!issueIds.includes('B8') || !issueIds.includes('B21')) {
      errors.push('A18.3 in topic set requires both B8 and B21');
    } else {
      productionRulesSatisfied.push('A18.3 → B8 + B21 satisfied');
    }
  }

  // No production rules applied
  if (productionRulesSatisfied.length === 0) {
    productionRulesSatisfied.push('No A18.x topics in set, no mandatory constraints');
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
