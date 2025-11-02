import { JobConfig } from "../JobConfig.js";
import { executeTwoStageExtraction } from "./two-stage-executor.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";

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
   * Database Query
   *
   * Uses test set to select specific decisions for processing.
   * Joins decisions1 with decisions_md to get full markdown text.
   * Uses composite key (decision_id + language) for correct matching.
   */
  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      dm.full_md
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    INNER JOIN unnest($1::text[], $2::text[]) AS test_set(decision_id, language)
      ON d.decision_id = test_set.decision_id
      AND d.language_metadata = test_set.language
    WHERE dm.full_md IS NOT NULL
      AND dm.full_md != ''
  `,

  /**
   * Database Query Parameters
   *
   * Loaded from CSV test set file at runtime.
   * Reuses comprehensive-197.csv initially for consistency.
   */
  dbQueryParams: await (async () => {
    const testSet = await TestSetLoader.loadTestSet(
      "evals/test-sets/comprehensive-197.csv"
    );
    const summary = TestSetLoader.getSummary(testSet);
    console.log(`📊 Cited Decisions test set: ${summary.total} decisions`);
    console.log(`   Languages: ${JSON.stringify(summary.byLanguage)}`);

    // Show distribution by length category
    const byLength: Record<string, number> = {};
    testSet.forEach((entry) => {
      if (entry.length_category) {
        byLength[entry.length_category] = (byLength[entry.length_category] || 0) + 1;
      }
    });
    console.log(`   Length distribution: ${JSON.stringify(byLength)}`);

    const params = TestSetLoader.toQueryParams(testSet);
    return [params.decisionIds, params.languages];
  })(),

  /**
   * Preprocess Row
   *
   * Enrich database rows with metadata from CSV test set.
   * Uses composite key lookup for correct language matching.
   */
  preprocessRow: await (async () => {
    const testSet = await TestSetLoader.loadTestSet(
      "evals/test-sets/comprehensive-197.csv"
    );

    // Create map for fast lookup: key = decision_id + language
    const testSetMap = new Map<string, any>();
    testSet.forEach((entry) => {
      const key = `${entry.decision_id}|${entry.language}`;
      testSetMap.set(key, entry);
    });

    // Return preprocessor function
    return async (row: any) => {
      const key = `${row.decision_id}|${row.language_metadata}`;
      const testSetEntry = testSetMap.get(key);

      if (testSetEntry) {
        return {
          ...row,
          decision_type_ecli_code: testSetEntry.decision_type_ecli_code,
          decision_type_name: testSetEntry.decision_type_name,
          court_ecli_code: testSetEntry.court_ecli_code,
          court_name: testSetEntry.court_name,
          courtcategory: testSetEntry.courtcategory,
          decision_date: testSetEntry.decision_date,
          md_length: testSetEntry.md_length,
          length_category: testSetEntry.length_category,
        };
      }

      return row;
    };
  })(),

  /**
   * Row Metadata Fields
   *
   * Track all metadata from CSV test set for evaluation and filtering.
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
   */
  provider: "openai",
  model: "gpt-5-mini",                // GPT-5 Mini with reasoning
  maxCompletionTokens: 64000,         // Same as provisions-2a
  reasoningEffort: "medium",             // Low reasoning for citation extraction
  verbosity: "low",                   // Concise responses preferred

  /**
   * Custom ID prefix
   */
  customIdPrefix: "cited-decisions",
};

export default config;
