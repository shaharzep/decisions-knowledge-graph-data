
import { JobConfig } from '../JobConfig.js';
import { STANDARD_MAPPING_PROMPT } from './prompt.js';
import { DatabaseConfig } from '../../config/database.js';

/**
 * Standard Provision Mapping Job
 * 
 * Maps non-CODE provisions to their parent acts in the documents table.
 */
const config: JobConfig = {
  id: 'map-provisions-standard',
  description: 'Map cited provisions to parent acts (Standard Algorithm)',

  /**
   * Select unique parent acts to process.
   * We group by internal_parent_act_id to avoid redundant processing.
   * We join with decision_legal_teachings to get context.
   */
  concurrencyLimit: 200,

  /**
   * Select unique parent acts to process.
   * Joins through decision_related_citations to get citation_paragraph from
   * decision_related_citations_citations.relevant_snippet.
   * Aggregates legal teachings for context.
   */
  dbQuery: `
    SELECT DISTINCT ON (dcp.internal_parent_act_id)
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
    ORDER BY dcp.internal_parent_act_id
    LIMIT 200
  `,
  
  // No params needed for this query
  dbQueryParams: [],

  /**
   * Preprocess: Fetch candidate documents
   */
  preprocessRow: async (row: any) => {
    const { parent_act_date, parent_act_type } = row;
    
    // Format date to YYYY-MM-DD safely using local time components
    // (pg driver parses DATE columns as local midnight)
    let searchDate = '';
    if (parent_act_date) {
      const d = new Date(parent_act_date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      searchDate = `${year}-${month}-${day}`;
    }
    
    // Map parent_act_type to document_type
    let strictTypes: string[] = [];
    const type = parent_act_type?.toUpperCase();

    if (['LOI', 'WET'].includes(type)) strictTypes = ['LOI'];
    else if (['DECRET', 'DECREET'].includes(type)) strictTypes = ['DECRET'];
    else if (['ORDONNANCE', 'ORDONNANTIE'].includes(type)) strictTypes = ['ORDONNANCE'];
    else if (['ARRETE_ROYAL', 'KONINKLIJK_BESLUIT', 'BESLUIT_VAN_DE_REGERING', 'ARRETE_GOUVERNEMENT'].includes(type)) strictTypes = ['ARRETE'];
    else {
      strictTypes = ['unknown'];
    }

    // Query documents table by date prefix and document type
    const query = `
      SELECT document_number, title, document_type
      FROM documents
      WHERE dossier_number LIKE $1
        AND document_type = ANY($2)
    `;
    const params: any[] = [`${searchDate}%`, strictTypes];

    try {
      const candidates = await DatabaseConfig.executeReadOnlyQuery(query, params);
      
      // Format candidate titles for metadata
      const candidate_titles = candidates.map((c: any) => `[${c.document_number}] ${c.title}`);

      return {
        ...row,
        candidates,
        candidate_titles
      };
    } catch (error) {
      console.error(`Error fetching candidates for ${row.internal_parent_act_id}:`, error);
      return { ...row, candidates: [], candidate_titles: [] };
    }
  },

  /**
   * Generate Prompt
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

  /**
   * Post-process: Filter matches by score threshold
   */
  // postProcessRow: (_row: any, result: any) => {
  //   // const matches = (result.matches || [])
  //   //   .filter((m: any) => m.score >= 80)
  //   //   .map((m: any) => ({
  //   //     document_number: String(m.document_number),
  //   //     confidence: parseFloat(m.confidence) || 0,
  //   //     score: parseInt(m.score, 10) || 0,
  //   //     reasoning: m.reasoning || '',
  //   //     context_score: parseInt(m.context_score, 10) || 0,
  //   //     context_reasoning: m.context_reasoning || '',
  //   //     context_alignment: m.context_alignment || 'NONE'
  //   //   }));

  //   // return {
  //   //   citation_type: result.citation_type || 'OTHER',
  //   //   matches,
  //   //   no_match_reason: matches.length === 0 ? (result.no_match_reason || null) : null
  //   // };
  // },

  /**
   * Output Schema
   */
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
  
  // Azure OpenAI Configuration
  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-5-mini',
  reasoningEffort: 'medium',
  
  // Row metadata to track in results
  rowMetadataFields: ['internal_parent_act_id', 'decision_id', 'language_metadata', 'parent_act_name', 'parent_act_date', 'parent_act_type', 'citation_paragraph', 'teaching_texts', 'candidate_titles'],
  
  customIdPrefix: 'map-std',
  
  useFullDataPipeline: false
};

export default config;
