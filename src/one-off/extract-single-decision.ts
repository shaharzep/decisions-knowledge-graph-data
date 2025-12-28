/**
 * One-Off Single Decision Extraction
 *
 * Runs a markdown file through the extraction pipeline (2a, 2b, 2c, 3, 5)
 * WITHOUT requiring database access.
 *
 * Usage:
 *   npx tsx src/one-off/extract-single-decision.ts
 */

import fs from 'fs';
import path from 'path';
import { OpenAIConcurrentClient } from '../concurrent/OpenAIConcurrentClient.js';
import { ReferenceExtractorN8N } from '../utils/referenceExtractorN8N.js';
import { extractJsonFromResponse } from '../utils/validators.js';
import { AzureConfig } from '../config/azure.js';

// Import prompts
import { STAGE_1_AGENTIC_SNIPPETS_PROMPT as PROVISIONS_STAGE1_PROMPT } from '../jobs/extract-provisions-2a/stage1-prompt.js';
import { STAGE_2_PARSING_PROMPT as PROVISIONS_STAGE2_PROMPT } from '../jobs/extract-provisions-2a/stage2-prompt.js';
import { detectCitationRegions } from '../jobs/extract-cited-decisions/regex-extractor.js';
import { STAGE_2_PARSING_PROMPT as DECISIONS_STAGE2_PROMPT } from '../jobs/extract-cited-decisions/stage2-prompt.js';
import { INTERPRET_PROVISIONS_PROMPT } from '../jobs/interpret-provisions/prompt.js';
import { EXTRACT_LEGAL_TEACHINGS_PROMPT } from '../jobs/extract-legal-teachings/prompt.js';

// ============================================================================
// MOCK ROW DEFINITIONS
// ============================================================================

interface MockRow {
  id: number;
  decision_id: string;
  language_metadata: 'FR' | 'NL';
  full_md: string;
  md_length: number;
  decision_type_ecli_code: string | null;
  court_ecli_code: string | null;
  decision_date: string | null;
  length_category: string;
}

/**
 * Create mock rows from markdown files
 */
function createMockRows(): MockRow[] {
  const inputDir = '/Users/shaharzep/ontology/custom-decisions-mds';

  const files = [
    {
      filename: 'Jugement JP Zabari-Hydrobru.md',
      decision_id: 'CUSTOM:BE:JP-BXL1:2014:13A1578',
      decision_date: '2014-03-06',
      court_ecli_code: 'JP',
      decision_type_ecli_code: 'JUG',
    },
    {
      filename: 'Jugement TPI Zabari-Hydrobru.md',
      decision_id: 'CUSTOM:BE:TPI-BXL:2014:2013-12673-A',
      decision_date: '2014-03-19',
      court_ecli_code: 'TPI',
      decision_type_ecli_code: 'JUG',
    },
  ];

  return files.map((file, index) => {
    const filePath = path.join(inputDir, file.filename);
    const full_md = fs.readFileSync(filePath, 'utf-8');
    const md_length = full_md.length;

    let length_category = 'unknown';
    if (md_length < 10000) length_category = 'short';
    else if (md_length < 30000) length_category = 'medium';
    else if (md_length < 60000) length_category = 'long';
    else length_category = 'very_long';

    return {
      id: index + 1,
      decision_id: file.decision_id,
      language_metadata: 'FR' as const,
      full_md,
      md_length,
      decision_type_ecli_code: file.decision_type_ecli_code,
      court_ecli_code: file.court_ecli_code,
      decision_date: file.decision_date,
      length_category,
    };
  });
}

// ============================================================================
// JOB 2A: EXTRACT PROVISIONS (Two-Stage)
// ============================================================================

