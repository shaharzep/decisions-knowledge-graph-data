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
   * Select unique CODE citations.
   * We join with decisions1 to get the ECLI and language.
   * We also fetch legal teachings for context.
   */
  dbQuery: `
    SELECT DISTINCT ON (dcp.internal_parent_act_id)
      dcp.internal_parent_act_id,
      d.decision_id,
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
    WHERE dcp.parent_act_type = 'CODE'
      AND dcp.internal_parent_act_id IS NOT NULL
    ORDER BY dcp.internal_parent_act_id
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
      return { match: null, error: 'No code family identified.' };
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
      // We join article_contents to get the text of the specific cited article
      const query = `
        SELECT d.document_number, d.title, ac.raw_markdown
        FROM documents d
        LEFT JOIN article_contents ac 
          ON d.document_number = ac.document_number 
          AND ac.article_number = $2
        WHERE d.document_number = ANY($1)
      `;
      
      // Use provision_number_key for article lookup (it's cleaner usually)
      // Fallback to provision_number if key is missing
      const articleLookup = row.provision_number_key || row.provision_number;
      
      const docs = await DatabaseConfig.executeReadOnlyQuery(query, [docNumbersToFetch, articleLookup]);
      candidateDocs = docs;
    }

    if (candidateDocs.length === 0) {
      return { match: null, error: 'No candidate documents found for identified codes.' };
    }

    // Format Context (Legal Teachings)
    const contextText = row.teaching_texts && row.teaching_texts.length > 0
      ? row.teaching_texts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

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
      .replace('{context}', contextText)
      .replace('{candidatesList}', candidatesList);

    const pass2Response = await client.complete(
      [{ role: 'user', content: pass2Prompt }],
      { type: 'json_object' },
      { model: 'gpt-5-mini', reasoningEffort: 'medium' }
    );

    let rawResult;
    try {
      rawResult = JSON.parse(pass2Response.choices[0].message.content);
    } catch (e) {
      return { matches: [], error: 'Failed to parse LLM response JSON.', candidate_titles: candidateDocs.map(d => d.title) };
    }

    // Sanitize and normalize the result
    let matches = rawResult.matches || [];
    if (!Array.isArray(matches)) matches = [];

    // Ensure all fields are correct types
    matches = matches.map((m: any) => {
      const docId = String(m.document_number);
      const candidate = candidateDocs.find(d => String(d.document_number) === docId);
      return {
        document_number: docId,
        title: candidate ? candidate.title : 'Unknown Title',
        score: parseInt(m.score, 10) || 0,
        confidence: parseFloat(m.confidence) || 0.0,
        reasoning: m.reasoning || 'No reasoning provided'
      };
    });

    // Sort by score descending
    matches.sort((a: any, b: any) => b.score - a.score);

    // Construct final result strictly adhering to schema
    const finalResult = {
      matches: matches,
      candidate_titles: candidateDocs.map(d => d.title),
      error: rawResult.error
    };
    
    return finalResult;
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
          properties: {
            document_number: { type: 'string' },
            title: { type: 'string' },
            score: { type: 'integer' },
            confidence: { type: 'number' },
            reasoning: { type: 'string' }
          },
          required: ['document_number', 'title', 'score', 'confidence', 'reasoning'],
          additionalProperties: false
        }
      },
      candidate_titles: {
        type: 'array',
        items: { type: 'string' }
      },
      error: { type: 'string' }
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
  rowMetadataFields: ['internal_parent_act_id', 'decision_id', 'language_metadata', 'parent_act_name', 'provision_number', 'teaching_texts'],
  
  customIdPrefix: 'map-code',
  
  useFullDataPipeline: true
};

export default config;
