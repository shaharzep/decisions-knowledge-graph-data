
import { JobConfig } from '../JobConfig.js';
import { NO_DATE_MAPPING_PROMPT } from './prompt.js';
import { DatabaseConfig } from '../../config/database.js';
import { AzureConfig } from '../../config/azure.js';
import fs from 'fs';
import path from 'path';

/**
 * No-Date Provision Mapping Job
 *
 * Maps provisions that have a Parent Act Name and Type but NO Date.
 * Uses Act Type mapping and article existence to filter candidates.
 * Translates non-French act names to French for better pg_trgm similarity.
 *
 * RESUME MODE: Set RESUME=true to skip already-processed provisions.
 */

// =====================================================================================
// TRANSLATION HELPER
// =====================================================================================

// Cache translations to avoid redundant API calls for same act names
const translationCache = new Map<string, string>();

/**
 * Translate a legal act name to French using Azure OpenAI.
 * Uses caching to minimize API calls for repeated act names.
 */
async function translateToFrench(actName: string): Promise<string> {
  if (!actName || actName.trim().length === 0) return actName;

  // Check cache first
  const cacheKey = actName.toLowerCase().trim();
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)!;
  }

  try {
    const client = AzureConfig.getClient();
    const response: any = await client.responses.create({
      model: AzureConfig.getDeployment(),
      input: [
        {
          role: 'system',
          content: [{
            type: 'input_text',
            text: 'Translate the Belgian legal act name from Dutch/German to French. Return ONLY the French translation, nothing else. Keep dates and numbers unchanged.'
          }]
        },
        {
          role: 'user',
          content: [{ type: 'input_text', text: actName }]
        }
      ],
      max_output_tokens: 150,
      reasoning: { effort: 'low' }
    });

    // Extract translated text
    let translated = actName; // fallback to original
    if (response.output_text) {
      translated = response.output_text.trim();
    } else if (response.output?.[0]?.content?.[0]?.text) {
      translated = response.output[0].content[0].text.trim();
    }

    // Cache and return
    translationCache.set(cacheKey, translated);
    return translated;
  } catch (e: any) {
    console.warn(`Translation failed for "${actName}": ${e.message}`);
    return actName; // fallback to original on error
  }
}

// =====================================================================================
// RESUME LOGIC HELPERS
// =====================================================================================

function getRunTimestamps(jobId: string): string[] {
  const resultsDir = path.join(process.cwd(), 'full-data', jobId);
  if (!fs.existsSync(resultsDir)) return [];
  return fs.readdirSync(resultsDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.test(name))
    .sort()
    .reverse();
}

function loadProcessedIdsFromRun(jobId: string, timestamp: string): string[] {
  const jsonsDir = path.join(process.cwd(), 'full-data', jobId, timestamp, 'jsons');
  if (!fs.existsSync(jsonsDir)) return [];

  const ids: string[] = [];
  for (const filename of fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'))) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(jsonsDir, filename), 'utf-8'));
      if (data.internal_parent_act_id) ids.push(data.internal_parent_act_id);
    } catch { /* skip malformed */ }
  }
  return ids;
}

function buildCompletedProvisionSet(): Set<string> {
  const completedSet = new Set<string>();
  const timestamps = getRunTimestamps('map-provisions-no-date');
  if (timestamps.length === 0) return completedSet;

  console.log(`\n⏯️  RESUME MODE: Scanning ${timestamps.length} previous run(s)...`);
  for (const ts of timestamps) {
    const ids = loadProcessedIdsFromRun('map-provisions-no-date', ts);
    console.log(`   - Run ${ts}: ${ids.length} provisions`);
    ids.forEach(id => completedSet.add(id));
  }
  console.log(`   Total unique completed: ${completedSet.size}`);
  return completedSet;
}

// =====================================================================================
// RESUME STATE
// =====================================================================================

const RESUME_MODE = process.env.RESUME === 'true';
const COMPLETED_PROVISIONS: Set<string> = RESUME_MODE ? buildCompletedProvisionSet() : new Set();

