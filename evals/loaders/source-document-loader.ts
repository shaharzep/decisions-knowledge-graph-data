/**
 * Source Document Loader
 *
 * Loads original markdown documents from PostgreSQL database
 * Uses composite key (decision_id + language) for accurate matching
 */

import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import { DatabaseConfig } from '../../src/config/database.js';
import { generateBlocksFromMarkdown } from '../../src/utils/markdownToHtml.js';
import { RFTCSourceData } from '../types.js';

/**
 * Composite key for uniquely identifying a decision document
 */
export interface DecisionKey {
  decisionId: string;
  language: string;
}

/**
 * Source document with metadata
 */
export interface SourceDocumentWithMetadata {
  fullMd: string;
  url?: string;
}

/**
 * Cache for source documents to avoid repeated database queries
 * Key format: "decisionId|language"
 */
const documentCache = new Map<string, SourceDocumentWithMetadata>();

/**
 * Generate cache key from decision_id and language
 */
function getCacheKey(decisionId: string, language: string): string {
  return `${decisionId}|${language}`;
}

/**
 * Load source document for a single decision with language
 *
 * @param decisionId - ECLI identifier (e.g., "ECLI:BE:CASS:2023:ARR.20230315")
 * @param language - Procedural language ("FR" or "NL")
 * @returns Original full markdown text
 */
export async function loadSourceDocument(
  decisionId: string,
  language: string
): Promise<string> {
  const cacheKey = getCacheKey(decisionId, language);

  // Check cache first
  if (documentCache.has(cacheKey)) {
    return documentCache.get(cacheKey)!;
  }

  const query = `
    SELECT dm.full_md
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    WHERE d.decision_id = $1
      AND d.language_metadata = $2
      AND dm.full_md IS NOT NULL
      AND dm.full_md != ''
    LIMIT 1
  `;

  try {
    const rows: any = await DatabaseConfig.executeReadOnlyQuery(query, [
      decisionId,
      language,
    ]);

    if (!rows || rows.length === 0) {
      throw new Error(
        `Source document not found for decision: ${decisionId} (${language})`
      );
    }

    const fullMd = rows[0].full_md;

    if (!fullMd || fullMd.trim() === '') {
      throw new Error(
        `Source document is empty for decision: ${decisionId} (${language})`
      );
    }

    // Cache the result
    documentCache.set(cacheKey, fullMd);

    return fullMd;
  } catch (error: any) {
    throw new Error(
      `Failed to load source document for ${decisionId} (${language}): ${error.message}`
    );
  }
}

/**
 * Batch load source documents for multiple decisions
 *
 * More efficient than loading one by one
 * Uses composite keys (decision_id + language) for accurate matching
 *
 * @param decisions - Array of decision keys with decisionId and language
 * @returns Map of "decisionId|language" -> document with metadata
 */
export async function batchLoadSourceDocuments(
  decisions: DecisionKey[]
): Promise<Map<string, SourceDocumentWithMetadata>> {
  // Filter out already cached documents
  const uncachedDecisions = decisions.filter(
    (d) => !documentCache.has(getCacheKey(d.decisionId, d.language))
  );

  if (uncachedDecisions.length === 0) {
    // All documents are cached
    const result = new Map<string, SourceDocumentWithMetadata>();
    for (const d of decisions) {
      const cacheKey = getCacheKey(d.decisionId, d.language);
      result.set(cacheKey, documentCache.get(cacheKey)!);
    }
    return result;
  }

  // Build arrays for query
  const decisionIds = uncachedDecisions.map((d) => d.decisionId);
  const languages = uncachedDecisions.map((d) => d.language);

  // Query for uncached documents
  // Use a more complex query to match decision_id AND language pairs
  const query = `
    SELECT
      d.decision_id,
      d.language_metadata,
      d.url_official_publication,
      dm.full_md
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    WHERE d.decision_id = ANY($1)
      AND d.language_metadata = ANY($2)
      AND dm.full_md IS NOT NULL
      AND dm.full_md != ''
  `;

  try {
    const rows: any = await DatabaseConfig.executeReadOnlyQuery(query, [
      decisionIds,
      languages,
    ]);

    // Build result map and update cache
    const documents = new Map<string, SourceDocumentWithMetadata>();

    for (const row of rows) {
      const decisionId = row.decision_id;
      const language = row.language_metadata;
      const fullMd = row.full_md;
      const url = row.url_official_publication;

      const docWithMetadata: SourceDocumentWithMetadata = {
        fullMd,
        url: url || undefined,
      };

      const cacheKey = getCacheKey(decisionId, language);
      documents.set(cacheKey, docWithMetadata);
      documentCache.set(cacheKey, docWithMetadata);
    }

    // Add cached documents to result
    for (const d of decisions) {
      const cacheKey = getCacheKey(d.decisionId, d.language);
      if (documentCache.has(cacheKey) && !documents.has(cacheKey)) {
        documents.set(cacheKey, documentCache.get(cacheKey)!);
      }
    }

    // Check if any documents are missing
    const missingDecisions = decisions.filter(
      (d) => !documents.has(getCacheKey(d.decisionId, d.language))
    );
    if (missingDecisions.length > 0) {
      console.warn(
        `Warning: ${missingDecisions.length} source documents not found:`,
        missingDecisions.slice(0, 5).map((d) => `${d.decisionId} (${d.language})`)
      );
    }

    return documents;
  } catch (error: any) {
    throw new Error(`Failed to batch load source documents: ${error.message}`);
  }
}

