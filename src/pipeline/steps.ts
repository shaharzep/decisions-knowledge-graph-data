/**
 * Pipeline Step Definitions
 *
 * Defines all 12 extraction steps for the single-decision pipeline.
 * Each step imports reusable pieces (prompts, schemas, executors) directly
 * from the existing job files, avoiding module-level side effects.
 */

import { OpenAIConcurrentClient } from '../concurrent/OpenAIConcurrentClient.js';
import { extractJsonFromResponse } from '../utils/validators.js';

// ============================================================================
// Safe imports (no module-level side effects)
// ============================================================================

// Step 1: extract-comprehensive
import { COMPREHENSIVE_PROMPT } from '../jobs/extract-comprehensive/prompt.js';
import extractComprehensiveConfig from '../jobs/extract-comprehensive/config.js';

// Step 2: extract-provisions-2a
import { executeTwoStageExtraction as executeTwoStageProvisions } from '../jobs/extract-provisions-2a/two-stage-executor.js';
// Step 3: extract-cited-decisions
import { executeTwoStageExtraction as executeTwoStageDecisions } from '../jobs/extract-cited-decisions/two-stage-executor.js';

// Step 4: extract-keywords
import { KEYWORD_EXTRACTION_PROMPT } from '../jobs/extract-keywords/prompt.js';
import extractKeywordsConfig from '../jobs/extract-keywords/config.js';

// Step 5: extract-micro-summary
import { createMicroSummaryPrompt } from '../jobs/extract-micro-summary/prompt.js';
import extractMicroSummaryConfig from '../jobs/extract-micro-summary/config.js';

// Step 6: enrich-provisions (regex, no LLM)
import { ReferenceExtractorN8N } from '../utils/referenceExtractorN8N.js';

// Step 7: interpret-provisions (prompt + schema safe, config has side effects)
import { INTERPRET_PROVISIONS_PROMPT } from '../jobs/interpret-provisions/prompt.js';

// Step 8: extract-legal-teachings (prompt + schema load from files, safe - no side effects)
import { EXTRACT_LEGAL_TEACHINGS_PROMPT } from '../jobs/extract-legal-teachings/prompt.js';
import { EXTRACT_LEGAL_TEACHINGS_SCHEMA, EXTRACT_LEGAL_TEACHINGS_SCHEMA_NAME } from '../jobs/extract-legal-teachings/schema.js';

// Step 10: enrich-provision-citations
import { ENRICH_PROVISION_CITATIONS_PROMPT } from '../jobs/enrich-provision-citations/prompt.js';
import { enrichProvisionCitationsSchema, SCHEMA_NAME as PROVISION_CITATIONS_SCHEMA_NAME } from '../jobs/enrich-provision-citations/schema.js';

// Step 11: enrich-teaching-citations
import { ENRICH_TEACHING_CITATIONS_PROMPT } from '../jobs/enrich-teaching-citations/prompt.js';
import { enrichTeachingCitationsSchema, SCHEMA_NAME as TEACHING_CITATIONS_SCHEMA_NAME } from '../jobs/enrich-teaching-citations/schema.js';

// Step 12: classify-legal-issues
import {
  TeachingInput,
  runStage1CandidateGeneration,
  runStage2TopicSetSelection,
  runStage3WithRetry,
} from '../jobs/classify-legal-issues/stages.js';
import { buildFinalClassification, validateClassification } from '../jobs/classify-legal-issues/validation.js';

// Step 9: convert-md-to-html (no LLM) + block extraction for citation steps
import { extractBlocksFromTransformedHtml, transformDecisionHtml } from '../utils/htmlTransformer.js';
import { convertMarkdownToHtml } from '../utils/markdownToHtml.js';
import * as cheerio from 'cheerio';

// ============================================================================
// Types
// ============================================================================

export interface PipelineStep {
  id: string;
  dependsOn: string[];
  requiresLLM: boolean;
  execute: (row: any, upstreamResults: Record<string, any>, client: OpenAIConcurrentClient) => Promise<any>;
  postProcess?: (row: any, upstreamResults: Record<string, any>, rawResult: any) => any;
}

// ============================================================================
// Helper: Standard single-prompt LLM call
// ============================================================================

