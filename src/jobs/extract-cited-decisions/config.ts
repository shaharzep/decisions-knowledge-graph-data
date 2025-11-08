import { JobConfig } from "../JobConfig.js";
import { executeTwoStageExtraction } from "./two-stage-executor.js";

/**
 * Helper: Extract decision date from ECLI code
 *
 * ECLI format: ECLI:BE:CASS:2001:ARR.20010131.9
 * Extracts: 20010131 → 2001-01-31
 *
 * Used to filter self-citations by date matching in postProcessRow.
 */
function extractDateFromECLI(ecli: string): string | null {
  if (!ecli || !ecli.startsWith('ECLI:')) return null;

  const parts = ecli.split(':');
  if (parts.length < 5) return null;

  // Get identifier part (5th segment, index 4)
  const identifier = parts[4];

  // Look for 8-digit date pattern (YYYYMMDD)
  const dateMatch = identifier.match(/(\d{8})/);
  if (!dateMatch) return null;

  const dateStr = dateMatch[1];
  const year = dateStr.substring(0, 4);
  const month = dateStr.substring(4, 6);
  const day = dateStr.substring(6, 8);

  return `${year}-${month}-${day}`;
}

/**
 * Extract Cited Decisions Job Configuration - Agent 3 - REGEX + LLM VALIDATION ARCHITECTURE
 *
 * APPROACH: Fast regex extraction with LLM validation
 *
 * Stage 1: Regex Extraction (instant, zero cost)
 *   - Scans complete decision markdown text (2K-80K chars)
 *   - Finds ALL potential citations (BE, EU, INT) with 400-char context snippets
 *   - Detects court names, dates, case numbers, ECLI codes via pattern matching
 *   - Returns structured JSON with all extracted fields + confidence levels
 *   - Task: Cast wide net for maximum recall
 *
 * Stage 2: LLM Validation & Correction (gpt-5-mini MEDIUM reasoning)
 *   - Validates regex-extracted JSON (verify fields are correct)
 *   - Fixes parsing errors (date normalization, court name completion)
 *   - Classifies treatment based on 400-char context indicators
 *   - Filters false positives (paragraph refs, self-citations)
 *   - Returns validated citedDecisions array
 *   - Task: Quality control + treatment classification
 *
 * SCOPE: Belgian, EU, and International court decisions cited in judicial texts
 *
 * Extracts cited judicial decisions from Belgian court decisions:
 * - Court name (verbatim, in procedural language)
 * - Citation details (date, case number, ECLI)
 * - Treatment classification (FOLLOWED, DISTINGUISHED, OVERRULED, CITED, UNCERTAIN)
 * - Jurisdiction (BE, EU, INT)
 * - Internal reference IDs (DEC-xxx-001, DEC-xxx-002, etc.)
 *
 * Included:
 * - Belgian courts (Cass., GwH, RvS, etc.)
 * - EU courts (CJUE, TUE, etc.)
 * - International courts (CEDH, CIJ, etc.)
 *
 * Key Features:
 * - Faster than dual-LLM approach (regex is instant)
 * - Lower cost (one LLM call instead of two)
 * - Better recall (regex casts wide net)
 * - Better precision (LLM validates and corrects)
 * - Easier to debug (inspect regex JSON before LLM)
 * - 400-char context windows for accurate treatment classification
 * - Reserved null field for database mapping (decisionId)
 * - Verbatim extraction (no translation or standardization)
 * - Sequential internal IDs for cross-agent linking
 * - Target: 95-100/100 evaluation score
 */

const config: JobConfig = {
  id: "extract-cited-decisions",

  description:
    "Regex + LLM validation: Stage 1 regex extracts all citations (BE/EU/INT) with 400-char snippets (instant), Stage 2 LLM validates/corrects and classifies treatment (MEDIUM reasoning). Target: 95-100/100 score.",

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
   * Post-Processing: Filter Self-Citations & Construct IDs
   *
   * Step 1: Filter self-citations by date matching
   *   - Extract decision date from ECLI
   *   - Remove citations with same date as current decision
   *   - Re-sequence remaining citations (1, 2, 3...)
   *
   * Step 2: Construct IDs from sequences
   *   - LLM outputs simple integer sequences
   *   - TypeScript constructs full IDs with guaranteed-correct format
   *   - Eliminates ID truncation/corruption errors
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

    // Step 1: Filter self-citations by date matching
    const decisionDate = extractDateFromECLI(decisionId);

    if (decisionDate) {
      // Filter out citations with same date as current decision
      const originalCount = result.citedDecisions.length;
      result.citedDecisions = result.citedDecisions.filter(
        (citation: any) => citation.date !== decisionDate
      );

      // Log if any self-citations were filtered
      const filteredCount = originalCount - result.citedDecisions.length;
      if (filteredCount > 0) {
        console.log(`[${decisionId}] Filtered ${filteredCount} self-citation(s) by date match (${decisionDate})`);
      }

      // Re-sequence to fill gaps (1, 2, 3...)
      result.citedDecisions = result.citedDecisions.map((citation: any, index: number) => ({
        ...citation,
        decisionSequence: index + 1
      }));
    }

    // Step 2: Validate sequences exist
    for (const citation of result.citedDecisions) {
      if (typeof citation.decisionSequence !== 'number') {
        throw new Error(`Missing or invalid decisionSequence: ${JSON.stringify(citation)}`);
      }
    }

    // Step 3: Construct IDs with guaranteed-correct format
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
   * Schema for cited decisions with treatment and type classification.
   * Key features:
   * - Reserved null field (decisionId)
   * - Internal IDs constructed in postProcessRow
   * - Multi-jurisdiction support (BE, EU, INT)
   * - Treatment classification enum (5 values: FOLLOWED, DISTINGUISHED, OVERRULED, CITED, UNCERTAIN)
   * - Type classification enum (2 values: PRECEDENT, PROCEDURAL)
   * - Verbatim extraction requirements
   * - Extracts BOTH precedent citations (legal authority) and procedural citations (timeline events)
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
            "type",
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
              enum: ["BE", "EU", "INT"],
              description: "BE for Belgian courts, EU for European courts, INT for International courts",
            },
            courtName: {
              type: "string",
              minLength: 3,
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
                  pattern: "^ECLI:[A-Z]{2}:[A-Z0-9]+:\\d{4}:.*$",
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

            // ========================================
            // CITATION TYPE CLASSIFICATION
            // ========================================
            type: {
              type: "string",
              enum: ["PRECEDENT", "PROCEDURAL"],
              description: "PRECEDENT: Citation to another case for legal authority. PROCEDURAL: Citation to event in current case's timeline.",
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
   * Note: Two-stage execution with HIGH reasoning effort:
   *   - Stage 1: Region detection (regex - instant, zero cost)
   *   - Stage 2: Field extraction + treatment + type classification (gpt-5-mini HIGH reasoning)
   *
   * HIGH reasoning needed for:
   *   - Complex date format parsing (15 mars 2022 → 2022-03-15)
   *   - Treatment classification from context
   *   - Type classification (PRECEDENT vs PROCEDURAL)
   *   - Self-reference detection
   */
  provider: "openai",
  model: "gpt-5",
  openaiProvider: "standard",
  maxCompletionTokens: 64000, // Citations typically shorter output than provisions
  reasoningEffort: "high",    // HIGH reasoning for complex extraction + dual classification
  verbosity: "low",           // Concise responses preferred

  /**
   * Custom ID prefix
   */
  customIdPrefix: "cited-decisions",
};

export default config;
