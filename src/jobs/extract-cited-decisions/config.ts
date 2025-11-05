import { JobConfig } from "../JobConfig.js";
import { executeTwoStageExtraction } from "./two-stage-executor.js";

/**
 * Extract Cited Decisions Job Configuration - Agent 3 - TWO-STAGE AGENTIC SNIPPET ARCHITECTURE
 *
 * APPROACH: Separation of concerns via two focused LLM stages
 *
 * Stage 1: Agentic Snippet Creation (gpt-5-mini MEDIUM reasoning)
 *   - Scans complete decision markdown text (2K-80K chars)
 *   - Finds EVERY Belgian court citation (100% recall target)
 *   - Synthesizes enriched, self-contained snippets
 *   - Captures surrounding context (50-100 words) with treatment indicators
 *   - Filters out EU/international courts
 *   - Returns plain text snippet list
 *   - Task: Systematic extraction with context synthesis
 *
 * Stage 2: Deterministic Parsing (gpt-5-mini MEDIUM reasoning)
 *   - Parses ONLY the enriched snippets (5-10K chars, 8-16x smaller)
 *   - Extracts court name, date, case number, ECLI verbatim
 *   - Classifies treatment based on context indicators
 *   - Returns citedDecisions array
 *   - Task: Complex parsing with treatment classification
 *
 * SCOPE: Belgian court decisions cited in judicial texts
 *
 * Extracts cited judicial decisions from Belgian court decisions:
 * - Court name (verbatim, in procedural language)
 * - Citation details (date, case number, ECLI)
 * - Treatment classification (FOLLOWED, DISTINGUISHED, OVERRULED, CITED, UNCERTAIN)
 * - Internal reference IDs (DEC-xxx-001, DEC-xxx-002, etc.)
 *
 * Exclusions:
 * - EU court decisions (CJEU, General Court)
 * - International court decisions (ECtHR, ICC)
 * - Foreign court decisions
 *
 * Key Features:
 * - Better for long documents (no attention degradation)
 * - Better treatment classification (context-based)
 * - Easier to debug (inspect Stage 1 output)
 * - Reserved null field for database mapping (decisionId)
 * - Verbatim extraction (no translation or standardization)
 * - Sequential internal IDs for cross-agent linking
 * - Target: 95-100/100 evaluation score
 */

