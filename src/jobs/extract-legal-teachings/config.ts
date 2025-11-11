import { JobConfig } from "../JobConfig.js";
import { EXTRACT_LEGAL_TEACHINGS_PROMPT } from "./prompt.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";

/**
 * Load 197-decision test set for legal teachings extraction
 *
 * This test set is stratified by language, court level, decision type, and length.
 * Returns query parameters for composite key matching.
 */
async function loadTestSetParams() {
  const testSet = await TestSetLoader.loadTestSet("evals/test-sets/comprehensive-197.csv");
  const summary = TestSetLoader.getSummary(testSet);

  console.log(`📊 Legal Teachings test set: ${summary.total} decisions`);
  console.log(`   Languages: ${JSON.stringify(summary.byLanguage)}`);

  return TestSetLoader.toQueryParams(testSet);
}

/**
 * Build test set metadata map for preprocessor enrichment
 *
 * Creates fast lookup map for enriching rows with court level and other metadata.
 */
async function buildTestSetMap() {
  const testSet = await TestSetLoader.loadTestSet("evals/test-sets/comprehensive-197.csv");
  const map = new Map<string, any>();

  testSet.forEach((entry) => {
    const key = `${entry.decision_id}|${entry.language}`;
    map.set(key, entry);
  });

  return map;
}

/**
 * Extract Legal Teachings Job Configuration - Agent 5
 *
 * Production-grade extraction of reusable legal principles from Belgian court decisions.
 *
 * COMPLEXITY: VERY HIGH
 * - Belgian legal document structure awareness (reasoning vs procedural sections)
 * - 5 quality gates per candidate principle (accuracy, attribution, generalizability, completeness, clarity)
 * - Dual formulations (generalized text + court verbatim)
 * - Dual contexts (abstract trigger + specific facts)
 * - Hierarchical relationship mapping (parent-child, rule-exception, conflicts)
 * - Precedential weight assessment (6 dimensions)
 * - Cross-referencing with cited provisions and decisions
 *
 * DEPENDENCIES:
 * - Agent 2C (interpret-provisions): Provides citedProvisions array with internalProvisionId
 * - Agent 3 (extract-cited-decisions): Provides citedDecisions array with internalDecisionId
 *
 * APPROACH: Multi-source extraction with dependency linking
 * - LLM receives full markdown + cited provisions + cited decisions
 * - Must identify reasoning sections, apply quality gates, extract verbatim quotes
 * - Links teachings to specific provisions and precedents using internal IDs
 * - gpt-5 with HIGH reasoning effort for complex multi-step analysis
 *
 * OUTPUT: Production-ready legal principles with complete metadata
 * - 14 required fields per teaching (dual formulations + contexts + relationships + weight + links)
 * - Nested hierarchicalRelationships object (5 fields)
 * - Nested precedentialWeight object (6 fields)
 * - Enhanced metadata with relationship counts and validation checks
 */

const TEST_SET_PARAMS = await loadTestSetParams();
const TEST_SET_MAP = await buildTestSetMap();