/**
 * Manually cache source documents (useful for pre-loading)
 *
 * @param documents - Map of decisionId -> markdown text
 */
export function cacheSourceDocuments(documents: Map<string, string>): void {
  for (const [id, doc] of documents) {
    documentCache.set(id, doc);
  }
}

/**
 * Clear document cache
 */
export function clearDocumentCache(): void {
  documentCache.clear();
}

/**
 * Get cache statistics
 */
export function getCacheStats(): {
  size: number;
  entries: string[];
} {
  return {
    size: documentCache.size,
    entries: Array.from(documentCache.keys()),
  };
}

/**
 * Cache for RFTC source documents
 * Key format: "decisionId|language"
 */
const rftcDocumentCache = new Map<string, RFTCSourceData>();

/**
 * Load source document for RFTC evaluation
 *
 * Generates blocks from markdown (load → pandoc → transform) + dependencies.
 * Used for evaluating block-based citation jobs.
 *
 * @param decisionId - ECLI identifier
 * @param language - Procedural language (FR or NL)
 * @param jobType - RFTC job type ('enrich-teaching-citations' or 'enrich-provision-citations')
 * @returns Blocks + dependencies
 */
export async function loadSourceDocumentForRFTC(
  decisionId: string,
  language: string,
  jobType: string
): Promise<RFTCSourceData> {
  const cacheKey = getCacheKey(decisionId, language);

  // Check cache first
  if (rftcDocumentCache.has(cacheKey)) {
    return rftcDocumentCache.get(cacheKey)!;
  }

  // 1. Get URL for metadata (optional)
  const urlQuery = `
    SELECT d.url_official_publication
    FROM decisions1 d
    WHERE d.decision_id = $1 AND d.language_metadata = $2
    LIMIT 1
  `;

  const rows: any = await DatabaseConfig.executeReadOnlyQuery(urlQuery, [
    decisionId,
    language,
  ]);

  const url_official_publication = rows?.[0]?.url_official_publication;

  // 2. Generate blocks from markdown (load markdown → convert to HTML → transform to blocks)
  const { blocks } = await generateBlocksFromMarkdown(
    decisionId,
    language
  );

  // 3. Load dependencies
  const dependencies = await loadDependenciesForRFTC(
    decisionId,
    language,
    jobType
  );

  const result: RFTCSourceData = {
    transformedHtml: '',  // No longer needed by eval prompts (using blocks only)
    blocks,
    dependencies,
    url: url_official_publication || undefined,
  };

  // Cache the result
  rftcDocumentCache.set(cacheKey, result);

  return result;
}

/**
 * Load dependencies for RFTC evaluation
 *
 * @param decisionId - ECLI identifier
 * @param language - Procedural language
 * @param jobType - RFTC job type
 * @returns Dependency data
 */
async function loadDependenciesForRFTC(
  decisionId: string,
  language: string,
  jobType: string
): Promise<{
  legalTeachingsInput: any[];
  citedProvisions: any[];
  citedDecisions: any[];
}> {
  const baseDir = 'concurrent/results';

  // Dependency mapping per job type
  const depJobs: Record<
    string,
    { input: string; provisions: string; decisions: string; teachings?: string }
  > = {
    'enrich-teaching-citations': {
      input: 'extract-legal-teachings', // Agent 5A
      provisions: 'interpret-provisions', // Agent 2C
      decisions: 'extract-cited-decisions', // Agent 3
    },
    'enrich-provision-citations': {
      input: 'interpret-provisions', // Agent 2C (provisions to enrich)
      teachings: 'extract-legal-teachings', // Agent 5A (for cross-reference)
      provisions: 'interpret-provisions', // Agent 2C (for cross-refs)
      decisions: 'extract-cited-decisions', // Agent 3
    },
  };

  const deps = depJobs[jobType];
  if (!deps) {
    throw new Error(
      `Unknown RFTC job type: ${jobType}. Expected: enrich-teaching-citations or enrich-provision-citations`
    );
  }

  // Load each dependency
  const [inputResult, provisionsResult, decisionsResult, teachingsResult] = await Promise.all([
    loadLatestJobResult(baseDir, deps.input, decisionId, language),
    loadLatestJobResult(baseDir, deps.provisions, decisionId, language),
    loadLatestJobResult(baseDir, deps.decisions, decisionId, language),
    deps.teachings ? loadLatestJobResult(baseDir, deps.teachings, decisionId, language) : Promise.resolve(null),
  ]);

  // For teaching citations: inputResult has legalTeachings
  // For provision citations: inputResult has citedProvisions, teachingsResult has legalTeachings
  const legalTeachings = inputResult?.legalTeachings || teachingsResult?.legalTeachings || [];
  const citedProvisionsData = inputResult?.citedProvisions || provisionsResult?.citedProvisions || [];

  return {
    legalTeachingsInput: legalTeachings,
    citedProvisions: citedProvisionsData,
    citedDecisions: decisionsResult?.citedDecisions || [],
  };
}

