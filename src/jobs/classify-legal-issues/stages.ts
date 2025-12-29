/**
 * ULIT Classification Stages
 *
 * Three-stage LLM execution for legal teaching classification.
 * Each stage uses gpt-5-mini with LOW reasoning effort.
 */

import {
  STAGE1_SYSTEM_PROMPT,
  STAGE2_SYSTEM_PROMPT,
  STAGE3_SYSTEM_PROMPT,
  buildProvisionsContext,
  buildStage1UserPrompt,
  buildStage2UserPrompt,
  buildStage3UserPrompt,
  buildStage3RetryPrompt,
} from './prompts.js';

/**
 * Stage 2 JSON Schema for Structured Outputs
 *
 * Enforces maxItems: 3 on topic_set to prevent schema validation errors.
 */
const STAGE2_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    analysis: {
      type: 'object',
      properties: {
        bodies_of_law_engaged: {
          type: 'array',
          items: { type: 'string' },
        },
        retrieval_consideration: { type: 'string' },
        granularity_decisions: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['bodies_of_law_engaged', 'retrieval_consideration', 'granularity_decisions'],
      additionalProperties: false,
    },
    topic_set: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
      items: {
        type: 'object',
        properties: {
          topic_id: { type: 'string' },
          topic_name: { type: 'string' },
          confidence: { type: 'number' },
          materiality_evidence: { type: 'string' },
        },
        required: ['topic_id', 'topic_name', 'confidence', 'materiality_evidence'],
        additionalProperties: false,
      },
    },
    rejected_candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          topic_id: { type: 'string' },
          rejection_reason: { type: 'string' },
        },
        required: ['topic_id', 'rejection_reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['analysis', 'topic_set', 'rejected_candidates'],
  additionalProperties: false,
};

/**
 * Stage 3 JSON Schema for Structured Outputs
 *
 * Enforces maxItems: 4 on issue_type_set to prevent schema validation errors.
 */
const STAGE3_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    materiality_analysis: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issue_type_id: { type: 'string' },
          issue_type_name: { type: 'string' },
          engagement_evidence: { type: 'string' },
          is_material: { type: 'boolean' },
        },
        required: ['issue_type_id', 'issue_type_name', 'engagement_evidence', 'is_material'],
        additionalProperties: false,
      },
    },
    production_rules_applied: {
      type: 'array',
      items: { type: 'string' },
    },
    production_rules_violations: {
      type: 'array',
      items: { type: 'string' },
    },
    issue_type_set: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          issue_type_id: { type: 'string' },
          issue_type_name: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['issue_type_id', 'issue_type_name', 'confidence'],
        additionalProperties: false,
      },
    },
    rejected_candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          issue_type_id: { type: 'string' },
          rejection_reason: { type: 'string' },
        },
        required: ['issue_type_id', 'rejection_reason'],
        additionalProperties: false,
      },
    },
  },
  required: ['materiality_analysis', 'production_rules_applied', 'production_rules_violations', 'issue_type_set', 'rejected_candidates'],
  additionalProperties: false,
};

/**
 * Teaching input for classification
 */
export interface TeachingInput {
  teachingId: string;
  text: string;
  courtVerbatim?: string;
  factualTrigger?: string;
  principleType?: string;
  relatedCitedProvisions?: Array<{
    parentActName?: string;
    provisionNumber?: string;
    provisionInterpretation?: string;
  }>;
  decisionId?: string;
  language?: string;
}

/**
 * Stage 1 Result: Candidate Generation
 */
export interface Stage1Result {
  legal_concepts: string[];
  candidate_topics: Array<{
    topic_id: string;
    topic_name: string;
    reasoning: string;
    retrieval_queries?: string[];
  }>;
  candidate_issue_types: Array<{
    issue_type_id: string;
    issue_type_name: string;
    reasoning: string;
    engagement_level: string;
  }>;
}

/**
 * Stage 2 Result: Topic Set Selection
 */
export interface Stage2Result {
  analysis: {
    bodies_of_law_engaged: string[];
    retrieval_consideration: string;
    granularity_decisions?: string[];
  };
  topic_set: Array<{
    topic_id: string;
    topic_name: string;
    confidence: number;
    materiality_evidence?: string;
  }>;
  rejected_candidates?: Array<{
    topic_id: string;
    rejection_reason: string;
  }>;
}

/**
 * Stage 3 Result: Issue Type Set Selection
 */