async function standardLLMCall(
  client: OpenAIConcurrentClient,
  prompt: string,
  schema: any,
  schemaName: string,
  settings: { reasoningEffort?: 'low' | 'medium' | 'high'; maxOutputTokens?: number } = {}
): Promise<any> {
  const response = await client.complete(
    [{ role: 'user', content: prompt }],
    {
      type: 'json_schema',
      json_schema: {
        name: schemaName,
        schema,
        strict: true,
      },
    },
    {
      reasoningEffort: settings.reasoningEffort || 'medium',
      maxOutputTokens: settings.maxOutputTokens || 64000,
    }
  );

  const content = response.choices[0]?.message?.content || '{}';
  const parsed = extractJsonFromResponse(content);

  // Attach token usage for tracking
  if (response.usage) {
    parsed._tokenUsage = {
      prompt: response.usage.prompt_tokens || 0,
      completion: response.usage.completion_tokens || 0,
      total: response.usage.total_tokens || 0,
    };
  }

  return parsed;
}

// ============================================================================
// Helper: Load HTML blocks for citation steps
// ============================================================================

function loadHtmlBlocks(upstreamResults: Record<string, any>, row: any): { blocks: any[]; blocks_json: string } {
  const htmlResult = upstreamResults['convert-md-to-html'];
  if (!htmlResult?.full_html) {
    throw new Error(`No HTML available from convert-md-to-html step for ${row.decision_id}`);
  }

  const blocks = extractBlocksFromTransformedHtml(htmlResult.full_html);
  if (blocks.length === 0) {
    throw new Error(`No blocks found in HTML for decision ${row.decision_id}`);
  }

  return { blocks, blocks_json: JSON.stringify(blocks, null, 2) };
}

// ============================================================================
// Helper: extract date from ECLI (copied from extract-cited-decisions/config.ts)
// ============================================================================

function extractDateFromECLI(ecli: string): string | null {
  if (!ecli || !ecli.startsWith('ECLI:')) return null;
  const parts = ecli.split(':');
  if (parts.length < 5) return null;
  const identifier = parts[4];
  const dateMatch = identifier.match(/(\d{8})/);
  if (!dateMatch) return null;
  const dateStr = dateMatch[1];
  return `${dateStr.substring(0, 4)}-${dateStr.substring(4, 6)}-${dateStr.substring(6, 8)}`;
}

// ============================================================================
// Step Definitions
// ============================================================================

// ---------------------------------------------------------------------------
// Step 1: extract-comprehensive
// ---------------------------------------------------------------------------
const stepExtractComprehensive: PipelineStep = {
  id: 'extract-comprehensive',
  dependsOn: [],
  requiresLLM: true,
  execute: async (row, _upstream, client) => {
    const prompt = COMPREHENSIVE_PROMPT
      .replace('{decisionId}', row.decision_id || '')
      .replace('{fullText.markdown}', row.full_md || '')
      .replace('{proceduralLanguage}', row.language_metadata || 'FR');

    return standardLLMCall(
      client, prompt,
      extractComprehensiveConfig.outputSchema,
      extractComprehensiveConfig.outputSchemaName || 'comprehensive_extraction',
      { reasoningEffort: 'medium', maxOutputTokens: 128000 }
    );
  },
};

// ---------------------------------------------------------------------------
// Step 2: extract-provisions-2a
// ---------------------------------------------------------------------------
const stepExtractProvisions2a: PipelineStep = {
  id: 'extract-provisions-2a',
  dependsOn: [],
  requiresLLM: true,
  execute: async (row, _upstream, client) => {
    return executeTwoStageProvisions(row, client);
  },
  postProcess: (_row, _upstream, result) => {
    // Replicate postProcessRow from extract-provisions-2a/config.ts
    const decisionId = _row.decision_id;
    if (!decisionId) throw new Error('decision_id required for ID construction');
    if (!result.citedProvisions || !Array.isArray(result.citedProvisions)) {
      result.citedProvisions = [];
      return result;
    }

    for (const prov of result.citedProvisions) {
      if (typeof prov.provisionSequence !== 'number') throw new Error(`Missing provisionSequence`);
      if (typeof prov.parentActSequence !== 'number') throw new Error(`Missing parentActSequence`);
    }

    result.citedProvisions = result.citedProvisions.map((provision: any) => {
      const provSeq = String(provision.provisionSequence).padStart(3, '0');
      const actSeq = String(provision.parentActSequence).padStart(3, '0');
      return {
        ...provision,
        internalProvisionId: `ART-${decisionId}-${provSeq}`,
        internalParentActId: `ACT-${decisionId}-${actSeq}`,
      };
    });

    return result;
  },
};