/**
 * Load latest result for a specific job + decision
 *
 * @param baseDir - Base directory (e.g., 'concurrent/results')
 * @param jobId - Job ID (e.g., 'extract-legal-teachings')
 * @param decisionId - ECLI identifier
 * @param language - Procedural language
 * @returns Extraction result or null if not found
 */
async function loadLatestJobResult(
  baseDir: string,
  jobId: string,
  decisionId: string,
  language: string
): Promise<any | null> {
  const jobDir = path.join(process.cwd(), baseDir, jobId);

  try {
    // Step 1: Find model subdirectories (e.g., gpt-5-mini)
    const modelDirs = await fs.readdir(jobDir);
    const validModelDirs = [];

    for (const modelDir of modelDirs) {
      if (modelDir.startsWith('.')) continue; // Skip hidden files like .DS_Store
      const modelPath = path.join(jobDir, modelDir);
      const stat = await fs.stat(modelPath);
      if (stat.isDirectory()) {
        validModelDirs.push({ name: modelDir, path: modelPath });
      }
    }

    if (validModelDirs.length === 0) {
      console.warn(`⚠️  No model directories found for ${jobId}`);
      return null;
    }

    // Step 2: For each model directory, find the latest timestamp directory
    // Use the most recent one across all models
    let latestTimestamp: string | null = null;
    let latestDir: string | null = null;

    for (const modelDir of validModelDirs) {
      const timestampDirs = await fs.readdir(modelDir.path);
      // Match ISO 8601 format: 2025-11-11T00-47-37-685Z
      const validTimestamps = timestampDirs.filter((d) =>
        /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(d)
      );

      for (const ts of validTimestamps) {
        if (!latestTimestamp || ts > latestTimestamp) {
          latestTimestamp = ts;
          latestDir = path.join(modelDir.path, ts);
        }
      }
    }

    if (!latestDir || !latestTimestamp) {
      console.warn(`⚠️  No timestamp directories found for ${jobId}`);
      return null;
    }

    // Step 3: Read extracted-data.json (or fall back to other JSON files)
    const preferredFile = path.join(latestDir, 'extracted-data.json');
    let data: any[] | null = null;

    try {
      const content = await fs.readFile(preferredFile, 'utf-8');
      data = JSON.parse(content);
    } catch (error: any) {
      // Fall back to searching all JSON files
      const files = await fs.readdir(latestDir);
      const jsonFiles = files.filter(
        (f) => f.endsWith('.json') && f !== 'summary.json'
      );

      for (const file of jsonFiles) {
        const filePath = path.join(latestDir, file);
        const content = await fs.readFile(filePath, 'utf-8');
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          data = parsed;
          break;
        }
      }
    }

    if (!data || !Array.isArray(data)) {
      console.warn(`⚠️  No valid JSON data found for ${jobId}`);
      return null;
    }

    // Step 4: Find matching record by composite key
    const match = data.find(
      (record: any) =>
        record.decision_id === decisionId &&
        (record.language === language || record.language_metadata === language)
    );

    return match || null;
  } catch (error: any) {
    console.warn(
      `⚠️  Error loading ${jobId} result for ${decisionId}: ${error.message}`
    );
    return null;
  }
}

/**
 * Batch load RFTC data for multiple decisions
 *
 * @param decisionKeys - Array of decision keys
 * @param jobType - RFTC job type
 * @returns Map of decision data keyed by "decisionId|language"
 */
export async function batchLoadRFTCData(
  decisionKeys: DecisionKey[],
  jobType: string
): Promise<Map<string, RFTCSourceData>> {
  const results = new Map<string, RFTCSourceData>();

  // Load in parallel (with some concurrency limit to avoid overwhelming DB)
  const limit = pLimit(10);

  await Promise.all(
    decisionKeys.map((key) =>
      limit(async () => {
        try {
          const data = await loadSourceDocumentForRFTC(
            key.decisionId,
            key.language,
            jobType
          );
          const cacheKey = getCacheKey(key.decisionId, key.language);
          results.set(cacheKey, data);
        } catch (error: any) {
          console.warn(
            `⚠️  Failed to load RFTC data for ${key.decisionId} (${key.language}): ${error.message}`
          );
        }
      })
    )
  );

  return results;
}

/**
 * Clear RFTC document cache
 */
export function clearRFTCCache(): void {
  rftcDocumentCache.clear();
}

/**
 * Get RFTC cache statistics
 */
export function getRFTCCacheStats(): {
  size: number;
  entries: string[];
} {
  return {
    size: rftcDocumentCache.size,
    entries: Array.from(rftcDocumentCache.keys()),
  };
}
