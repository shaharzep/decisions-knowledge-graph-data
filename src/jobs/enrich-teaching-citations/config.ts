import { JobConfig } from "../JobConfig.js";
import { ENRICH_TEACHING_CITATIONS_PROMPT } from "./prompt.js";
import { enrichTeachingCitationsSchema, SCHEMA_NAME } from "./schema.js";

import { extractBlocksFromTransformedHtml } from "../../utils/htmlTransformer.js";
import { DatabaseConfig } from "../../config/database.js";
import fs from "fs";
import path from "path";

/**
 * Enrich Teaching Citations Job Configuration - Agent 5B (Stage 2) - FULL-DATA PIPELINE
 *
 * Enriches legal teachings from Agent 5A with block-based citations for UI highlighting.
 * Validates that provisions and decisions mentioned in teachings actually appear in citations.
 * Runs over entire dataset (~63K decisions) using full-data pipeline.
 *
 * ARCHITECTURE:
 * - Loads pre-transformed HTML from decision_fulltext1.full_html (already has data-id attributes)
 * - Extracts blocks array from existing data-id attributes (no pandoc conversion needed)
 * - Returns block IDs + snippets for UI highlighting
 * - Validates relationship claims through provision/decision lookup
 * - Manual dependency loading from three full-data sources
 *
 * DEPENDENCIES (all required):
 * - extract-legal-teachings (Agent 5A): Source of teachings to enrich
 * - interpret-provisions (Agent 2C): For relationship validation
 * - extract-cited-decisions (Agent 3): For relationship validation
 *
 * EXECUTION MODE: Full-data pipeline on all decisions with all three dependencies
 */

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

// Auto-detect latest runs for all three dependencies at module load time
const LATEST_5A_TIMESTAMP_RAW = getLatestFullDataTimestamp('extract-legal-teachings');
const LATEST_2C_TIMESTAMP_RAW = getLatestFullDataTimestamp('interpret-provisions');
const LATEST_3_TIMESTAMP_RAW = getLatestFullDataTimestamp('extract-cited-decisions');

if (!LATEST_5A_TIMESTAMP_RAW) {
  throw new Error('No extract-legal-teachings full-data results found. Please run Agent 5A first with full-data pipeline:\n  npm run dev concurrent extract-legal-teachings');
}

if (!LATEST_2C_TIMESTAMP_RAW) {
  throw new Error('No interpret-provisions full-data results found. Please run Agent 2C first with full-data pipeline:\n  npm run dev concurrent interpret-provisions');
}

if (!LATEST_3_TIMESTAMP_RAW) {
  throw new Error('No extract-cited-decisions full-data results found. Please run Agent 3 first with full-data pipeline:\n  npm run dev concurrent extract-cited-decisions');
}

const LATEST_5A_TIMESTAMP: string = LATEST_5A_TIMESTAMP_RAW;
const LATEST_2C_TIMESTAMP: string = LATEST_2C_TIMESTAMP_RAW;
const LATEST_3_TIMESTAMP: string = LATEST_3_TIMESTAMP_RAW;

const SUCCESSFUL_5A_PAIRS = loadSuccessfulDecisions('extract-legal-teachings', LATEST_5A_TIMESTAMP);
const SUCCESSFUL_2C_PAIRS = loadSuccessfulDecisions('interpret-provisions', LATEST_2C_TIMESTAMP);
const SUCCESSFUL_3_PAIRS = loadSuccessfulDecisions('extract-cited-decisions', LATEST_3_TIMESTAMP);

console.log(`📋 Using extract-legal-teachings results from: ${LATEST_5A_TIMESTAMP}`);
console.log(`✅ Found ${SUCCESSFUL_5A_PAIRS.length} successful 5A decisions`);
console.log(`📋 Using interpret-provisions results from: ${LATEST_2C_TIMESTAMP}`);
console.log(`✅ Found ${SUCCESSFUL_2C_PAIRS.length} successful 2C decisions`);
console.log(`📋 Using extract-cited-decisions results from: ${LATEST_3_TIMESTAMP}`);
console.log(`✅ Found ${SUCCESSFUL_3_PAIRS.length} successful 3 decisions`);

