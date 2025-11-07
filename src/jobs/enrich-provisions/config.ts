import { JobConfig } from "../JobConfig.js";
import { ReferenceExtractorN8N } from "../../utils/referenceExtractorN8N.js";
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
 * Load successful provision results from latest concurrent run
 *
 * Returns array of (decision_id, language) pairs for composite key matching.
 * Reads decision_id and language directly from JSON content (more reliable than parsing filenames).
 */
function loadSuccessful2ADecisions(timestamp: string): Array<{ decision_id: string; language: string }> {
  const resultPath = path.join(
    process.cwd(),
    'full-data/extract-provisions-2a',
    timestamp,
    'jsons'
  );

  if (!fs.existsSync(resultPath)) {
    throw new Error(`Full-data results not found: ${resultPath}\n\nPlease verify the extract-provisions-2a run completed successfully with full-data pipeline.`);
  }

  const jsonFiles = fs.readdirSync(resultPath).filter(f => f.endsWith('.json'));

  if (jsonFiles.length === 0) {
    throw new Error('No decision JSONs found in 2A full-data directory.');
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
    throw new Error('Could not extract decision_id + language pairs from 2A JSONs.');
  }

  return pairs;
}

// Auto-detect latest 2A run at module load time (from full-data directory)
const LATEST_2A_TIMESTAMP_RAW = getLatestFullDataTimestamp('extract-provisions-2a');

if (!LATEST_2A_TIMESTAMP_RAW) {
  throw new Error('No extract-provisions-2a full-data results found. Please run Agent 2A first with full-data pipeline:\n  npm run dev concurrent extract-provisions-2a');
}

const LATEST_2A_TIMESTAMP: string = LATEST_2A_TIMESTAMP_RAW;
const SUCCESSFUL_2A_PAIRS = loadSuccessful2ADecisions(LATEST_2A_TIMESTAMP);

console.log(`📋 Using extract-provisions-2a results from: ${LATEST_2A_TIMESTAMP}`);
console.log(`✅ Found ${SUCCESSFUL_2A_PAIRS.length} successful 2A decisions to enrich`);

/**
 * Build a map of (decision_id, language) -> filepath for fast lookup
 * This avoids having to reconstruct filenames from ECLI format
 */