// ---------------------------------------------------------------------------
// Step 3: extract-cited-decisions
// ---------------------------------------------------------------------------
const stepExtractCitedDecisions: PipelineStep = {
  id: 'extract-cited-decisions',
  dependsOn: [],
  requiresLLM: true,
  execute: async (row, _upstream, client) => {
    return executeTwoStageDecisions(row, client);
  },
  postProcess: (_row, _upstream, result) => {
    // Replicate postProcessRow from extract-cited-decisions/config.ts
    const decisionId = _row.decision_id;
    if (!decisionId) throw new Error('decision_id required for ID construction');
    if (!result.citedDecisions || !Array.isArray(result.citedDecisions)) {
      result.citedDecisions = [];
      return result;
    }

    // Filter self-citations by date
    const decisionDate = extractDateFromECLI(decisionId);
    if (decisionDate) {
      const originalCount = result.citedDecisions.length;
      result.citedDecisions = result.citedDecisions.filter(
        (c: any) => c.date !== decisionDate
      );
      const filtered = originalCount - result.citedDecisions.length;
      if (filtered > 0) {
        console.log(`   [${decisionId}] Filtered ${filtered} self-citation(s)`);
      }
      // Re-sequence
      result.citedDecisions = result.citedDecisions.map((c: any, i: number) => ({
        ...c,
        decisionSequence: i + 1,
      }));
    }

    // Construct IDs
    result.citedDecisions = result.citedDecisions.map((citation: any) => {
      const seq = String(citation.decisionSequence).padStart(3, '0');
      return {
        ...citation,
        internalDecisionId: `DEC-${decisionId}-${seq}`,
      };
    });

    return result;
  },
};

// ---------------------------------------------------------------------------
// Step 4: extract-keywords
// ---------------------------------------------------------------------------
const stepExtractKeywords: PipelineStep = {
  id: 'extract-keywords',
  dependsOn: [],
  requiresLLM: true,
  execute: async (row, _upstream, client) => {
    const prompt = KEYWORD_EXTRACTION_PROMPT
      .replace('{decisionId}', row.decision_id || '')
      .replace('{proceduralLanguage}', row.language_metadata || 'FR')
      .replace('{fullText.markdown}', row.full_md || '');

    return standardLLMCall(
      client, prompt,
      extractKeywordsConfig.outputSchema,
      extractKeywordsConfig.outputSchemaName || 'keyword_extraction',
      { reasoningEffort: 'medium', maxOutputTokens: 16000 }
    );
  },
};

// ---------------------------------------------------------------------------
// Step 5: extract-micro-summary
// ---------------------------------------------------------------------------
const stepExtractMicroSummary: PipelineStep = {
  id: 'extract-micro-summary',
  dependsOn: [],
  requiresLLM: true,
  execute: async (row, _upstream, client) => {
    // createMicroSummaryPrompt is the promptTemplate function from config
    const prompt = createMicroSummaryPrompt(row);

    return standardLLMCall(
      client, prompt,
      extractMicroSummaryConfig.outputSchema,
      extractMicroSummaryConfig.outputSchemaName || 'micro_summary_extraction',
      { reasoningEffort: 'medium', maxOutputTokens: 16000 }
    );
  },
};

// ---------------------------------------------------------------------------
// Step 6: enrich-provisions (regex, no LLM)
// ---------------------------------------------------------------------------
const stepEnrichProvisions: PipelineStep = {
  id: 'enrich-provisions',
  dependsOn: ['extract-provisions-2a'],
  requiresLLM: false,
  execute: async (row, upstream, _client) => {
    const step2aResult = upstream['extract-provisions-2a'];
    const citedProvisions = step2aResult?.citedProvisions || [];

    // Run regex extractor
    const extractor = new ReferenceExtractorN8N();
    const extractedReferences = extractor.processDecision(
      row.decision_id || '',
      row.full_md || ''
    );

    return {
      citedProvisions,
      extractedReferences,
    };
  },
};