const FILEPATH_MAP_5A = buildFilepathMap('extract-legal-teachings', LATEST_5A_TIMESTAMP);
const FILEPATH_MAP_2C = buildFilepathMap('interpret-provisions', LATEST_2C_TIMESTAMP);
const FILEPATH_MAP_3 = buildFilepathMap('extract-cited-decisions', LATEST_3_TIMESTAMP);

/**
 * Build three-way intersection of decisions that have ALL dependencies
 *
 * Only these decisions can be processed by Agent 5B.
 * Requires: Agent 5A (teachings) AND Agent 2C (provisions) AND Agent 3 (decisions)
 */
function buildProcessableDecisions(): Array<{ decision_id: string; language: string }> {
  const set5A = new Set(SUCCESSFUL_5A_PAIRS.map(p => `${p.decision_id}||${p.language}`));
  const set2C = new Set(SUCCESSFUL_2C_PAIRS.map(p => `${p.decision_id}||${p.language}`));

  // Filter Agent 3 results to those that also exist in both 5A and 2C
  const processable = SUCCESSFUL_3_PAIRS.filter(p => {
    const key = `${p.decision_id}||${p.language}`;
    return set5A.has(key) && set2C.has(key);
  });

  console.log(`\n🔗 Three-way intersection: ${processable.length} decisions have 5A + 2C + 3 results`);
  console.log(`   (${SUCCESSFUL_5A_PAIRS.length} with 5A, ${SUCCESSFUL_2C_PAIRS.length} with 2C, ${SUCCESSFUL_3_PAIRS.length} with 3, ${processable.length} with all three)\n`);

  return processable;
}

const PROCESSABLE_DECISIONS = buildProcessableDecisions();