async function runJob2A(row: MockRow, client: OpenAIConcurrentClient): Promise<any> {
  console.log(`\n📋 [2A] Extracting provisions for ${row.decision_id}...`);

  // Stage 1: Agentic snippet creation
  const stage1Prompt = PROVISIONS_STAGE1_PROMPT
    .replaceAll('{decisionId}', row.decision_id)
    .replaceAll('{proceduralLanguage}', row.language_metadata)
    .replaceAll('{fullText.markdown}', row.full_md);

  const openaiClient = AzureConfig.getClient();
  const deployment = AzureConfig.getDeployment();

  console.log('  Stage 1: Creating enriched snippets...');
  const stage1Response = await openaiClient.responses.create({
    model: deployment,
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: stage1Prompt }],
      },
    ],
    reasoning: { effort: 'medium' },
  });

  let snippets = '';
  if (stage1Response.output_text) {
    snippets = stage1Response.output_text;
  } else if (Array.isArray(stage1Response.output)) {
    const pieces: string[] = [];
    for (const item of stage1Response.output) {
      if ('content' in item && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === 'output_text' && typeof c.text === 'string') {
            pieces.push(c.text);
          }
        }
      }
    }
    snippets = pieces.join('');
  }

  const trimmedSnippets = snippets.trim();
  if (trimmedSnippets === '' || trimmedSnippets === 'NO_SNIPPETS_FOUND' || trimmedSnippets === 'NO_SNIPPETS_FOUND.') {
    console.log('  No provisions found.');
    return { citedProvisions: [] };
  }

  // Stage 2: Parse to structured JSON
  console.log('  Stage 2: Parsing to structured JSON...');
  const stage2Prompt = PROVISIONS_STAGE2_PROMPT
    .replaceAll('{decisionId}', row.decision_id)
    .replaceAll('{proceduralLanguage}', row.language_metadata)
    .replaceAll('{agenticSnippets}', snippets);

  const stage2Response = await client.complete(
    [{ role: 'user', content: stage2Prompt }],
    {
      type: 'json_schema',
      json_schema: {
        name: 'provision_extraction',
        schema: {
          type: 'object',
          required: ['citedProvisions'],
          additionalProperties: false,
          properties: {
            citedProvisions: {
              type: 'array',
              items: {
                type: 'object',
                required: ['provisionId', 'parentActId', 'provisionSequence', 'parentActSequence',
                  'provisionNumber', 'provisionNumberKey', 'parentActType', 'parentActName',
                  'parentActDate', 'parentActNumber'],
                additionalProperties: false,
                properties: {
                  provisionId: { type: 'null' },
                  parentActId: { type: 'null' },
                  provisionSequence: { type: 'integer', minimum: 1 },
                  parentActSequence: { type: 'integer', minimum: 1 },
                  provisionNumber: { type: 'string', minLength: 3 },
                  provisionNumberKey: { type: 'string', minLength: 1 },
                  parentActType: { type: 'string' },
                  parentActName: { type: 'string', minLength: 5 },
                  parentActDate: { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
                  parentActNumber: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                },
              },
            },
          },
        },
        strict: true,
      },
    },
    { reasoningEffort: 'medium', maxOutputTokens: 64000 }
  );

  const content = stage2Response.choices[0]?.message?.content || '{}';
  const result = extractJsonFromResponse(content);

  // Post-process: construct IDs
  if (result.citedProvisions && Array.isArray(result.citedProvisions)) {
    result.citedProvisions = result.citedProvisions.map((prov: any) => {
      const provSeq = String(prov.provisionSequence).padStart(3, '0');
      const actSeq = String(prov.parentActSequence).padStart(3, '0');
      return {
        ...prov,
        internalProvisionId: `ART-${row.decision_id}-${provSeq}`,
        internalParentActId: `ACT-${row.decision_id}-${actSeq}`,
      };
    });
  }

  console.log(`  ✅ Found ${result.citedProvisions?.length || 0} provisions`);
  return result;
}

// ============================================================================
// JOB 2B: ENRICH PROVISIONS (Regex Only - No LLM)
// ============================================================================

