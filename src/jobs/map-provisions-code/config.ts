import { JobConfig } from '../JobConfig.js';
import { PASS_1_CODE_FAMILY_PROMPT, PASS_2_EXACT_MATCH_PROMPT } from './prompt.js';
import { DatabaseConfig } from '../../config/database.js';
import { AzureConfig } from '../../config/azure.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load Code Mapping
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const codeMappingPath = path.join(__dirname, 'code-mapping.json');
const codeMapping: Record<string, string[]> = JSON.parse(fs.readFileSync(codeMappingPath, 'utf-8'));

const ALL_CODES = Object.keys(codeMapping);

// =====================================================================================
// PASS 1 HELPER: Identify Code Family
// =====================================================================================

/**
 * Call LLM to identify which code family the cited act belongs to.
 * Returns array of code family names (e.g., ["Code civil", "Code judiciaire"]).
 */
async function identifyCodeFamily(parentActName: string): Promise<string[]> {
  const prompt = PASS_1_CODE_FAMILY_PROMPT
    .replace('{citedActName}', parentActName)
    .replace('{availableCodesList}', ALL_CODES.map(c => `- ${c}`).join('\n'));

  try {
    const client = AzureConfig.getClient();
    const response: any = await client.responses.create({
      model: AzureConfig.getDeployment(),
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: prompt }]
        }
      ],
      text: { format: { type: 'json_object' } },
      reasoning: { effort: 'low' }
    });

    let content = '';
    if (response.output_text) {
      content = response.output_text;
    } else if (response.output?.[0]?.content?.[0]?.text) {
      content = response.output[0].content[0].text;
    }

    const result = JSON.parse(content);
    return result.matches || [];
  } catch (e: any) {
    console.warn(`Pass 1 failed for "${parentActName}": ${e.message}`);
    return [];
  }
}

// =====================================================================================
// JOB CONFIG
// =====================================================================================

/**
 * CODE Provision Mapping Job
 *
 * Maps CODE/Constitution provisions using a two-pass approach:
 * - Pass 1 (preprocessRow): Identify code family from cited act name
 * - Pass 2 (promptTemplate → LLM): Match exact document within that family
 */
