import { JobConfig } from '../JobConfig.js';
import { NO_DATE_MAPPING_PROMPT } from './prompt.js';
import { DatabaseConfig } from '../../config/database.js';
import { AzureConfig } from '../../config/azure.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// =============================================================================
// POPULAR LAWS FAST-PATH
// =============================================================================

// Load popular laws from map-provisions-standard (shared mapping)
const rawPopularLaws: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, '../map-provisions-standard/popular-laws.json'), 'utf-8')
);

// Normalize keys for case-insensitive lookup
const popularLaws: Record<string, string> = {};
for (const [name, docNum] of Object.entries(rawPopularLaws)) {
  popularLaws[name.toLowerCase().trim()] = docNum;
}

/**
 * Normalize string for exact match lookup
 */
function normalizeString(str: string): string {
  return str?.toLowerCase().trim() || '';
}

/**
 * Try fast-path exact match against popular laws
 */
function tryFastMatch(parentActName: string): string | null {
  const normalized = normalizeString(parentActName);
  return popularLaws[normalized] || null;
}

/**
 * Map parent_act_type to citation_type enum
 */
function mapToCitationType(parentActType: string): string {
  const type = parentActType?.toUpperCase() || '';

  if (['LOI', 'WET'].includes(type)) return 'LAW';
  if (['DECRET', 'DECREET'].includes(type)) return 'DECREE';
  if (['ORDONNANCE', 'ORDONNANTIE'].includes(type)) return 'ORDINANCE';
  if (['ARRETE_ROYAL', 'KONINKLIJK_BESLUIT'].includes(type)) return 'ROYAL_DECREE';
  if (['BESLUIT_VAN_DE_REGERING', 'ARRETE_GOUVERNEMENT'].includes(type)) return 'GOVERNMENT_DECREE';
  if (['ARRETE_MINISTERIEL', 'MINISTERIEEL_BESLUIT'].includes(type)) return 'MINISTERIAL_DECREE';
  if (type.includes('COORDONNE') || type.includes('GECOORDINEERD')) return 'COORDINATED';

  return 'OTHER';
}

/**
 * Map parent_act_type to document_type for DB query
 */
function mapToDocumentType(parentActType: string): string[] {
  const type = parentActType?.toUpperCase() || '';

  if (['LOI', 'WET'].includes(type)) return ['LOI'];
  if (['DECRET', 'DECREET'].includes(type)) return ['DECRET'];
  if (['ORDONNANCE', 'ORDONNANTIE'].includes(type)) return ['ORDONNANCE'];
  if (['ARRETE_ROYAL', 'KONINKLIJK_BESLUIT', 'BESLUIT_VAN_DE_REGERING', 'ARRETE_GOUVERNEMENT'].includes(type)) return ['ARRETE'];
  if (['GRONDWET', 'CONSTITUTION'].includes(type)) return ['CONSTITUTION'];

  return ['unknown'];
}

/**
 * Build fast-match result matching the output schema
 */
function buildFastMatchResult(documentNumber: string, parentActType: string, parentActName: string) {
  return {
    citation_type: mapToCitationType(parentActType),
    matches: [{
      document_number: documentNumber,
      confidence: 1.0,
      score: 100,
      title_match: 'EXACT' as const,
      reasoning: `Exact match to popular law: "${parentActName}"`,
      context_alignment: 'STRONG' as const,
      context_notes: 'Matched via exact string lookup (pre-verified mapping)'
    }],
    no_match_reason: null
  };
}

// =============================================================================
// TRANSLATION HELPER
// =============================================================================

const translationCache = new Map<string, string>();

/**
 * Translate a legal act name to French using Azure OpenAI
 */
async function translateToFrench(actName: string): Promise<string> {
  if (!actName || actName.trim().length === 0) return actName;

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

    let translated = actName;
    if (response.output_text) {
      translated = response.output_text.trim();
    } else if (response.output?.[0]?.content?.[0]?.text) {
      translated = response.output[0].content[0].text.trim();
    }

    translationCache.set(cacheKey, translated);
    return translated;
  } catch (e: any) {
    console.warn(`Translation failed for "${actName}": ${e.message}`);
    return actName;
  }
}

// =============================================================================
// JOB CONFIG
// =============================================================================

