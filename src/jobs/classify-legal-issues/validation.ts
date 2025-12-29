/**
 * ULIT Classification Validation (Stage 4)
 *
 * Validation rules, confidence scoring, review tier routing.
 * No LLM calls - pure TypeScript logic from n8n workflow.
 */

import { TeachingInput, Stage1Result, Stage2Result, Stage3Result } from './stages.js';

// ============================================================================
// VALID ULIT v2.5.0 CODES
// ============================================================================

/**
 * Valid Topic Codes (TREE A) - Leaf nodes only
 *
 * Parent nodes like A13.9, A4.8, A17 are NOT valid - must use specific leaf nodes.
 */
export const VALID_TOPICS = new Set([
  // A0: Persons, Status, Representation
  'A0.1', 'A0.2', 'A0.3', 'A0.4',
  // A1: Family, Care, Personal Relationships
  'A1.1', 'A1.2', 'A1.3', 'A1.4', 'A1.5',
  // A2: Death, Succession, Estates
  'A2.1', 'A2.2', 'A2.3', 'A2.4', 'A2.5',
  // A3: Property, Assets, Real Rights
  'A3.1', 'A3.2', 'A3.3', 'A3.4', 'A3.5', 'A3.6', 'A3.7',
  // A4: Contracts and Voluntary Obligations
  'A4.1', 'A4.2', 'A4.3', 'A4.4', 'A4.5', 'A4.6', 'A4.7',
  'A4.8.1', 'A4.8.2.1', 'A4.8.2.2', 'A4.8.2.3', 'A4.8.2.4',
  'A4.8.3.1', 'A4.8.3.2.1', 'A4.8.3.2.2', 'A4.8.3.2.3', 'A4.8.3.2.4',
  'A4.8.3.3', 'A4.8.3.4', 'A4.8.4', 'A4.8.5', 'A4.8.6', 'A4.8.7', 'A4.8.8',
  // A5: Non-Contractual Responsibility and Restitution
  'A5.1', 'A5.2', 'A5.3', 'A5.4', 'A5.5', 'A5.6', 'A5.7',
  // A6: Work, Economic Dependence, Social Protection
  'A6.1', 'A6.2', 'A6.3', 'A6.4', 'A6.5', 'A6.6', 'A6.7', 'A6.8', 'A6.9',
  // A7: Organizations, Enterprise, Insolvency
  'A7.1', 'A7.2', 'A7.3', 'A7.4', 'A7.5', 'A7.6', 'A7.7',
  // A8: Markets and Mandatory Market Rules
  'A8.1', 'A8.2', 'A8.3', 'A8.4', 'A8.5',
  // A9: Information, Privacy, Reputation, IP
  'A9.1', 'A9.2', 'A9.3', 'A9.4', 'A9.5', 'A9.6', 'A9.7', 'A9.8',
  // A10: Constitutional Order and Fundamental Rights
  'A10.1', 'A10.2', 'A10.3',
  // A11: Administrative Power and Public Decision-Making
  'A11.1', 'A11.2', 'A11.3', 'A11.4', 'A11.5', 'A11.6', 'A11.7', 'A11.8',
  // A12: Taxation and Public Revenues
  'A12.1', 'A12.2', 'A12.3', 'A12.4', 'A12.5', 'A12.6', 'A12.7',
  // A13.1: Environment, Climate, Permitting
  'A13.1.1', 'A13.1.2', 'A13.1.3', 'A13.1.4', 'A13.1.5', 'A13.1.6', 'A13.1.7', 'A13.1.8', 'A13.1.9',
  // A13.2: Healthcare and Life Sciences
  'A13.2.1', 'A13.2.2', 'A13.2.3', 'A13.2.4', 'A13.2.5', 'A13.2.6', 'A13.2.7', 'A13.2.8', 'A13.2.9', 'A13.2.10',
  // A13.3: Financial Services Regulation
  'A13.3.1', 'A13.3.2', 'A13.3.3', 'A13.3.4', 'A13.3.5', 'A13.3.6', 'A13.3.7',
  // A13.4: Telecommunications and Media
  'A13.4.1', 'A13.4.2', 'A13.4.3', 'A13.4.4',
  // A13.5: Energy
  'A13.5.1', 'A13.5.2', 'A13.5.3', 'A13.5.4',
  // A13.6: Transport
  'A13.6.1', 'A13.6.2', 'A13.6.3', 'A13.6.4',
  // A13.7: Food and Agriculture
  'A13.7.1', 'A13.7.2', 'A13.7.3', 'A13.7.4',
  // A13.8: Digital Services and AI
  'A13.8.1', 'A13.8.2', 'A13.8.3', 'A13.8.4', 'A13.8.5',
  // A13.9: Regulated Professions
  'A13.9.1.1', 'A13.9.1.2', 'A13.9.1.3', 'A13.9.1.4',
  'A13.9.2.1', 'A13.9.2.2', 'A13.9.2.3', 'A13.9.2.4', 'A13.9.2.5',
  'A13.9.3.1', 'A13.9.3.2', 'A13.9.3.3',
  'A13.9.4.1', 'A13.9.4.2', 'A13.9.4.3',
  'A13.9.5.1', 'A13.9.5.2', 'A13.9.5.3',
  // A13.10, A13.11
  'A13.10', 'A13.11',
  // A14: Migration and Nationality
  'A14.1', 'A14.2', 'A14.3', 'A14.4', 'A14.5',
  // A15: Criminal Law
  'A15.1', 'A15.2', 'A15.3', 'A15.4', 'A15.5', 'A15.6', 'A15.7', 'A15.8', 'A15.9', 'A15.10',
  // A16: International and Supranational Law
  'A16.1', 'A16.2', 'A16.3', 'A16.4', 'A16.5', 'A16.6', 'A16.7',
  // A17: Procedural Law (Doctrine)
  'A17.1', 'A17.2', 'A17.3', 'A17.4', 'A17.5',
  // A18: Procedure as Relationship (Applied)
  'A18.1', 'A18.2', 'A18.3', 'A18.4', 'A18.5', 'A18.6', 'A18.7',
]);

