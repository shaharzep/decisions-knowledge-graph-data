import { JobConfig } from "../JobConfig.js";
import { KEYWORD_EXTRACTION_PROMPT } from "./prompt.js";

/**
 * Extract Keywords Job Configuration - AI Agent 4
 *
 * KEYWORD EXTRACTION WITH GPT-5 (STANDARD OPENAI)
 *
 * Generates 8-12 scannable keywords across 4 categories:
 * 1. Legal Domain (1 keyword - REQUIRED)
 * 2. Factual Situation (3-5 keywords - PRIORITY)
 * 3. Key Dispute (3-4 keywords - HIGH PRIORITY)
 * 4. Distinctive Element (0-2 keywords - OPTIONAL)
 *
 * APPROACH:
 * - Standard single-stage execution (no custom executor)
 * - No dependencies - works directly from full markdown text
 * - Uses GPT-5 via standard OpenAI (Azure doesn't support GPT-5 yet)
 * - Prompt template injects 3 placeholders:
 *   1. {decisionId} - from database
 *   2. {proceduralLanguage} - from database
 *   3. {fullText.markdown} - from database
 * - Test mode: Uses standard pipeline for evaluation
 *
 * OUTPUT:
 * - Results in concurrent/results/extract-keywords/<model>/<timestamp>/
 * - customKeywords: Array of 8-12 keywords (stored in database)
 * - metadata: Self-validation object (discarded after extraction)
 *
 * Target: Scannable in 3-4 seconds, balanced factual/legal mix
 */