async function runJob2B(row: MockRow, job2aResult: any): Promise<any> {
  console.log(`\n📋 [2B] Enriching provisions with regex extraction for ${row.decision_id}...`);

  const extractor = new ReferenceExtractorN8N();
  const extractedReferences = extractor.processDecision(row.decision_id, row.full_md);

  console.log(`  ✅ Extracted references: ${extractedReferences.reference.eu.verified.length} EU, ${extractedReferences.reference.be.verifiedNumac.length} NUMAC`);

  return {
    citedProvisions: job2aResult.citedProvisions || [],
    extractedReferences,
  };
}

// ============================================================================
// JOB 2C: INTERPRET PROVISIONS
// ============================================================================

async function runJob2C(row: MockRow, job2bResult: any, client: OpenAIConcurrentClient): Promise<any> {
  console.log(`\n📋 [2C] Interpreting provisions for ${row.decision_id}...`);

  if (!job2bResult.citedProvisions || job2bResult.citedProvisions.length === 0) {
    console.log('  No provisions to interpret.');
    return {
      citedProvisions: [],
      extractedReferences: job2bResult.extractedReferences,
    };
  }

  const prompt = INTERPRET_PROVISIONS_PROMPT
    .replace('{decisionId}', row.decision_id)
    .replace('{proceduralLanguage}', row.language_metadata)
    .replace('{citedProvisions}', JSON.stringify(job2bResult.citedProvisions, null, 2))
    .replace('{fullText.markdown}', row.full_md);

  const response = await client.complete(
    [{ role: 'user', content: prompt }],
    {
      type: 'json_schema',
      json_schema: {
        name: 'provision_interpretation',
        schema: {
          type: 'object',
          required: ['citedProvisions'],
          additionalProperties: false,
          properties: {
            citedProvisions: {
              type: 'array',
              items: {
                type: 'object',
                required: ['provisionSequence', 'provisionInterpretation', 'relevantFactualContext'],
                additionalProperties: false,
                properties: {
                  provisionSequence: { type: 'integer', minimum: 1, maximum: 9999 },
                  provisionInterpretation: { anyOf: [{ type: 'string', minLength: 100, maxLength: 1000 }, { type: 'null' }] },
                  relevantFactualContext: { anyOf: [{ type: 'string', minLength: 50, maxLength: 500 }, { type: 'null' }] },
                },
              },
            },
          },
        },
        strict: true,
      },
    },
    { reasoningEffort: 'medium', maxOutputTokens: 128000 }
  );

  const content = response.choices[0]?.message?.content || '{}';
  const llmResult = extractJsonFromResponse(content);

  // Post-process: merge LLM output with input provisions
  const inputProvisions = job2bResult.citedProvisions;
  const llmProvisions = llmResult.citedProvisions || [];

  const inputBySequence = new Map<number, any>();
  for (const prov of inputProvisions) {
    if (typeof prov.provisionSequence === 'number') {
      inputBySequence.set(prov.provisionSequence, prov);
    }
  }

  const mergedProvisions = llmProvisions.map((llmProv: any) => {
    const inputProv = inputBySequence.get(llmProv.provisionSequence);
    if (!inputProv) {
      console.warn(`  ⚠️  No input provision for sequence ${llmProv.provisionSequence}`);
      return null;
    }
    return {
      ...inputProv,
      provisionInterpretation: llmProv.provisionInterpretation,
      relevantFactualContext: llmProv.relevantFactualContext,
    };
  }).filter(Boolean);

  console.log(`  ✅ Interpreted ${mergedProvisions.length} provisions`);

  return {
    citedProvisions: mergedProvisions,
    extractedReferences: job2bResult.extractedReferences,
  };
}

// ============================================================================
// JOB 3: EXTRACT CITED DECISIONS (Two-Stage: Regex + LLM)
// ============================================================================