/**
 * Valid Issue Type Codes (TREE B)
 */
export const VALID_ISSUE_TYPES = new Set([
  // Threshold and Framing
  'B0', 'B1', 'B2', 'B3', 'B4', 'B5',
  // Existence and Meaning
  'B6', 'B7', 'B8', 'B9',
  // Conduct and Breach
  'B10', 'B11',
  // Responsibility and Consequences
  'B12', 'B13', 'B14', 'B15', 'B16',
  // Limiters
  'B17', 'B18', 'B19',
  // Outcomes
  'B20', 'B20.1', 'B20.2', 'B20.3', 'B20.4',
  // Process
  'B21', 'B22', 'B23', 'B24',
]);

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

  // ========== CODE VALIDITY CHECKS ==========
  // Check that all topic codes are valid leaf nodes
  for (const topicId of topicIds) {
    if (!VALID_TOPICS.has(topicId)) {
      if (topicId.startsWith('B')) {
        errors.push(`Invalid topic: ${topicId} is an issue type (B code), not a topic (A code)`);
      } else if (topicId.startsWith('A')) {
        errors.push(`Invalid topic: ${topicId} is not a valid leaf node - use a more specific code`);
      } else {
        errors.push(`Invalid topic: ${topicId} is not a recognized ULIT code`);
      }
    }
  }

  // Check that all issue type codes are valid
  for (const issueId of issueIds) {
    if (!VALID_ISSUE_TYPES.has(issueId)) {
      if (issueId.startsWith('A')) {
        errors.push(`Invalid issue type: ${issueId} is a topic (A code), not an issue type (B code)`);
      } else if (issueId.startsWith('B')) {
        errors.push(`Invalid issue type: ${issueId} is not a recognized issue type`);
      } else {
        errors.push(`Invalid issue type: ${issueId} is not a recognized ULIT code`);
      }
    }
  }

  // ========== SET SIZE CHECKS ==========
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
