import { JobConfig } from "../JobConfig.js";
import { PROVISIONS_2A_PROMPT } from "./prompt.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";

/**
 * Extract Provisions 2A Job Configuration - Agent 2A
 *
 * SCOPE: Essential provision metadata only
 *
 * Extracts cited legal provisions from Belgian court decisions:
 * - Provision numbers (article/artikel) - verbatim
 * - Parent act information (name, type, date) - verbatim
 * - Internal reference IDs (ART-xxx-001, ACT-xxx-001)
 * - Provision number keys (normalized for matching)
 *
 * Does NOT extract (deferred to other agents):
 * - URLs, ELI, CELEX identifiers (Agent 2B)
 * - Interpretation, context, application (Agent 2C)
 *
 * Key Features:
 * - Reserved null fields for database mapping (provisionId, parentActId)
 * - Parent act deduplication (same act → same internalParentActId)
 * - Bilingual enum support (FR/NL for parentActType)
 * - Verbatim extraction (no translation or standardization)
 * - Sequential internal IDs for cross-agent linking
 */

const config: JobConfig = {
  id: "extract-provisions-2a",

  description:
    "Extract cited legal provisions with essential metadata (Agent 2A: provision numbers, parent acts, internal IDs)",

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
      LIMIT 10
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
    console.log(`📊 Provisions 2A test set: ${summary.total} decisions`);
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
   * Prompt Template
   *
   * Replaces template variables in PROVISIONS_2A_PROMPT with actual data.
   */
  promptTemplate: (row) => {
    return PROVISIONS_2A_PROMPT
      .replace("{decisionId}", row.decision_id || "")
      .replace("{proceduralLanguage}", row.language_metadata || "FR")
      .replace("{fullText.markdown}", row.full_md || "");
  },

  /**
   * Output JSON Schema
   *
   * Schema for cited provisions with essential metadata.
   * Key features:
   * - Reserved null fields (provisionId, parentActId)
   * - Internal IDs with strict regex patterns
   * - Bilingual parent act type enum (22 values)
   * - Verbatim extraction requirements
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
            "internalProvisionId",
            "internalParentActId",
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
            // RESERVED DATABASE MAPPING FIELDS (MUST BE NULL)
            // ========================================
            provisionId: {
              type: "null",
              description: "Reserved for database mapping - always null in extraction",
            },
            parentActId: {
              type: "null",
              description: "Reserved for database mapping - always null in extraction",
            },

            // ========================================
            // INTERNAL REFERENCE IDs
            // ========================================
            internalProvisionId: {
              type: "string",
              pattern: "^ART-[a-zA-Z0-9:.]+-\\d{3}$",
              description: "Unique provision ID within decision: ART-{decisionId}-{sequence}",
            },
            internalParentActId: {
              type: "string",
              pattern: "^ACT-[a-zA-Z0-9:.]+-\\d{3}$",
              description: "Parent act ID (deduplicated across provisions citing same act)",
            },

            // ========================================
            // PROVISION IDENTIFICATION
            // ========================================
            provisionNumber: {
              type: "string",
              minLength: 5,
              maxLength: 200,
              description: "Provision number as written in decision (verbatim, not standardized)",
            },
            provisionNumberKey: {
              type: "string",
              minLength: 1,
              maxLength: 50,
              description: "Normalized core number for matching (e.g., '31' from 'article 31, § 2')",
            },

            // ========================================
            // PARENT ACT TYPE (BILINGUAL ENUM)
            // ========================================
            parentActType: {
              type: "string",
              enum: [
                // French (11 values)
                "LOI",                      // Federal law
                "ARRETE_ROYAL",             // Royal decree
                "CODE",                     // Code (civil, penal, etc.)
                "CONSTITUTION",             // Belgian Constitution
                "REGLEMENT_UE",             // EU Regulation
                "DIRECTIVE_UE",             // EU Directive
                "TRAITE",                   // International treaty
                "ARRETE_GOUVERNEMENT",      // Regional government decree
                "ORDONNANCE",               // Brussels-Capital ordinance
                "DECRET",                   // Regional decree
                "AUTRE",                    // Other

                // Dutch (11 values)
                "WET",                      // Federal law
                "KONINKLIJK_BESLUIT",       // Royal decree
                "WETBOEK",                  // Code
                "GRONDWET",                 // Belgian Constitution
                "EU_VERORDENING",           // EU Regulation
                "EU_RICHTLIJN",             // EU Directive
                "VERDRAG",                  // International treaty
                "BESLUIT_VAN_DE_REGERING",  // Regional government decree
                "ORDONNANTIE",              // Brussels-Capital ordinance
                "DECREET",                  // Regional decree
                "ANDERE",                   // Other
              ],
              description: "Type of parent legal act (language-specific enum)",
            },

            // ========================================
            // PARENT ACT INFORMATION
            // ========================================
            parentActName: {
              type: "string",
              minLength: 10,
              maxLength: 500,
              description: "Parent act name as written in decision (verbatim, not translated)",
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
              description: "Date in YYYY-MM-DD format or null if not mentioned",
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
              description: "Official act number or null if not mentioned",
            },
          },
        },
      },
    },
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "provision_extraction_2a",

  /**
   * Provider and Model Configuration
   */
  provider: "openai",
  model: "gpt-5-mini",
  maxCompletionTokens: 64000,        // Provision extraction simpler than comprehensive
  reasoningEffort: "low",            // Metadata extraction requires less reasoning
  verbosity: "low",                   // Concise responses preferred
  /**
   * Custom ID prefix
   */
  customIdPrefix: "provisions-2a",
};

export default config;
