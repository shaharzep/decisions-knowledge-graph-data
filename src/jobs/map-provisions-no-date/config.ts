
import { JobConfig } from '../JobConfig.js';
import { NO_DATE_MATCH_PROMPT } from './prompt.js';
import { DatabaseConfig } from '../../config/database.js';

/**
 * No-Date Provision Mapping Job
 * 
 * Maps provisions that have a Parent Act Name and Type but NO Date.
 * Uses Act Type mapping and Decision Date constraint to filter candidates.
 */
const config: JobConfig = {
  id: 'map-provisions-no-date',
  description: 'Map cited provisions without date to specific documents (Type & Date Filter)',

  /**
   * Select citations without parent act date.
   * Exclude CODE and EU types.
   */
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
      AND dcp.parent_act_type NOT LIKE 'EU%'
      AND dcp.parent_act_type NOT LIKE '%_UE'
      AND dcp.internal_parent_act_id IS NOT NULL
    ORDER BY dcp.internal_parent_act_id
    LIMIT 1000
  `,
  
  dbQueryParams: [],

  /**
   * Preprocess: Fetch candidate documents
   */
  preprocessRow: async (row: any) => {
    // 1. Determine Target Document Type
    let targetTypes: string[] = [];
    const type = row.parent_act_type ? row.parent_act_type.toUpperCase() : '';

    if (['LOI', 'WET', 'WETBOEK'].includes(type)) {
      targetTypes = ['LOI', 'CODE'];
    } else if (['DECRET', 'DECREET'].includes(type)) {
      targetTypes = ['DECRET'];
    } else if (['ORDONNANCE', 'ORDONNANTIE'].includes(type)) {
      targetTypes = ['ORDONNANCE'];
    } else if (['ARRETE_ROYAL', 'KONINKLIJK_BESLUIT', 'BESLUIT_VAN_DE_REGERING', 'ARRETE_GOUVERNEMENT'].includes(type)) {
      targetTypes = ['ARRETE'];
    } else if (['GRONDWET', 'CONSTITUTION'].includes(type)) {
      targetTypes = ['CONSTITUTION'];
    } else {
      // 'AUTRE', 'ANDERE', or unknown -> No type filter (empty array means all)
      targetTypes = []; 
    }

    // 2. Fetch Candidates
    // Filter by:
    // - Provision Number (INNER JOIN)
    // - Document Type (if mapped)
    // - Date: document_date < decision_date
    // - Title similarity to parent_act_name (using pg_trgm)

    // Use provision_number_key for article lookup, fallback to provision_number
    const articleLookup = row.provision_number_key || row.provision_number;

    let query = `
      SELECT
        d.document_number,
        d.title,
        d.dossier_number,
        SIMILARITY(d.title, $2) as title_similarity
      FROM documents d
      JOIN article_contents ac ON d.document_number = ac.document_number
      WHERE ac.article_number = $1
    `;
    const params: any[] = [articleLookup, row.parent_act_name];
    let paramIdx = 3;

    // Date Filter
    if (row.decision_date) {
      // Extract date from dossier_number (YYYY-MM-DD) and compare
      query += ` AND TO_DATE(SUBSTRING(d.dossier_number, 1, 10), 'YYYY-MM-DD') < $${paramIdx}::date`;
      params.push(row.decision_date);
      paramIdx++;
    }

    // Type Filter
    if (targetTypes.length > 0) {
      query += ` AND d.document_type = ANY($${paramIdx})`;
      params.push(targetTypes);
      paramIdx++;
    }

    // Order by title similarity (most similar first) and limit to top 20 candidates
    // query += ` ORDER BY title_similarity DESC LIMIT 100`;

    // Execute query
    let candidateDocs: any[] = [];
    try {
      candidateDocs = await DatabaseConfig.executeReadOnlyQuery(query, params);
    } catch (e: any) {
       return { match: null, error: `Database query failed: ${e.message}` };
    }

    // Return early if no candidates - will be handled in prompt
    const candidate_titles = candidateDocs.map((d: any) => {
      let cleanTitle = d.title
        .replace(/\(NOTE[^)]*\)/gi, '')
        .replace(/\([^)]*En vigueur[^)]*\)/gi, '')
        .replace(/\([^)]*Consultation des versions[^)]*\)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanTitle.length > 200) {
        cleanTitle = cleanTitle.substring(0, 200) + '...';
      }

      return `[${d.document_number}] ${cleanTitle}`;
    });

    return {
      ...row,
      candidates: candidateDocs,
      candidate_titles
    };
  },

  /**
   * Generate Prompt
   */
  promptTemplate: (row: any) => {
    if (!row.candidates || row.candidates.length === 0) {
      // No candidates - return minimal prompt that will fail gracefully
      return NO_DATE_MATCH_PROMPT
        .replace('{citedActName}', row.parent_act_name || 'Unknown')
        .replace('{citedProvision}', row.provision_number || 'Unknown')
        .replace('{context}', 'No legal teachings available.')
        .replace('{candidatesList}', 'No candidates found.');
    }

    // Format context
    const contextText = row.teaching_texts && row.teaching_texts.length > 0
      ? row.teaching_texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    // Format candidates
    const candidatesList = row.candidates.map((d: any) => {
      let cleanTitle = d.title
        .replace(/\(NOTE[^)]*\)/gi, '')
        .replace(/\([^)]*En vigueur[^)]*\)/gi, '')
        .replace(/\([^)]*Consultation des versions[^)]*\)/gi, '')
        .replace(/\s+/g, ' ')
        .trim();

      if (cleanTitle.length > 200) {
        cleanTitle = cleanTitle.substring(0, 200) + '...';
      }

      const date = d.dossier_number ? d.dossier_number.substring(0, 10) : 'Unknown';
      const similarity = d.title_similarity ? ` (similarity: ${(d.title_similarity * 100).toFixed(0)}%)` : '';

      return `ID: ${d.document_number}
Date: ${date}
Title: ${cleanTitle}${similarity}`;
    }).join('\n---\n');

    return NO_DATE_MATCH_PROMPT
      .replace('{citedActName}', row.parent_act_name)
      .replace('{citedProvision}', row.provision_number)
      .replace('{context}', contextText)
      .replace('{candidatesList}', candidatesList);
  },

  /**
   * Post-process: Normalize result format
   */
  postProcessRow: (_row: any, result: any) => {
    // Handle different response formats from LLM
    let matchObj = null;

    if (result.match) {
      matchObj = result.match;
    } else if (result.document_number) {
      // Flat format - normalize to nested
      matchObj = {
        document_number: result.document_number,
        score: result.score,
        reasoning: result.reasoning || result.explanation
      };
    }

    // Sanitize types
    if (matchObj) {
      if (typeof matchObj.document_number === 'number') {
        matchObj.document_number = String(matchObj.document_number);
      }
      if (typeof matchObj.score !== 'number') {
        matchObj.score = parseInt(matchObj.score, 10) || 0;
      }
    }

    return {
      match: matchObj,
      candidate_titles: result.candidate_titles || _row.candidate_titles || [],
      error: result.error || (matchObj ? undefined : 'No match selected.')
    };
  },

  /**
   * Output Schema
   * Note: Only includes fields that LLM must return.
   * candidate_titles and error are added in postProcessRow from metadata.
   */
  outputSchema: {
    type: 'object',
    required: ['match'],
    additionalProperties: false,
    properties: {
      match: {
        type: ['object', 'null'],
        properties: {
          document_number: { type: 'string' },
          score: { type: 'integer' },
          reasoning: { type: 'string' }
        },
        required: ['document_number', 'score', 'reasoning'],
        additionalProperties: false
      }
    }
  },

  outputSchemaName: 'no_date_provision_mapping',
  
  // Azure OpenAI Configuration
  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-4.1',
  temperature: 0,
  // reasoningEffort: 'low',
  // verbosity: 'low',
  concurrencyLimit: 200,  // Requires pg_trgm GIN index on documents.title
  
  // Row metadata
  rowMetadataFields: ['internal_parent_act_id', 'decision_id', 'language_metadata', 'parent_act_name', 'provision_number', 'teaching_texts', 'candidate_titles'],
  
  customIdPrefix: 'map-nodate'
};

export default config;
