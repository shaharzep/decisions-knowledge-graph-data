import { JobConfig } from '../JobConfig.js';
import { KEYWORDS_PROMPT } from './prompt.js';
import { TaxonomyManager } from './taxonomy.js';
import { TaxonomyFilterService } from './taxonomyFilter.js';

/**
 * Extract Keywords Job Configuration
 *
 * Generates custom keywords and maps legal issues from the Belgian legal taxonomy (UTU).
 *
 * Features:
 * - Excludes decisions that already have UTU keywords
 * - Uses GPT-5 to pre-filter taxonomy to relevant categories (reduces tokens by 80%)
 * - Processes decisions with decision_id and language_metadata
 * - Uses empty strings for fields not yet available in database
 */

const config: JobConfig = {
  id: 'extract-keywords',

  description:
    'Generate custom keywords and map to Belgian legal taxonomy (UTU keywords)',

  /**
   * Database Query
   *
   * Selects decisions from decisions1 that DON'T have UTU keywords yet.
   * Joins with decisions_md to get full markdown text.
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
      AND NOT EXISTS (
        SELECT 1
        FROM decisions_summaries_keywords dsk
        JOIN keywords1 k ON dsk.keyword_id = k.id
        WHERE dsk.decision_id = d.id
          AND k.keyword_type = 'UTU'
      )
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
   * Preprocessing Hook
   *
   * For each decision:
   * 1. Load full taxonomy (once)
   * 2. Use GPT-5 to select 2-3 relevant parent categories
   * 3. Filter taxonomy to selected categories (~80% reduction)
   * 4. Format filtered taxonomy for prompt
   * 5. Add to row data
   */
  preprocessRow: async (row) => {
    // Ensure taxonomy is loaded
    const stats = TaxonomyManager.getStats();
    if (!stats.isLoaded) {
      await TaxonomyManager.loadTaxonomy();
    }

    // Get parent categories
    const parentCategories = TaxonomyManager.getParentCategories();

    // Use actual full text markdown for taxonomy filtering
    const decisionText = row.full_md;

    // Select relevant categories using GPT-5
    const selectedParentIds = await TaxonomyFilterService.selectRelevantCategories(
      decisionText,
      parentCategories
    );

    // Filter taxonomy
    const filteredTaxonomy = TaxonomyManager.filterByParents(selectedParentIds);

    // Determine language for formatting
    const language =
      row.language_metadata?.toLowerCase() === 'nl' ? 'nl' : 'fr';

    // Format for prompt
    const taxonomyString = TaxonomyManager.formatForPrompt(
      filteredTaxonomy,
      language
    );

    // Add filtered taxonomy to row
    return {
      ...row,
      keywordsUtu: taxonomyString,
      // Full text now available from database
      fullTextMarkdown: row.full_md || '',
      factsFr: '',
      citedProvisions: '',
      proceduralLanguage: row.language_metadata || 'FR',
    };
  },

  /**
   * Prompt Template
   *
   * Replaces template variables in the KEYWORDS_PROMPT with actual data.
   */
  promptTemplate: (row) => {
    return KEYWORDS_PROMPT.replace('{{decisionId}}', row.id || '')
      .replace('{{fullTextMarkdown}}', row.fullTextMarkdown || '')
      .replace('{{factsFr}}', row.factsFr || '')
      .replace('{{citedProvisions}}', row.citedProvisions || '')
      .replace('{{proceduralLanguage}}', row.proceduralLanguage || 'FR')
      .replace('{{keywordsUtu}}', row.keywordsUtu || '');
  },

  /**
   * Output JSON Schema
   *
   * Validates the model's response structure.
   */
  outputSchema: {
    type: 'object',
    required: ['index', 'metadata'],
    properties: {
      index: {
        type: 'object',
        required: ['customKeywords', 'legalIssues'],
        properties: {
          customKeywords: {
            type: 'array',
            items: {
              type: 'string',
              minLength: 3,
            },
            minItems: 8,
            maxItems: 15,
            description: 'Array of 8-15 custom keywords in procedural language',
          },
          legalIssues: {
            type: 'array',
            items: {
              type: 'object',
              required: ['id', 'keywordsSequenceFr', 'keywordsSequenceNl'],
              properties: {
                id: {
                  type: 'string',
                  description: 'Taxonomy ID',
                },
                keywordsSequenceFr: {
                  type: 'string',
                  description: 'French keyword sequence',
                },
                keywordsSequenceNl: {
                  type: 'string',
                  description: 'Dutch keyword sequence',
                },
              },
            },
            minItems: 2,
            maxItems: 8,
            description: 'Array of 2-8 legal issues from taxonomy',
          },
        },
      },
      metadata: {
        type: 'object',
        required: [
          'keywordCount',
          'legalIssueCount',
          'primaryLegalField',
          'indexingConfidence',
        ],
        properties: {
          keywordCount: {
            type: 'integer',
            minimum: 8,
            maximum: 15,
          },
          legalIssueCount: {
            type: 'integer',
            minimum: 2,
            maximum: 8,
          },
          primaryLegalField: {
            type: 'string',
            description: 'Main area of law',
          },
          indexingConfidence: {
            type: 'string',
            enum: ['HIGH', 'MEDIUM', 'LOW'],
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
  customIdPrefix: 'keywords',
};

export default config;