const config: JobConfig = {
  id: "extract-legal-teachings",

  description:
    "Extract production-ready legal principles with quality gates (Agent 5: Belgian structure awareness, dual formulations, hierarchies, precedential weight, provision/decision linking)",

  /**
   * Dependencies
   *
   * Load citedProvisions from Agent 2C and citedDecisions from Agent 3.
   * Both use concurrent/results source for test set evaluation.
   */
  dependencies: [
    {
      jobId: "interpret-provisions",
      alias: "agent2c",
      required: false,
      source: "concurrent",
      matchOn: [
        { row: "decision_id", dependency: "decision_id" },
        { row: "language_metadata", dependency: "language" },
      ],
    },
    {
      jobId: "extract-cited-decisions",
      alias: "agent3",
      required: false,
      source: "concurrent",
      matchOn: [
        { row: "decision_id", dependency: "decision_id" },
        { row: "language_metadata", dependency: "language" },
      ],
    },
  ],

  /**
   * Database Query
   *
   * Loads 197 stratified test decisions using TestSetLoader.
   * Composite key matching (decision_id + language) ensures correct pairing.
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
    ORDER BY d.decision_id, d.language_metadata
  `,

  /**
   * Database Query Parameters
   *
   * Load 197-decision test set with composite key arrays.
   */
  dbQueryParams: [TEST_SET_PARAMS.decisionIds, TEST_SET_PARAMS.languages],

  /**
   * Preprocess Row
   *
   * Enriches database rows with test set metadata.
   * Note: Dependencies (agent2c, agent3) are automatically loaded by DependencyResolver.
   */
  preprocessRow: async (row: any) => {
    const key = `${row.decision_id}|${row.language_metadata}`;
    const testSetEntry = TEST_SET_MAP.get(key);

    if (!testSetEntry) {
      return row;
    }

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
  },

  /**
   * Row Metadata Fields
   *
   * Track all metadata for filtering and evaluation analysis.
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
   * Injects 5 variables into the production prompt:
   * 1. {decisionId} - ECLI identifier
   * 2. {proceduralLanguage} - FR or NL
   * 3. {citedProvisions} - JSON array from Agent 2C (with internalProvisionId)
   * 4. {citedDecisions} - JSON array from Agent 3 (with internalDecisionId)
   * 5. {fullText.markdown} - Full decision text
   *
   * Dependencies are loaded by DependencyResolver and attached to row.agent2c and row.agent3.
   */
  promptTemplate: (row) => {
    // Extract citedProvisions from Agent 2C dependency
    const citedProvisions = row.agent2c?.citedProvisions || [];

    // Extract citedDecisions from Agent 3 dependency
    const citedDecisions = row.agent3?.citedDecisions || [];

    return EXTRACT_LEGAL_TEACHINGS_PROMPT
      .replace("{decisionId}", row.decision_id || "")
      .replace("{proceduralLanguage}", row.language_metadata || "FR")
      .replace("{citedProvisions}", JSON.stringify(citedProvisions, null, 2))
      .replace("{citedDecisions}", JSON.stringify(citedDecisions, null, 2))
      .replace("{fullText.markdown}", row.full_md || "");
  },

  /**
   * Output JSON Schema
   *
   * Complex nested schema for production-ready legal principles.
   *
   * Structure:
   * - legalTeachings: Array with 14 required fields per teaching
   *   - Core: teachingId, text, courtVerbatim, courtVerbatimLanguage
   *   - Context: factualTrigger, relevantFactualContext
   *   - Categorization: principleType, legalArea
   *   - Nested: hierarchicalRelationships (5 fields), precedentialWeight (6 fields)
   *   - Relationships: relatedLegalIssuesId, relatedCitedProvisionsId, relatedCitedDecisionsId
   *   - Source: sourceAuthor (AI_GENERATED)
   * - metadata: Enhanced validation with relationship counts and court level detection
   */
  outputSchema: {
    type: "object",
    required: ["legalTeachings", "metadata"],
    additionalProperties: false,
    properties: {
      legalTeachings: {
        type: "array",
        minItems: 0,
        description: "Array of extracted legal principles (can be 0 for routine decisions)",
        items: {
          type: "object",
          required: [
            "teachingId",
            "text",
            "courtVerbatim",
            "courtVerbatimLanguage",
            "factualTrigger",
            "relevantFactualContext",
            "principleType",
            "legalArea",
            "hierarchicalRelationships",
            "precedentialWeight",
            "relatedLegalIssuesId",
            "relatedCitedProvisionsId",
            "relatedCitedDecisionsId",
            "sourceAuthor",
          ],
          additionalProperties: false,
          properties: {
            // ========================================
            // CORE IDENTIFICATION
            // ========================================
            teachingId: {
              type: "string",
              pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$",
              description: "Teaching ID: TEACH-{decisionId}-{sequence}",
            },

            // ========================================
            // DUAL TEXT FORMULATIONS
            // ========================================
            text: {
              type: "string",
              minLength: 100,
              maxLength: 1000,
              description: "Generalized principle (100-1000 chars, procedural language)",
            },
            courtVerbatim: {
              type: "string",
              minLength: 100,
              maxLength: 2000,
              description: "Court's exact words from reasoning section (100-2000 chars)",
            },
            courtVerbatimLanguage: {
              type: "string",
              enum: ["FR", "NL"],
              description: "Language of verbatim quote",
            },

            // ========================================
            // DUAL FACTUAL CONTEXT
            // ========================================
            factualTrigger: {
              type: "string",
              minLength: 50,
              maxLength: 300,
              description: "Abstract conditions when principle applies (50-300 chars)",
            },
            relevantFactualContext: {
              type: "string",
              minLength: 50,
              maxLength: 500,
              description: "Specific facts of this case (50-500 chars)",
            },

            // ========================================
            // CATEGORIZATION
            // ========================================
            principleType: {
              type: "string",
              enum: [
                "INTERPRETATION_RULE",
                "APPLICATION_STANDARD",
                "LEGAL_TEST",
                "BURDEN_PROOF",
                "BALANCING_TEST",
                "PROCEDURAL_RULE",
                "REMEDIAL_PRINCIPLE",
              ],
              description: "Type of legal principle",
            },
            legalArea: {
              type: "string",
              enum: [
                "DISCRIMINATION_LAW",
                "DATA_PROTECTION",
                "EMPLOYMENT_LAW",
                "CONTRACT_LAW",
                "CIVIL_LIABILITY",
                "ADMINISTRATIVE_LAW",
                "PROCEDURAL_LAW",
                "COMPETITION_LAW",
                "INTELLECTUAL_PROPERTY",
                "FAMILY_LAW",
                "OTHER",
              ],
              description: "Primary legal area",
            },

            // ========================================
            // HIERARCHICAL RELATIONSHIPS
            // ========================================
            hierarchicalRelationships: {
              type: "object",
              required: [
                "refinesParentPrinciple",
                "refinedByChildPrinciples",
                "exceptionToPrinciple",
                "exceptedByPrinciples",
                "conflictsWith",
              ],
              additionalProperties: false,
              properties: {
                refinesParentPrinciple: {
                  anyOf: [
                    {
                      type: "string",
                      pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$",
                    },
                    {
                      type: "null",
                    },
                  ],
                  description: "Parent principle ID (if this is child) or null",
                },
                refinedByChildPrinciples: {
                  type: "array",
                  items: {
                    type: "string",
                    pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$",
                  },
                  description: "Child principle IDs (if this is parent)",
                },
                exceptionToPrinciple: {
                  anyOf: [
                    {
                      type: "string",
                      pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$",
                    },
                    {
                      type: "null",
                    },
                  ],
                  description: "Rule principle ID (if this is exception) or null",
                },
                exceptedByPrinciples: {
                  type: "array",
                  items: {
                    type: "string",
                    pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$",
                  },
                  description: "Exception principle IDs (if this is rule)",
                },
                conflictsWith: {
                  type: "array",
                  items: {
                    type: "string",
                    pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$",
                  },
                  description: "Conflicting principle IDs (rare)",
                },
              },
            },

            // ========================================
            // PRECEDENTIAL WEIGHT
            // ========================================
            precedentialWeight: {
              type: "object",
              required: [
                "courtLevel",
                "binding",
                "clarity",
                "novelPrinciple",
                "confirmsExistingDoctrine",
                "distinguishesPriorCase",
              ],
              additionalProperties: false,
              properties: {
                courtLevel: {
                  type: "string",
                  enum: ["CASSATION", "APPEAL", "FIRST_INSTANCE"],
                  description: "Court hierarchical level (extracted from markdown)",
                },
                binding: {
                  type: "boolean",
                  description: "Whether principle is binding (true for CASSATION/APPEAL, false for FIRST_INSTANCE)",
                },
                clarity: {
                  type: "string",
                  enum: ["EXPLICIT", "IMPLICIT"],
                  description: "Whether principle is explicitly stated or derivable from reasoning",
                },
                novelPrinciple: {
                  type: "boolean",
                  description: "Whether court articulates new principle",
                },
                confirmsExistingDoctrine: {
                  type: "boolean",
                  description: "Whether court explicitly follows prior precedent",
                },
                distinguishesPriorCase: {
                  type: "boolean",
                  description: "Whether court qualifies earlier precedent",
                },
              },
            },

            // ========================================
            // RELATIONSHIPS TO OTHER MATERIALS
            // ========================================
            relatedLegalIssuesId: {
              type: "array",
              maxItems: 0,
              items: { type: "string" },
              description: "MUST be empty array (populated by separate workflow)",
            },
            relatedCitedProvisionsId: {
              type: "array",
              items: {
                type: "string",
                pattern: "^ART-[a-zA-Z0-9:.]+-\\d{3}$",
              },
              description: "Provision IDs from Agent 2C (use internalProvisionId)",
            },
            relatedCitedDecisionsId: {
              type: "array",
              items: {
                type: "string",
                pattern: "^DEC-[a-zA-Z0-9:.]+-\\d{3}$",
              },
              description: "Decision IDs from Agent 3 (use internalDecisionId)",
            },

            // ========================================
            // SOURCE ATTRIBUTION
            // ========================================
            sourceAuthor: {
              type: "string",
              enum: ["AI_GENERATED"],
              description: "MUST be AI_GENERATED",
            },
          },
        },
      },

      // ========================================
      // METADATA (SELF-VALIDATION & STATISTICS)
      // ========================================
      metadata: {
        type: "object",
        required: [
          "totalTeachings",
          "extractedCourtLevel",
          "courtLevelConfidence",
          "teachingTypes",
          "hierarchicalRelationships",
          "courtLevelDistribution",
          "validationChecks",
        ],
        additionalProperties: false,
        properties: {
          totalTeachings: {
            type: "integer",
            minimum: 0,
            description: "Total teachings extracted (can be 0 for routine decisions)",
          },
          extractedCourtLevel: {
            type: "string",
            enum: ["CASSATION", "APPEAL", "FIRST_INSTANCE"],
            description: "Court level detected from markdown",
          },
          courtLevelConfidence: {
            type: "string",
            enum: ["HIGH", "MEDIUM", "LOW"],
            description: "Confidence in court level detection (HIGH if clear name, MEDIUM if inferred, LOW if ambiguous)",
          },
          teachingTypes: {
            type: "object",
            required: [
              "interpretive",
              "application",
              "balancing",
              "procedural",
              "remedial",
              "legal_test",
              "burden_proof",
            ],
            additionalProperties: false,
            properties: {
              interpretive: { type: "integer", minimum: 0 },
              application: { type: "integer", minimum: 0 },
              balancing: { type: "integer", minimum: 0 },
              procedural: { type: "integer", minimum: 0 },
              remedial: { type: "integer", minimum: 0 },
              legal_test: { type: "integer", minimum: 0 },
              burden_proof: { type: "integer", minimum: 0 },
            },
          },
          hierarchicalRelationships: {
            type: "object",
            required: ["parentChildPairs", "ruleExceptionPairs", "conflicts"],
            additionalProperties: false,
            properties: {
              parentChildPairs: { type: "integer", minimum: 0 },
              ruleExceptionPairs: { type: "integer", minimum: 0 },
              conflicts: { type: "integer", minimum: 0 },
            },
          },
          courtLevelDistribution: {
            type: "object",
            required: ["cassation", "appeal", "first_instance"],
            additionalProperties: false,
            properties: {
              cassation: { type: "integer", minimum: 0 },
              appeal: { type: "integer", minimum: 0 },
              first_instance: { type: "integer", minimum: 0 },
            },
          },
          validationChecks: {
            type: "object",
            required: [
              "allTeachingsHaveSourceAuthor",
              "sourceAuthorCorrect",
              "teachingCountReasonable",
              "allTeachingsHaveContext",
              "allTeachingsHaveVerbatim",
              "legalIssuesEmptyAsExpected",
              "allProvisionIdsValid",
              "allDecisionIdsValid",
              "allHierarchyReferencesValid",
              "courtLevelDetected",
            ],
            additionalProperties: false,
            properties: {
              allTeachingsHaveSourceAuthor: { type: "boolean" },
              sourceAuthorCorrect: { type: "boolean" },
              teachingCountReasonable: { type: "boolean" },
              allTeachingsHaveContext: { type: "boolean" },
              allTeachingsHaveVerbatim: { type: "boolean" },
              legalIssuesEmptyAsExpected: { type: "boolean" },
              allProvisionIdsValid: { type: "boolean" },
              allDecisionIdsValid: { type: "boolean" },
              allHierarchyReferencesValid: { type: "boolean" },
              courtLevelDetected: { type: "boolean" },
            },
          },
        },
      },
    },
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "legal_teachings_extraction_v2",

  /**
   * Provider and Model Configuration
   *
   * gpt-5 (full model) with HIGH reasoning effort:
   * - Complex multi-step reasoning required
   * - Belgian document structure awareness
   * - 5 quality gates per candidate
   * - Verbatim quote extraction
   * - Hierarchical relationship detection
   * - Precedential weight assessment
   * - Cross-referencing with provisions and decisions
   */
  provider: "openai",
  openaiProvider: "azure",
  model: "gpt-5-mini",
  maxCompletionTokens: 128000,
  reasoningEffort: "medium",
  verbosity: "low",

  /**
   * Concurrency Configuration
   *
   * Lower concurrency (150 vs typical 200-300) due to:
   * - gpt-5 (full model) complexity and cost
   * - HIGH reasoning effort per request
   * - Larger output per decision (dual formulations + metadata)
   */
  concurrencyLimit: 300,

  /**
   * Standard Pipeline Mode
   *
   * Enabled for test set evaluation and rapid iteration.
   * Creates 4 aggregated JSONs in concurrent/results/ for analysis.
   */
  useFullDataPipeline: false,

  /**
   * Custom ID prefix
   */
  customIdPrefix: "legal-teachings",
};

export default config;
