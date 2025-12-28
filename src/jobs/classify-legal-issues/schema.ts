/**
 * ULIT Classification Output Schema
 *
 * JSON Schema for validating classification output.
 */

export const SCHEMA_NAME = 'legal_issue_classification';

/**
 * Output schema for legal issue classification
 */
export const classifyLegalIssuesSchema = {
  type: 'object',
  required: [
    'teaching_id',
    'classification',
    'confidence',
    'validation',
    'review_tier',
  ],
  additionalProperties: true,
  properties: {
    teaching_id: {
      type: 'string',
      description: 'Unique identifier for the teaching being classified',
    },
    classification: {
      type: 'object',
      required: ['topic_set', 'issue_type_set', 'issue_key'],
      additionalProperties: true,
      properties: {
        topic_set: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 3,
          description: 'Sorted array of topic IDs (1-3 topics)',
        },
        topic_set_details: {
          type: 'array',
          items: {
            type: 'object',
            required: ['topic_id', 'topic_name', 'confidence'],
            properties: {
              topic_id: { type: 'string' },
              topic_name: { type: 'string' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
              materiality_evidence: { type: 'string' },
            },
          },
        },
        issue_type_set: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: 4,
          description: 'Sorted array of issue type IDs (1-4 issue types)',
        },
        issue_type_set_details: {
          type: 'array',
          items: {
            type: 'object',
            required: ['issue_type_id', 'issue_type_name', 'confidence'],
            properties: {
              issue_type_id: { type: 'string' },
              issue_type_name: { type: 'string' },
              confidence: { type: 'number', minimum: 0, maximum: 1 },
            },
          },
        },
        issue_key: {
          type: 'string',
          pattern: '^\\{[A-Z0-9.,]+\\}\\|\\{[A-Z0-9.,]+\\}$',
          description: 'Set-based issue key: {topics}|{issue_types}',
        },
      },
    },
    confidence: {
      type: 'object',
      required: ['overall', 'topic_set', 'issue_type_set'],
      properties: {
        overall: {
          type: 'number',
          minimum: 0,
          maximum: 1,
          description: 'Weighted average confidence (55% topics, 45% issue types)',
        },
        topic_set: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
        issue_type_set: {
          type: 'number',
          minimum: 0,
          maximum: 1,
        },
        per_topic: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              confidence: { type: 'number' },
            },
          },
        },
        per_issue_type: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              confidence: { type: 'number' },
            },
          },
        },
      },
    },
    validation: {
      type: 'object',
      required: ['valid', 'errors', 'warnings'],
      properties: {
        valid: {
          type: 'boolean',
          description: 'Whether classification passed all validation rules',
        },
        errors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Validation errors (blocking)',
        },
        warnings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Validation warnings (non-blocking)',
        },
        productionRulesSatisfied: {
          type: 'array',
          items: { type: 'string' },
          description: 'Production rules that were checked/satisfied',
        },
      },
    },
    review_tier: {
      type: 'string',
      enum: ['auto_accept', 'expedited_review', 'mandatory_review'],
      description: 'Review tier based on confidence and validation',
    },
    retrieval_info: {
      type: 'object',
      properties: {
        description: { type: 'string' },
        retrieval_queries: { type: 'string' },
      },
    },
    alternatives: {
      type: 'object',
      properties: {
        rejected_topics: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              topic_id: { type: 'string' },
              rejection_reason: { type: 'string' },
            },
          },
        },
        rejected_issue_types: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              issue_type_id: { type: 'string' },
              rejection_reason: { type: 'string' },
            },
          },
        },
      },
    },
    reasoning_trace: {
      type: 'object',
      properties: {
        stage1_concepts: {
          type: 'array',
          items: { type: 'string' },
        },
        stage2_analysis: { type: 'object' },
        stage3_materiality: {
          type: 'array',
          items: { type: 'object' },
        },
        production_rules_applied: {
          type: 'array',
          items: { type: 'string' },
        },
        processed_at: {
          type: 'string',
          format: 'date-time',
        },
      },
    },
  },
};
