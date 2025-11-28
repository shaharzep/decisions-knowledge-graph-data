
import { JobConfig } from '../JobConfig.js';
import { /* BATCH_SELECTION_PROMPT, */ FINAL_RANKING_PROMPT } from './prompt.js';
import { DatabaseConfig } from '../../config/database.js';
import fs from 'fs';
import path from 'path';

/**
 * No-Date Provision Mapping Job
 *
 * Maps provisions that have a Parent Act Name and Type but NO Date.
 * Uses Act Type mapping and Decision Date constraint to filter candidates.
 *
 * RESUME MODE: Set RESUME=true to skip already-processed provisions.
 */

// =====================================================================================
// RESUME LOGIC HELPERS
// =====================================================================================

/**
 * Get all timestamped run directories for a job
 */
function getRunTimestamps(jobId: string): string[] {
  const resultsDir = path.join(process.cwd(), 'full-data', jobId);

  if (!fs.existsSync(resultsDir)) {
    return [];
  }

  return fs.readdirSync(resultsDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.test(name))
    .sort()
    .reverse();
}

/**
 * Load processed provision IDs from a single run
 */
function loadProcessedIdsFromRun(jobId: string, timestamp: string): string[] {
  const jsonsDir = path.join(process.cwd(), 'full-data', jobId, timestamp, 'jsons');

  if (!fs.existsSync(jsonsDir)) {
    return [];
  }

  const jsonFiles = fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'));
  const ids: string[] = [];

  for (const filename of jsonFiles) {
    try {
      const filepath = path.join(jsonsDir, filename);
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      if (data.internal_parent_act_id) {
        ids.push(data.internal_parent_act_id);
      }
    } catch {
      // Skip malformed files
    }
  }

  return ids;
}

/**
 * Build set of all processed provision IDs across all previous runs
 */
