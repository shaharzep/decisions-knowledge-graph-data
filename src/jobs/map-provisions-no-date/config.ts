
import { JobConfig } from '../JobConfig.js';
import { NO_DATE_MATCH_PROMPT, BATCH_SELECTION_PROMPT, FINAL_RANKING_PROMPT } from './prompt.js';
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
        d.dossier_number
      FROM documents d
      JOIN article_contents ac ON d.document_number = ac.document_number
      WHERE ac.article_number = $1
    `;
    const params: any[] = [articleLookup];
    let paramIdx = 2;

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
      return `[${d.document_number}] ${d.title}`;
    });

    return {
      ...row,
      candidates: candidateDocs,
      candidate_titles
    };
  },

  /**
   * Custom Execution with Tournament Logic
   */
  customExecution: async (row: any, client: any) => {
    const candidates = row.candidates || [];
    const contextText = row.teaching_texts && row.teaching_texts.length > 0
      ? row.teaching_texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    // Helper to format candidates
    const formatCandidate = (c: any) => {
      const date = c.dossier_number ? c.dossier_number.substring(0, 10) : 'Unknown';
      return `ID: ${c.document_number}\nDate: ${date}\nTitle: ${c.title}`;
    };

    let shortlistedCandidates: any[] = [];

    // --- PHASE 1: Batch Selection (Tournament Semi-Finals) ---
    // Use a large batch size to minimize API calls, as requested.
    const BATCH_SIZE = 1000;
    
    if (candidates.length > BATCH_SIZE) {
      const batches = [];
      for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
        batches.push(candidates.slice(i, i + BATCH_SIZE));
      }

      // Process batches in parallel (limited by client concurrency usually, but here we do sequential to avoid rate limits per request)
      for (const batch of batches) {
        const batchPrompt = BATCH_SELECTION_PROMPT
          .replace('{citedActName}', row.parent_act_name)
          .replace('{citedProvision}', row.provision_number)
          .replace('{context}', contextText)
          .replace('{candidatesList}', batch.map(formatCandidate).join('\n---\n'));

        try {
          const response = await client.complete(
            [{ role: 'user', content: batchPrompt }],
            { type: 'json_object' },
            { model: 'gpt-5-mini', reasoningEffort: 'minimal' } // Fast, cheap model for filtering
          );
          const result = JSON.parse(response.choices[0].message.content);
          
          if (result.matches) {
            for (const m of result.matches) {
              const doc = batch.find((c: any) => String(c.document_number) === String(m.document_number));
              if (doc) shortlistedCandidates.push(doc);
            }
          }
        } catch (e) {
          console.error('Error in batch selection:', e);
          // On error, we might skip this batch or add all? Let's skip to be safe/strict.
        }
      }
    } else {
      // Small enough to process all at once
      shortlistedCandidates = candidates;
    }

    // If no candidates survived (or none existed), return empty
    if (shortlistedCandidates.length === 0) {
      return { matches: [], error: 'No candidates found or selected.' };
    }

    // --- PHASE 2: Final Ranking (Tournament Finals) ---
    const finalPrompt = FINAL_RANKING_PROMPT
      .replace('{citedActName}', row.parent_act_name)
      .replace('{citedProvision}', row.provision_number)
      .replace('{context}', contextText)
      .replace('{candidatesList}', shortlistedCandidates.map(formatCandidate).join('\n---\n'));

    const finalResponse = await client.complete(
      [{ role: 'user', content: finalPrompt }],
      { type: 'json_object' },
      { model: 'gpt-5-mini', reasoningEffort: 'medium' } // Stronger reasoning for final pick
    );

    let finalResult;
    try {
      finalResult = JSON.parse(finalResponse.choices[0].message.content);
    } catch (e) {
      return { matches: [], error: 'Failed to parse final ranking JSON.' };
    }

    // Normalize and Filter
    let matches = finalResult.matches || [];
    if (!Array.isArray(matches)) matches = [];

    // Filter by score >= 80 (Strictness check)
    matches = matches.filter((m: any) => m.score >= 80);

    return {
      matches: matches.map((m: any) => ({
        document_number: String(m.document_number),
        score: parseInt(m.score, 10) || 0,
        reasoning: m.reasoning,
        confidence: (parseInt(m.score, 10) || 0) / 100
      })),
      candidate_titles: candidates.map((c: any) => c.title) // Keep track of all original candidates
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
        items: {
          type: 'object',
          required: ['document_number', 'score', 'reasoning'],
          additionalProperties: false,
          properties: {
            document_number: { type: 'string' },
            score: { type: 'integer' },
            reasoning: { type: 'string' },
            confidence: { type: 'number' }
          }
        }
      },
      candidate_titles: {
        type: 'array',
        items: { type: 'string' }
      }
    }
  },

  outputSchemaName: 'no_date_provision_mapping',
  
  // Azure OpenAI Configuration
  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-5-mini',
  // reasoningEffort: 'low',
  // verbosity: 'low',
  concurrencyLimit: 50,  // Requires pg_trgm GIN index on documents.title
  
  // Row metadata
  rowMetadataFields: ['internal_parent_act_id', 'decision_id', 'language_metadata', 'parent_act_name', 'provision_number', 'teaching_texts', 'candidate_titles'],
  
  customIdPrefix: 'map-nodate'
};

export default config;