const config: JobConfig = {
  id: 'map-provisions-no-date',
  description: 'Map cited provisions without date to specific documents (with fast-path for popular laws)',

  concurrencyLimit: 200,

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
      drcc.relevant_snippet AS citation_paragraph,
      (
        SELECT ARRAY_AGG(dlt.teaching_text)
        FROM decision_legal_teachings dlt
        WHERE dlt.decision_id = dcp.decision_id
      ) AS teaching_texts
    FROM decision_cited_provisions dcp
    JOIN decisions1 d ON d.id = dcp.decision_id
    LEFT JOIN decision_related_citations drc
      ON drc.internal_provision_id = dcp.internal_provision_id
    LEFT JOIN decision_related_citations_citations drcc
      ON drcc.decision_related_citations_id = drc.id
    WHERE dcp.parent_act_date IS NULL
      AND dcp.parent_act_type <> 'CODE'
      AND dcp.parent_act_type <> 'WETBOEK'
      AND parent_act_type <> 'GRONDWET'
      AND parent_act_type <> 'CONSTITUTION'
      AND dcp.parent_act_type NOT LIKE 'EU%'
      AND dcp.parent_act_type NOT LIKE '%_UE'
      AND dcp.internal_parent_act_id IS NOT NULL
    ORDER BY dcp.internal_parent_act_id
    limit 50
  `,

  dbQueryParams: [],

  /**
   * Preprocess: Try fast-path match, otherwise fetch candidates from DB
   */
  preprocessRow: async (row: any) => {
    const { parent_act_name, parent_act_type } = row;

    // === STEP 1: Try exact-match fast-path ===
    const fastMatchDocNumber = tryFastMatch(parent_act_name);

    if (fastMatchDocNumber) {
      return {
        ...row,
        _skipLLM: true,
        _result: buildFastMatchResult(fastMatchDocNumber, parent_act_type, parent_act_name)
      };
    }

    // === STEP 2: Fetch candidates from DB for LLM processing ===
    const targetTypes = mapToDocumentType(parent_act_type);
    const articleLookup = row.provision_number_key || row.provision_number;

    if (!articleLookup) {
      console.warn(`No article number for ${row.internal_parent_act_id}, skipping`);
      return null;
    }

    // Translate non-French act names for better similarity matching
    const language = row.language_metadata?.toUpperCase();
    const needsTranslation = language === 'NL' || language === 'DE';
    const searchName = needsTranslation && parent_act_name
      ? await translateToFrench(parent_act_name)
      : parent_act_name;

    const MAX_CANDIDATES = 200;

    let query = `
      SELECT d.document_number, d.title, d.dossier_number,
             similarity(d.title, $1) AS sim_score
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

    if (targetTypes.length > 0 && !targetTypes.includes('unknown')) {
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
   * Generate prompt for LLM (only called when _skipLLM is not set)
   */
  promptTemplate: (row: any) => {
    const candidates = row.candidates || [];

    const candidatesList = candidates.length > 0
      ? candidates.map((c: any) => {
          const date = c.dossier_number ? c.dossier_number.substring(0, 10) : 'Unknown';
          return `- [${c.document_number}] (${date}) ${c.title}`;
        }).join('\n')
      : 'No candidates found.';

    const legalTeachings = row.teaching_texts?.length > 0
      ? row.teaching_texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    const citationParagraph = row.citation_paragraph || 'No citation paragraph available.';

    return NO_DATE_MAPPING_PROMPT
      .replace('{citedActName}', row.parent_act_name || 'Unknown')
      .replace('{citationParagraph}', citationParagraph)
      .replace('{legalTeachings}', legalTeachings)
      .replace('{candidatesList}', candidatesList);
  },

  outputSchema: {
    type: 'object',
    required: ['citation_type', 'matches', 'no_match_reason'],
    additionalProperties: false,
    properties: {
      citation_type: {
        type: 'string',
        enum: ['LAW', 'DECREE', 'ORDINANCE', 'ROYAL_DECREE', 'GOVERNMENT_DECREE', 'MINISTERIAL_DECREE', 'COORDINATED', 'OTHER']
      },
      matches: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          required: ['document_number', 'confidence', 'score', 'title_match', 'reasoning', 'context_alignment', 'context_notes'],
          additionalProperties: false,
          properties: {
            document_number: { type: 'string' },
            confidence: { type: 'number', minimum: 0, maximum: 1.0 },
            score: { type: 'integer', minimum: 0, maximum: 100 },
            title_match: {
              type: 'string',
              enum: ['EXACT', 'STRONG', 'PARTIAL', 'WEAK']
            },
            reasoning: { type: 'string' },
            context_alignment: {
              type: 'string',
              enum: ['STRONG', 'MODERATE', 'WEAK', 'NONE', 'TANGENTIAL']
            },
            context_notes: { type: 'string' }
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

  rowMetadataFields: [
    'internal_parent_act_id',
    'decision_id',
    'language_metadata',
    'parent_act_name',
    'provision_number',
    'citation_paragraph',
    'teaching_texts',
    'candidate_titles'
  ],

  customIdPrefix: 'map-nodate',

  useFullDataPipeline: false
};

export default config;