if (RESUME_MODE) {
  console.log(`   Remaining to process: (will be calculated after DB query)\n`);
}

// =====================================================================================
// JOB CONFIG
// =====================================================================================

const config: JobConfig = {
  id: 'map-provisions-no-date',
  description: 'Map cited provisions without date to specific documents',

  dbQuery: `
    SELECT DISTINCT ON (dcp.internal_parent_act_id)
      dcp.internal_parent_act_id,
      d.decision_id,
      d.decision_date,
      d.language_metadata,
      dcp.parent_act_name,
      dcp.provision_number,
      dcp.provision_number_key,
      dcp.parent_act_type,
      (
        SELECT ARRAY_AGG(dlt.teaching_text)
        FROM decision_legal_teachings dlt
        WHERE dlt.decision_id = dcp.decision_id
      ) as teaching_texts
    FROM decision_cited_provisions dcp
    JOIN decisions1 d ON d.id = dcp.decision_id
    WHERE dcp.parent_act_date IS NULL
      AND dcp.parent_act_type <> 'CODE'
      AND dcp.parent_act_type <> 'WETBOEK'
      AND dcp.parent_act_type NOT LIKE 'EU%'
      AND dcp.parent_act_type NOT LIKE '%_UE'
      AND dcp.internal_parent_act_id IS NOT NULL
    ORDER BY dcp.internal_parent_act_id
    limit 10
  `,

  dbQueryParams: [],

  /**
   * Preprocess: Fetch candidate documents from article_contents
   * Translates non-French act names to French for better pg_trgm similarity
   */
  preprocessRow: async (row: any) => {
    if (RESUME_MODE && COMPLETED_PROVISIONS.has(row.internal_parent_act_id)) {
      return null;
    }

    // Map parent_act_type to document_type
    let targetTypes: string[] = [];
    const type = row.parent_act_type?.toUpperCase() || '';

    if (['LOI', 'WET'].includes(type)) targetTypes = ['LOI'];
    else if (['DECRET', 'DECREET'].includes(type)) targetTypes = ['DECRET'];
    else if (['ORDONNANCE', 'ORDONNANTIE'].includes(type)) targetTypes = ['ORDONNANCE'];
    else if (['ARRETE_ROYAL', 'KONINKLIJK_BESLUIT', 'BESLUIT_VAN_DE_REGERING', 'ARRETE_GOUVERNEMENT'].includes(type)) targetTypes = ['ARRETE'];
    else if (['GRONDWET', 'CONSTITUTION'].includes(type)) targetTypes = ['CONSTITUTION'];
    else targetTypes = ['unknown'];

    const articleLookup = row.provision_number_key || row.provision_number;
    if (!articleLookup) {
      console.warn(`No article number for ${row.internal_parent_act_id}, skipping`);
      return null;
    }

    // Translate non-French act names for better similarity matching
    // Document titles in DB are in French, so we need French act names for pg_trgm
    const parentActName = row.parent_act_name || '';
    const language = row.language_metadata?.toUpperCase();
    const needsTranslation = language === 'NL' || language === 'DE';

    const searchName = needsTranslation && parentActName
      ? await translateToFrench(parentActName)
      : parentActName;

    // Query documents containing this article, ranked by title similarity
    const MAX_CANDIDATES = 200;

    let query = `
      SELECT d.document_number, d.title, d.dossier_number,
             similarity(d.title, $1) as sim_score
      FROM documents d
      JOIN article_contents ac ON d.document_number = ac.document_number
      WHERE ac.article_number = $2
    `;
    const params: any[] = [searchName, articleLookup];
    let paramIdx = 3;

    if (row.decision_date) {
      query += ` AND TO_DATE(SUBSTRING(d.dossier_number, 1, 10), 'YYYY-MM-DD') < $${paramIdx}::date`;
      params.push(row.decision_date);
      paramIdx++;
    }

    if (targetTypes.length > 0) {
      query += ` AND d.document_type = ANY($${paramIdx})`;
      params.push(targetTypes);
    }

    query += ` ORDER BY sim_score DESC LIMIT ${MAX_CANDIDATES}`;

    try {
      const candidates = await DatabaseConfig.executeReadOnlyQuery(query, params);
      return {
        ...row,
        candidates,
        candidate_titles: candidates.map((c: any) => `[${c.document_number}] ${c.title}`)
      };
    } catch (e: any) {
      console.error(`DB query failed for ${row.internal_parent_act_id}:`, e.message);
      return null;
    }
  },

  /**
   * Generate prompt for LLM
   */
  promptTemplate: (row: any) => {
    const candidates = row.candidates || [];

    const candidatesList = candidates.length > 0
      ? candidates.map((c: any) => {
          const date = c.dossier_number ? c.dossier_number.substring(0, 10) : 'Unknown';
          return `- [${c.document_number}] (${date}) ${c.title}`;
        }).join('\n')
      : 'No candidates found.';

    const contextText = row.teaching_texts?.length > 0
      ? row.teaching_texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    return NO_DATE_MAPPING_PROMPT
      .replace('{citedActName}', row.parent_act_name || 'Unknown')
      .replace('{citedProvision}', row.provision_number || 'Unknown')
      .replace('{context}', contextText)
      .replace('{candidatesList}', candidatesList);
  },

  // /**
  //  * Post-process: Filter matches by score threshold
  //  */
  // postProcessRow: (_row: any, result: any) => {
  //   const matches = (result.matches || [])
  //     .filter((m: any) => m.score >= 80)
  //     .map((m: any) => ({
  //       document_number: String(m.document_number),
  //       confidence: parseFloat(m.confidence) || 0,
  //       score: parseInt(m.score, 10) || 0,
  //       title_match: m.title_match || 'PARTIAL',
  //       reasoning: m.reasoning || '',
  //       context_score: parseInt(m.context_score, 10) || 0,
  //       context_reasoning: m.context_reasoning || '',
  //       context_alignment: m.context_alignment || 'NONE'
  //     }));

  //   return {
  //     citation_type: result.citation_type || 'OTHER',
  //     matches,
  //     no_match_reason: matches.length === 0 ? (result.no_match_reason || null) : null
  //   };
  // },

  outputSchema: {
    type: 'object',
    required: ['citation_type', 'matches', 'no_match_reason'],
    additionalProperties: false,
    properties: {
      citation_type: {
        type: 'string',
        enum: ['CODE', 'LAW', 'DECREE', 'ORDINANCE', 'TREATY', 'EU_LAW', 'ROYAL_DECREE', 'MINISTERIAL_DECREE', 'COORDINATED', 'OTHER']
      },
      matches: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          required: ['document_number', 'confidence', 'score', 'title_match', 'reasoning', 'context_score', 'context_reasoning', 'context_alignment'],
          additionalProperties: false,
          properties: {
            document_number: { type: 'string' },
            confidence: { type: 'number' },
            score: { type: 'integer' },
            title_match: {
              type: 'string',
              enum: ['EXACT', 'STRONG', 'PARTIAL', 'WEAK']
            },
            reasoning: { type: 'string' },
            context_score: { type: 'integer' },
            context_reasoning: { type: 'string' },
            context_alignment: {
              type: 'string',
              enum: ['STRONG', 'MODERATE', 'WEAK', 'NONE', 'TANGENTIAL']
            }
          }
        }
      },
      no_match_reason: { type: ['string', 'null'] }
    }
  },

  outputSchemaName: 'no_date_provision_mapping',

  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-5-mini',
  reasoningEffort: 'medium',
  verbosity: 'low',

  concurrencyLimit: 100,

  rowMetadataFields: ['internal_parent_act_id', 'decision_id', 'language_metadata', 'parent_act_name', 'provision_number', 'teaching_texts', 'candidate_titles'],

  customIdPrefix: 'map-nodate',

  useFullDataPipeline: true,
};

export default config;