// ---------------------------------------------------------------------------
// Step 7: interpret-provisions
// ---------------------------------------------------------------------------
const stepInterpretProvisions: PipelineStep = {
  id: 'interpret-provisions',
  dependsOn: ['enrich-provisions'],
  requiresLLM: true,
  execute: async (row, upstream, client) => {
    const enrichResult = upstream['enrich-provisions'];
    const citedProvisions = enrichResult?.citedProvisions || [];
    const citedProvisionsJson = JSON.stringify(citedProvisions, null, 2);

    const prompt = INTERPRET_PROVISIONS_PROMPT
      .replace('{decisionId}', row.decision_id || '')
      .replace('{proceduralLanguage}', row.language_metadata || 'FR')
      .replace('{citedProvisions}', citedProvisionsJson)
      .replace('{fullText.markdown}', row.full_md || '');

    // Schema for LLM output (only sequence + interpretative fields)
    const llmSchema = {
      type: 'object',
      required: ['citedProvisions'],
      additionalProperties: false,
      properties: {
        citedProvisions: {
          type: 'array',
          minItems: 0,
          items: {
            type: 'object',
            required: ['provisionSequence', 'provisionInterpretation', 'relevantFactualContext'],
            additionalProperties: false,
            properties: {
              provisionSequence: { type: 'integer', minimum: 1, maximum: 9999 },
              provisionInterpretation: {
                anyOf: [{ type: 'string', minLength: 100, maxLength: 1000 }, { type: 'null' }],
              },
              relevantFactualContext: {
                anyOf: [{ type: 'string', minLength: 50, maxLength: 500 }, { type: 'null' }],
              },
            },
          },
        },
      },
    };

    return standardLLMCall(
      client, prompt, llmSchema,
      'provision_interpretation_2c',
      { reasoningEffort: 'medium', maxOutputTokens: 128000 }
    );
  },
  postProcess: (_row, upstream, rawResult) => {
    // Replicate postProcessRow from interpret-provisions/config.ts
    const enrichResult = upstream['enrich-provisions'];
    const inputProvisions: any[] = enrichResult?.citedProvisions || [];
    const llmProvisions: any[] = rawResult.citedProvisions || [];

    const inputBySequence = new Map<number, any>();
    for (const prov of inputProvisions) {
      if (typeof prov.provisionSequence === 'number') {
        inputBySequence.set(prov.provisionSequence, prov);
      }
    }

    const mergedProvisions = llmProvisions.map((llmProv: any) => {
      const seq = llmProv.provisionSequence;
      const inputProv = inputBySequence.get(seq);
      if (!inputProv) {
        throw new Error(`No input provision for provisionSequence ${seq}`);
      }
      return {
        provisionId: inputProv.provisionId,
        parentActId: inputProv.parentActId,
        internalProvisionId: inputProv.internalProvisionId,
        internalParentActId: inputProv.internalParentActId,
        provisionSequence: inputProv.provisionSequence,
        parentActSequence: inputProv.parentActSequence,
        provisionNumber: inputProv.provisionNumber,
        provisionNumberKey: inputProv.provisionNumberKey,
        parentActType: inputProv.parentActType,
        parentActName: inputProv.parentActName,
        parentActDate: inputProv.parentActDate,
        parentActNumber: inputProv.parentActNumber,
        provisionInterpretation: llmProv.provisionInterpretation,
        relevantFactualContext: llmProv.relevantFactualContext,
      };
    });

    const extractedReferences = enrichResult?.extractedReferences || {
      url: { eu: [], be: [] },
      reference: {
        eu: { extracted: [], verified: [] },
        be: { extracted: [], verifiedNumac: [], verifiedFileNumber: [] },
      },
    };

    return {
      citedProvisions: mergedProvisions,
      extractedReferences,
    };
  },
};

// ---------------------------------------------------------------------------
// Step 8: extract-legal-teachings
// ---------------------------------------------------------------------------
const stepExtractLegalTeachings: PipelineStep = {
  id: 'extract-legal-teachings',
  dependsOn: ['interpret-provisions', 'extract-cited-decisions'],
  requiresLLM: true,
  execute: async (row, upstream, client) => {
    const agent2cResult = upstream['interpret-provisions'];
    const agent3Result = upstream['extract-cited-decisions'];

    const citedProvisions = agent2cResult?.citedProvisions || [];
    const citedDecisions = agent3Result?.citedDecisions || [];

    const prompt = EXTRACT_LEGAL_TEACHINGS_PROMPT
      .replace('{decisionId}', row.decision_id || '')
      .replace('{proceduralLanguage}', row.language_metadata || 'FR')
      .replace('{citedProvisions}', JSON.stringify(citedProvisions, null, 2))
      .replace('{citedDecisions}', JSON.stringify(citedDecisions, null, 2))
      .replace('{fullText.markdown}', row.full_md || '');

    return standardLLMCall(
      client, prompt,
      EXTRACT_LEGAL_TEACHINGS_SCHEMA,
      EXTRACT_LEGAL_TEACHINGS_SCHEMA_NAME,
      { reasoningEffort: 'medium', maxOutputTokens: 128000 }
    );
  },
};

