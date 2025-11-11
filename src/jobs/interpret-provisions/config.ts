import { JobConfig } from "../JobConfig.js";
import { INTERPRET_PROVISIONS_PROMPT } from "./prompt.js";
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
    .filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(name))
    .sort()
    .reverse();

  return timestamps[0] || null;
}

/**
 * Load successful enriched provision results from latest full-data run
 *
 * Returns array of (decision_id, language) pairs for composite key matching.
 * Reads decision_id and language directly from JSON content (more reliable than parsing filenames).
 */
function loadSuccessful2BDecisions(timestamp: string): Array<{ decision_id: string; language: string }> {
  const resultPath = path.join(
    process.cwd(),
    'full-data/enrich-provisions',
    timestamp,
    'jsons'
  );

  if (!fs.existsSync(resultPath)) {
    throw new Error(`Full-data results not found: ${resultPath}\n\nPlease verify the enrich-provisions run completed successfully with full-data pipeline.`);
  }

  const jsonFiles = fs.readdirSync(resultPath).filter(f => f.endsWith('.json'));

  if (jsonFiles.length === 0) {
    throw new Error('No decision JSONs found in 2B full-data directory.');
  }

  console.log(`Reading decision_id + language from ${jsonFiles.length} JSON files...`);

  // Read decision_id and language directly from JSON content
  const pairs = jsonFiles.map(filename => {
    const filepath = path.join(resultPath, filename);
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
    throw new Error('Could not extract decision_id + language pairs from 2B JSONs.');
  }

  return pairs;
}

/**
 * Build a map of (decision_id, language) -> filepath for fast lookup
 * This avoids having to reconstruct filenames from ECLI format
 */
function build2BFilepathMap(timestamp: string): Map<string, string> {
  const jsonsDir = path.join(
    process.cwd(),
    'full-data/enrich-provisions',
    timestamp,
    'jsons'
  );

  const jsonFiles = fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'));
  const map = new Map<string, string>();

  console.log('Building filepath map for fast lookup...');

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

  console.log(`Built filepath map with ${map.size} entries`);
  return map;
}

/**
 * Load Agent 2B data for a specific decision using composite key
 *
 * Uses prebuilt map for fast lookup (no filename reconstruction needed).
 */
function load2BData(decisionId: string, language: string): any {
  const key = `${decisionId}||${language}`;
  const filepath = FILEPATH_MAP_2B.get(key);

  if (!filepath) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    return data;
  } catch (error) {
    console.warn(`Failed to load 2B data for ${key}: ${error}`);
    return null;
  }
}

// Auto-detect latest 2B run at module load time (from full-data directory)
const LATEST_2B_TIMESTAMP_RAW = getLatestFullDataTimestamp('enrich-provisions');

if (!LATEST_2B_TIMESTAMP_RAW) {
  throw new Error('No enrich-provisions full-data results found. Please run Agent 2B first with full-data pipeline:\n  npm run dev concurrent enrich-provisions');
}

const LATEST_2B_TIMESTAMP: string = LATEST_2B_TIMESTAMP_RAW;
const SUCCESSFUL_2B_PAIRS = loadSuccessful2BDecisions(LATEST_2B_TIMESTAMP);

console.log(`📋 Using enrich-provisions results from: ${LATEST_2B_TIMESTAMP}`);
console.log(`✅ Found ${SUCCESSFUL_2B_PAIRS.length} successful 2B decisions to interpret`);