function build2AFilepathMap(timestamp: string): Map<string, string> {
  const jsonsDir = path.join(
    process.cwd(),
    'full-data/extract-provisions-2a',
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

const FILEPATH_MAP_2A = build2AFilepathMap(LATEST_2A_TIMESTAMP);

/**
 * Load Agent 2A data for a specific decision using composite key
 *
 * Uses prebuilt map for fast lookup (no filename reconstruction needed).
 */
function load2AData(decisionId: string, language: string): any {
  const key = `${decisionId}||${language}`;
  const filepath = FILEPATH_MAP_2A.get(key);

  if (!filepath) {
    return null;
  }

  try {
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    return data;
  } catch (error) {
    console.warn(`Failed to load 2A data for ${key}: ${error}`);
    return null;
  }
}

/**
 * Enrich Provisions Job Configuration - Agent 2B (REGEX-ONLY)
 *
 * SCOPE: Enrich provisions from Agent 2A with regex-extracted metadata
 *
 * Enriches decisions with legal reference metadata:
 * - EU references: CELEX codes and Europa URLs
 * - Belgian references: NUMAC codes, file numbers, Justel/etaamb URLs
 *
 * APPROACH: Pure regex extraction (no LLM)
 * - Uses production-tested N8N ReferenceExtractor
 * - Zero cost per decision (no API calls)
 * - Instant processing (no rate limits)
 *
 * DEPENDS ON: extract-provisions-2a (Agent 2A)
 * - Loads citedProvisions array from latest Agent 2A results
 * - Merges 2A provisions with extracted reference metadata
 * - All decisions output (even if 0 provisions or 0 references)
 *
 * OUTPUT STRUCTURE:
 * {
 *   citedProvisions: [...],        // From Agent 2A (unchanged)
 *   extractedReferences: {         // From regex extractor
 *     url: { eu: [...], be: [...] },
 *     reference: {
 *       eu: { extracted: [...], verified: [...] },
 *       be: { extracted: [...], verifiedNumac: [...], verifiedFileNumber: [...] }
 *     }
 *   }
 * }
 */

const config: JobConfig = {
  id: "enrich-provisions",

  description:
    "Enrich provisions with regex-extracted metadata (Agent 2B: CELEX, NUMAC, URLs) - NO LLM",

  /**
   * Dependencies
   *
   * NOTE: We manually load 2A data in customExecution from full-data directory
   * instead of using DependencyResolver (which expects concurrent results).
   */
  dependencies: [],

  /**
   * Database Query
   *
   * Query ALL decisions that have successful Agent 2A results.
   * Filters using composite key (decision_id, language) from 2A full-data directory.
   *
   * This ensures we only process decisions where Agent 2A completed successfully.
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
      LENGTH(dm.full_md) as md_length,
      CASE
        WHEN LENGTH(dm.full_md) < 10000 THEN 'short'
        WHEN LENGTH(dm.full_md) < 30000 THEN 'medium'
        WHEN LENGTH(dm.full_md) < 60000 THEN 'long'
        ELSE 'very_long'
      END as length_category
    FROM decisions_md dm
    INNER JOIN decisions1 d
      ON d.decision_id = dm.decision_id
      AND d.language_metadata = dm.language
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
   * Arrays of decision_id and language from successful Agent 2A results.
   * Composite key matching ensures correct pairing.
   */
  dbQueryParams: [
    SUCCESSFUL_2A_PAIRS.map(p => p.decision_id),
    SUCCESSFUL_2A_PAIRS.map(p => p.language)
  ],

  /**
   * Row Metadata Fields
   *
   * Track all metadata for analysis and filtering.
   * Matches Agent 2A's metadata fields.
   */
  rowMetadataFields: [
    "id",
    "decision_id",
    "language_metadata",
    "decision_type_ecli_code",
    "court_ecli_code",
    "decision_date",
    "md_length",
    "length_category"
  ],

  /**
   * Custom Execution: Regex-Only Enrichment
   *
   * NO LLM CALLS - Pure regex extraction using N8N ReferenceExtractor.
   *
   * Process:
   * 1. Get citedProvisions from Agent 2A dependency
   * 2. Run regex extractor on full_md text
   * 3. Merge and return both arrays
   *
   * All decisions output (even if 2A had 0 provisions or regex found 0 references).
   */
  customExecution: async (row: any, _client: any) => {
    // Step 1: Load Agent 2A data from full-data directory
    const agent2aData = load2AData(row.decision_id, row.language_metadata);

    if (!agent2aData) {
      console.warn(`⚠️  Missing Agent 2A data for decision ${row.decision_id} (${row.language_metadata}), skipping`);
      // Return empty structure
      return {
        citedProvisions: [],
        extractedReferences: {
          url: { eu: [], be: [] },
          reference: {
            eu: { extracted: [], verified: [] },
            be: { extracted: [], verifiedNumac: [], verifiedFileNumber: [] }
          }
        }
      };
    }

    const citedProvisions = agent2aData.citedProvisions || [];

    // Step 2: Run regex extractor (no LLM call)
    const extractor = new ReferenceExtractorN8N();
    const extractedReferences = extractor.processDecision(
      row.decision_id || '',
      row.full_md || ''
    );

    // Step 3: Merge and return
    return {
      citedProvisions,           // Pass through from Agent 2A (unchanged)
      extractedReferences        // New enrichment data from regex
    };
  },

  /**
   * Output JSON Schema
   *
   * Combines Agent 2A provisions array with regex-extracted reference metadata.
   *
   * Structure:
   * - citedProvisions: Array from Agent 2A (provisions with all 2A fields)
   * - extractedReferences: Hints structure from regex extractor
   *
   * Both arrays can be empty (some decisions cite no provisions,
   * some decisions contain no extractable references).
   */
  outputSchema: {
    type: "object",
    required: ["citedProvisions", "extractedReferences"],
    additionalProperties: false,
    properties: {
      // ========================================
      // FROM AGENT 2A: Cited Provisions
      // ========================================
      citedProvisions: {
        type: "array",
        description: "Provisions array from Agent 2A (unchanged)",
        items: {
          type: "object",
          required: [
            "provisionId",
            "parentActId",
            "provisionSequence",
            "parentActSequence",
            "internalProvisionId",
            "internalParentActId",
            "provisionNumber",
            "provisionNumberKey",
            "parentActType",
            "parentActName",
            "parentActDate",
            "parentActNumber"
          ],
          additionalProperties: false,
          properties: {
            provisionId: { type: "null" },
            parentActId: { type: "null" },
            provisionSequence: {
              type: "integer",
              minimum: 1,
              maximum: 9999,
              description: "Sequential provision number from Agent 2A"
            },
            parentActSequence: {
              type: "integer",
              minimum: 1,
              maximum: 999,
              description: "Parent act sequence from Agent 2A"
            },
            internalProvisionId: {
              type: "string",
              pattern: "^ART-[a-zA-Z0-9:.]+-\\d{3}$"
            },
            internalParentActId: {
              type: "string",
              pattern: "^ACT-[a-zA-Z0-9:.]+-\\d{3}$"
            },
            provisionNumber: {
              type: "string",
              minLength: 3,
              maxLength: 500
            },
            provisionNumberKey: {
              type: "string",
              minLength: 1,
              maxLength: 50
            },
            parentActType: {
              type: "string",
              enum: [
                "LOI", "ARRETE_ROYAL", "CODE", "CONSTITUTION",
                "REGLEMENT_UE", "DIRECTIVE_UE", "TRAITE",
                "ARRETE_GOUVERNEMENT", "ORDONNANCE", "DECRET", "AUTRE",
                "WET", "KONINKLIJK_BESLUIT", "WETBOEK", "GRONDWET",
                "EU_VERORDENING", "EU_RICHTLIJN", "VERDRAG",
                "BESLUIT_VAN_DE_REGERING", "ORDONNANTIE", "DECREET", "ANDERE"
              ]
            },
            parentActName: {
              type: "string",
              minLength: 5,
              maxLength: 500
            },
            parentActDate: {
              anyOf: [
                { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                { type: "null" }
              ]
            },
            parentActNumber: {
              anyOf: [
                { type: "string", minLength: 1, maxLength: 100 },
                { type: "null" }
              ]
            }
          }
        }
      },

      // ========================================
      // FROM REGEX EXTRACTOR: Reference Metadata
      // ========================================
      extractedReferences: {
        type: "object",
        required: ["url", "reference"],
        additionalProperties: false,
        description: "Regex-extracted legal reference metadata",
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
    }
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "provision_enrichment_regex",

  /**
   * Provider and Model Configuration
   *
   * NOTE: No LLM is used in this job (regex-only).
   * These settings are required by JobConfig type but unused.
   */
  provider: "openai",
  model: "gpt-5-mini",
  maxCompletionTokens: 16000,
  reasoningEffort: "low",
  verbosity: "low",

  /**
   * Concurrency Configuration
   *
   * High concurrency possible since no LLM calls (no rate limits).
   */
  concurrencyLimit: 500,

  /**
   * Full-Data Pipeline Mode
   *
   * Enabled for full dataset processing.
   * Writes per-decision JSONs to full-data/enrich-provisions/<timestamp>/jsons/
   */
  useFullDataPipeline: true,

  /**
   * Custom ID prefix
   */
  customIdPrefix: "enrich-provisions-regex",
};

export default config;
