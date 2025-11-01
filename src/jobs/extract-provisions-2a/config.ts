import { JobConfig } from "../JobConfig.js";
import { executeTwoStageExtraction } from "./two-stage-executor.js";

/**
 * Extract Provisions 2A Job Configuration - TWO-STAGE AGENTIC SNIPPET ARCHITECTURE
 *
 * APPROACH: Separation of concerns via two focused LLM stages
 *
 * Stage 1: Agentic Snippet Creation (gpt-5-mini MEDIUM reasoning)
 *   - Scans complete decision markdown text (2K-80K chars)
 *   - Finds EVERY provision mention (100% recall target)
 *   - Synthesizes enriched, self-contained snippets
 *   - Combines distant information (article + parent act from 2000+ chars away)
 *   - Resolves implicit references ("voormelde artikel")
 *   - Returns plain text snippet list
 *   - Task: Systematic extraction, not deep reasoning (MEDIUM sufficient)
 *
 * Stage 2: Deterministic Parsing (gpt-5-mini MEDIUM reasoning)
 *   - Parses ONLY the enriched snippets (5-10K chars, 8-16x smaller)
 *   - Complex normalization (decimal notation, key extraction, deduplication)
 *   - Applies expansion (ranges/lists), deduplication, sequencing
 *   - Returns citedProvisions array
 *   - Task: Complex parsing with multi-step rules (MEDIUM needed for accuracy)
 *
 * Extracts cited legal provisions with essential metadata:
 * - Provision numbers (article/artikel) - verbatim
 * - Parent act information (name, type, date) - verbatim
 * - Internal reference IDs (ART-xxx-001, ACT-xxx-001)
 * - Provision number keys (normalized for matching)
 *
 * Key Features:
 * - Better for long documents (no attention degradation)
 * - Clearer deduplication (snippet list view vs 80K char scan)
 * - Easier to debug (inspect Stage 1 output)
 * - Verbatim extraction (no standardization or translation)
 * - Bilingual enum values (LOI/WET, ARRETE_ROYAL/KONINKLIJK_BESLUIT, etc.)
 * - Parent act deduplication within decision
 * - Target: 99-100/100 evaluation score
 *
 * Does NOT extract (deferred to other agents):
 * - URLs, ELI, CELEX identifiers (Agent 2B)
 * - Interpretation, context, application (Agent 2C)
 */