export interface Stage3Result {
  materiality_analysis?: Array<{
    issue_type_id: string;
    issue_type_name: string;
    engagement_evidence: string;
    is_material: boolean;
  }>;
  production_rules_applied?: string[];
  issue_type_set: Array<{
    issue_type_id: string;
    issue_type_name: string;
    confidence: number;
  }>;
  rejected_candidates?: Array<{
    issue_type_id: string;
    rejection_reason: string;
  }>;
}

/**
 * Parse JSON from LLM response
 *
 * Handles markdown code blocks and various response field names.
 */
export function parseJsonFromResponse(responseText: string): any {
  let text = responseText.trim();

  // Remove markdown code blocks if present
  if (text.startsWith('```json')) {
    text = text.slice(7);
  } else if (text.startsWith('```')) {
    text = text.slice(3);
  }
  if (text.endsWith('```')) {
    text = text.slice(0, -3);
  }
  text = text.trim();

  return JSON.parse(text);
}

/**
 * Extract response content from LLM completion
 */
function extractResponseContent(completion: any): string {
  // Try common response field patterns
  const content =
    completion.choices?.[0]?.message?.content ||
    completion.response ||
    completion.text ||
    completion.output ||
    completion.message;

  if (!content) {
    throw new Error(
      'No response content found. Keys: ' + Object.keys(completion).join(', ')
    );
  }

  return content;
}

/**
 * Stage 1: Candidate Generation
 *
 * Generates broad candidate lists (3-6 topics, 3-6 issue types).
 * Uses LOW reasoning effort for efficient candidate identification.
 */
export async function runStage1CandidateGeneration(
  teaching: TeachingInput,
  client: any
): Promise<Stage1Result> {
  const provisionsContext = buildProvisionsContext(teaching.relatedCitedProvisions);

  const userPrompt = buildStage1UserPrompt({
    teachingId: teaching.teachingId,
    text: teaching.text,
    courtVerbatim: teaching.courtVerbatim,
    factualTrigger: teaching.factualTrigger,
    principleType: teaching.principleType,
    provisionsContext,
  });

  const messages = [
    { role: 'system' as const, content: STAGE1_SYSTEM_PROMPT },
    { role: 'user' as const, content: userPrompt },
  ];

  const responseFormat = { type: 'json_object' as const };

  const settings = {
    reasoningEffort: 'low' as const,
  };

  const completion = await client.complete(messages, responseFormat, settings);
  const content = extractResponseContent(completion);
  const result = parseJsonFromResponse(content);

  // Validate required fields
  if (!result.candidate_topics || result.candidate_topics.length === 0) {
    throw new Error('Stage 1 produced no candidate topics');
  }
  if (!result.candidate_issue_types || result.candidate_issue_types.length === 0) {
    throw new Error('Stage 1 produced no candidate issue types');
  }

  return result as Stage1Result;
}

/**
 * Stage 2: Topic Set Selection
 *
 * Narrows candidates to 1-3 topics.
 * Uses LOW reasoning effort for deterministic selection.
 */
export async function runStage2TopicSetSelection(
  teaching: TeachingInput,
  stage1Result: Stage1Result,
  client: any
): Promise<Stage2Result> {
  const provisionsContext = buildProvisionsContext(teaching.relatedCitedProvisions);

  const userPrompt = buildStage2UserPrompt(
    {
      teachingId: teaching.teachingId,
      text: teaching.text,
      factualTrigger: teaching.factualTrigger,
      provisionsContext,
    },
    stage1Result
  );

  const messages = [
    { role: 'system' as const, content: STAGE2_SYSTEM_PROMPT },
    { role: 'user' as const, content: userPrompt },
  ];

  // Use structured outputs with schema to enforce maxItems: 3
  const responseFormat = {
    type: 'json_schema' as const,
    json_schema: {
      name: 'stage2_topic_set_selection',
      schema: STAGE2_RESPONSE_SCHEMA,
      strict: true,
    },
  };

  const settings = {
    reasoningEffort: 'low' as const,
  };

  const completion = await client.complete(messages, responseFormat, settings);
  const content = extractResponseContent(completion);
  const result = parseJsonFromResponse(content);

  // Validate required fields
  if (!result.topic_set || result.topic_set.length === 0) {
    throw new Error('Stage 2 did not produce a topic set');
  }

  return result as Stage2Result;
}

