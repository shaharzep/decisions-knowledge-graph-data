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
 * - Loads citedProvisions array with 12 fields from Agent 2A (passed through 2B)
 * - Note: 2B adds extractedReferences separately, but NOT merged into provisions
 *
 * ARCHITECTURE: Sequence-based matching (eliminates ID corruption)
 * - LLM outputs only: provisionSequence + 2 interpretative fields
 * - postProcessRow matches by sequence, copies all immutable fields from input
 * - IDs (internalProvisionId, internalParentActId) are NEVER touched by LLM
 *
 * Key Features:
 * - Manual 2B data loading from full-data directory
 * - Composite key matching (decision_id + language)
 * - Sequence-based provision matching in postProcessRow
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
    "md_length",
    "agent2b"  // Contains citedProvisions for postProcessRow matching
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
   * Post-Processing: Match by sequence, copy IDs from input
   *
   * The LLM outputs only provisionSequence + interpretative fields.
   * This function matches by sequence and copies all immutable fields
   * (IDs, provision details) from input to ensure ID integrity.
   *
   * This eliminates ID corruption because the LLM never touches
   * complex strings like internalProvisionId/internalParentActId.
   */
  postProcessRow: (row, result) => {
    const inputProvisions: any[] = row.agent2b?.citedProvisions || [];
    const llmProvisions: any[] = result.citedProvisions || [];

    // Build lookup map from input provisions (keyed by provisionSequence)
    const inputBySequence = new Map<number, any>();
    for (const prov of inputProvisions) {
      if (typeof prov.provisionSequence === 'number') {
        inputBySequence.set(prov.provisionSequence, prov);
      }
    }

    // Match LLM output by sequence, copy immutable fields from input
    const mergedProvisions = llmProvisions.map((llmProv: any) => {
      const seq = llmProv.provisionSequence;
      const inputProv = inputBySequence.get(seq);

      if (!inputProv) {
        throw new Error(
          `No input provision found for provisionSequence ${seq}. ` +
          `Available sequences: [${Array.from(inputBySequence.keys()).join(', ')}]`
        );
      }

      // Copy all immutable fields from input, keep only interpretative fields from LLM
      return {
        // From input (never touched by LLM)
        provisionId: inputProv.provisionId,
        parentActId: inputProv.parentActId,
        internalProvisionId: inputProv.internalProvisionId,
        internalParentActId: inputProv.internalParentActId,
        provisionSequence: inputProv.provisionSequence,
        parentActSequence: inputProv.parentActSequence,
        provisionNumber: inputProv.provisionNumber,
        provisionNumberKey: inputProv.provisionNumberKey,
        parentActType: inputProv.parentActType,
        parentActName: inputProv.parentActName,
        parentActDate: inputProv.parentActDate,
        parentActNumber: inputProv.parentActNumber,
        // From LLM (interpretative enrichment)
        provisionInterpretation: llmProv.provisionInterpretation,
        relevantFactualContext: llmProv.relevantFactualContext,
      };
    });

    // Get extractedReferences from Agent 2B dependency
    const extractedReferences = row.agent2b?.extractedReferences || {
      url: { eu: [], be: [] },
      reference: {
        eu: { extracted: [], verified: [] },
        be: { extracted: [], verifiedNumac: [], verifiedFileNumber: [] }
      }
    };

    return {
      citedProvisions: mergedProvisions,
      extractedReferences: extractedReferences
    };
  },

  /**
   * Output JSON Schema (LLM Output Only)
   *
   * CRITICAL: This schema defines what the LLM outputs, NOT the final output.
   * The final output is constructed in postProcessRow by merging:
   * - Immutable fields from input (IDs, provision details)
   * - Interpretative fields from LLM (this schema)
   *
   * LLM outputs only 3 fields per provision:
   * - provisionSequence: Matching key to link to input provision
   * - provisionInterpretation: Court's interpretation (100-1000 chars or null)
   * - relevantFactualContext: Factual context (50-500 chars or null)
   *
   * This design eliminates ID corruption by never asking the LLM to
   * echo back complex strings like internalProvisionId/internalParentActId.
   */
  outputSchema: {
    type: "object",
    required: ["citedProvisions"],
    additionalProperties: false,
    properties: {
      citedProvisions: {
        type: "array",
        minItems: 0,
        items: {
          type: "object",
          required: [
            "provisionSequence",
            "provisionInterpretation",
            "relevantFactualContext",
          ],
          additionalProperties: false,
          properties: {
            // ========================================
            // MATCHING KEY (links to input provision)
            // ========================================
            provisionSequence: {
              type: "integer",
              minimum: 1,
              maximum: 9999,
              description: "MATCHING KEY: Must match provisionSequence from input. Used to link interpretative fields to the correct provision.",
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
                },
                {
                  type: "null",
                },
              ],
              description: "Court's interpretation of provision (100-1000 chars, procedural language) or null if not applicable",
            },

            relevantFactualContext: {
              anyOf: [
                {
                  type: "string",
                  minLength: 50,
                  maxLength: 500,
                },
                {
                  type: "null",
                },
              ],
              description: "Factual context for provision's application (50-500 chars, procedural language) or null if not applicable",
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
