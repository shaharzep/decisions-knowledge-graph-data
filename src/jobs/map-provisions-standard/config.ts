
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
   * We group by internal_parent_act_id to avoid redundant processing.
   * We aggregate all legal teachings for the decision to provide full context.
   */
  dbQuery: `
    SELECT DISTINCT ON (dcp.internal_parent_act_id)
      dcp.internal_parent_act_id,
      d.decision_id,
      d.language_metadata,
      dcp.parent_act_name,
      dcp.parent_act_date,
      dcp.parent_act_type,
      (
        SELECT ARRAY_AGG(dlt.teaching_text)
        FROM decision_legal_teachings dlt
        WHERE dlt.decision_id = dcp.decision_id
      ) as teaching_texts
    FROM decision_cited_provisions dcp
    JOIN decisions1 d ON d.id = dcp.decision_id
    WHERE dcp.parent_act_type <> 'CODE'
      AND dcp.parent_act_type NOT LIKE 'EU%'
      AND dcp.parent_act_type NOT LIKE '%_UE'
      AND dcp.parent_act_date IS NOT NULL
      AND dcp.internal_parent_act_id IS NOT NULL
    ORDER BY dcp.internal_parent_act_id
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

    if (['LOI', 'WET', 'WETBOEK'].includes(type)) strictTypes = ['LOI', 'CODE'];
    else if (['DECRET', 'DECREET'].includes(type)) strictTypes = ['DECRET'];
    else if (['ORDONNANCE', 'ORDONNANTIE'].includes(type)) strictTypes = ['ORDONNANCE'];
    else if (['ARRETE_ROYAL', 'KONINKLIJK_BESLUIT', 'BESLUIT_VAN_DE_REGERING', 'ARRETE_GOUVERNEMENT'].includes(type)) strictTypes = ['ARRETE'];
    else if (['GRONDWET', 'CONSTITUTION'].includes(type)) strictTypes = ['CONSTITUTION'];
    else {
      // For generic/unknown types, we don't enforce strict types, 
      // effectively searching everything matching the date.
      strictTypes = []; 
    }

    // Query documents table
    // Logic: 
    // 1. Match date (dossier_number starts with YYYY-MM-DD)
    // 2. AND (
    //      document_type IN strictTypes
    //      OR document_type NOT IN ('LOI', 'CODE', 'DECRET', 'ORDONNANCE', 'CONSTITUTION', 'ARRETE')
    //    )
    // This ensures we catch the expected types AND any "other" types (wide net),
    // while excluding known wrong types (e.g. don't match a LOI if we're looking for an ARRETE).
    
    let query = `
      SELECT document_number, title, document_type
      FROM documents
      WHERE dossier_number LIKE $1
    `;
    
    const params: any[] = [`${searchDate}%`];

    if (strictTypes.length > 0) {
      query += `
        AND (
          document_type = ANY($2)
          OR document_type NOT IN ('LOI', 'CODE', 'DECRET', 'ORDONNANCE', 'CONSTITUTION', 'ARRETE')
        )
      `;
      params.push(strictTypes);
    }

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
    const candidatesList = row.candidates && row.candidates.length > 0
      ? row.candidates.map((c: any) => `- [${c.document_number}] (${c.document_type}) ${c.title}`).join('\n')
      : 'No candidates found matching date.';

    // Format teachings as a list
    const contextText = row.teaching_texts && row.teaching_texts.length > 0
      ? row.teaching_texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    return STANDARD_MAPPING_PROMPT
      .replace('{citedActName}', row.parent_act_name || 'Unknown')
      .replace('{context}', contextText)
      .replace('{candidatesList}', candidatesList);
  },

  /**
   * Post-process: Filter matches by score
   */
  postProcessRow: (_row: any, result: any) => {
    // Filter matches with score >= 80
    const validMatches = (result.matches || []).filter((m: any) => m.score >= 80);
    return {
      ...result,
      matches: validMatches
    };
  },

  /**
   * Output Schema
   */
  outputSchema: {
    type: 'object',
    required: ['matches'],
    additionalProperties: false,
    properties: {
      matches: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          required: ['document_number', 'confidence', 'score', 'reasoning'],
          additionalProperties: false,
          properties: {
            document_number: { type: ['string', 'null'] },
            confidence: { type: 'number', description: 'Confidence score between 0.0 and 1.0' },
            score: { type: 'integer', description: 'Relevance score between 0 and 100' },
            reasoning: { type: 'string' }
          }
        }
      }
    }
  },

  outputSchemaName: 'standard_provision_mapping',
  
  // Azure OpenAI Configuration
  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-5-mini',
  reasoningEffort: 'medium',
  
  // Row metadata to track in results
  rowMetadataFields: ['internal_parent_act_id', 'decision_id', 'language_metadata', 'parent_act_name', 'parent_act_date', 'parent_act_type', 'teaching_texts', 'candidate_titles'],
  
  customIdPrefix: 'map-std',
  
  useFullDataPipeline: true
};

export default config;
