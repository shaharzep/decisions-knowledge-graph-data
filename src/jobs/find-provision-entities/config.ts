import { JobConfig } from '../JobConfig.js';
import { DatabaseConfig } from '../../config/database.js';

/**
 * Find Provision Entities Job Configuration
 *
 * Looks up provision entities in article_contents table by matching:
 * - decision_cited_provisions.parent_act_number → article_contents.document_number
 * - decision_cited_provisions.provision_number_key → article_contents.article_number
 *
 * OPTIMIZATION: Loads all article_contents into memory once (~1.1M rows, ~100MB)
 * then performs O(1) Map lookups instead of individual DB queries.
 *
 * This job does NOT use an LLM - it performs pure in-memory lookups.
 * All processing happens in preprocessRow with _skipLLM: true.
 *
 * Future: Add LLM processing for unmatched provisions (fuzzy matching).
 *
 * Input: decision_cited_provisions rows where parent_act_number and score are non-null
 * Output: JSON per internal_provision_id with article_contents match status
 */

// =============================================================================
// IN-MEMORY ARTICLE CONTENTS CACHE
// =============================================================================

interface ArticleEntry {
  id: number;
  document_number: string;
  article_number: string;
}

// Cache: Map<"document_number|article_number", ArticleEntry>
let articleCache: Map<string, ArticleEntry> | null = null;
let cacheLoadPromise: Promise<void> | null = null;

/**
 * Build cache key from document_number and article_number
 */
function buildCacheKey(documentNumber: string, articleNumber: string): string {
  return `${documentNumber}|${articleNumber}`;
}

/**
 * Load all article_contents into memory cache
 * Called once on first preprocessRow, then reused for all subsequent lookups
 */
async function loadArticleCache(): Promise<void> {
  if (articleCache !== null) return;

  // Prevent multiple concurrent loads
  if (cacheLoadPromise) {
    await cacheLoadPromise;
    return;
  }

  cacheLoadPromise = (async () => {
    console.log('📚 Loading article_contents into memory cache...');
    const startTime = Date.now();

    const query = `
      SELECT id, document_number, article_number
      FROM article_contents
    `;

    const rows = await DatabaseConfig.executeReadOnlyQuery<ArticleEntry>(query);

    articleCache = new Map();
    for (const row of rows) {
      const key = buildCacheKey(row.document_number, row.article_number);
      articleCache.set(key, row);
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`✅ Loaded ${articleCache.size.toLocaleString()} articles into cache (${elapsed}s)`);
  })();

  await cacheLoadPromise;
}

/**
 * Lookup article in cache (O(1))
 */
function lookupArticle(documentNumber: string, articleNumber: string): ArticleEntry | null {
  if (!articleCache) return null;
  const key = buildCacheKey(documentNumber, articleNumber);
  return articleCache.get(key) || null;
}

// =============================================================================
// JOB CONFIG
// =============================================================================

const config: JobConfig = {
  id: 'find-provision-entities',

  description:
    'Find provision entities in article_contents by parent_act_number + provision_number_key (no LLM, in-memory cache)',

  /**
   * Concurrency Configuration
   *
   * High concurrency is fine now - lookups are in-memory O(1), no DB contention.
   */
  concurrencyLimit: 500,

  /**
   * Database Query
   *
   * Selects all provisions from decision_cited_provisions where:
   * - parent_act_number is not null and not empty (we have a document mapping)
   * - score is not null (mapping was successful with quality score)
   *
   * Uses internal_provision_id as the unique key for each row.
   */
  dbQuery: `
    SELECT
      internal_provision_id,
      internal_parent_act_id,
      decision_id,
      parent_act_number,
      parent_act_name,
      provision_number,
      provision_number_key,
      parent_act_type,
      score
    FROM decision_cited_provisions
    WHERE parent_act_number IS NOT NULL
      AND parent_act_number != ''
      AND score IS NOT NULL
  `,

  dbQueryParams: [],

  /**
   * Preprocess Row - In-Memory Lookup (No LLM, No DB per row)
   *
   * On first call: loads all article_contents into memory cache (~1.1M rows)
   * Then: performs O(1) Map lookup for each provision
   *
   * Returns:
   * - { _skipLLM: true, _result: { found: true, ... } } when match found
   * - { _skipLLM: true, _result: { found: false, ... } } when no match
   */
  preprocessRow: async (row: any) => {
    const { parent_act_number, provision_number_key } = row;

    // Ensure cache is loaded (only loads once)
    await loadArticleCache();

    // O(1) lookup
    const match = lookupArticle(parent_act_number, provision_number_key);

    if (match) {
      return {
        ...row,
        _skipLLM: true,
        _result: {
          found: true,
          article_contents_id: match.id,
          article_number: match.article_number,
          document_number: match.document_number
        }
      };
    } else {
      return {
        ...row,
        _skipLLM: true,
        _result: {
          found: false,
          article_contents_id: null,
          article_number: null,
          document_number: null
        }
      };
    }
  },

  /**
   * Prompt Template (Not Used)
   *
   * Required by JobConfig interface but won't be called since all rows use _skipLLM.
   * Returns empty string as placeholder.
   */
  promptTemplate: () => '',

  /**
   * Output Schema
   *
   * Schema for the provision entity lookup result.
   */
  outputSchema: {
    type: 'object',
    required: ['found', 'article_contents_id', 'article_number', 'document_number'],
    additionalProperties: true,
    properties: {
      found: {
        type: 'boolean',
        description: 'Whether a matching article was found in article_contents'
      },
      article_contents_id: {
        type: ['integer', 'null'],
        description: 'ID from article_contents table (null if not found)'
      },
      article_number: {
        type: ['string', 'null'],
        description: 'Article number from article_contents (null if not found)'
      },
      document_number: {
        type: ['string', 'null'],
        description: 'Document number from article_contents (null if not found)'
      },
      error: {
        type: 'string',
        description: 'Error message if lookup failed'
      }
    }
  },

  outputSchemaName: 'provision_entity_lookup',

  /**
   * Row Metadata Fields
   *
   * These fields from the database row are included in the output JSON.
   */
  rowMetadataFields: [
    'internal_provision_id',
    'internal_parent_act_id',
    'decision_id',
    'parent_act_number',
    'parent_act_name',
    'provision_number',
    'provision_number_key',
    'parent_act_type',
    'score'
  ],

  /**
   * Provider Configuration
   *
   * Required by JobConfig but won't be used since _skipLLM is always true.
   */
  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-4o-mini',

  /**
   * Custom ID Prefix
   */
  customIdPrefix: 'find-prov',

  /**
   * Full Data Pipeline Mode
   *
   * Enabled to write per-provision JSON files to full-data/<job>/<timestamp>/jsons/
   */
  useFullDataPipeline: true
};

export default config;