const FILEPATH_MAP_2B = build2BFilepathMap(LATEST_2B_TIMESTAMP);

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
   * NOTE: We manually load 2B data in preprocessRow from full-data directory
   * instead of using DependencyResolver (which expects concurrent results).
   */
  dependencies: [],

  /**
   * Database Query
   *
   * Query ALL decisions that have successful Agent 2B results.
   * Filters using composite key (decision_id, language) from 2B full-data directory.
   *
   * This ensures we only process decisions where Agent 2B completed successfully.
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
    INNER JOIN unnest($1::text[], $2::text[]) AS successful(decision_id, language)
      ON d.decision_id = successful.decision_id
      AND d.language_metadata = successful.language
    WHERE dm.full_md IS NOT NULL
      AND dm.full_md != ''
    ORDER BY d.decision_id, d.language_metadata
  `,

  /**
   * Database Query Parameters
   *
   * Arrays of decision_id and language from successful Agent 2B results.
   * Composite key matching ensures correct pairing.
   */
  dbQueryParams: [
    SUCCESSFUL_2B_PAIRS.map(p => p.decision_id),
    SUCCESSFUL_2B_PAIRS.map(p => p.language)
  ],

  /**
   * Preprocess Row
   *
   * Load Agent 2B data from full-data directory and attach to row.
   * Replaces DependencyResolver attachment with manual loading.
   *
   * IMPORTANT: Returns null if Agent 2B data missing (ConcurrentRunner will skip).
   */
  preprocessRow: async (row: any) => {
    // Load Agent 2B data from full-data directory
    const agent2bData = load2BData(row.decision_id, row.language_metadata);

    if (!agent2bData) {
      console.warn(`⚠️  Missing Agent 2B data for decision ${row.decision_id} (${row.language_metadata}), skipping`);
      return null; // ConcurrentRunner will skip this decision
    }

    // Attach Agent 2B data to row (same structure as DependencyResolver would provide)
    return {
      ...row,
      agent2b: {
        citedProvisions: agent2bData.citedProvisions,
        citedProvisionsJson: JSON.stringify(agent2bData.citedProvisions, null, 2),
        extractedReferences: agent2bData.extractedReferences
      }
    };
  },

  /**
   * Row Metadata Fields
   *
   * Track all metadata from database for analysis and filtering.
   * Matches Agent 2B's metadata fields.
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
   * Post-Processing: Merge extractedReferences from Agent 2B
   *
   * The LLM only outputs citedProvisions with interpretative enrichment.
   * This function merges the extractedReferences from Agent 2B dependency
   * to create the complete output structure.
   */
  postProcessRow: (row, result) => {
    // Get extractedReferences from Agent 2B dependency
    const extractedReferences = row.agent2b?.extractedReferences || {
      url: { eu: [], be: [] },
      reference: {
        eu: { extracted: [], verified: [] },
        be: { extracted: [], verifiedNumac: [], verifiedFileNumber: [] }
      }
    };

    // Merge LLM result (citedProvisions) with Agent 2B metadata (extractedReferences)
    return {
      citedProvisions: result.citedProvisions,
      extractedReferences: extractedReferences
    };
  },

  /**
   * Output JSON Schema
   *
   * Comprehensive schema for interpreted provisions with regex metadata.
   *
   * Structure:
   * - citedProvisions: Array with 12 fields per provision
   *   - 10 fields from Agent 2A (preserved unchanged via Agent 2B passthrough)
   *   - 2 new fields from Agent 2C (interpretative enrichment)
   * - extractedReferences: Regex-extracted metadata from Agent 2B (passed through)
   *
   * Key validation:
   * - All fields from 2A must be present and unchanged
   * - internalProvisionId must match Agent 2A input exactly
   * - New fields are nullable (null when interpretation not found)
   * - Length constraints: interpretation 100-1000, context 50-500
   * - extractedReferences passed through from Agent 2B unchanged
   */
  outputSchema: {
    type: "object",
    required: ["citedProvisions", "extractedReferences"],
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

      // ========================================
      // FROM AGENT 2B: Reference Metadata (PASSTHROUGH)
      // ========================================
      extractedReferences: {
        type: "object",
        required: ["url", "reference"],
        additionalProperties: false,
        description: "Regex-extracted legal reference metadata from Agent 2B (passed through unchanged)",
        properties: {
          url: {
            type: "object",
            required: ["eu", "be"],
            additionalProperties: false,
            properties: {
              eu: {
                type: "array",
                items: { type: "string" },
                description: "EU URLs (europa.eu with CELEX)"
              },
              be: {
                type: "array",
                items: { type: "string" },
                description: "Belgian URLs (ejustice, etaamb)"
              }
            }
          },
          reference: {
            type: "object",
            required: ["eu", "be"],
            additionalProperties: false,
            properties: {
              eu: {
                type: "object",
                required: ["extracted", "verified"],
                additionalProperties: false,
                properties: {
                  extracted: {
                    type: "array",
                    items: { type: "string" },
                    description: "CELEX candidates that failed validation"
                  },
                  verified: {
                    type: "array",
                    items: { type: "string" },
                    description: "CELEX codes that passed validation"
                  }
                }
              },
              be: {
                type: "object",
                required: ["extracted", "verifiedNumac", "verifiedFileNumber"],
                additionalProperties: false,
                properties: {
                  extracted: {
                    type: "array",
                    items: { type: "string" },
                    description: "Belgian reference candidates that failed validation"
                  },
                  verifiedNumac: {
                    type: "array",
                    items: { type: "string" },
                    description: "NUMAC codes that passed validation"
                  },
                  verifiedFileNumber: {
                    type: "array",
                    items: { type: "string" },
                    description: "File numbers that passed validation"
                  }
                }
              }
            }
          }
        }
      }
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
  reasoningEffort: "medium",          // Interpretative extraction requires reasoning
  verbosity: "low",                   // Concise responses preferred

  /**
   * Concurrency Configuration
   *
   * For full dataset (64k decisions), use moderate concurrency.
   */
  concurrencyLimit: 300,

  /**
   * Full-Data Pipeline Mode
   *
   * Enabled for full dataset processing.
   * Writes per-decision JSONs to full-data/interpret-provisions/<timestamp>/jsons/
   */
  useFullDataPipeline: true,

  /**
   * Custom ID prefix
   */
  customIdPrefix: "interpret-provisions",
};

export default config;