// ---------------------------------------------------------------------------
// Step 9: convert-md-to-html (no LLM)
// ---------------------------------------------------------------------------
const stepConvertMdToHtml: PipelineStep = {
  id: 'convert-md-to-html',
  dependsOn: [],
  requiresLLM: false,
  execute: async (row, _upstream, _client) => {
    const markdown = row.full_md || '';
    if (!markdown.trim()) {
      throw new Error(`Empty markdown for decision ${row.decision_id}`);
    }

    let html = await convertMarkdownToHtml(markdown);

    const $ = cheerio.load(html);
    const bodyContent = $('body').html();
    if (bodyContent) {
      html = bodyContent;
    }

    const { transformedHtml } = transformDecisionHtml(row.decision_id, html);
    return { full_html: transformedHtml };
  },
};

// ---------------------------------------------------------------------------
// Step 10: enrich-provision-citations
// ---------------------------------------------------------------------------
const stepEnrichProvisionCitations: PipelineStep = {
  id: 'enrich-provision-citations',
  dependsOn: ['interpret-provisions', 'extract-legal-teachings', 'extract-cited-decisions', 'convert-md-to-html'],
  requiresLLM: true,
  execute: async (row, upstream, client) => {
    const agent2cResult = upstream['interpret-provisions'];
    const agent5aResult = upstream['extract-legal-teachings'];
    const agent3Result = upstream['extract-cited-decisions'];

    const { blocks_json } = loadHtmlBlocks(upstream, row);

    const prompt = ENRICH_PROVISION_CITATIONS_PROMPT
      .replace('{decisionId}', row.decision_id || '')
      .replace('{proceduralLanguage}', row.language_metadata || 'FR')
      .replace('{blocks}', blocks_json)
      .replace('{citedProvisions}', JSON.stringify(agent2cResult?.citedProvisions || [], null, 2))
      .replace('{legalTeachings}', JSON.stringify(agent5aResult?.legalTeachings || [], null, 2))
      .replace('{citedDecisions}', JSON.stringify(agent3Result?.citedDecisions || [], null, 2));

    return standardLLMCall(
      client, prompt,
      enrichProvisionCitationsSchema,
      PROVISION_CITATIONS_SCHEMA_NAME,
      { reasoningEffort: 'medium', maxOutputTokens: 64000 }
    );
  },
};

// ---------------------------------------------------------------------------
// Step 11: enrich-teaching-citations
// ---------------------------------------------------------------------------
const stepEnrichTeachingCitations: PipelineStep = {
  id: 'enrich-teaching-citations',
  dependsOn: ['extract-legal-teachings', 'interpret-provisions', 'extract-cited-decisions', 'convert-md-to-html'],
  requiresLLM: true,
  execute: async (row, upstream, client) => {
    const agent5aResult = upstream['extract-legal-teachings'];
    const agent2cResult = upstream['interpret-provisions'];
    const agent3Result = upstream['extract-cited-decisions'];

    const { blocks_json } = loadHtmlBlocks(upstream, row);

    const prompt = ENRICH_TEACHING_CITATIONS_PROMPT
      .replace('{decisionId}', row.decision_id || '')
      .replace('{proceduralLanguage}', row.language_metadata || 'FR')
      .replace('{blocks}', blocks_json)
      .replace('{legalTeachings}', JSON.stringify(agent5aResult?.legalTeachings || [], null, 2))
      .replace('{citedProvisions}', JSON.stringify(agent2cResult?.citedProvisions || [], null, 2))
      .replace('{citedDecisions}', JSON.stringify(agent3Result?.citedDecisions || [], null, 2));

    return standardLLMCall(
      client, prompt,
      enrichTeachingCitationsSchema,
      TEACHING_CITATIONS_SCHEMA_NAME,
      { reasoningEffort: 'medium', maxOutputTokens: 64000 }
    );
  },
};

