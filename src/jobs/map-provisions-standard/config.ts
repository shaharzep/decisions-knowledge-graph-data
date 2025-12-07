import { JobConfig } from '../JobConfig.js';
import { STANDARD_MAPPING_PROMPT } from './prompt.js';
import { DatabaseConfig } from '../../config/database.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load popular laws mapping and normalize keys for case-insensitive lookup
const rawPopularLaws: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, 'popular-laws.json'), 'utf-8')
);

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
 * Returns document_number if found, null otherwise
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

  return ['unknown'];
}

/**
 * Format date to YYYY-MM-DD
 */
function formatDate(date: Date | string | null): string {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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
      reasoning: `Exact match to popular law: "${parentActName}"`,
      context_alignment: 'STRONG' as const,
      context_notes: 'Matched via exact string lookup (pre-verified mapping)'
    }],
    no_match_reason: null
  };
}

/**
 * Standard Provision Mapping Job
 *
 * Maps non-CODE provisions to their parent acts in the documents table.
 * Uses exact string matching for popular laws (fast-path) before falling back to LLM.
 */
const config: JobConfig = {
  id: 'map-provisions-standard',
  description: 'Map cited provisions to parent acts (Standard Algorithm with Fast-Path)',

  concurrencyLimit: 200,

  dbQuery: `
    SELECT DISTINCT ON (dcp.id)
      dcp.id,
      dcp.internal_parent_act_id,
      d.decision_id,
      d.language_metadata,
      dcp.parent_act_name,
      dcp.parent_act_date,
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
    WHERE dcp.parent_act_type <> 'CODE'
      AND dcp.parent_act_type <> 'WETBOEK'
      AND dcp.parent_act_type <> 'GRONDWET'
      AND dcp.parent_act_type <> 'CONSTITUTION'
      AND dcp.parent_act_type NOT LIKE 'EU%'
      AND dcp.parent_act_type NOT LIKE '%_UE'
      AND dcp.parent_act_date IS NOT NULL
      AND dcp.internal_parent_act_id IS NOT NULL
    ORDER BY dcp.id
  `,

  dbQueryParams: [],

  /**
   * Preprocess: Try fast-path match, otherwise fetch candidates from DB
   *
   * Returns:
   * - { ...row, _skipLLM: true, _result: {...} } for fast-path matches
   * - { ...row, candidates: [...] } for LLM processing
   */
  preprocessRow: async (row: any) => {
    const { parent_act_name, parent_act_type, parent_act_date } = row;

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
    const searchDate = formatDate(parent_act_date);
    const strictTypes = mapToDocumentType(parent_act_type);

    const query = `
      SELECT document_number, title, document_type
      FROM documents
      WHERE dossier_number LIKE $1
        AND document_type = ANY($2)
    `;

    let candidates: any[] = [];
    try {
      candidates = await DatabaseConfig.executeReadOnlyQuery(query, [`${searchDate}%`, strictTypes]);

      // === STEP 3: If too many candidates, use similarity to rank and limit ===
      if (candidates.length > 200) {
        const similarityQuery = `
          SELECT document_number, title, document_type,
                 similarity(title, $3) AS sim_score
          FROM documents
          WHERE dossier_number LIKE $1
            AND document_type = ANY($2)
          ORDER BY sim_score DESC
          LIMIT 200
        `;
        candidates = await DatabaseConfig.executeReadOnlyQuery(
          similarityQuery,
          [`${searchDate}%`, strictTypes, parent_act_name]
        );
      }
    } catch (error) {
      console.error(`Error fetching candidates for ${row.internal_parent_act_id}:`, error);
    }

    const candidate_titles = candidates.map((c: any) => `[${c.document_number}] ${c.title}`);

    return {
      ...row,
      candidates,
      candidate_titles
    };
  },

  /**
   * Generate prompt for LLM (only called when _skipLLM is not set)
   */
  promptTemplate: (row: any) => {
    const candidatesList = row.candidates?.length > 0
      ? row.candidates.map((c: any) => `- [${c.document_number}] (${c.document_type}) ${c.title}`).join('\n')
      : 'No candidates found matching date.';

    const legalTeachings = row.teaching_texts?.length > 0
      ? row.teaching_texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    const citationParagraph = row.citation_paragraph || 'No citation paragraph available.';

    return STANDARD_MAPPING_PROMPT
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
        enum: ['LAW', 'DECREE', 'ORDINANCE', 'ROYAL_DECREE', 'GOVERNMENT_DECREE', 'MINISTERIAL_DECREE', 'OTHER']
      },
      matches: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          required: ['document_number', 'confidence', 'score', 'reasoning', 'context_alignment', 'context_notes'],
          additionalProperties: false,
          properties: {
            document_number: { type: 'string' },
            confidence: { type: 'number' },
            score: { type: 'integer' },
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

  outputSchemaName: 'standard_provision_mapping',

  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-5-mini',
  reasoningEffort: 'medium',

  rowMetadataFields: ['id', 'internal_parent_act_id', 'decision_id', 'language_metadata', 'parent_act_name', 'parent_act_date', 'parent_act_type', 'citation_paragraph', 'teaching_texts', 'candidate_titles'],

  customIdPrefix: 'map-std',

  useFullDataPipeline: true
};

export default config;