const config: JobConfig = {
  id: "extract-provisions-2a",

  description:
    "Two-stage agentic snippet extraction: Stage 1 synthesizes enriched snippets (HIGH reasoning), Stage 2 parses to JSON (LOW reasoning). Target: 99-100/100 score.",

  /**
   * Concurrency Configuration
   *
   * For full dataset (63k decisions), use high concurrency to leverage Azure rate limits:
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
   * - Full dataset (63k decisions): true
   */
  useFullDataPipeline: true,

  /**
   * Database Query
   *
   * Pulls all decisions from the database with full markdown text.
   * Includes metadata fields directly from decisions1 table for tracking.
   *
   * This query selects all ~63,000 decisions with complete markdown content.
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
    "id",                        // Database serial ID
    "decision_id",               // ECLI code
    "language_metadata",         // FR or NL
    "decision_type_ecli_code",   // ARR, ORD, RECO, etc. (from database)
    "court_ecli_code",           // CASS, GBAPD, COPRIV, etc. (from database)
    "decision_date",             // YYYY-MM-DD (from database)
    "md_length",                 // Character count (computed from full_md)
    "length_category",           // short, medium, long, very_long (computed in preprocessRow)
  ],

  /**
   * Custom Execution: Two-Stage Agentic Snippet Architecture
   *
   * Stage 1: Agentic snippet creation (gpt-5-mini MEDIUM reasoning)
   *   - Scans full decision text
   *   - Synthesizes enriched, self-contained snippets
   *   - Returns plain text snippet list
   *
   * Stage 2: Complex parsing (gpt-5-mini MEDIUM reasoning)
   *   - Parses snippets into structured JSON
   *   - Applies complex normalization, expansion, deduplication
   *   - Returns citedProvisions array
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

    if (!result.citedProvisions || !Array.isArray(result.citedProvisions)) {
      result.citedProvisions = [];
      return result;
    }

    // Validate sequences exist
    for (const prov of result.citedProvisions) {
      if (typeof prov.provisionSequence !== 'number') {
        throw new Error(`Missing or invalid provisionSequence: ${JSON.stringify(prov)}`);
      }
      if (typeof prov.parentActSequence !== 'number') {
        throw new Error(`Missing or invalid parentActSequence: ${JSON.stringify(prov)}`);
      }
    }

    // Construct IDs with guaranteed-correct format
    result.citedProvisions = result.citedProvisions.map((provision: any) => {
      const provSeq = String(provision.provisionSequence).padStart(3, '0');
      const actSeq = String(provision.parentActSequence).padStart(3, '0');

      return {
        ...provision,
        // Add the full IDs that will be used downstream
        internalProvisionId: `ART-${decisionId}-${provSeq}`,
        internalParentActId: `ACT-${decisionId}-${actSeq}`,
      };
    });

    return result;
  },

  /**
   * Output JSON Schema - Full-Text Approach (Bilingual Enums)
   *
   * CHANGES from snippet-based version:
   * - Removed extractionMetadata wrapper
   * - Removed top-level decisionId and language fields (provided via metadata)
   * - Bilingual enum values (LOI/WET, ARRETE_ROYAL/KONINKLIJK_BESLUIT, etc.)
   * - Direct citedProvisions array at top level
   *
   * Key features:
   * - Language-specific enum values matching procedural language
   * - Verbatim extraction requirements
   * - Parent act deduplication via internalParentActId
   * - Same internal ID patterns (ART-xxx-001, ACT-xxx-001)
   */
  outputSchema: {
    type: "object",
    required: ["citedProvisions"],
    additionalProperties: false,
    properties: {
      citedProvisions: {
        type: "array",
        minItems: 0, // Some decisions cite no provisions
        items: {
          type: "object",
          required: [
            "provisionId",
            "parentActId",
            "provisionSequence",
            "parentActSequence",
            "provisionNumber",
            "provisionNumberKey",
            "parentActType",
            "parentActName",
            "parentActDate",
            "parentActNumber",
          ],
          additionalProperties: false,
          properties: {
            // ========================================
            // DATABASE MAPPING IDs (ALWAYS NULL)
            // ========================================
            provisionId: {
              type: "null",
              description: "Reserved for database matching - always null",
            },
            parentActId: {
              type: "null",
              description: "Reserved for database matching - always null",
            },

            // ========================================
            // SEQUENCING (IDs constructed in postProcessRow)
            // ========================================
            provisionSequence: {
              type: "integer",
              minimum: 1,
              maximum: 9999,
              description:
                "Sequential provision number: 1, 2, 3, 4, ... Increment for each provision, never skip or reuse.",
            },
            parentActSequence: {
              type: "integer",
              minimum: 1,
              maximum: 999,
              description:
                "Parent act sequence (deduplicated): same parent act = same number, different act = new number.",
            },

            // ========================================
            // PROVISION IDENTIFICATION
            // ========================================
            provisionNumber: {
              type: "string",
              minLength: 3,
              maxLength: 500,
              description:
                "Provision number VERBATIM from text (no standardization)",
            },
            provisionNumberKey: {
              type: "string",
              minLength: 1,
              maxLength: 50,
              description:
                "Normalized core number (e.g., '31' from 'article 31, § 2', '87' from 'article 87quater')",
            },

            // ========================================
            // PARENT ACT TYPE (BILINGUAL ENUM)
            // ========================================
            parentActType: {
              type: "string",
              enum: [
                // French values
                "LOI",
                "ARRETE_ROYAL",
                "CODE",
                "CONSTITUTION",
                "REGLEMENT_UE",
                "DIRECTIVE_UE",
                "TRAITE",
                "ARRETE_GOUVERNEMENT",
                "ORDONNANCE",
                "DECRET",
                "AUTRE",
                // Dutch values
                "WET",
                "KONINKLIJK_BESLUIT",
                "WETBOEK",
                "GRONDWET",
                "EU_VERORDENING",
                "EU_RICHTLIJN",
                "VERDRAG",
                "BESLUIT_VAN_DE_REGERING",
                "ORDONNANTIE",
                "DECREET",
                "ANDERE",
              ],
              description:
                "Type of parent legal act (bilingual enum - use language-specific value)",
            },

            // ========================================
            // PARENT ACT INFORMATION
            // ========================================
            parentActName: {
              type: "string",
              minLength: 5,
              maxLength: 500,
              description:
                "Parent act name VERBATIM with ALL qualifiers (coordonné..., approuvé..., modifié...)",
            },
            parentActDate: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                },
                {
                  type: "null",
                },
              ],
              description:
                "Date in YYYY-MM-DD format (from name or qualifier) or null",
            },
            parentActNumber: {
              anyOf: [
                {
                  type: "string",
                  minLength: 1,
                  maxLength: 100,
                },
                {
                  type: "null",
                },
              ],
              description: "Official act number (e.g., numac) or null",
            },
          },
        },
      },
    },
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "provision_extraction",

  /**
   * Provider and Model Configuration
   *
   * Note: Two-stage execution specifies reasoning effort per stage:
   *   - Stage 1: MEDIUM (systematic extraction with synthesis)
   *   - Stage 2: MEDIUM (complex normalization with multi-step rules)
   *
   * Both use MEDIUM to handle the complexity accurately.
   */
  provider: "openai",
  model: "gpt-5-mini",
  maxCompletionTokens: 128000, // Full text processing requires more tokens
  /**
   * Custom ID prefix
   */
  customIdPrefix: "provisions-2a",
};

export default config;