const config: JobConfig = {
  id: "extract-cited-decisions",

  description:
    "Two-stage agentic snippet extraction: Stage 1 finds all Belgian court citations with context (MEDIUM reasoning), Stage 2 parses to JSON and classifies treatment (MEDIUM reasoning). Target: 95-100/100 score.",

  /**
   * Concurrency Configuration
   *
   * For full dataset (64k decisions), use high concurrency to leverage Azure rate limits:
   * - Rate limit: 9,750,000 tokens/min
   * - Rate limit: 9,750 requests/min
   * - Recommended: 300-500 concurrent requests
   */
  concurrencyLimit: 300,

  /**
   * Full-Data Pipeline Mode
   *
   * Enable for large dataset extraction (50k+ decisions).
   *
   * When true:
   * - Writes per-decision JSONs to full-data/<job>/<timestamp>/jsons/
   * - Streams results incrementally (durable for long runs)
   * - Suitable for full dataset extraction
   *
   * When false (default):
   * - Writes 4 aggregated JSONs to concurrent/results/
   * - Required for dependency resolution and evaluation
   * - Suitable for test set runs (197 decisions)
   *
   * Toggle this flag when switching between test runs and full dataset:
   * - Test/eval runs (197 decisions): false
   * - Full dataset (64k decisions): true
   */
  useFullDataPipeline: true,

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
    "id",                      // Database serial ID
    "decision_id",             // ECLI code
    "language_metadata",       // FR or NL
    "decision_type_ecli_code", // ARR, ORD, RECO, etc. (from database)
    "court_ecli_code",         // CASS, GBAPD, COPRIV, etc. (from database)
    "decision_date",           // YYYY-MM-DD (from database)
    "md_length",               // Character count (computed from full_md)
    "length_category",         // short, medium, long, very_long (computed in preprocessRow)
  ],

  /**
   * Custom Execution: Two-Stage Agentic Snippet Architecture
   *
   * Stage 1: Agentic snippet creation (gpt-5-mini MEDIUM reasoning)
   *   - Scans full decision text
   *   - Finds ALL Belgian court citations
   *   - Synthesizes enriched snippets with context (50-100 words)
   *   - Returns plain text snippet list
   *
   * Stage 2: Complex parsing (gpt-5-mini MEDIUM reasoning)
   *   - Parses snippets into structured JSON
   *   - Classifies treatment based on context indicators
   *   - Returns citedDecisions array
   */
  customExecution: async (row, client) => {
    const result = await executeTwoStageExtraction(row, client);
    return result;
  },

  /**
   * Post-Processing: Construct IDs from Sequences
   *
   * This is where deterministic ID construction happens - the LLM only outputs
   * simple integer sequences, then TypeScript constructs the full IDs with
   * guaranteed-correct decisionId string concatenation.
   *
   * This eliminates all ID truncation/corruption errors because the LLM never
   * touches decisionId string manipulation.
   */
  postProcessRow: (row, result) => {
    const decisionId = row.decision_id;

    if (!decisionId) {
      throw new Error('decision_id is required for ID construction');
    }

    if (!result.citedDecisions || !Array.isArray(result.citedDecisions)) {
      result.citedDecisions = [];
      return result;
    }

    // Validate sequences exist
    for (const citation of result.citedDecisions) {
      if (typeof citation.decisionSequence !== 'number') {
        throw new Error(`Missing or invalid decisionSequence: ${JSON.stringify(citation)}`);
      }
    }

    // Construct IDs with guaranteed-correct format
    result.citedDecisions = result.citedDecisions.map((citation: any) => {
      const seq = String(citation.decisionSequence).padStart(3, '0');

      return {
        ...citation,
        // Add the full ID that will be used downstream
        internalDecisionId: `DEC-${decisionId}-${seq}`,
      };
    });

    return result;
  },

  /**
   * Output JSON Schema
   *
   * Schema for cited decisions with treatment classification.
   * Key features:
   * - Reserved null field (decisionId)
   * - Internal IDs with strict regex patterns
   * - Belgian courts only (courtJurisdictionCode: "BE")
   * - Treatment classification enum (5 values)
   * - Verbatim extraction requirements
   */
  outputSchema: {
    type: "object",
    required: ["citedDecisions"],
    additionalProperties: false,
    properties: {
      citedDecisions: {
        type: "array",
        minItems: 0, // Some decisions cite no prior decisions
        items: {
          type: "object",
          required: [
            "decisionId",
            "decisionSequence",
            "courtJurisdictionCode",
            "courtName",
            "date",
            "caseNumber",
            "ecli",
            "treatment",
          ],
          additionalProperties: false,
          properties: {
            // ========================================
            // RESERVED DATABASE MAPPING FIELD (MUST BE NULL)
            // ========================================
            decisionId: {
              type: "null",
              description: "Reserved for database mapping - always null in extraction",
            },

            // ========================================
            // SEQUENCING (ID constructed in postProcessRow)
            // ========================================
            decisionSequence: {
              type: "integer",
              minimum: 1,
              maximum: 9999,
              description:
                "Sequential citation number: 1, 2, 3, 4, ... Increment for each citation, never skip or reuse.",
            },

            // ========================================
            // COURT INFORMATION
            // ========================================
            courtJurisdictionCode: {
              type: "string",
              enum: ["BE"],
              description: "Always BE for Belgian courts",
            },
            courtName: {
              type: "string",
              minLength: 10,
              maxLength: 200,
              description: "Court name verbatim in procedural language",
            },

            // ========================================
            // CITATION DETAILS
            // ========================================
            date: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                },
                {
                  type: "null",
                },
              ],
              description: "Decision date YYYY-MM-DD or null if not mentioned",
            },
            caseNumber: {
              anyOf: [
                {
                  type: "string",
                  minLength: 3,
                  maxLength: 100,
                },
                {
                  type: "null",
                },
              ],
              description: "Case/roll number verbatim or null if not mentioned",
            },
            ecli: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^ECLI:BE:[A-Z]+:\\d{4}:.*$",
                },
                {
                  type: "null",
                },
              ],
              description: "ECLI code only if explicitly in text or null",
            },

            // ========================================
            // TREATMENT CLASSIFICATION
            // ========================================
            treatment: {
              type: "string",
              enum: [
                "FOLLOWED",
                "DISTINGUISHED",
                "OVERRULED",
                "CITED",
                "UNCERTAIN",
              ],
              description: "How current court treats cited decision",
            },
          },
        },
      },
    },
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "cited_decisions_extraction",

  /**
   * Provider and Model Configuration
   *
   * Note: Two-stage execution specifies reasoning effort per stage:
   *   - Stage 1: MEDIUM (systematic extraction with context synthesis)
   *   - Stage 2: MEDIUM (complex parsing with treatment classification)
   *
   * Both use MEDIUM to handle the complexity accurately.
   */
  provider: "openai",
  model: "gpt-5-mini",
  maxCompletionTokens: 64000, // Citations typically shorter output than provisions

  /**
   * Custom ID prefix
   */
  customIdPrefix: "cited-decisions",
};

export default config;
