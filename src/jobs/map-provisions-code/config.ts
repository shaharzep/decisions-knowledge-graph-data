
import { JobConfig } from '../JobConfig.js';
import { CODE_PASS_1_PROMPT, CODE_PASS_2_PROMPT } from './prompt.js';
import { DatabaseConfig } from '../../config/database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Load Code Mapping
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const codeMappingPath = path.join(__dirname, 'code-mapping.json');
const codeMapping = JSON.parse(fs.readFileSync(codeMappingPath, 'utf-8'));

const ALL_CODES = [
  "Code belge de la Navigation", "Code civil", "Code consulaire", "Code d'Instruction Criminelle",
  "Code de commerce", "Code de droit international privé", "Code de droit économique",
  "Code de la nationalité belge", "Code de procédure pénale militaire", "Code des droits et taxes divers",
  "Code du recouvrement amiable et forcé des créances fiscales et non fiscales", "Code électoral",
  "Code forestier", "Code judiciaire", "Code pénal social", "Code pénal", "Code rural",
  "Code de l'Enseignement supérieur (Communauté flamande)",
  "Code de l'enseignement fondamental et de l'enseignement secondaire (communauté française)",
  "Code flamand de l'enseignement secondaire", "Code flamand des Finances publiques",
  "Code bruxellois de l'Air, du Climat et de la Maîtrise de l'Energie",
  "Code bruxellois de l'aménagement du territoire (CoBAT)", "Code bruxellois du Logement",
  "Code de la démocratie locale et de la décentralisation (Région Wallonne)",
  "Code de la fonction publique wallonne", "Code électoral communal bruxellois",
  "Code flamand de l'aménagement du territoire", "Code flamand de la Fiscalité",
  "Code flamand du Logement", "Code wallon de l'Agriculture",
  "Code wallon de l'action sociale et de la santé (CWASS) - partie décrétale",
  "Code wallon de l'action sociale et de la santé (CWASS) - partie réglementaire",
  "Code wallon de l'environnement (CWE) - Partie décrétale",
  "Code wallon de l'environnement (CWE) - Partie réglementaire",
  "Code wallon de l'habitation durable",
  "Code wallon du Développement territorial (CoDt) - Partie décrétale",
  "Code wallon du Développement territorial (CoDt) - Partie réglementaire",
  "Code wallon du Tourisme", "Code wallon du patrimoine (CoPat) - partie réglementaire"
];

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
   */
  dbQuery: `
    SELECT DISTINCT ON (dcp.internal_parent_act_id)
      dcp.internal_parent_act_id,
      dcp.parent_act_name,
      dcp.provision_number,
      dcp.parent_act_type
    FROM decision_cited_provisions dcp
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
    const pass1Prompt = CODE_PASS_1_PROMPT
      .replace('{citedCodeName}', row.parent_act_name)
      .replace('{codeList}', ALL_CODES.map(c => `- ${c}`).join('\n'));

    const pass1Response = await client.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: pass1Prompt }],
      response_format: { type: 'json_object' }
    });

    const pass1Result = JSON.parse(pass1Response.choices[0].message.content);
    const candidateCodes = pass1Result.candidate_codes || [];

    if (candidateCodes.length === 0) {
      return { document_number: null, confidence: 0, reasoning: 'No code family identified.' };
    }

    // --- PASS 2: Match Exact Article ---
    // Gather candidate documents from the identified codes
    let candidateDocs: any[] = [];
    for (const codeName of candidateCodes) {
      const docNumbers = codeMapping[codeName] || [];
      if (docNumbers.length > 0) {
        // Fetch document titles and article content
        const query = `
          SELECT d.document_number, d.title, ac.main_text_raw
          FROM documents d
          LEFT JOIN article_contents ac 
            ON d.document_number = ac.document_number 
            AND ac.article_number = $2
          WHERE d.document_number = ANY($1)
        `;
        const docs = await DatabaseConfig.executeReadOnlyQuery(query, [docNumbers, row.provision_number]);
        candidateDocs = [...candidateDocs, ...docs];
      }
    }

    if (candidateDocs.length === 0) {
      return { document_number: null, confidence: 0, reasoning: 'No candidate documents found for identified codes.' };
    }

    const candidatesList = candidateDocs.map(d => 
      `ID: ${d.document_number}\nTitle: ${d.title}\nArticle Content: ${d.main_text_raw ? d.main_text_raw.substring(0, 500) + '...' : 'Not found'}`
    ).join('\n---\n');

    const pass2Prompt = CODE_PASS_2_PROMPT
      .replace('{citedCodeName}', row.parent_act_name)
      .replace('{articleNumber}', row.provision_number)
      .replace('{candidatesList}', candidatesList);

    const pass2Response = await client.chat.completions.create({
      model: 'gpt-5-mini',
      messages: [{ role: 'user', content: pass2Prompt }],
      response_format: { type: 'json_object' }
    });

    return JSON.parse(pass2Response.choices[0].message.content);
  },

  /**
   * Output Schema
   */
  outputSchema: {
    type: 'object',
    required: ['document_number', 'confidence', 'reasoning'],
    additionalProperties: false,
    properties: {
      document_number: { type: ['string', 'null'] },
      confidence: { type: 'number' },
      reasoning: { type: 'string' }
    }
  },

  outputSchemaName: 'code_provision_mapping',
  
  // Azure OpenAI Configuration
  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-5-mini',
  reasoningEffort: 'medium',
  
  rowMetadataFields: ['internal_parent_act_id', 'parent_act_name', 'provision_number'],
  
  customIdPrefix: 'map-code'
};

export default config;
