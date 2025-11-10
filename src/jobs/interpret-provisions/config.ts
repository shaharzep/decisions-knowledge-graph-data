import { JobConfig } from "../JobConfig.js";
import { INTERPRET_PROVISIONS_PROMPT } from "./prompt.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";

/**
 * Interpret Provisions Job Configuration - Agent 2C
 *
 * SCOPE: Final stage - add interpretative enrichment to provisions
 *
 * Adds interpretative analysis to cited legal provisions:
 * - How court interprets/applies each provision (provisionInterpretation)
 * - Relevant factual context for provision's application (relevantFactualContext)
 *
 * DEPENDS ON: enrich-provisions (Agent 2B)
 * - Loads citedProvisions array with 10 fields from Agent 2A (passed through 2B)
 * - Note: 2B adds extractedReferences separately, but NOT merged into provisions
 * - Preserves all 10 fields from Agent 2A unchanged
 * - Adds 2 new interpretative fields
 *
 * CRITICAL REQUIREMENT:
 * - Must preserve exact internalProvisionId matching from Agent 2A
 * - Same number of provisions in output as input
 * - No provisions added or removed
 *
 * Key Features:
 * - Automatic dependency loading via DependencyResolver
 * - Composite key matching (id + decision_id + language)
 * - Transform function stringifies citedProvisions for prompt
 * - Comprehensive schema validates all 12 required fields
 * - Nullable interpretative fields (null when not applicable)
 */

