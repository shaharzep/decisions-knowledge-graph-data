import { JobConfig } from '../JobConfig.js';
import { PASS_1_CODE_FAMILY_PROMPT, PASS_2_EXACT_MATCH_PROMPT } from './prompt.js';
import { DatabaseConfig } from '../../config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load Code Mapping
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const codeMappingPath = path.join(__dirname, 'code-mapping.json');
const codeMapping = JSON.parse(fs.readFileSync(codeMappingPath, 'utf-8'));

const ALL_CODES = Object.keys(codeMapping);

/**
 * CODE Provision Mapping Job
 * 
 * Maps CODE provisions using a two-pass approach.
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
   * Custom Execution Logic for Two-Pass Approach
   */
  customExecution: async (row: any, client: any) => {
    // --- PASS 1: Identify Code Family ---
    const pass1Prompt = PASS_1_CODE_FAMILY_PROMPT
      .replace('{citedActName}', row.parent_act_name)
      .replace('{availableCodesList}', ALL_CODES.map(c => `- ${c}`).join('\n'));

    const pass1Response = await client.complete(
      [{ role: 'user', content: pass1Prompt }],
      { type: 'json_object' },
      { model: 'gpt-5-mini', reasoningEffort: 'minimal' }
    );

    const pass1Result = JSON.parse(pass1Response.choices[0].message.content);
    const candidateCodes = pass1Result.matches || [];

    if (candidateCodes.length === 0) {
      return {
        decision_path: {
          title_matches: [],
          after_range_elimination: [],
          existence_status: {},
          semantic_disambiguation_used: false,
          semantic_match_reasoning: null
        },
        matches: [],
        final_decision: 'NO_MATCH',
        no_match_reason: 'No code family identified in Pass 1.',
        candidate_titles: []
      };
    }

    // --- Data Fetching: Candidates & Context ---
    // Gather candidate documents from the identified codes
    let candidateDocs: any[] = [];
    const docNumbersToFetch: string[] = [];

    for (const codeName of candidateCodes) {
      const docNumbers = codeMapping[codeName] || [];
      docNumbersToFetch.push(...docNumbers);
    }

    if (docNumbersToFetch.length > 0) {
      // Fetch document titles and article content
      // Filter: only include documents published BEFORE the decision date
      // dossier_number format: YYYY-MM-DD... (first 10 chars = publication date)
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

      // Use provision_number_key for article lookup (it's cleaner usually)
      // Fallback to provision_number if key is missing
      const articleLookup = row.provision_number_key || row.provision_number;

      const docs = await DatabaseConfig.executeReadOnlyQuery(query, [
        docNumbersToFetch,
        articleLookup,
        row.decision_date
      ]);
      candidateDocs = docs;
    }

    if (candidateDocs.length === 0) {
      return {
        decision_path: {
          title_matches: [],
          after_range_elimination: [],
          existence_status: {},
          semantic_disambiguation_used: false,
          semantic_match_reasoning: null
        },
        matches: [],
        final_decision: 'NO_MATCH',
        no_match_reason: 'No candidate documents found for identified codes.',
        candidate_titles: []
      };
    }

    // Format Context (Legal Teachings)
    const contextText = row.teaching_texts && row.teaching_texts.length > 0
      ? row.teaching_texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    // Format Citation Paragraph
    const citationParagraph = row.citation_paragraph || 'No citation paragraph available.';

    // Format Candidates List
    const candidatesList = candidateDocs.map(d =>
      `ID: ${d.document_number}
Title: ${d.title}
Article Content: ${d.raw_markdown ? d.raw_markdown.substring(0, 800) + (d.raw_markdown.length > 800 ? '...' : '') : 'Not available'}`
    ).join('\n---\n');

    // --- PASS 2: Match Exact Article ---
    const pass2Prompt = PASS_2_EXACT_MATCH_PROMPT
      .replace('{citedArticle}', row.provision_number)
      .replace('{citedActName}', row.parent_act_name)
      .replace('{citationParagraph}', citationParagraph)
      .replace('{context}', contextText)
      .replace('{candidatesList}', candidatesList);

    const pass2Response = await client.complete(
      [{ role: 'user', content: pass2Prompt }],
      { type: 'json_object' },
      { model: 'gpt-5-mini', reasoningEffort: 'medium' }
    );

    // Extract candidate titles for output
    const candidateTitles = candidateDocs.map(d => d.title);

    let rawResult;
    try {
      rawResult = JSON.parse(pass2Response.choices[0].message.content);
    } catch (e) {
      return {
        decision_path: {
          title_matches: [],
          after_range_elimination: [],
          existence_status: {},
          semantic_disambiguation_used: false,
          semantic_match_reasoning: null
        },
        matches: [],
        final_decision: 'NO_MATCH',
        no_match_reason: 'Failed to parse LLM response JSON.',
        candidate_titles: candidateTitles
      };
    }

    // Normalize matches array
    let matches = rawResult.matches || [];
    if (!Array.isArray(matches)) matches = [];

    matches = matches.map((m: any) => ({
      document_number: String(m.document_number || ''),
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
    const decisionPath = rawResult.decision_path || {
      title_matches: [],
      after_range_elimination: [],
      existence_status: {},
      semantic_disambiguation_used: false,
      semantic_match_reasoning: null
    };

    return {
      decision_path: decisionPath,
      matches,
      final_decision: rawResult.final_decision || 'NO_MATCH',
      no_match_reason: rawResult.no_match_reason || null,
      candidate_titles: candidateTitles
    };
  },

  /**
   * Output Schema — matches PASS_2_EXACT_MATCH_PROMPT output format
   */
  outputSchema: {
    type: 'object',
    required: ['decision_path', 'matches', 'final_decision', 'no_match_reason', 'candidate_titles'],
    additionalProperties: false,
    properties: {
      decision_path: {
        type: 'object',
        required: ['title_matches', 'after_range_elimination', 'existence_status', 'semantic_disambiguation_used', 'semantic_match_reasoning'],
        additionalProperties: false,
        properties: {
          title_matches: {
            type: 'array',
            items: { type: 'string' }
          },
          after_range_elimination: {
            type: 'array',
            items: { type: 'string' }
          },
          existence_status: {
            type: 'object',
            additionalProperties: { type: 'string', enum: ['EXISTS', 'UNKNOWN'] }
          },
          semantic_disambiguation_used: { type: 'boolean' },
          semantic_match_reasoning: { type: ['string', 'null'] }
        }
      },
      matches: {
        type: 'array',
        items: {
          type: 'object',
          required: ['document_number', 'score', 'confidence', 'title_match', 'range_status', 'existence_status', 'is_abrogated', 'reasoning'],
          additionalProperties: false,
          properties: {
            document_number: { type: 'string' },
            score: { type: 'integer', minimum: 0, maximum: 100 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            title_match: {
              type: 'string',
              enum: ['MATCH', 'NO_MATCH']
            },
            range_status: {
              type: 'string',
              enum: ['INCLUDES', 'EXCLUDES', 'NO_RANGE']
            },
            existence_status: {
              type: 'string',
              enum: ['EXISTS', 'UNKNOWN']
            },
            is_abrogated: { type: 'boolean' },
            reasoning: { type: 'string' }
          }
        }
      },
      final_decision: {
        type: 'string',
        enum: ['SINGLE_MATCH', 'RESOLVED_BY_RANGE', 'RESOLVED_BY_EXISTENCE', 'RESOLVED_BY_SEMANTIC', 'AMBIGUOUS', 'NO_MATCH']
      },
      no_match_reason: {
        type: ['string', 'null']
      },
      candidate_titles: {
        type: 'array',
        items: { type: 'string' }
      }
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
    'teaching_texts'
  ],
  
  customIdPrefix: 'map-code',
  
  useFullDataPipeline: false
};

export default config;