const config: JobConfig = {
  id: "extract-keywords",

  description:
    "Generate 8-12 scannable keywords across 4 categories (Legal Domain, Factual Situation, Key Dispute, Distinctive Elements) from decision markdown text",

  /**
   * Database Query
   *
   * Pulls all decisions from the database with full markdown text.
   * Includes metadata fields directly from decisions1 table for tracking.
   *
   * This query selects all ~64,000 decisions with complete markdown content.
   */
  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      d.decision_type_ecli_code,
      d.court_ecli_code,
      d.decision_date,
      dm.full_md,
      LENGTH(dm.full_md) as md_length
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    WHERE dm.full_md IS NOT NULL
      AND dm.full_md != ''
  `,

  /**
   * Database Query Parameters
   *
   * No parameters needed - query selects all decisions directly.
   */
  dbQueryParams: [],

  /**
   * Preprocess Row
   *
   * Add computed length category based on markdown length.
   * All other metadata comes directly from database query.
   */
  preprocessRow: async (row: any) => {
    // Categorize decision length
    let length_category = 'unknown';
    if (row.md_length) {
      if (row.md_length < 10000) length_category = 'short';
      else if (row.md_length < 30000) length_category = 'medium';
      else if (row.md_length < 60000) length_category = 'long';
      else length_category = 'very_long';
    }

    return {
      ...row,
      length_category,
    };
  },

  /**
   * Row Metadata Fields
   *
   * Track all metadata from database for analysis and filtering.
   * These fields will be merged into each extraction result, enabling:
   * - Filtering by language, court, decision type, length
   * - Performance analysis by category
   * - Identifying which types work well vs poorly
   */
  rowMetadataFields: [
    "id",
    "decision_id",
    "language_metadata",
    "decision_type_ecli_code",
    "decision_type_name",
    "court_ecli_code",
    "court_name",
    "courtcategory",
    "decision_date",
    "md_length",
    "length_category",
  ],

  /**
   * Prompt Template
   *
   * Fills prompt placeholders with actual data from row.
   *
   * Data sources:
   * - {decisionId} - row.decision_id (from database)
   * - {proceduralLanguage} - row.language_metadata (from database)
   * - {fullText.markdown} - row.full_md (from database)
   */
  promptTemplate: (row) => {
    // Fill all placeholders
    return KEYWORD_EXTRACTION_PROMPT
      .replace('{decisionId}', row.decision_id || '')
      .replace('{proceduralLanguage}', row.language_metadata || 'FR')
      .replace('{fullText.markdown}', row.full_md || '');
  },

  /**
   * Output JSON Schema
   *
   * Schema for keyword extraction with strict validation.
   * Matches the prompt's output requirements exactly.
   *
   * Key features:
   * - customKeywords: 8-12 keywords (what gets stored)
   * - metadata: Self-validation object (discarded after extraction)
   * - Strict length/count requirements
   * - Validation checks ensure quality
   */
  outputSchema: {
    type: "object",
    required: ["customKeywords", "metadata"],
    additionalProperties: false,
    properties: {
      // ========================================
      // CUSTOM KEYWORDS (stored in database)
      // ========================================
      customKeywords: {
        type: "array",
        minItems: 8,
        maxItems: 12,
        description: "8-12 scannable keywords for search result cards",
        items: {
          type: "string",
          minLength: 3,
          maxLength: 50,
          description: "Single keyword: 1-4 words, 3-50 chars, in procedural language"
        }
      },

      // ========================================
      // METADATA (self-validation only, discarded)
      // ========================================
      metadata: {
        type: "object",
        required: ["totalKeywords", "keywordBreakdown", "validationChecks"],
        additionalProperties: false,
        description: "Self-validation metadata (not stored in database)",
        properties: {
          totalKeywords: {
            type: "integer",
            minimum: 8,
            maximum: 12,
            description: "Total keyword count (must match array length)"
          },
          keywordBreakdown: {
            type: "object",
            required: ["legalDomain", "factualSituation", "keyDispute", "distinctiveElement"],
            additionalProperties: false,
            description: "Distribution across 4 categories (must sum to totalKeywords)",
            properties: {
              legalDomain: {
                type: "integer",
                minimum: 1,
                maximum: 1,
                description: "Must be exactly 1"
              },
              factualSituation: {
                type: "integer",
                minimum: 3,
                maximum: 5,
                description: "3-5 factual keywords (PRIORITY category)"
              },
              keyDispute: {
                type: "integer",
                minimum: 3,
                maximum: 4,
                description: "3-4 legal dispute keywords"
              },
              distinctiveElement: {
                type: "integer",
                minimum: 0,
                maximum: 2,
                description: "0-2 distinctive keywords (optional)"
              }
            }
          },
          validationChecks: {
            type: "object",
            required: [
              "keywordCountInRange",
              "allKeywordsShort",
              "noGenericTerms",
              "noPartyNames",
              "balancedMix"
            ],
            additionalProperties: false,
            description: "Quality checks (all must be true)",
            properties: {
              keywordCountInRange: {
                type: "boolean",
                description: "8-12 keywords total"
              },
              allKeywordsShort: {
                type: "boolean",
                description: "Each keyword 1-4 words"
              },
              noGenericTerms: {
                type: "boolean",
                description: "No overly generic terms"
              },
              noPartyNames: {
                type: "boolean",
                description: "No specific party names"
              },
              balancedMix: {
                type: "boolean",
                description: "Balanced factual/legal mix"
              }
            }
          }
        }
      }
    }
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "keyword_extraction",

  /**
   * Provider and Model Configuration
   *
   * Using GPT-5 (standard OpenAI, not Azure) with LOW reasoning:
   * - Azure OpenAI doesn't support GPT-5 yet
   * - Keyword extraction is pattern recognition, not deep reasoning
   * - Short output (8-12 keywords)
   * - Fast iteration preferred
   */
  provider: "openai",
  openaiProvider: "standard",     // Use standard OpenAI (not Azure) for GPT-5
  model: "gpt-5",                 // GPT-5 full model
  maxCompletionTokens: 16000,     // Keywords are short output
  reasoningEffort: "medium",         // Pattern recognition task
  verbosity: "low",               // Concise responses preferred

  /**
   * Concurrency Configuration
   *
   * Conservative settings for GPT-5 (rate limits unknown):
   * - Start with 200 concurrent requests
   * - Monitor for 429 errors and adjust if needed
   */
  concurrencyLimit: 200,

  /**
   * Pipeline Configuration
   *
   * Use standard pipeline for test mode.
   * Outputs to concurrent/results/ for evaluation.
   */
  useFullDataPipeline: true,

  /**
   * Custom ID prefix
   */
  customIdPrefix: "keywords",
};

export default config;