function buildCompletedProvisionSet(): Set<string> {
  const completedSet = new Set<string>();
  const timestamps = getRunTimestamps('map-provisions-no-date');

  if (timestamps.length === 0) {
    return completedSet;
  }

  console.log(`\n⏯️  RESUME MODE: Scanning ${timestamps.length} previous run(s)...`);

  for (const ts of timestamps) {
    const ids = loadProcessedIdsFromRun('map-provisions-no-date', ts);
    console.log(`   - Run ${ts}: ${ids.length} provisions`);
    for (const id of ids) {
      completedSet.add(id);
    }
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
  `,

  dbQueryParams: [],

  /**
   * Preprocess: Fetch candidate documents
   *
   * RESUME: Skips provisions that were already processed in previous runs.
   */
  preprocessRow: async (row: any) => {
    // RESUME: Skip already-processed provisions
    if (RESUME_MODE && COMPLETED_PROVISIONS.has(row.internal_parent_act_id)) {
      return null;
    }

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
      targetTypes = ['unknown'];
    }

    // 2. Use provision_number_key for article lookup, fallback to provision_number
    const articleLookup = row.provision_number_key || row.provision_number;

    if (!articleLookup) {
      console.warn(`No article number for ${row.internal_parent_act_id}, skipping`);
      return null;
    }

    // 3. Build candidate query
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

    if (row.decision_date) {
      query += ` AND TO_DATE(SUBSTRING(d.dossier_number, 1, 10), 'YYYY-MM-DD') < $${paramIdx}::date`;
      params.push(row.decision_date);
      paramIdx++;
    }

    if (targetTypes.length > 0) {
      query += ` AND d.document_type = ANY($${paramIdx})`;
      params.push(targetTypes);
    }

    // 4. Execute query
    let candidateDocs: any[] = [];
    try {
      candidateDocs = await DatabaseConfig.executeReadOnlyQuery(query, params);
    } catch (e: any) {
      console.error(`DB query failed for ${row.internal_parent_act_id}:`, e.message);
      return null;
    }

    const candidate_titles = candidateDocs.map((d: any) => `[${d.document_number}] ${d.title}`);

    return {
      ...row,
      candidates: candidateDocs,
      candidate_titles
    };
  },

  /**
   * Custom Execution - Simple Single Call
   * (Tournament logic commented out below for reprocessing failures)
   */
  customExecution: async (row: any, client: any) => {
    const candidates = row.candidates || [];
    const contextText = row.teaching_texts && row.teaching_texts.length > 0
      ? row.teaching_texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    const formatCandidate = (c: any) => {
      const date = c.dossier_number ? c.dossier_number.substring(0, 10) : 'Unknown';
      return `ID: ${c.document_number}\nDate: ${date}\nTitle: ${c.title}`;
    };

    if (candidates.length === 0) {
      return { matches: [], error: 'No candidates found.' };
    }

    // Simple single-call approach (candidates already filtered by document_type='unknown')
    const finalPrompt = FINAL_RANKING_PROMPT
      .replace('{citedActName}', row.parent_act_name || '[Unknown Act]')
      .replace('{citedProvision}', row.provision_number || '[Unknown Provision]')
      .replace('{context}', contextText)
      .replace('{candidatesList}', candidates.map(formatCandidate).join('\n---\n'));

    const finalResponse = await client.complete(
      [{ role: 'user', content: finalPrompt }],
      { type: 'json_object' },
      { model: 'gpt-5-mini', reasoningEffort: 'medium' }
    );

    let finalResult;
    try {
      finalResult = JSON.parse(finalResponse.choices[0].message.content);
    } catch {
      return { matches: [], error: 'Failed to parse final ranking JSON.' };
    }

    let matches = finalResult.matches || [];
    if (!Array.isArray(matches)) matches = [];

    matches = matches.filter((m: any) => m.score >= 80);

    return {
      matches: matches.map((m: any) => ({
        document_number: String(m.document_number),
        score: parseInt(m.score, 10) || 0,
        reasoning: m.reasoning,
        confidence: (parseInt(m.score, 10) || 0) / 100
      })),
      candidate_titles: candidates.map((c: any) => c.title)
    };
  },

  // =====================================================================================
  // TOURNAMENT LOGIC (COMMENTED OUT) - Use for reprocessing failures with large candidate sets
  // =====================================================================================
  // customExecution_TOURNAMENT: async (row: any, client: any) => {
  //   const candidates = row.candidates || [];
  //   const contextText = row.teaching_texts && row.teaching_texts.length > 0
  //     ? row.teaching_texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
  //     : 'No legal teachings available.';
  //
  //   const formatCandidate = (c: any) => {
  //     const date = c.dossier_number ? c.dossier_number.substring(0, 10) : 'Unknown';
  //     return `ID: ${c.document_number}\nDate: ${date}\nTitle: ${c.title}`;
  //   };
  //
  //   let shortlistedCandidates: any[] = [];
  //
  //   // --- PHASE 1: Batch Selection ---
  //   const BATCH_SIZE = 500;
  //
  //   if (candidates.length > BATCH_SIZE) {
  //     const batches = [];
  //     for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
  //       batches.push(candidates.slice(i, i + BATCH_SIZE));
  //     }
  //
  //     for (const batch of batches) {
  //       const batchPrompt = BATCH_SELECTION_PROMPT
  //         .replace('{citedActName}', row.parent_act_name || '[Unknown Act]')
  //         .replace('{citedProvision}', row.provision_number || '[Unknown Provision]')
  //         .replace('{context}', contextText)
  //         .replace('{candidatesList}', batch.map(formatCandidate).join('\n---\n'));
  //
  //       try {
  //         const response = await client.complete(
  //           [{ role: 'user', content: batchPrompt }],
  //           { type: 'json_object' },
  //           { model: 'gpt-5-mini', reasoningEffort: 'minimal' }
  //         );
  //         const result = JSON.parse(response.choices[0].message.content);
  //
  //         if (result.matches) {
  //           for (const m of result.matches) {
  //             const doc = batch.find((c: any) => String(c.document_number) === String(m.document_number));
  //             if (doc) shortlistedCandidates.push(doc);
  //           }
  //         }
  //       } catch (e) {
  //         console.error('Error in batch selection, including all candidates from batch:', e);
  //         shortlistedCandidates.push(...batch);
  //       }
  //     }
  //   } else {
  //     shortlistedCandidates = candidates;
  //   }
  //
  //   if (shortlistedCandidates.length === 0) {
  //     return { matches: [], error: 'No candidates found or selected.' };
  //   }
  //
  //   if (shortlistedCandidates.length > BATCH_SIZE) {
  //     console.warn(`Phase 1 returned ${shortlistedCandidates.length} candidates, truncating to ${BATCH_SIZE}`);
  //     shortlistedCandidates = shortlistedCandidates.slice(0, BATCH_SIZE);
  //   }
  //
  //   // --- PHASE 2: Final Ranking ---
  //   const finalPrompt = FINAL_RANKING_PROMPT
  //     .replace('{citedActName}', row.parent_act_name || '[Unknown Act]')
  //     .replace('{citedProvision}', row.provision_number || '[Unknown Provision]')
  //     .replace('{context}', contextText)
  //     .replace('{candidatesList}', shortlistedCandidates.map(formatCandidate).join('\n---\n'));
  //
  //   const finalResponse = await client.complete(
  //     [{ role: 'user', content: finalPrompt }],
  //     { type: 'json_object' },
  //     { model: 'gpt-5-mini', reasoningEffort: 'medium' }
  //   );
  //
  //   let finalResult;
  //   try {
  //     finalResult = JSON.parse(finalResponse.choices[0].message.content);
  //   } catch {
  //     return { matches: [], error: 'Failed to parse final ranking JSON.' };
  //   }
  //
  //   let matches = finalResult.matches || [];
  //   if (!Array.isArray(matches)) matches = [];
  //
  //   matches = matches.filter((m: any) => m.score >= 80);
  //
  //   return {
  //     matches: matches.map((m: any) => ({
  //       document_number: String(m.document_number),
  //       score: parseInt(m.score, 10) || 0,
  //       reasoning: m.reasoning,
  //       confidence: (parseInt(m.score, 10) || 0) / 100
  //     })),
  //     candidate_titles: candidates.map((c: any) => c.title)
  //   };
  // },
  // =====================================================================================

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
      },
      error: {
        type: 'string',
        description: 'Error message if mapping failed'
      }
    }
  },

  outputSchemaName: 'no_date_provision_mapping',

  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-5-mini',
  reasoningEffort: 'medium',
  verbosity: 'low',

  // High concurrency for fast processing (candidates now filtered by document_type='unknown')
  concurrencyLimit: 200,
  // maxConcurrentApiCalls: 10,  // Uncomment for reprocessing failures with rate limiting
  // requestsPerSecond: 5,       // Uncomment for reprocessing failures (300 RPM)

  rowMetadataFields: ['internal_parent_act_id', 'decision_id', 'language_metadata', 'parent_act_name', 'provision_number', 'teaching_texts', 'candidate_titles'],

  customIdPrefix: 'map-nodate',

  useFullDataPipeline: true
};

export default config;
