/**
 * Source Document Loader
 *
 * Loads original markdown documents from PostgreSQL database
 * Uses composite key (decision_id + language) for accurate matching
 */

import { DatabaseConfig } from '../../src/config/database.js';

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
