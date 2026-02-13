/**
 * Mapping Step Definitions
 *
 * 4 mapping steps for the per-decision mapping pipeline.
 * Each step processes multiple items (provisions or cited decisions).
 * Reuses existing prompts, schemas, and helpers from the job configs.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { OpenAIConcurrentClient } from '../../concurrent/OpenAIConcurrentClient.js';
import { extractJsonFromResponse } from '../../utils/validators.js';
import { DatabaseConfig } from '../../config/database.js';
import { findCitationSnippet } from '../../jobs/map-cited-decisions/citation-finder.js';
import { STANDARD_MAPPING_PROMPT } from '../../jobs/map-provisions-standard/prompt.js';
import { PASS_1_CODE_FAMILY_PROMPT, PASS_2_EXACT_MATCH_PROMPT } from '../../jobs/map-provisions-code/prompt.js';
import { NO_DATE_MAPPING_PROMPT } from '../../jobs/map-provisions-no-date/prompt.js';
import { CITED_DECISION_MAPPING_PROMPT } from '../../jobs/map-cited-decisions/prompt.js';
import { loadAllProvisions, loadCitedDecisions } from './data-loader.js';
import { MappingStep, ItemResult, StepContext } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// Load JSON data files
// ============================================================================

const standardPopularLawsRaw: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, '../../jobs/map-provisions-standard/popular-laws.json'), 'utf-8')
);
const standardPopularLaws: Record<string, string> = {};
for (const [name, docNum] of Object.entries(standardPopularLawsRaw)) {
  standardPopularLaws[name.toLowerCase().trim()] = docNum;
}

const noDatePopularLawsRaw: Record<string, string> = JSON.parse(
  readFileSync(join(__dirname, '../../jobs/map-provisions-no-date/popular-laws.json'), 'utf-8')
);
const noDatePopularLaws: Record<string, string> = {};
for (const [name, docNum] of Object.entries(noDatePopularLawsRaw)) {
  noDatePopularLaws[name.toLowerCase().trim()] = docNum;
}

const codeMapping: Record<string, string[]> = JSON.parse(
  readFileSync(join(__dirname, '../../jobs/map-provisions-code/code-mapping.json'), 'utf-8')
);
const ALL_CODES = Object.keys(codeMapping);

const missingCourtsRaw: string[] = JSON.parse(
  readFileSync(join(__dirname, '../../jobs/map-cited-decisions/missing-courts.json'), 'utf-8')
);
const missingCourts = new Set(missingCourtsRaw.map(c => normalizeCourtName(c)));

// ============================================================================
// Shared Helper Functions
// ============================================================================

function normalizeString(str: string): string {
  return str?.toLowerCase().trim() || '';
}

function mapToCitationType(parentActType: string): string {
  const type = parentActType?.toUpperCase() || '';
  if (['LOI', 'WET'].includes(type)) return 'LAW';
  if (['DECRET', 'DECREET'].includes(type)) return 'DECREE';
  if (['ORDONNANCE', 'ORDONNANTIE'].includes(type)) return 'ORDINANCE';
  if (['ARRETE_ROYAL', 'KONINKLIJK_BESLUIT'].includes(type)) return 'ROYAL_DECREE';
  if (['BESLUIT_VAN_DE_REGERING', 'ARRETE_GOUVERNEMENT'].includes(type)) return 'GOVERNMENT_DECREE';
  if (['ARRETE_MINISTERIEL', 'MINISTERIEEL_BESLUIT'].includes(type)) return 'MINISTERIAL_DECREE';
  if (type.includes('COORDONNE') || type.includes('GECOORDINEERD')) return 'COORDINATED';
  return 'OTHER';
}

function mapToDocumentType(parentActType: string): string[] {
  const type = parentActType?.toUpperCase() || '';
  if (['LOI', 'WET'].includes(type)) return ['LOI'];
  if (['DECRET', 'DECREET'].includes(type)) return ['DECRET'];
  if (['ORDONNANCE', 'ORDONNANTIE'].includes(type)) return ['ORDONNANCE'];
  if (['ARRETE_ROYAL', 'KONINKLIJK_BESLUIT', 'BESLUIT_VAN_DE_REGERING', 'ARRETE_GOUVERNEMENT'].includes(type)) return ['ARRETE'];
  if (['GRONDWET', 'CONSTITUTION'].includes(type)) return ['CONSTITUTION'];
  return ['unknown'];
}

function formatDate(date: Date | string | null): string {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function normalizeCourtName(name: string): string {
  if (!name) return '';
  return name.toLowerCase().trim().replace(/\s+/g, ' ').replace(/['']/g, "'");
}

function isKnownMissingCourt(courtName: string): boolean {
  if (!courtName) return false;
  return missingCourts.has(normalizeCourtName(courtName));
}

// ============================================================================
// Standard LLM Call Helper (same pattern as extraction pipeline)
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
      json_schema: { name: schemaName, schema, strict: true },
    },
    {
      reasoningEffort: settings.reasoningEffort || 'medium',
      maxOutputTokens: settings.maxOutputTokens || 64000,
    }
  );

  const content = response.choices[0]?.message?.content || '{}';
  const parsed = extractJsonFromResponse(content);

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
// Output Schemas (copied from job configs)
// ============================================================================

const STANDARD_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['citation_type', 'matches', 'no_match_reason'],
  additionalProperties: false,
  properties: {
    citation_type: {
      type: 'string',
      enum: ['LAW', 'DECREE', 'ORDINANCE', 'ROYAL_DECREE', 'GOVERNMENT_DECREE', 'MINISTERIAL_DECREE', 'OTHER']
    },
    matches: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        required: ['document_number', 'confidence', 'score', 'reasoning', 'context_alignment', 'context_notes'],
        additionalProperties: false,
        properties: {
          document_number: { type: 'string' },
          confidence: { type: 'number' },
          score: { type: 'integer' },
          reasoning: { type: 'string' },
          context_alignment: { type: 'string', enum: ['STRONG', 'MODERATE', 'WEAK', 'NONE', 'TANGENTIAL'] },
          context_notes: { type: 'string' }
        }
      }
    },
    no_match_reason: { type: ['string', 'null'] }
  }
};

const CODE_OUTPUT_SCHEMA = {
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
};

const NO_DATE_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['citation_type', 'matches', 'no_match_reason'],
  additionalProperties: false,
  properties: {
    citation_type: {
      type: 'string',
      enum: ['LAW', 'DECREE', 'ORDINANCE', 'ROYAL_DECREE', 'GOVERNMENT_DECREE', 'MINISTERIAL_DECREE', 'COORDINATED', 'OTHER']
    },
    matches: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        required: ['document_number', 'confidence', 'score', 'title_match', 'reasoning', 'context_alignment', 'context_notes'],
        additionalProperties: false,
        properties: {
          document_number: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1.0 },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          title_match: { type: 'string', enum: ['EXACT', 'STRONG', 'PARTIAL', 'WEAK'] },
          reasoning: { type: 'string' },
          context_alignment: { type: 'string', enum: ['STRONG', 'MODERATE', 'WEAK', 'NONE', 'TANGENTIAL'] },
          context_notes: { type: 'string' }
        }
      }
    },
    no_match_reason: { type: ['string', 'null'] }
  }
};

const CITED_DECISION_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['matches', 'no_match_reason'],
  additionalProperties: false,
  properties: {
    matches: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        required: ['decision_id', 'court_name', 'score', 'confidence', 'reasoning'],
        additionalProperties: false,
        properties: {
          decision_id: { type: 'string' },
          court_name: { type: ['string', 'null'] },
          score: { type: 'integer', minimum: 0, maximum: 100 },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reasoning: { type: 'string' }
        }
      }
    },
    no_match_reason: { type: ['string', 'null'] }
  }
};

// ============================================================================
// Step 1: map-provisions-standard
// ============================================================================

const stepMapProvisionsStandard: MappingStep = {
  id: 'map-provisions-standard',
  dependsOn: [],

  loadItems: async (decisionId: string) => {
    const buckets = await loadAllProvisions(decisionId);
    return buckets.standard;
  },

  processItem: async (item: any, client: OpenAIConcurrentClient, context: StepContext): Promise<ItemResult> => {
    const { parent_act_name, parent_act_type, parent_act_date } = item;

    // Fast-path: popular-laws exact match
    const normalized = normalizeString(parent_act_name);
    const fastMatchDocNumber = standardPopularLaws[normalized];
    if (fastMatchDocNumber) {
      return {
        success: true,
        skipped: true,
        skipReason: `Popular law match: "${parent_act_name}"`,
        data: {
          citation_type: mapToCitationType(parent_act_type),
          matches: [{
            document_number: fastMatchDocNumber,
            confidence: 1.0,
            score: 100,
            reasoning: `Exact match to popular law: "${parent_act_name}"`,
            context_alignment: 'STRONG',
            context_notes: 'Matched via exact string lookup (pre-verified mapping)'
          }],
          no_match_reason: null
        },
      };
    }

    // Fetch candidates from DB
    const searchDate = formatDate(parent_act_date);
    const strictTypes = mapToDocumentType(parent_act_type);

    let candidates: any[] = [];
    try {
      candidates = await DatabaseConfig.executeReadOnlyQuery(
        `SELECT document_number, title, document_type FROM documents WHERE dossier_number LIKE $1 AND document_type = ANY($2)`,
        [`${searchDate}%`, strictTypes]
      );

      if (candidates.length > 200) {
        candidates = await DatabaseConfig.executeReadOnlyQuery(
          `SELECT document_number, title, document_type, similarity(title, $3) AS sim_score FROM documents WHERE dossier_number LIKE $1 AND document_type = ANY($2) ORDER BY sim_score DESC LIMIT 200`,
          [`${searchDate}%`, strictTypes, parent_act_name]
        );
      }
    } catch (error: any) {
      console.error(`      Error fetching candidates for ${item.internal_parent_act_id}:`, error.message);
    }

    // Build prompt
    const candidatesList = candidates.length > 0
      ? candidates.map((c: any) => `- [${c.document_number}] (${c.document_type}) ${c.title}`).join('\n')
      : 'No candidates found matching date.';

    const citationParagraph = context.relatedCitations.get(item.internal_provision_id) || 'No citation paragraph available.';

    const legalTeachings = context.teachingTexts.length > 0
      ? context.teachingTexts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    const prompt = STANDARD_MAPPING_PROMPT
      .replace('{citedActName}', parent_act_name || 'Unknown')
      .replace('{citationParagraph}', citationParagraph)
      .replace('{legalTeachings}', legalTeachings)
      .replace('{candidatesList}', candidatesList);

    const result = await standardLLMCall(client, prompt, STANDARD_OUTPUT_SCHEMA, 'standard_provision_mapping');
    const tokenUsage = result._tokenUsage;
    delete result._tokenUsage;

    return { success: true, data: result, tokenUsage };
  },
};

// ============================================================================
// Step 2: map-provisions-code
// ============================================================================

// Translation cache for code family identification within a pipeline run
const codeFamilyCache = new Map<string, string[]>();

const stepMapProvisionsCode: MappingStep = {
  id: 'map-provisions-code',
  dependsOn: [],

  loadItems: async (decisionId: string) => {
    const buckets = await loadAllProvisions(decisionId);
    return buckets.code;
  },

  processItem: async (item: any, client: OpenAIConcurrentClient, context: StepContext): Promise<ItemResult> => {
    const { parent_act_name, provision_number, provision_number_key } = item;

    // Pass 1: Identify code family via LLM (using client.complete for model escalation)
    const cacheKey = normalizeString(parent_act_name);
    let candidateCodes: string[];

    if (codeFamilyCache.has(cacheKey)) {
      candidateCodes = codeFamilyCache.get(cacheKey)!;
    } else {
      const pass1Prompt = PASS_1_CODE_FAMILY_PROMPT
        .replace('{citedActName}', parent_act_name)
        .replace('{availableCodesList}', ALL_CODES.map(c => `- ${c}`).join('\n'));

      try {
        const pass1Response = await client.complete(
          [{ role: 'user', content: pass1Prompt }],
          { type: 'json_object' },
          { reasoningEffort: 'low', maxOutputTokens: 1000 }
        );

        const pass1Content = pass1Response.choices[0]?.message?.content || '{}';
        const pass1Result = JSON.parse(pass1Content);
        candidateCodes = pass1Result.matches || [];
      } catch (e: any) {
        console.warn(`      Pass 1 failed for "${parent_act_name}": ${e.message}`);
        candidateCodes = [];
      }

      codeFamilyCache.set(cacheKey, candidateCodes);
    }

    if (candidateCodes.length === 0) {
      return {
        success: true,
        skipped: true,
        skipReason: `No code family identified for: ${parent_act_name}`,
        data: { decision_path: { title_matches: [], after_range_elimination: [], existence_status: [], semantic_disambiguation_used: false, semantic_match_reasoning: null }, matches: [], final_decision: 'NO_MATCH', no_match_reason: 'No code family identified' },
      };
    }

    // Gather document numbers from identified code families
    const docNumbersToFetch: string[] = [];
    for (const codeName of candidateCodes) {
      const docNumbers = codeMapping[codeName] || [];
      docNumbersToFetch.push(...docNumbers);
    }

    if (docNumbersToFetch.length === 0) {
      return {
        success: true,
        skipped: true,
        skipReason: `No document numbers mapped for codes: ${candidateCodes.join(', ')}`,
        data: { decision_path: { title_matches: [], after_range_elimination: [], existence_status: [], semantic_disambiguation_used: false, semantic_match_reasoning: null }, matches: [], final_decision: 'NO_MATCH', no_match_reason: 'No document numbers for identified codes' },
      };
    }

    // Fetch candidate documents from DB
    const articleLookup = provision_number_key || provision_number;
    const candidateQuery = `
      SELECT d.document_number, d.title, d.dossier_number, ac.raw_markdown
      FROM documents d
      LEFT JOIN article_contents ac
        ON d.document_number = ac.document_number
        AND ac.article_number = $2
      WHERE d.document_number = ANY($1)
        AND ($3::date IS NULL
             OR TO_DATE(SUBSTRING(d.dossier_number, 1, 10), 'YYYY-MM-DD') < $3::date)
    `;

    let candidates: any[];
    try {
      candidates = await DatabaseConfig.executeReadOnlyQuery(candidateQuery, [
        docNumbersToFetch,
        articleLookup,
        context.decisionDate,
      ]);
    } catch (e: any) {
      throw new Error(`DB query failed for ${item.internal_parent_act_id}: ${e.message}`);
    }

    if (candidates.length === 0) {
      return {
        success: true,
        skipped: true,
        skipReason: `No candidate documents found for: ${item.internal_parent_act_id}`,
        data: { decision_path: { title_matches: [], after_range_elimination: [], existence_status: [], semantic_disambiguation_used: false, semantic_match_reasoning: null }, matches: [], final_decision: 'NO_MATCH', no_match_reason: 'No candidate documents found' },
      };
    }

    // Pass 2: Build prompt for exact document matching
    const candidatesList = candidates.map((d: any) => {
      const content = d.raw_markdown
        ? d.raw_markdown.substring(0, 800) + (d.raw_markdown.length > 800 ? '...' : '')
        : 'Not available';
      return `ID: ${d.document_number}\nTitle: ${d.title}\nArticle Content: ${content}`;
    }).join('\n---\n');

    const citationParagraph = context.relatedCitations.get(item.internal_provision_id) || 'No citation paragraph available.';
    const contextText = context.teachingTexts.length > 0
      ? context.teachingTexts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    const prompt = PASS_2_EXACT_MATCH_PROMPT
      .replace('{citedArticle}', provision_number)
      .replace('{citedActName}', parent_act_name)
      .replace('{citationParagraph}', citationParagraph)
      .replace('{context}', contextText)
      .replace('{candidatesList}', candidatesList);

    const rawResult = await standardLLMCall(client, prompt, CODE_OUTPUT_SCHEMA, 'code_provision_mapping');
    const tokenUsage = rawResult._tokenUsage;
    delete rawResult._tokenUsage;

    // Post-process (same as postProcessRow in config)
    let matches = rawResult.matches || [];
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

    matches.sort((a: any, b: any) => b.score - a.score);

    const decisionPath = rawResult.decision_path || {
      title_matches: [],
      after_range_elimination: [],
      existence_status: {},
      semantic_disambiguation_used: false,
      semantic_match_reasoning: null
    };

    return {
      success: true,
      data: {
        decision_path: decisionPath,
        matches,
        final_decision: rawResult.final_decision || 'NO_MATCH',
        no_match_reason: rawResult.no_match_reason || null
      },
      tokenUsage,
    };
  },
};

// ============================================================================
// Step 3: map-provisions-no-date
// ============================================================================

// Translation cache shared within pipeline run
const translationCache = new Map<string, string>();

async function translateToFrench(actName: string, client: OpenAIConcurrentClient): Promise<string> {
  if (!actName || actName.trim().length === 0) return actName;

  const cacheKey = actName.toLowerCase().trim();
  if (translationCache.has(cacheKey)) {
    return translationCache.get(cacheKey)!;
  }

  try {
    // client.complete() always forces json_object format, so we ask for JSON output
    const response = await client.complete(
      [
        { role: 'system', content: 'Translate the Belgian legal act name from Dutch/German to French. Return JSON: {"translation": "French text here"}. Keep dates and numbers unchanged.' },
        { role: 'user', content: actName },
      ],
      { type: 'json_object' },
      { reasoningEffort: 'low', maxOutputTokens: 200 }
    );

    let translated = actName;
    const content = response.choices[0]?.message?.content;
    if (content) {
      try {
        const parsed = JSON.parse(content);
        translated = parsed.translation || content.trim();
      } catch {
        // If JSON parse fails, use raw content
        translated = content.trim();
      }
    }

    translationCache.set(cacheKey, translated);
    return translated;
  } catch (e: any) {
    console.warn(`      Translation failed for "${actName}": ${e.message}`);
    return actName;
  }
}

const stepMapProvisionsNoDate: MappingStep = {
  id: 'map-provisions-no-date',
  dependsOn: [],

  loadItems: async (decisionId: string) => {
    const buckets = await loadAllProvisions(decisionId);
    return buckets.noDate;
  },

  processItem: async (item: any, client: OpenAIConcurrentClient, context: StepContext): Promise<ItemResult> => {
    const { parent_act_name, parent_act_type, provision_number, provision_number_key } = item;

    // Fast-path: popular-laws exact match
    const normalized = normalizeString(parent_act_name);
    const fastMatchDocNumber = noDatePopularLaws[normalized];
    if (fastMatchDocNumber) {
      return {
        success: true,
        skipped: true,
        skipReason: `Popular law match: "${parent_act_name}"`,
        data: {
          citation_type: mapToCitationType(parent_act_type),
          matches: [{
            document_number: fastMatchDocNumber,
            confidence: 1.0,
            score: 100,
            title_match: 'EXACT',
            reasoning: `Exact match to popular law: "${parent_act_name}"`,
            context_alignment: 'STRONG',
            context_notes: 'Matched via exact string lookup (pre-verified mapping)'
          }],
          no_match_reason: null
        },
      };
    }

    // Determine article lookup key
    const articleLookup = provision_number_key || provision_number;
    if (!articleLookup) {
      return {
        success: true,
        skipped: true,
        skipReason: `No article number for ${item.internal_parent_act_id}`,
        data: { citation_type: mapToCitationType(parent_act_type), matches: [], no_match_reason: 'No article number available' },
      };
    }

    // Translate non-French act names for better similarity matching
    const language = context.language?.toUpperCase();
    const needsTranslation = language === 'NL' || language === 'DE';
    const searchName = needsTranslation && parent_act_name
      ? await translateToFrench(parent_act_name, client)
      : parent_act_name;

    // Fetch candidates
    const targetTypes = mapToDocumentType(parent_act_type);
    const MAX_CANDIDATES = 200;

    let query = `
      SELECT d.document_number, d.title, d.dossier_number,
             similarity(d.title, $1) AS sim_score
      FROM documents d
      JOIN article_contents ac ON d.document_number = ac.document_number
      WHERE ac.article_number = $2
        AND similarity(d.title, $1) >= 0.15
    `;
    const params: any[] = [searchName, articleLookup];
    let paramIdx = 3;

    if (context.decisionDate) {
      query += ` AND TO_DATE(SUBSTRING(d.dossier_number, 1, 10), 'YYYY-MM-DD') < $${paramIdx}::date`;
      params.push(context.decisionDate);
      paramIdx++;
    }

    if (targetTypes.length > 0 && !targetTypes.includes('unknown')) {
      query += ` AND d.document_type = ANY($${paramIdx})`;
      params.push(targetTypes);
    }

    query += ` ORDER BY sim_score DESC LIMIT ${MAX_CANDIDATES}`;

    let candidates: any[];
    try {
      candidates = await DatabaseConfig.executeReadOnlyQuery(query, params);
    } catch (e: any) {
      throw new Error(`DB query failed for ${item.internal_parent_act_id}: ${e.message}`);
    }

    // Build prompt
    const candidatesList = candidates.length > 0
      ? candidates.map((c: any) => {
          const date = c.dossier_number ? c.dossier_number.substring(0, 10) : 'Unknown';
          return `- [${c.document_number}] (${date}) ${c.title}`;
        }).join('\n')
      : 'No candidates found.';

    const citationParagraph = context.relatedCitations.get(item.internal_provision_id) || 'No citation paragraph available.';
    const legalTeachings = context.teachingTexts.length > 0
      ? context.teachingTexts.map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    const prompt = NO_DATE_MAPPING_PROMPT
      .replace('{citedActName}', parent_act_name || 'Unknown')
      .replace('{citationParagraph}', citationParagraph)
      .replace('{legalTeachings}', legalTeachings)
      .replace('{candidatesList}', candidatesList);

    const result = await standardLLMCall(client, prompt, NO_DATE_OUTPUT_SCHEMA, 'no_date_provision_mapping');
    const tokenUsage = result._tokenUsage;
    delete result._tokenUsage;

    return { success: true, data: result, tokenUsage };
  },
};

// ============================================================================
// Step 4: map-cited-decisions
// ============================================================================

interface Candidate {
  decision_id: string;
  court_ecli_code: string;
  court_name: string;
  decision_date: string;
  decision_type: string | null;
  rol_number: string | null;
  teaching_texts: string[] | null;
  summaries: string[] | null;
}

async function fetchCandidateDecisions(citedDate: string, courtEcliCode: string | null): Promise<Candidate[]> {
  let query = `
    SELECT
      d.id AS db_id,
      d.decision_id,
      d.court_ecli_code,
      d.language_metadata,
      c.courtfr AS court_name_fr,
      c.courtnl AS court_name_nl,
      d.decision_date,
      dt.decision_type_fr,
      dt.decision_type_nl,
      d.rol_number,
      (
        SELECT ARRAY_AGG(dlt.teaching_text)
        FROM decision_legal_teachings dlt
        WHERE dlt.decision_id = d.id
      ) AS teaching_texts,
      (
        SELECT ARRAY_AGG(s.summary)
        FROM summaries s
        WHERE s.decision_id = d.id
      ) AS summaries
    FROM decisions1 d
    LEFT JOIN courts c ON c.id = d.court_ecli_code
    LEFT JOIN decision_types dt ON dt.decisiontypeeclicode = d.decision_type_ecli_code
    WHERE d.decision_date = $1
  `;

  const params: any[] = [citedDate];

  if (courtEcliCode) {
    query += ` AND d.court_ecli_code = $2`;
    params.push(courtEcliCode);
  }

  query += ` ORDER BY d.decision_id`;

  try {
    const rows = await DatabaseConfig.executeReadOnlyQuery(query, params);
    return rows.map((r: any) => {
      const isNL = r.language_metadata === 'NL';
      return {
        decision_id: r.decision_id,
        court_ecli_code: r.court_ecli_code,
        court_name: isNL
          ? (r.court_name_nl || r.court_name_fr || r.court_ecli_code)
          : (r.court_name_fr || r.court_name_nl || r.court_ecli_code),
        decision_date: formatDate(r.decision_date),
        decision_type: isNL
          ? (r.decision_type_nl || r.decision_type_fr || null)
          : (r.decision_type_fr || r.decision_type_nl || null),
        rol_number: r.rol_number || null,
        teaching_texts: r.teaching_texts || null,
        summaries: r.summaries || null
      };
    });
  } catch (error) {
    console.error(`      Error fetching candidates for date ${citedDate}:`, error);
    return [];
  }
}

const stepMapCitedDecisions: MappingStep = {
  id: 'map-cited-decisions',
  dependsOn: [],

  loadItems: async (decisionId: string) => {
    return loadCitedDecisions(decisionId);
  },

  processItem: async (item: any, client: OpenAIConcurrentClient, context: StepContext): Promise<ItemResult> => {
    const { cited_date, cited_court_name, cited_ecli, cited_case_number, source_ecli, treatment } = item;

    // Skip known missing courts
    if (isKnownMissingCourt(cited_court_name)) {
      return {
        success: true,
        skipped: true,
        skipReason: `Known missing court: ${cited_court_name}`,
        data: { matches: [], no_match_reason: `Court "${cited_court_name}" is not in database` },
      };
    }

    // Format and validate date
    const searchDate = formatDate(cited_date);
    if (!searchDate) {
      return {
        success: true,
        skipped: true,
        skipReason: 'cited_date is null or invalid',
        data: { matches: [], no_match_reason: 'cited_date is null or invalid' },
      };
    }

    // Extract citation snippet from source markdown
    const { snippet: citationSnippet, matchedOn: snippetMatchType } = findCitationSnippet(
      context.sourceMarkdown,
      cited_court_name,
      searchDate,
      cited_case_number,
      cited_ecli
    );

    // Fetch all candidates for this date
    const candidates = await fetchCandidateDecisions(searchDate, null);

    // No candidates for date
    if (candidates.length === 0) {
      return {
        success: true,
        skipped: true,
        skipReason: `No decisions found for date ${searchDate}`,
        data: { matches: [], no_match_reason: `No decisions found for date ${searchDate}` },
      };
    }

    // Fast-path: exact ECLI match
    if (cited_ecli) {
      const ecliMatch = candidates.find(c =>
        c.decision_id.toLowerCase() === cited_ecli.toLowerCase()
      );
      if (ecliMatch) {
        return {
          success: true,
          skipped: true,
          skipReason: `Exact ECLI match: ${cited_ecli}`,
          data: {
            matches: [{
              decision_id: ecliMatch.decision_id,
              court_name: ecliMatch.court_name || null,
              score: 100,
              confidence: 1.0,
              reasoning: `Exact ECLI match: ${cited_ecli}`
            }],
            no_match_reason: null
          },
        };
      }
    }

    // Build prompt for LLM disambiguation
    const truncate = (text: string | null, maxLen: number): string => {
      if (!text) return 'Not available';
      return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
    };

    const formatCandidateContext = (c: Candidate): string => {
      if (c.teaching_texts && c.teaching_texts.length > 0) {
        const teachingsText = c.teaching_texts
          .slice(0, 3)
          .map((t, idx) => `     ${idx + 1}. ${truncate(t, 250)}`)
          .join('\n');
        return `   Legal Teachings:\n${teachingsText}`;
      } else if (c.summaries && c.summaries.length > 0) {
        const summariesText = c.summaries
          .slice(0, 3)
          .map((s, idx) => `     ${idx + 1}. ${truncate(s, 200)}`)
          .join('\n');
        return `   Summaries:\n${summariesText}`;
      }
      return '   Context: Not available';
    };

    const candidatesList = candidates.map((c: Candidate, i: number) =>
      `${i + 1}. [${c.decision_id}]
   Court: ${c.court_name}
   Date: ${c.decision_date}
   Type: ${c.decision_type || 'Unknown'}
   Case Number (rol_number): ${c.rol_number || 'Not available'}
${formatCandidateContext(c)}`
    ).join('\n\n');

    const legalTeachings = context.teachingTexts.length > 0
      ? context.teachingTexts.slice(0, 5).map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    const citationSnippetText = citationSnippet
      ? `${citationSnippet}\n\n(Matched on: ${snippetMatchType})`
      : 'Citation location not found in source text.';

    const prompt = CITED_DECISION_MAPPING_PROMPT
      .replace('{citedCourtName}', cited_court_name || 'Unknown')
      .replace('{citedDate}', searchDate || 'Unknown')
      .replace('{citedCaseNumber}', cited_case_number || 'Not provided')
      .replace('{citedEcli}', cited_ecli || 'Not provided')
      .replace('{sourceDecisionEcli}', source_ecli || 'Unknown')
      .replace('{legalTeachings}', legalTeachings)
      .replace('{treatment}', treatment || 'Not specified')
      .replace('{citationSnippet}', citationSnippetText)
      .replace('{candidatesList}', candidatesList)
      .replace('{candidateCount}', String(candidates.length));

    const result = await standardLLMCall(client, prompt, CITED_DECISION_OUTPUT_SCHEMA, 'cited_decision_mapping');
    const tokenUsage = result._tokenUsage;
    delete result._tokenUsage;

    return { success: true, data: result, tokenUsage };
  },
};

// ============================================================================
// Export All Steps
// ============================================================================

export const MAPPING_STEPS: MappingStep[] = [
  stepMapProvisionsStandard,
  stepMapProvisionsCode,
  stepMapProvisionsNoDate,
  stepMapCitedDecisions,
];