const config: JobConfig = {
  id: 'map-provisions-code',
  description: 'Map cited CODE provisions to specific documents (Two-Pass Algorithm)',

  /**
   * Select unique CODE/WETBOEK/GRONDWET/CONSTITUTION citations.
   * Joins citation context tables to get the paragraph where the provision is cited.
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
    WHERE dcp.parent_act_type IN ('CODE', 'WETBOEK', 'GRONDWET', 'CONSTITUTION')
      AND dcp.internal_parent_act_id IS NOT NULL
    ORDER BY dcp.internal_parent_act_id
    limit 100
  `,

  dbQueryParams: [],

  /**
   * Pass 1: Identify code family and fetch candidate documents.
   * Returns null to skip rows where no candidates are found.
   */
  preprocessRow: async (row: any) => {
    // --- PASS 1: Identify Code Family ---
    const candidateCodes = await identifyCodeFamily(row.parent_act_name);

    if (candidateCodes.length === 0) {
      console.warn(`No code family identified for: ${row.parent_act_name}`);
      return null;
    }

    // --- Gather document numbers from identified code families ---
    const docNumbersToFetch: string[] = [];
    for (const codeName of candidateCodes) {
      const docNumbers = codeMapping[codeName] || [];
      docNumbersToFetch.push(...docNumbers);
    }

    if (docNumbersToFetch.length === 0) {
      console.warn(`No document numbers mapped for codes: ${candidateCodes.join(', ')}`);
      return null;
    }

    // --- Fetch candidate documents from DB ---
    // Filter: only include documents published BEFORE the decision date
    const query = `
      SELECT d.document_number, d.title, d.dossier_number, ac.raw_markdown
      FROM documents d
      LEFT JOIN article_contents ac
        ON d.document_number = ac.document_number
        AND ac.article_number = $2
      WHERE d.document_number = ANY($1)
        AND ($3::date IS NULL
             OR TO_DATE(SUBSTRING(d.dossier_number, 1, 10), 'YYYY-MM-DD') < $3::date)
    `;

    const articleLookup = row.provision_number_key || row.provision_number;

    try {
      const candidates = await DatabaseConfig.executeReadOnlyQuery(query, [
        docNumbersToFetch,
        articleLookup,
        row.decision_date
      ]);

      if (candidates.length === 0) {
        console.warn(`No candidate documents found for: ${row.internal_parent_act_id}`);
        return null;
      }

      return {
        ...row,
        candidates,
        candidate_titles: candidates.map((c: any) => c.title),
        identified_code_families: candidateCodes
      };
    } catch (e: any) {
      console.error(`DB query failed for ${row.internal_parent_act_id}: ${e.message}`);
      return null;
    }
  },

  /**
   * Pass 2: Generate prompt for exact document matching.
   */
  promptTemplate: (row: any) => {
    const candidates = row.candidates || [];

    // Format candidates list with article content
    const candidatesList = candidates.map((d: any) => {
      const content = d.raw_markdown
        ? d.raw_markdown.substring(0, 800) + (d.raw_markdown.length > 800 ? '...' : '')
        : 'Not available';
      return `ID: ${d.document_number}\nTitle: ${d.title}\nArticle Content: ${content}`;
    }).join('\n---\n');

    // Format legal teachings
    const contextText = row.teaching_texts?.length > 0
      ? row.teaching_texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    // Format citation paragraph
    const citationParagraph = row.citation_paragraph || 'No citation paragraph available.';

    return PASS_2_EXACT_MATCH_PROMPT
      .replace('{citedArticle}', row.provision_number)
      .replace('{citedActName}', row.parent_act_name)
      .replace('{citationParagraph}', citationParagraph)
      .replace('{context}', contextText)
      .replace('{candidatesList}', candidatesList);
  },

  /**
   * Normalize LLM output and attach candidate_titles from preprocessing.
   */
  postProcessRow: (_row: any, result: any) => {
    // Normalize matches array
    let matches = result.matches || [];
    if (!Array.isArray(matches)) matches = [];

    matches = matches.map((m: any) => ({
      document_number: String(m.document_number || ''),
      title: String(m.title || ''),
      score: parseInt(m.score, 10) || 0,
      confidence: parseFloat(m.confidence) || 0.0,
      title_match: m.title_match || 'NO_MATCH',
      range_status: m.range_status || 'NO_RANGE',
      existence_status: m.existence_status || 'UNKNOWN',
      is_abrogated: m.is_abrogated || false,
      reasoning: m.reasoning || 'No reasoning provided'
    }));

    // Sort by score descending
    matches.sort((a: any, b: any) => b.score - a.score);

    // Normalize decision_path
    const decisionPath = result.decision_path || {
      title_matches: [],
      after_range_elimination: [],
      existence_status: {},
      semantic_disambiguation_used: false,
      semantic_match_reasoning: null
    };

    return {
      decision_path: decisionPath,
      matches,
      final_decision: result.final_decision || 'NO_MATCH',
      no_match_reason: result.no_match_reason || null
    };
  },

  /**
   * Output Schema — matches PASS_2_EXACT_MATCH_PROMPT output format
   */
  outputSchema: {
    type: 'object',
    required: ['decision_path', 'matches', 'final_decision', 'no_match_reason'],
    additionalProperties: false,
    properties: {
      decision_path: {
        type: 'object',
        required: ['title_matches', 'after_range_elimination', 'existence_status', 'semantic_disambiguation_used', 'semantic_match_reasoning'],
        additionalProperties: false,
        properties: {
          title_matches: { type: 'array', items: { type: 'string' } },
          after_range_elimination: { type: 'array', items: { type: 'string' } },
          existence_status: {
            type: 'array',
            items: {
              type: 'object',
              required: ['candidate_id', 'status'],
              additionalProperties: false,
              properties: {
                candidate_id: { type: 'string' },
                status: { type: 'string', enum: ['EXISTS', 'UNKNOWN'] }
              }
            }
          },
          semantic_disambiguation_used: { type: 'boolean' },
          semantic_match_reasoning: { type: ['string', 'null'] }
        }
      },
      matches: {
        type: 'array',
        items: {
          type: 'object',
          required: ['document_number', 'title', 'score', 'confidence', 'title_match', 'range_status', 'existence_status', 'is_abrogated', 'reasoning'],
          additionalProperties: false,
          properties: {
            document_number: { type: 'string' },
            title: { type: 'string' },
            score: { type: 'integer' },
            confidence: { type: 'number' },
            title_match: { type: 'string', enum: ['MATCH', 'NO_MATCH'] },
            range_status: { type: 'string', enum: ['INCLUDES', 'EXCLUDES', 'NO_RANGE'] },
            existence_status: { type: 'string', enum: ['EXISTS', 'UNKNOWN'] },
            is_abrogated: { type: 'boolean' },
            reasoning: { type: 'string' }
          }
        }
      },
      final_decision: { type: 'string', enum: ['SINGLE_MATCH', 'RESOLVED_BY_RANGE', 'RESOLVED_BY_EXISTENCE', 'RESOLVED_BY_SEMANTIC', 'AMBIGUOUS', 'NO_MATCH'] },
      no_match_reason: { type: ['string', 'null'] }
    }
  },

  outputSchemaName: 'code_provision_mapping',

  // Azure OpenAI Configuration
  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-5-mini',
  reasoningEffort: 'medium',
  concurrencyLimit: 200,

  // Row metadata to track in results
  rowMetadataFields: [
    'internal_parent_act_id',
    'decision_id',
    'decision_date',
    'language_metadata',
    'parent_act_name',
    'provision_number',
    'provision_number_key',
    'parent_act_type',
    'citation_paragraph',
    'teaching_texts',
    'candidate_titles',
    'identified_code_families'
  ],

  customIdPrefix: 'map-code',

  useFullDataPipeline: false
};

export default config;