const config: JobConfig = {
  id: "interpret-provisions",

  description:
    "Add interpretative analysis to provisions (Agent 2C: court interpretation and factual context)",

  /**
   * Dependencies
   *
   * Loads Agent 2B (enrich-provisions) results and makes them available in promptTemplate.
   * Transform function extracts and stringifies citedProvisions array.
   */
  dependencies: [
    {
      jobId: 'enrich-provisions',
      alias: 'agent2b',
      required: true,
      source: 'concurrent', // Load from concurrent/results/enrich-provisions/

      /**
       * Transform: Extract citedProvisions and create stringified version
       *
       * Returns object with:
       * - citedProvisions: Original array (for reference)
       * - citedProvisionsJson: Prettified JSON string for prompt injection
       */
      transform: (dep) => ({
        citedProvisions: dep.citedProvisions,
        citedProvisionsJson: JSON.stringify(dep.citedProvisions, null, 2)
      })
    }
  ],

  /**
   * Database Query
   *
   * IMPORTANT: Uses SAME query as enrich-provisions (Agent 2B) to ensure
   * we process the exact same decisions.
   *
   * Joins decisions1 with decisions_md to get full markdown text.
   * Uses test set for stratified selection.
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
   * Loaded from same test set as Agent 2B.
   * Ensures consistency across the entire provision pipeline (2A → 2B → 2C).
   */
  dbQueryParams: await (async () => {
    const testSet = await TestSetLoader.loadTestSet(
      "evals/test-sets/comprehensive-197.csv"
    );
    const summary = TestSetLoader.getSummary(testSet);
    console.log(`📊 Interpret Provisions test set: ${summary.total} decisions`);
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
   *
   * NOTE: Dependencies are loaded BEFORE preprocessRow runs,
   * so row.agent2b.citedProvisionsJson is already available here.
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
   * Injects 4 variables into Agent 2C prompt:
   * 1. {decisionId} - ECLI identifier
   * 2. {proceduralLanguage} - FR or NL
   * 3. {citedProvisions} - Stringified JSON from Agent 2B
   * 4. {fullText.markdown} - Full decision text
   *
   * Dependencies are already loaded, so row.agent2b.citedProvisionsJson
   * contains the stringified provisions with 18 fields from Agent 2B.
   */
  promptTemplate: (row) => {
    const prompt = INTERPRET_PROVISIONS_PROMPT
      .replace("{decisionId}", row.decision_id || "")
      .replace("{proceduralLanguage}", row.language_metadata || "FR")
      .replace("{citedProvisions}", row.agent2b?.citedProvisionsJson || "[]")
      .replace("{fullText.markdown}", row.full_md || "");

    return prompt;
  },

  /**
   * Output JSON Schema
   *
   * Comprehensive schema for interpreted provisions.
   *
   * Structure:
   * - 10 fields from Agent 2A (preserved unchanged via Agent 2B passthrough)
   * - 2 new fields from Agent 2C (interpretative enrichment)
   *
   * Total: 12 required fields per provision
   *
   * Key validation:
   * - All fields from 2A must be present and unchanged
   * - internalProvisionId must match Agent 2A input exactly
   * - New fields are nullable (null when interpretation not found)
   * - Length constraints: interpretation 100-1000, context 50-500
   *
   * Note: Agent 2B regex enrichment is stored separately in extractedReferences,
   * not merged into provision objects.
   */
  outputSchema: {
    type: "object",
    required: ["citedProvisions"],
    additionalProperties: false,
    properties: {
      citedProvisions: {
        type: "array",
        minItems: 0, // Some decisions may cite no provisions
        items: {
          type: "object",
          required: [
            // ========================================
            // FROM AGENT 2A (10 fields - via Agent 2B passthrough)
            // ========================================
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

            // ========================================
            // FROM AGENT 2C (2 new interpretative fields)
            // ========================================
            "provisionInterpretation",
            "relevantFactualContext",
          ],
          additionalProperties: false,
          properties: {
            // ========================================
            // RESERVED DATABASE MAPPING FIELDS (FROM 2A)
            // ========================================
            provisionId: {
              type: "null",
              description: "Reserved for database mapping - always null",
            },
            parentActId: {
              type: "null",
              description: "Reserved for database mapping - always null",
            },

            // ========================================
            // INTERNAL REFERENCE IDs (FROM 2A)
            // ========================================
            internalProvisionId: {
              type: "string",
              pattern: "^ART-[a-zA-Z0-9:.]+-\\d{3}$",
              description: "CRITICAL: Must match Agent 2B input exactly - ART-{decisionId}-{seq}",
            },
            internalParentActId: {
              type: "string",
              pattern: "^ACT-[a-zA-Z0-9:.]+-\\d{3}$",
              description: "Parent act ID - ACT-{decisionId}-{seq}",
            },

            // ========================================
            // PROVISION IDENTIFICATION (FROM 2A)
            // ========================================
            provisionNumber: {
              type: "string",
              minLength: 5,
              maxLength: 200,
              description: "Verbatim provision number (from Agent 2A)",
            },
            provisionNumberKey: {
              type: "string",
              minLength: 1,
              maxLength: 50,
              description: "Normalized core number (from Agent 2A)",
            },

            // ========================================
            // PARENT ACT TYPE (FROM 2A - BILINGUAL ENUM)
            // ========================================
            parentActType: {
              type: "string",
              enum: [
                // French (11 values)
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

                // Dutch (11 values)
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
              description: "Parent act type (from Agent 2A)",
            },

            // ========================================
            // PARENT ACT INFORMATION (FROM 2A)
            // ========================================
            parentActName: {
              type: "string",
              minLength: 10,
              maxLength: 500,
              description: "Verbatim parent act name (from Agent 2A)",
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
              description: "Date in YYYY-MM-DD or null (from Agent 2A)",
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
              description: "Official act number or null (from Agent 2A)",
            },

            // ========================================
            // INTERPRETATIVE FIELDS (NEW IN 2C)
            // ========================================
            provisionInterpretation: {
              anyOf: [
                {
                  type: "string",
                  minLength: 100,
                  maxLength: 1000,
                  description: "How court interprets/applies provision (100-1000 chars, procedural language)",
                },
                {
                  type: "null",
                },
              ],
              description: "Court's interpretation of provision or null if not applicable (NEW: Agent 2C)",
            },

            relevantFactualContext: {
              anyOf: [
                {
                  type: "string",
                  minLength: 50,
                  maxLength: 500,
                  description: "Relevant case facts for provision's application (50-500 chars, procedural language)",
                },
                {
                  type: "null",
                },
              ],
              description: "Factual context for provision or null if not applicable (NEW: Agent 2C)",
            },
          },
        },
      },
    },
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "provision_interpretation_2c",

  /**
   * Provider and Model Configuration
   */
  provider: "openai",
  model: "gpt-5-mini",
  maxCompletionTokens: 128000,        // Same as Agent 2B (interpretative analysis)
  reasoningEffort: "low",            // Interpretative extraction
  verbosity: "low",                   // Concise responses preferred

  /**
   * Custom ID prefix
   */
  customIdPrefix: "interpret-provisions",
};

export default config;
