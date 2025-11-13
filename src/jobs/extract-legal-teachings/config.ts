import { JobConfig } from "../JobConfig.js";
import { EXTRACT_LEGAL_TEACHINGS_PROMPT } from "./prompt.js";
import fs from "fs";
import path from "path";

/**
 * Get latest full-data run timestamp for a job
 */
function getLatestFullDataTimestamp(jobId: string): string | null {
  const resultsDir = path.join(process.cwd(), 'full-data', jobId);

  if (!fs.existsSync(resultsDir)) {
    return null;
  }

  const timestamps = fs.readdirSync(resultsDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.test(name))
    .sort()
    .reverse();

  return timestamps[0] || null;
}

/**
 * Load successful decisions from latest full-data run
 *
 * Returns array of (decision_id, language) pairs for composite key matching.
 */
function loadSuccessfulDecisions(jobId: string, timestamp: string): Array<{ decision_id: string; language: string }> {
  const jsonsDir = path.join(
    process.cwd(),
    'full-data',
    jobId,
    timestamp,
    'jsons'
  );

  if (!fs.existsSync(jsonsDir)) {
    throw new Error(`Full-data results not found: ${jsonsDir}\n\nPlease verify the ${jobId} run completed successfully with full-data pipeline.`);
  }

  const jsonFiles = fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'));

  if (jsonFiles.length === 0) {
    throw new Error(`No decision JSONs found in ${jobId} full-data directory.`);
  }

  console.log(`Reading decision_id + language from ${jsonFiles.length} ${jobId} files...`);

  const pairs = jsonFiles.map(filename => {
    const filepath = path.join(jsonsDir, filename);
    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      return {
        decision_id: data.decision_id,
        language: data.language || data.language_metadata
      };
    } catch (error) {
      console.warn(`Failed to read ${filename}: ${error}`);
      return null;
    }
  }).filter((pair): pair is { decision_id: string; language: string } =>
    pair !== null && pair.decision_id && pair.language
  );

  if (pairs.length === 0) {
    throw new Error(`Could not extract decision_id + language pairs from ${jobId} JSONs.`);
  }

  return pairs;
}

/**
 * Build filepath map for fast lookup
 *
 * Maps (decision_id, language) -> filepath to avoid ECLI filename reconstruction.
 */
function buildFilepathMap(jobId: string, timestamp: string): Map<string, string> {
  const jsonsDir = path.join(
    process.cwd(),
    'full-data',
    jobId,
    timestamp,
    'jsons'
  );

  const jsonFiles = fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'));
  const map = new Map<string, string>();

  console.log(`Building ${jobId} filepath map for fast lookup...`);

  for (const filename of jsonFiles) {
    const filepath = path.join(jsonsDir, filename);
    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      const key = `${data.decision_id}||${data.language || data.language_metadata}`;
      map.set(key, filepath);
    } catch (error) {
      console.warn(`Failed to read ${filename} for map building: ${error}`);
    }
  }

  console.log(`Built ${jobId} filepath map with ${map.size} entries`);
  return map;
}

/**
 * Load dependency data for specific decision using composite key
 *
 * Uses prebuilt filepath map for O(1) lookup.
 */
function loadDependencyData(
  filepathMap: Map<string, string>,
  decisionId: string,
  language: string
): any | null {
  const key = `${decisionId}||${language}`;
  const filepath = filepathMap.get(key);

  if (!filepath) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    return data;
  } catch (error) {
    console.warn(`Failed to load data for ${key}: ${error}`);
    return null;
  }
}

// Auto-detect latest runs for both dependencies at module load time
const LATEST_2C_TIMESTAMP_RAW = getLatestFullDataTimestamp('interpret-provisions');
const LATEST_3_TIMESTAMP_RAW = getLatestFullDataTimestamp('extract-cited-decisions');

if (!LATEST_2C_TIMESTAMP_RAW) {
  throw new Error('No interpret-provisions full-data results found. Please run Agent 2C first with full-data pipeline:\n  npm run dev concurrent interpret-provisions');
}

if (!LATEST_3_TIMESTAMP_RAW) {
  throw new Error('No extract-cited-decisions full-data results found. Please run Agent 3 first with full-data pipeline:\n  npm run dev concurrent extract-cited-decisions');
}

const LATEST_2C_TIMESTAMP: string = LATEST_2C_TIMESTAMP_RAW;
const LATEST_3_TIMESTAMP: string = LATEST_3_TIMESTAMP_RAW;

const SUCCESSFUL_2C_PAIRS = loadSuccessfulDecisions('interpret-provisions', LATEST_2C_TIMESTAMP);
const SUCCESSFUL_3_PAIRS = loadSuccessfulDecisions('extract-cited-decisions', LATEST_3_TIMESTAMP);

console.log(`📋 Using interpret-provisions results from: ${LATEST_2C_TIMESTAMP}`);
console.log(`✅ Found ${SUCCESSFUL_2C_PAIRS.length} successful 2C decisions`);
console.log(`📋 Using extract-cited-decisions results from: ${LATEST_3_TIMESTAMP}`);
console.log(`✅ Found ${SUCCESSFUL_3_PAIRS.length} successful 3 decisions`);

const FILEPATH_MAP_2C = buildFilepathMap('interpret-provisions', LATEST_2C_TIMESTAMP);
const FILEPATH_MAP_3 = buildFilepathMap('extract-cited-decisions', LATEST_3_TIMESTAMP);

