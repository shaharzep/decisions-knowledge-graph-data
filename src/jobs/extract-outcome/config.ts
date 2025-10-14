import { JobConfig } from '../JobConfig.js';
import { OUTCOME_PROMPT } from './prompt.js';

/**
 * Extract Outcome Job Configuration
 *
 * Extracts legal metadata (outcome classification) from Belgian court decisions.
 *
 * Features:
 * - Joins decisions1 with decision_fulltext1 to get full markdown text
 * - Only processes decisions with full_md (skips null values)
 * - Tracks id, decision_id, language_metadata for result merging
 * - Classifies outcome based on dispositif/beschikking
 */

const config: JobConfig = {
  id: 'extract-outcome',

  description:
    'Extract decision outcome and validate document structure from Belgian court decisions',

  /**
   * Database Query
   *
   * Joins decisions1 with decisions_md to get full markdown text.
   * CRITICAL: Only processes decisions where full_md IS NOT NULL.
   */
  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      dm.full_md
    FROM decisions1 d
    INNER JOIN decisions_md dm ON d.id = dm.decision_serial
    WHERE dm.full_md IS NOT NULL
    LIMIT $1
  `,

  dbQueryParams: [100],

  /**
   * Row Metadata Fields
   *
   * These fields will be tracked and merged into final output JSON.
   * Enables merging results across all extraction jobs.
   *
   * Maps to output fields:
   * - id → id
   * - decision_id → decision_id
   * - language_metadata → language
   */
  rowMetadataFields: ['id', 'decision_id', 'language_metadata'],

  /**
   * Prompt Template
   *
   * Replaces template variables in OUTCOME_PROMPT with actual data.
   */
  promptTemplate: (row) => {
    return OUTCOME_PROMPT.replace('{{decisionId}}', String(row.id) || '')
      .replace('{{fullTextMarkdown}}', row.full_md || '')
      .replace('{{proceduralLanguage}}', row.language_metadata || 'FR');
  },

  /**
   * Output JSON Schema
   *
   * Validates the model's response structure.
   */
  outputSchema: {
    type: 'object',
    required: ['currentInstance', 'metadata'],
    properties: {
      currentInstance: {
        type: 'object',
        required: ['outcome'],
        properties: {
          outcome: {
            type: 'string',
            enum: [
              'GRANTED',
              'DENIED',
              'PARTIALLY_GRANTED',
              'DISMISSED',
              'INADMISSIBLE',
              'REMANDED',
              'PARTIAL_CASSATION',
              'CONFIRMED',
              'REVERSED',
            ],
            description: 'Classification of the decision outcome',
          },
        },
      },
      metadata: {
        type: 'object',
        required: [
          'outcomeConfidence',
          'outcomeSummary',
          'isAppellateDecision',
          'proceduralPosture',
        ],
        properties: {
          outcomeConfidence: {
            type: 'string',
            enum: ['HIGH', 'MEDIUM', 'LOW'],
            description: 'Confidence level of the outcome classification',
          },
          outcomeSummary: {
            type: 'string',
            minLength: 10,
            description:
              '1-2 sentence explanation in the decision language',
          },
          isAppellateDecision: {
            type: 'boolean',
            description: 'Whether this is an appellate court decision',
          },
          proceduralPosture: {
            type: 'string',
            minLength: 5,
            description: 'Brief description of the procedural context',
          },
        },
      },
    },
  },

  /**
   * Azure Configuration
   */
  deploymentName: 'gpt-4o-2',
  maxTokens: 4000,
  temperature: 0.0,

  /**
   * Custom ID prefix
   */
  customIdPrefix: 'outcome',
};

export default config;