// ---------------------------------------------------------------------------
// Step 12: classify-legal-issues
// ---------------------------------------------------------------------------
const stepClassifyLegalIssues: PipelineStep = {
  id: 'classify-legal-issues',
  dependsOn: ['extract-legal-teachings'],
  requiresLLM: true,
  execute: async (row, upstream, client) => {
    const teachingsResult = upstream['extract-legal-teachings'];
    const teachings = teachingsResult?.legalTeachings || [];

    if (teachings.length === 0) {
      return { classifications: [], totalTeachings: 0 };
    }

    // Create fallback client for gpt-4.1 (lazy, only if needed)
    let fallbackClient: OpenAIConcurrentClient | null = null;
    const getFallback = () => {
      if (!fallbackClient) {
        fallbackClient = new OpenAIConcurrentClient('pipeline-classify-fallback', {
          openaiProvider: 'azure',
          model: 'gpt-4.1',
          maxConcurrentApiCalls: 5,
        });
      }
      return fallbackClient;
    };

    const classifications: any[] = [];

    for (const teaching of teachings) {
      const teachingInput: TeachingInput = {
        teachingId: teaching.teachingId,
        text: teaching.text,
        courtVerbatim: teaching.courtVerbatim,
        factualTrigger: teaching.factualTrigger,
        principleType: teaching.principleType,
        // Original config reads teaching.relatedCitedProvisions (not relatedCitedProvisionsId)
        // The LLM schema outputs relatedCitedProvisionsId, so we check both for compatibility
        relatedCitedProvisions: (teaching.relatedCitedProvisions || teaching.relatedCitedProvisionsId)?.map((id: string) => ({
          parentActName: id,
          provisionNumber: '',
        })) || [],
        decisionId: row.decision_id,
        language: row.language_metadata,
      };

      try {
        // Stage 1: Candidate Generation
        const stage1Result = await runStage1CandidateGeneration(teachingInput, client);

        // Stage 2: Topic Set Selection
        const stage2Result = await runStage2TopicSetSelection(teachingInput, stage1Result, client);

        // Stage 3: Issue Type Set Selection (with retry)
        const { result: stage3Result, retried, usedFallback } = await runStage3WithRetry(
          teachingInput, stage1Result, stage2Result, client,
          validateClassification,
          getFallback()
        );

        // Stage 4: Validation & Issue Key
        const classification = buildFinalClassification(
          teachingInput, stage1Result, stage2Result, stage3Result
        );

        classifications.push(classification);

        if (retried) {
          console.log(`   📝 Teaching ${teaching.teachingId}: Stage 3 ${usedFallback ? 'used fallback' : 'retried'}`);
        }
      } catch (error: any) {
        console.log(`   ⚠️  Classification failed for ${teaching.teachingId}: ${error.message}`);
        classifications.push({
          teaching_id: teaching.teachingId,
          error: error.message,
          status: 'failed',
        });
      }
    }

    return {
      classifications,
      totalTeachings: teachings.length,
      successCount: classifications.filter((c: any) => !c.error).length,
      failCount: classifications.filter((c: any) => c.error).length,
    };
  },
};

// ============================================================================
// Ordered Step List
// ============================================================================

export const PIPELINE_STEPS: PipelineStep[] = [
  stepExtractComprehensive,        // 1. DB row only
  stepExtractProvisions2a,         // 2. DB row only (two-stage)
  stepExtractCitedDecisions,       // 3. DB row only (regex+LLM)
  stepExtractKeywords,             // 4. DB row only
  stepExtractMicroSummary,         // 5. DB row only
  stepEnrichProvisions,            // 6. DB row + step 2 (regex, no LLM)
  stepInterpretProvisions,         // 7. DB row + step 6
  stepExtractLegalTeachings,       // 8. DB row + step 7 + step 3
  stepConvertMdToHtml,             // 9. DB row only (pandoc, no LLM)
  stepEnrichProvisionCitations,    // 10. DB row + step 7 + step 8 + step 3 + step 9
  stepEnrichTeachingCitations,     // 11. DB row + step 8 + step 9
  stepClassifyLegalIssues,         // 12. step 8 teachings
];