/**
 * Build intersection of decisions that have both Agent 2C AND Agent 3 results
 *
 * Only these decisions can be processed by Agent 5.
 */
function buildProcessableDecisions(): Array<{ decision_id: string; language: string }> {
  const set2C = new Set(SUCCESSFUL_2C_PAIRS.map(p => `${p.decision_id}||${p.language}`));
  const processable = SUCCESSFUL_3_PAIRS.filter(p => set2C.has(`${p.decision_id}||${p.language}`));

  console.log(`\n🔗 Intersection: ${processable.length} decisions have both Agent 2C and Agent 3 results`);
  console.log(`   (${SUCCESSFUL_2C_PAIRS.length} with 2C, ${SUCCESSFUL_3_PAIRS.length} with 3, ${processable.length} with both)\n`);

  return processable;
}

const PROCESSABLE_DECISIONS = buildProcessableDecisions();

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
 * - Both loaded from full-data directory (latest timestamps)
 *
 * APPROACH: Full-dataset extraction with manual dependency loading
 * - Bypasses DependencyResolver (which only supports concurrent/results)
 * - Manually loads dependencies from full-data/{job}/{timestamp}/jsons/
 * - Processes only decisions that have BOTH Agent 2C AND Agent 3 results
 * - Uses composite key matching (decision_id + language)
 *
 * OUTPUT: Per-decision JSONs in full-data pipeline
 * - 14 required fields per teaching (dual formulations + contexts + relationships + weight + links)
 * - Nested hierarchicalRelationships object (5 fields)
 * - Nested precedentialWeight object (6 fields)
 * - Enhanced metadata with relationship counts and validation checks
 */

const config: JobConfig = {
  id: "extract-legal-teachings",

  description:
    "Extract production-ready legal principles with quality gates (Agent 5: Belgian structure awareness, dual formulations, hierarchies, precedential weight, provision/decision linking)",

  /**
   * Dependencies
   *
   * Empty array - we manually load from full-data in preprocessRow.
   * DependencyResolver only supports concurrent/results, not full-data.
   */
  dependencies: [],

  /**
   * Database Query
   *
   * Loads ALL decisions that have both Agent 2C and Agent 3 results.
   * Uses composite key matching (decision_id + language) from full-data.
   */
  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      dm.full_md,
      LENGTH(dm.full_md) as md_length
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    INNER JOIN unnest($1::text[], $2::text[]) AS processable(decision_id, language)
      ON d.decision_id = processable.decision_id
      AND d.language_metadata = processable.language
    WHERE dm.full_md IS NOT NULL
      AND dm.full_md != ''
    ORDER BY d.decision_id, d.language_metadata
  `,

  /**
   * Database Query Parameters
   *
   * Loads only decisions that exist in BOTH Agent 2C and Agent 3 full-data results.
   */
  dbQueryParams: [
    PROCESSABLE_DECISIONS.map(p => p.decision_id),
    PROCESSABLE_DECISIONS.map(p => p.language)
  ],

  /**
   * Preprocess Row
   *
   * Manually loads Agent 2C and Agent 3 data from full-data directories.
   * Returns null if either dependency is missing (ConcurrentRunner will skip).
   */
  preprocessRow: async (row: any) => {
    // Load Agent 2C data (interpret-provisions)
    const agent2cData = loadDependencyData(
      FILEPATH_MAP_2C,
      row.decision_id,
      row.language_metadata
    );

    if (!agent2cData) {
      console.warn(`⚠️  Missing Agent 2C data for decision ${row.decision_id} (${row.language_metadata}), skipping`);
      return null;
    }

    // Load Agent 3 data (extract-cited-decisions)
    const agent3Data = loadDependencyData(
      FILEPATH_MAP_3,
      row.decision_id,
      row.language_metadata
    );

    if (!agent3Data) {
      console.warn(`⚠️  Missing Agent 3 data for decision ${row.decision_id} (${row.language_metadata}), skipping`);
      return null;
    }

    // Attach both dependencies to row
    return {
      ...row,
      agent2c: {
        citedProvisions: agent2cData.citedProvisions || [],
        citedProvisionsJson: JSON.stringify(agent2cData.citedProvisions || [], null, 2),
        extractedReferences: agent2cData.extractedReferences
      },
      agent3: {
        citedDecisions: agent3Data.citedDecisions || [],
        citedDecisionsJson: JSON.stringify(agent3Data.citedDecisions || [], null, 2)
      }
    };
  },

  /**
   * Row Metadata Fields
   *
   * Track essential metadata for analysis and filtering.
   */
  rowMetadataFields: [
    "id",
    "decision_id",
    "language_metadata",
    "md_length"
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
   * Dependencies loaded manually in preprocessRow and attached as row.agent2c and row.agent3.
   */
  promptTemplate: (row) => {
    const citedProvisions = row.agent2c?.citedProvisions || [];
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
   * gpt-5-mini with MEDIUM reasoning effort:
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
   * Conservative concurrency for full dataset:
   * - 200 concurrent requests (standard for large runs)
   * - Reduced from 300 to avoid rate limits on 60k+ dataset
   * - Batch processing with 500ms delays between batches
   */
  concurrencyLimit: 200,

  /**
   * Full-Data Pipeline Mode
   *
   * Enabled for full dataset processing.
   * Writes per-decision JSONs to full-data/extract-legal-teachings/<timestamp>/jsons/
   * Required for large datasets and future retry operations.
   */
  useFullDataPipeline: true,

  /**
   * Custom ID prefix
   */
  customIdPrefix: "legal-teachings",
};

export default config;