/**
 * Stage 3: Issue Type Set Selection
 *
 * Selects 1-4 issue types using materiality standard.
 * Uses LOW reasoning effort for balanced selection.
 */
export async function runStage3IssueTypeSetSelection(
  teaching: TeachingInput,
  stage1Result: Stage1Result,
  stage2Result: Stage2Result,
  client: any
): Promise<Stage3Result> {
  const userPrompt = buildStage3UserPrompt(
    {
      teachingId: teaching.teachingId,
      text: teaching.text,
      courtVerbatim: teaching.courtVerbatim,
    },
    stage1Result,
    stage2Result
  );

  const messages = [
    { role: 'system' as const, content: STAGE3_SYSTEM_PROMPT },
    { role: 'user' as const, content: userPrompt },
  ];

  // Use structured outputs with schema to enforce maxItems: 4
  const responseFormat = {
    type: 'json_schema' as const,
    json_schema: {
      name: 'stage3_issue_type_selection',
      schema: STAGE3_RESPONSE_SCHEMA,
      strict: true,
    },
  };

  const settings = {
    reasoningEffort: 'low' as const,
  };

  const completion = await client.complete(messages, responseFormat, settings);
  const content = extractResponseContent(completion);
  const result = parseJsonFromResponse(content);

  // Validate required fields
  if (!result.issue_type_set || result.issue_type_set.length === 0) {
    throw new Error('Stage 3 did not produce any issue types');
  }

  return result as Stage3Result;
}

/**
 * Stage 3 with retry on production rule validation failure
 *
 * Runs Stage 3, validates against production rules, and retries with
 * error feedback if violations are detected. Max 1 retry.
 *
 * @param validateFn - Validation function passed from config.ts to avoid circular import
 */
export async function runStage3WithRetry(
  teaching: TeachingInput,
  stage1Result: Stage1Result,
  stage2Result: Stage2Result,
  client: any,
  validateFn: (
    topicSet: Stage2Result['topic_set'],
    issueTypeSet: Stage3Result['issue_type_set']
  ) => { valid: boolean; errors: string[]; warnings: string[] }
): Promise<{ result: Stage3Result; retried: boolean; originalErrors?: string[] }> {
  // First attempt
  const firstResult = await runStage3IssueTypeSetSelection(
    teaching,
    stage1Result,
    stage2Result,
    client
  );

  // Validate against production rules
  const validation = validateFn(stage2Result.topic_set, firstResult.issue_type_set);

  // If valid or only warnings, return
  if (validation.valid) {
    return { result: firstResult, retried: false };
  }

  // Production rule errors detected - retry with feedback
  console.log(`⚠️ Stage 3 validation failed for ${teaching.teachingId}: ${validation.errors.join(', ')}`);
  console.log(`🔄 Retrying Stage 3 with error feedback...`);

  const retryPrompt = buildStage3RetryPrompt(
    {
      teachingId: teaching.teachingId,
      text: teaching.text,
      courtVerbatim: teaching.courtVerbatim,
    },
    stage1Result,
    stage2Result,
    { issue_type_set: firstResult.issue_type_set },
    validation.errors
  );

  const messages = [
    { role: 'system' as const, content: STAGE3_SYSTEM_PROMPT },
    { role: 'user' as const, content: retryPrompt },
  ];

  // Use structured outputs with schema to enforce maxItems: 4 (same as first attempt)
  const responseFormat = {
    type: 'json_schema' as const,
    json_schema: {
      name: 'stage3_issue_type_selection',
      schema: STAGE3_RESPONSE_SCHEMA,
      strict: true,
    },
  };

  const settings = {
    reasoningEffort: 'low' as const,
  };

  const completion = await client.complete(messages, responseFormat, settings);
  const content = extractResponseContent(completion);
  const retryResult = parseJsonFromResponse(content);

  if (!retryResult.issue_type_set || retryResult.issue_type_set.length === 0) {
    throw new Error('Stage 3 retry did not produce any issue types');
  }

  // Validate retry result
  const retryValidation = validateFn(stage2Result.topic_set, retryResult.issue_type_set);
  if (!retryValidation.valid) {
    console.log(`⚠️ Stage 3 retry still has errors: ${retryValidation.errors.join(', ')}`);
  } else {
    console.log(`✅ Stage 3 retry successful - production rules satisfied`);
  }

  return {
    result: retryResult as Stage3Result,
    retried: true,
    originalErrors: validation.errors,
  };
}