const config: JobConfig = {
  id: "enrich-teaching-citations",

  description:
    "Enrich legal teachings with block-based citations and validate relationships (Agent 5B - Full-data pipeline with 5A+2C+3 dependencies)",

  /**
   * Dependencies
   *
   * Empty array - we manually load all three dependencies from full-data in preprocessRow.
   * DependencyResolver only supports concurrent/results, not full-data.
   */
  dependencies: [],

  /**
   * Database Query
   *
   * Loads ALL decisions that have Agent 5A + 2C + 3 results.
   * Uses composite key matching (decision_id + language) from full-data three-way intersection.
   *
   * CRITICAL: decision_fulltext1.decision_id is FK to decisions1.id (not decision_id!)
   */
  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      LENGTH(df.full_html) as html_length
    FROM decisions1 d
    INNER JOIN decision_fulltext1 df
      ON df.decision_id = d.id
    INNER JOIN unnest($1::text[], $2::text[]) AS processable(decision_id, language)
      ON d.decision_id = processable.decision_id
      AND d.language_metadata = processable.language
    WHERE df.full_html IS NOT NULL
      AND df.full_html != ''
    ORDER BY d.decision_id, d.language_metadata
  `,

  /**
   * Database Query Parameters
   *
   * Loads only decisions that exist in ALL THREE full-data results (5A ∩ 2C ∩ 3).
   */
  dbQueryParams: [
    PROCESSABLE_DECISIONS.map(p => p.decision_id),
    PROCESSABLE_DECISIONS.map(p => p.language)
  ],

  /**
   * Preprocess Row
   *
   * Manually loads all three dependencies from full-data directories.
   * Extracts blocks from pre-transformed HTML (no pandoc conversion needed).
   * Returns null if ANY dependency is missing (ConcurrentRunner will skip).
   */
  preprocessRow: async (row: any) => {
    // Load all three dependencies
    const agent5aData = loadDependencyData(
      FILEPATH_MAP_5A,
      row.decision_id,
      row.language_metadata
    );

    const agent2cData = loadDependencyData(
      FILEPATH_MAP_2C,
      row.decision_id,
      row.language_metadata
    );

    const agent3Data = loadDependencyData(
      FILEPATH_MAP_3,
      row.decision_id,
      row.language_metadata
    );

    // Skip if ANY dependency is missing
    if (!agent5aData || !agent2cData || !agent3Data) {
      const missing = [];
      if (!agent5aData) missing.push('5A');
      if (!agent2cData) missing.push('2C');
      if (!agent3Data) missing.push('3');
      console.warn(`⚠️  Missing dependencies for decision ${row.decision_id} (${row.language_metadata}): ${missing.join(', ')}, skipping`);
      return null;
    }

    // Lazy load full_html for this specific decision
    // This prevents loading 64k HTML strings into memory at once
    const htmlResult = await DatabaseConfig.executeReadOnlyQuery(
      'SELECT full_html FROM decision_fulltext1 WHERE decision_id = $1',
      [row.id]
    );

    if (!htmlResult || htmlResult.length === 0 || !htmlResult[0].full_html) {
      console.warn(`⚠️  Could not load HTML for decision ${row.decision_id} (${row.language_metadata}), skipping`);
      return null;
    }

    const fullHtml = htmlResult[0].full_html;

    // Extract blocks from pre-transformed HTML
    const blocks = extractBlocksFromTransformedHtml(fullHtml);

    if (blocks.length === 0) {
      console.warn(`⚠️  No blocks found in HTML for decision ${row.decision_id} (${row.language_metadata}), skipping`);
      return null;
    }

    // Attach all three dependencies and blocks to row
    return {
      ...row,
      agent5a: {
        legalTeachings: agent5aData.legalTeachings || []
      },
      agent2c: {
        citedProvisions: agent2cData.citedProvisions || []
      },
      agent3: {
        citedDecisions: agent3Data.citedDecisions || []
      },
      blocks: blocks,
      blocks_json: JSON.stringify(blocks, null, 2)
    };
  },

  /**
   * Row Metadata Fields
   *
   * Track essential metadata for analysis and debugging.
   */
  rowMetadataFields: [
    "id",
    "decision_id",
    "language_metadata",
    "html_length"
  ],

  /**
   * Prompt Template - BLOCK-BASED WITH RELATIONSHIP VALIDATION
   *
   * Injects 6 variables into prompt template:
   * 1. {decisionId} - ECLI identifier
   * 2. {proceduralLanguage} - FR or NL
   * 3. {blocks} - JSON array of blocks (blockId, plainText, elementType, charCount)
   * 4. {legalTeachings} - JSON array from Agent 5A (teachings to enrich)
   * 5. {citedProvisions} - JSON array from Agent 2C (for relationship validation)
   * 6. {citedDecisions} - JSON array from Agent 3 (for relationship validation)
   *
   * The prompt will:
   * - Extract block citations for each teaching
   * - Validate that provisions in teaching.relatedCitedProvisionsId appear in citations
   * - Validate that decisions in teaching.relatedCitedDecisionsId appear in citations
   * - Report validation results in relationshipValidation object
   */
  promptTemplate: (row) => {
    return ENRICH_TEACHING_CITATIONS_PROMPT
      .replace("{decisionId}", row.decision_id || "")
      .replace("{proceduralLanguage}", row.language_metadata || "FR")
      .replace("{blocks}", row.blocks_json || "[]")
      .replace("{legalTeachings}", JSON.stringify(row.agent5a?.legalTeachings || [], null, 2))
      .replace("{citedProvisions}", JSON.stringify(row.agent2c?.citedProvisions || [], null, 2))
      .replace("{citedDecisions}", JSON.stringify(row.agent3?.citedDecisions || [], null, 2));
  },

  /**
   * Output JSON Schema - BLOCK-BASED WITH RELATIONSHIP VALIDATION
   *
   * Validates:
   * - legalTeachings: Array with teachingId, citations (blockId + snippet), relationshipValidation
   * - metadata: Statistics about block citations and validation results
   */
  outputSchema: enrichTeachingCitationsSchema,

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: SCHEMA_NAME,

  /**
   * Provider and Model Configuration
   *
   * Using gpt-5-mini with MEDIUM reasoning effort for:
   * - Block-based citation extraction
   * - Provision/decision relationship validation
   * - Semantic matching of legal concepts
   */
  provider: "openai",
  openaiProvider: "azure",
  model: "gpt-5-mini",
  maxCompletionTokens: 64000,
  reasoningEffort: "medium",
  verbosity: "low",

  /**
   * Concurrency Configuration
   *
   * Conservative concurrency for full dataset extraction.
   * Matches extract-legal-teachings approach.
   */
  concurrencyLimit: 200,

  /**
   * Full-Data Pipeline Mode
   *
   * Enabled for full dataset processing.
   * Writes per-decision JSONs to full-data/enrich-teaching-citations/<timestamp>/jsons/
   * Required for large datasets and future retry operations.
   */
  useFullDataPipeline: true,

  /**
   * Custom ID prefix
   */
  customIdPrefix: "enrich-citations",
};

export default config;