async function runJob3(row: MockRow, client: OpenAIConcurrentClient): Promise<any> {
  console.log(`\n📋 [3] Extracting cited decisions for ${row.decision_id}...`);

  // Stage 1: Regex detection
  const { regions, stats } = detectCitationRegions(row.full_md, row.decision_id);

  if (regions.length === 0) {
    console.log('  No citation regions found.');
    return { citedDecisions: [] };
  }

  console.log(`  Stage 1: Found ${regions.length} potential citation regions`);

  // Format regions for Stage 2
  const formattedRegions = regions.map(region => {
    const triggerList = region.triggers.map(t => `${t.type}: "${t.text}" @pos ${t.position}`).join(', ');
    return `
REGION ${region.regionId}:
- Trigger Type: ${region.triggerType}
- Confidence: ${region.confidence}
- Potential Jurisdiction: ${region.potentialJurisdiction || 'UNKNOWN'}
- Triggers Found: ${triggerList}
- Text Window (1200 chars):

${region.text}

---`;
  }).join('\n\n');

  // Stage 2: LLM extraction
  console.log('  Stage 2: Extracting structured data with LLM...');
  const stage2Prompt = DECISIONS_STAGE2_PROMPT
    .replaceAll('{decisionId}', row.decision_id)
    .replaceAll('{proceduralLanguage}', row.language_metadata)
    .replaceAll('{citationRegions}', formattedRegions)
    .replaceAll('{regionCount}', String(regions.length))
    .replaceAll('{triggerStats}', JSON.stringify(stats, null, 2));

  const response = await client.complete(
    [{ role: 'user', content: stage2Prompt }],
    {
      type: 'json_schema',
      json_schema: {
        name: 'cited_decisions_extraction',
        schema: {
          type: 'object',
          required: ['citedDecisions'],
          additionalProperties: false,
          properties: {
            citedDecisions: {
              type: 'array',
              items: {
                type: 'object',
                required: ['decisionId', 'decisionSequence', 'courtJurisdictionCode', 'courtName',
                  'date', 'caseNumber', 'ecli', 'treatment', 'type'],
                additionalProperties: false,
                properties: {
                  decisionId: { type: 'null' },
                  decisionSequence: { type: 'integer', minimum: 1, maximum: 9999 },
                  courtJurisdictionCode: { type: 'string', enum: ['BE', 'EU', 'INT'] },
                  courtName: { type: 'string', minLength: 3, maxLength: 200 },
                  date: { anyOf: [{ type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' }, { type: 'null' }] },
                  caseNumber: { anyOf: [{ type: 'string', minLength: 3, maxLength: 100 }, { type: 'null' }] },
                  ecli: { anyOf: [{ type: 'string', pattern: '^ECLI:[A-Z]{2}:[A-Z0-9]+:\\d{4}:.*$' }, { type: 'null' }] },
                  treatment: { type: 'string', enum: ['FOLLOWED', 'DISTINGUISHED', 'OVERRULED', 'CITED', 'UNCERTAIN'] },
                  type: { type: 'string', enum: ['PRECEDENT', 'PROCEDURAL'] },
                },
              },
            },
          },
        },
        strict: true,
      },
    },
    { reasoningEffort: 'high', maxOutputTokens: 64000 }
  );

  const content = response.choices[0]?.message?.content || '{}';
  const result = extractJsonFromResponse(content);

  // Post-process: construct IDs
  if (result.citedDecisions && Array.isArray(result.citedDecisions)) {
    result.citedDecisions = result.citedDecisions.map((citation: any) => {
      const seq = String(citation.decisionSequence).padStart(3, '0');
      return {
        ...citation,
        internalDecisionId: `DEC-${row.decision_id}-${seq}`,
      };
    });
  }

  console.log(`  ✅ Found ${result.citedDecisions?.length || 0} cited decisions`);
  return result;
}

// ============================================================================
// JOB 5: EXTRACT LEGAL TEACHINGS
// ============================================================================

async function runJob5(
  row: MockRow,
  job2cResult: any,
  job3Result: any,
  client: OpenAIConcurrentClient
): Promise<any> {
  console.log(`\n📋 [5] Extracting legal teachings for ${row.decision_id}...`);

  const citedProvisions = job2cResult.citedProvisions || [];
  const citedDecisions = job3Result.citedDecisions || [];

  const prompt = EXTRACT_LEGAL_TEACHINGS_PROMPT
    .replace('{decisionId}', row.decision_id)
    .replace('{proceduralLanguage}', row.language_metadata)
    .replace('{citedProvisions}', JSON.stringify(citedProvisions, null, 2))
    .replace('{citedDecisions}', JSON.stringify(citedDecisions, null, 2))
    .replace('{fullText.markdown}', row.full_md);

  const response = await client.complete(
    [{ role: 'user', content: prompt }],
    {
      type: 'json_schema',
      json_schema: {
        name: 'legal_teachings_extraction',
        schema: {
          type: 'object',
          required: ['legalTeachings', 'metadata'],
          additionalProperties: false,
          properties: {
            legalTeachings: {
              type: 'array',
              items: {
                type: 'object',
                required: ['teachingId', 'text', 'courtVerbatim', 'courtVerbatimLanguage',
                  'factualTrigger', 'relevantFactualContext', 'principleType', 'legalArea',
                  'hierarchicalRelationships', 'precedentialWeight', 'relatedLegalIssuesId',
                  'relatedCitedProvisionsId', 'relatedCitedDecisionsId', 'sourceAuthor'],
                additionalProperties: false,
                properties: {
                  teachingId: { type: 'string', pattern: '^TEACH-[a-zA-Z0-9:.]+-\\d{3}$' },
                  text: { type: 'string', minLength: 100, maxLength: 1000 },
                  courtVerbatim: { type: 'string', minLength: 100, maxLength: 2000 },
                  courtVerbatimLanguage: { type: 'string', enum: ['FR', 'NL'] },
                  factualTrigger: { type: 'string', minLength: 50, maxLength: 300 },
                  relevantFactualContext: { type: 'string', minLength: 50, maxLength: 500 },
                  principleType: {
                    type: 'string',
                    enum: ['INTERPRETATION_RULE', 'APPLICATION_STANDARD', 'LEGAL_TEST',
                      'BURDEN_PROOF', 'BALANCING_TEST', 'PROCEDURAL_RULE', 'REMEDIAL_PRINCIPLE'],
                  },
                  legalArea: {
                    type: 'string',
                    enum: ['DISCRIMINATION_LAW', 'DATA_PROTECTION', 'EMPLOYMENT_LAW', 'CONTRACT_LAW',
                      'CIVIL_LIABILITY', 'ADMINISTRATIVE_LAW', 'PROCEDURAL_LAW', 'COMPETITION_LAW',
                      'INTELLECTUAL_PROPERTY', 'FAMILY_LAW', 'OTHER'],
                  },
                  hierarchicalRelationships: {
                    type: 'object',
                    required: ['refinesParentPrinciple', 'refinedByChildPrinciples', 'exceptionToPrinciple',
                      'exceptedByPrinciples', 'conflictsWith'],
                    additionalProperties: false,
                    properties: {
                      refinesParentPrinciple: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                      refinedByChildPrinciples: { type: 'array', items: { type: 'string' } },
                      exceptionToPrinciple: { anyOf: [{ type: 'string' }, { type: 'null' }] },
                      exceptedByPrinciples: { type: 'array', items: { type: 'string' } },
                      conflictsWith: { type: 'array', items: { type: 'string' } },
                    },
                  },
                  precedentialWeight: {
                    type: 'object',
                    required: ['courtLevel', 'binding', 'clarity', 'novelPrinciple',
                      'confirmsExistingDoctrine', 'distinguishesPriorCase'],
                    additionalProperties: false,
                    properties: {
                      courtLevel: { type: 'string', enum: ['CASSATION', 'APPEAL', 'FIRST_INSTANCE'] },
                      binding: { type: 'boolean' },
                      clarity: { type: 'string', enum: ['EXPLICIT', 'IMPLICIT'] },
                      novelPrinciple: { type: 'boolean' },
                      confirmsExistingDoctrine: { type: 'boolean' },
                      distinguishesPriorCase: { type: 'boolean' },
                    },
                  },
                  relatedLegalIssuesId: { type: 'array', maxItems: 0, items: { type: 'string' } },
                  relatedCitedProvisionsId: { type: 'array', items: { type: 'string' } },
                  relatedCitedDecisionsId: { type: 'array', items: { type: 'string' } },
                  sourceAuthor: { type: 'string', enum: ['AI_GENERATED'] },
                },
              },
            },
            metadata: {
              type: 'object',
              required: ['totalTeachings', 'extractedCourtLevel', 'courtLevelConfidence',
                'teachingTypes', 'hierarchicalRelationships', 'courtLevelDistribution', 'validationChecks'],
              additionalProperties: false,
              properties: {
                totalTeachings: { type: 'integer', minimum: 0 },
                extractedCourtLevel: { type: 'string', enum: ['CASSATION', 'APPEAL', 'FIRST_INSTANCE'] },
                courtLevelConfidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
                teachingTypes: {
                  type: 'object',
                  required: ['interpretive', 'application', 'balancing', 'procedural', 'remedial', 'legal_test', 'burden_proof'],
                  additionalProperties: false,
                  properties: {
                    interpretive: { type: 'integer', minimum: 0 },
                    application: { type: 'integer', minimum: 0 },
                    balancing: { type: 'integer', minimum: 0 },
                    procedural: { type: 'integer', minimum: 0 },
                    remedial: { type: 'integer', minimum: 0 },
                    legal_test: { type: 'integer', minimum: 0 },
                    burden_proof: { type: 'integer', minimum: 0 },
                  },
                },
                hierarchicalRelationships: {
                  type: 'object',
                  required: ['parentChildPairs', 'ruleExceptionPairs', 'conflicts'],
                  additionalProperties: false,
                  properties: {
                    parentChildPairs: { type: 'integer', minimum: 0 },
                    ruleExceptionPairs: { type: 'integer', minimum: 0 },
                    conflicts: { type: 'integer', minimum: 0 },
                  },
                },
                courtLevelDistribution: {
                  type: 'object',
                  required: ['cassation', 'appeal', 'first_instance'],
                  additionalProperties: false,
                  properties: {
                    cassation: { type: 'integer', minimum: 0 },
                    appeal: { type: 'integer', minimum: 0 },
                    first_instance: { type: 'integer', minimum: 0 },
                  },
                },
                validationChecks: {
                  type: 'object',
                  required: ['allTeachingsHaveSourceAuthor', 'sourceAuthorCorrect', 'teachingCountReasonable',
                    'allTeachingsHaveContext', 'allTeachingsHaveVerbatim', 'legalIssuesEmptyAsExpected',
                    'allProvisionIdsValid', 'allDecisionIdsValid', 'allHierarchyReferencesValid', 'courtLevelDetected'],
                  additionalProperties: false,
                  properties: {
                    allTeachingsHaveSourceAuthor: { type: 'boolean' },
                    sourceAuthorCorrect: { type: 'boolean' },
                    teachingCountReasonable: { type: 'boolean' },
                    allTeachingsHaveContext: { type: 'boolean' },
                    allTeachingsHaveVerbatim: { type: 'boolean' },
                    legalIssuesEmptyAsExpected: { type: 'boolean' },
                    allProvisionIdsValid: { type: 'boolean' },
                    allDecisionIdsValid: { type: 'boolean' },
                    allHierarchyReferencesValid: { type: 'boolean' },
                    courtLevelDetected: { type: 'boolean' },
                  },
                },
              },
            },
          },
        },
        strict: true,
      },
    },
    { reasoningEffort: 'medium', maxOutputTokens: 128000 }
  );

  const content = response.choices[0]?.message?.content || '{}';
  const result = extractJsonFromResponse(content);

  console.log(`  ✅ Extracted ${result.legalTeachings?.length || 0} legal teachings`);
  return result;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  ONE-OFF DECISION EXTRACTION PIPELINE');
  console.log('  Jobs: 2A → 2B → 2C + 3 → 5');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Create output directory
  const outputDir = path.join(process.cwd(), 'one-off-results', new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(outputDir, { recursive: true });
  console.log(`📁 Output directory: ${outputDir}\n`);

  // Initialize client
  const client = new OpenAIConcurrentClient('one-off-extraction', {
    openaiProvider: 'azure',
    model: 'gpt-5-mini',
  });

  // Create mock rows
  const mockRows = createMockRows();
  console.log(`📄 Found ${mockRows.length} decision(s) to process:\n`);
  for (const row of mockRows) {
    console.log(`  - ${row.decision_id} (${row.length_category}, ${row.md_length} chars)`);
  }

  // Process each decision
  for (const row of mockRows) {
    console.log('\n' + '─'.repeat(70));
    console.log(`🔍 Processing: ${row.decision_id}`);
    console.log('─'.repeat(70));

    try {
      // Run pipeline
      const job2aResult = await runJob2A(row, client);
      const job2bResult = await runJob2B(row, job2aResult);
      const job2cResult = await runJob2C(row, job2bResult, client);
      const job3Result = await runJob3(row, client);
      const job5Result = await runJob5(row, job2cResult, job3Result, client);

      // Combine all results
      const combinedResult = {
        decision_id: row.decision_id,
        language: row.language_metadata,
        decision_date: row.decision_date,
        court: row.court_ecli_code,
        md_length: row.md_length,
        extraction_timestamp: new Date().toISOString(),
        job2a: job2aResult,
        job2b: job2bResult,
        job2c: job2cResult,
        job3: job3Result,
        job5: job5Result,
      };

      // Save result
      const safeFilename = row.decision_id.replace(/[/:]/g, '_');
      const outputPath = path.join(outputDir, `${safeFilename}.json`);
      fs.writeFileSync(outputPath, JSON.stringify(combinedResult, null, 2));
      console.log(`\n💾 Saved: ${outputPath}`);

      // Print summary
      console.log('\n📊 EXTRACTION SUMMARY:');
      console.log(`  Provisions extracted (2A): ${job2aResult.citedProvisions?.length || 0}`);
      console.log(`  References enriched (2B): EU=${job2bResult.extractedReferences?.reference.eu.verified.length || 0}, NUMAC=${job2bResult.extractedReferences?.reference.be.verifiedNumac.length || 0}`);
      console.log(`  Provisions interpreted (2C): ${job2cResult.citedProvisions?.length || 0}`);
      console.log(`  Cited decisions (3): ${job3Result.citedDecisions?.length || 0}`);
      console.log(`  Legal teachings (5): ${job5Result.legalTeachings?.length || 0}`);

    } catch (error) {
      console.error(`\n❌ Error processing ${row.decision_id}:`, error);

      // Save error
      const safeFilename = row.decision_id.replace(/[/:]/g, '_');
      const errorPath = path.join(outputDir, `${safeFilename}_ERROR.json`);
      fs.writeFileSync(errorPath, JSON.stringify({
        decision_id: row.decision_id,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      }, null, 2));
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('  EXTRACTION COMPLETE');
  console.log(`  Results saved to: ${outputDir}`);
  console.log('═'.repeat(70) + '\n');
}

// Run
main().catch(console.error);
