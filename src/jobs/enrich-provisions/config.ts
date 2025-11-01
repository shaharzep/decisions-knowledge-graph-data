import { JobConfig } from "../JobConfig.js";
import { ENRICH_PROVISIONS_PROMPT } from "./prompt.js";
import { extractLegalReferences, hasAnyReferences } from "../../utils/legalReferenceExtractor.js";
import { extractJsonFromResponse } from "../../utils/validators.js";
import fs from "fs";
import path from "path";

/**
 * Get latest concurrent run timestamp for a job
 */
function getLatestConcurrentTimestamp(jobId: string, model: string = 'gpt-5-mini'): string | null {
  const resultsDir = path.join(process.cwd(), 'concurrent', 'results', jobId, model);

  if (!fs.existsSync(resultsDir)) {
    return null;
  }

  const timestamps = fs.readdirSync(resultsDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(name))
    .sort()
    .reverse();

  return timestamps[0] || null;
}

/**
 * Load successful provision results from latest concurrent run
 *
 * Returns array of (decision_id, language) pairs for composite key matching.
 * Only includes records that have citedProvisions data (successful extractions).
 */
function loadSuccessfulProvisions(timestamp: string): Array<{ decision_id: string; language: string }> {
  const resultPath = path.join(
    process.cwd(),
    'concurrent/results/extract-provisions-2a/gpt-5-mini',
    timestamp,
    'extracted-data.json'
  );

  if (!fs.existsSync(resultPath)) {
    throw new Error(`Results file not found: ${resultPath}\n\nPlease verify the extract-provisions-2a run completed successfully.`);
  }

  const data = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));

  // Extract decision_id + language pairs from successful records
  const pairs = data
    .filter((record: any) => record.citedProvisions !== undefined)
    .map((record: any) => ({
      decision_id: record.decision_id,
      language: record.language || record.language_metadata
    }))
    .filter((pair: any) => pair.decision_id && pair.language);

  if (pairs.length === 0) {
    throw new Error('No successful provisions found in latest 2A run. All decisions failed.');
  }

  return pairs;
}

// Auto-detect latest run at module load time
const LATEST_2A_TIMESTAMP = getLatestConcurrentTimestamp('extract-provisions-2a', 'gpt-5-mini');

if (!LATEST_2A_TIMESTAMP) {
  throw new Error('No extract-provisions-2a concurrent results found. Please run Agent 2A first:\n  npm run dev concurrent extract-provisions-2a');
}

const SUCCESSFUL_2A_PAIRS = loadSuccessfulProvisions(LATEST_2A_TIMESTAMP);

console.log(`📋 Using extract-provisions-2a results from: ${LATEST_2A_TIMESTAMP}`);
console.log(`✅ Found ${SUCCESSFUL_2A_PAIRS.length} successful decisions to enrich`);

/**
 * Enrich Provisions Job Configuration - Agent 2B
 *
 * SCOPE: Enrich provisions from Agent 2A with metadata identifiers
 *
 * Enriches cited legal provisions with:
 * - Provision-level identifiers (ELI, Justel URL, EUR-Lex URL)
 * - Parent act identifiers (ELI, CELEX, Justel URL, EUR-Lex URL)
 * - Official publication references (parentActNumber)
 * - Citation references (Bluebook-style citations)
 *
 * DEPENDS ON: extract-provisions-2a (Agent 2A)
 * - Loads citedProvisions array from Agent 2A results
 * - Preserves all 10 fields from Agent 2A unchanged
 * - Adds 8 new enrichment fields
 *
 * Key Features:
 * - Automatic dependency loading via DependencyResolver
 * - Composite key matching (id + decision_id + language)
 * - Transform function stringifies citedProvisions for prompt
 * - Comprehensive schema validates all 18 required fields
 * - Bilingual URL/identifier pattern support
 */

const config: JobConfig = {
  id: "enrich-provisions",

  description:
    "Enrich cited provisions with metadata identifiers (Agent 2B: ELI, CELEX, URLs, citations)",

  /**
   * Dependencies
   *
   * Loads Agent 2A results and makes them available in promptTemplate.
   * Transform function extracts and stringifies citedProvisions array.
   */
  dependencies: [
    {
      jobId: 'extract-provisions-2a',
      alias: 'agent2a',
      required: true,
      source: 'concurrent',
      timestamp: LATEST_2A_TIMESTAMP,

      /**
       * Transform: Extract citedProvisions and create stringified version
       *
       * Returns object with:
       * - citedProvisions: Original array (for reference)
       * - citedProvisionsJson: Prettified JSON string for prompt injection
       */
      transform: (dep) => ({
        citedProvisions: dep.citedProvisions,
        citedProvisionsJson: JSON.stringify(dep.citedProvisions, null, 2)
      })
    }
  ],

  /**
   * Database Query
   *
   * Loads ONLY successful decisions from latest extract-provisions-2a run.
   * Uses composite key (decision_id, language) matching to ensure correct pairing.
   *
   * Query uses INNER JOIN with unnest() to filter to successful 2A results.
   * This prevents processing decisions where Agent 2A failed.
   */
  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      d.decision_type_ecli_code,
      d.court_ecli_code,
      d.decision_date,
      dm.full_md,
      LENGTH(dm.full_md) as md_length,
      CASE
        WHEN LENGTH(dm.full_md) < 10000 THEN 'short'
        WHEN LENGTH(dm.full_md) < 30000 THEN 'medium'
        WHEN LENGTH(dm.full_md) < 60000 THEN 'long'
        ELSE 'very_long'
      END as length_category,
      (SELECT count(*) FROM regexp_matches(dm.full_md, 'ejustice\\.just\\.fgov\\.be', 'g')) as justel_urls,
      (SELECT count(*) FROM regexp_matches(dm.full_md, 'eur-lex\\.europa\\.eu', 'g')) as eurlex_urls,
      (
        (SELECT count(*) FROM regexp_matches(dm.full_md, 'ejustice\\.just\\.fgov\\.be', 'g')) +
        (SELECT count(*) FROM regexp_matches(dm.full_md, 'eur-lex\\.europa\\.eu', 'g'))
      ) as total_urls
    FROM decisions_md dm
    INNER JOIN decisions1 d
      ON d.decision_id = dm.decision_id
      AND d.language_metadata = dm.language
    INNER JOIN unnest($1::text[], $2::text[]) AS successful(decision_id, language)
      ON d.decision_id = successful.decision_id
      AND d.language_metadata = successful.language
    WHERE dm.full_md IS NOT NULL
      AND dm.full_md != ''
    ORDER BY d.decision_id, d.language_metadata
  `,

  /**
   * Database Query Parameters
   *
   * Arrays of decision_id and language from successful Agent 2A results.
   * Composite key matching ensures correct pairing.
   */
  dbQueryParams: [
    SUCCESSFUL_2A_PAIRS.map(p => p.decision_id),
    SUCCESSFUL_2A_PAIRS.map(p => p.language)
  ],

  /**
   * Preprocess Row
   *
   * Extracts all legal references (ELI, CELEX, NUMAC, file numbers, URLs, bibliographic refs)
   * from decision text. Flags decisions without enrichable references for cost-saving skip logic.
   */
  preprocessRow: async (row: any) => {
    const references = extractLegalReferences(row.full_md || '');
    const hasReferences = hasAnyReferences(references);

    return {
      ...row,
      extractedReferences: references,
      extractedReferencesJson: JSON.stringify(references, null, 2),
      hasEnrichableReferences: hasReferences,
      referenceCount: {
        totalUrls: references.eurLexUrls.length + references.justelUrls.length +
                   references.dataEuropa.length + references.etaamb.length,
        totalIdentifiers: references.celex.length + references.eli.length +
                         references.numac.length + references.fileNumber.length,
        hasBiblio: references.bibliographicRefs.length > 0
      }
    };
  },

  /**
   * Row Metadata Fields
   *
   * Track all metadata for evaluation, filtering, and cost-saving statistics.
   */
  rowMetadataFields: [
    "id",
    "decision_id",
    "language_metadata",
    "decision_type_ecli_code",
    "court_ecli_code",
    "decision_date",
    "md_length",
    "length_category",
    "justel_urls",
    "eurlex_urls",
    "total_urls",
    "extractedReferences",
    "hasEnrichableReferences",
    "referenceCount",
  ],

  /**
   * Custom Execution with Cost-Saving Logic
   *
   * Implements intelligent skip logic: if no enrichable references found,
   * return Agent 2A provisions with null enrichment fields (skip expensive LLM call).
   * Otherwise, run full LLM enrichment with extracted references.
   */
  customExecution: async (row: any, client: any) => {
    // Cost-saving: Skip LLM if no enrichable references
    if (!row.hasEnrichableReferences) {
      const provisions = row.agent2a?.citedProvisions || [];
      return {
        citedProvisions: provisions.map((p: any) => ({
          ...p,
          provisionEli: null,
          parentActEli: null,
          parentActCelex: null,
          provisionUrlJustel: null,
          parentActUrlJustel: null,
          provisionUrlEurlex: null,
          parentActUrlEurlex: null,
          citationReference: null
        })),
        _skipped: true,  // Track for statistics
      };
    }

    // Build prompt with extracted references
    const prompt = ENRICH_PROVISIONS_PROMPT
      .replace("{decisionId}", row.decision_id || "")
      .replace("{proceduralLanguage}", row.language_metadata || "FR")
      .replace("{citedProvisions}", row.agent2a?.citedProvisionsJson || "[]")
      .replace("{extractedReferences}", row.extractedReferencesJson || '{}')
      .replace("{fullText.markdown}", row.full_md || "");

    const messages = [
      {
        role: 'system' as const,
        content: 'Return ONLY a single JSON object matching the schema. No markdown, no prose, no code blocks.'
      },
      {
        role: 'user' as const,
        content: prompt
      }
    ];

    const responseFormat = {
      type: 'json_schema' as const,
      json_schema: {
        name: config.outputSchemaName!,
        schema: config.outputSchema,
        strict: true
      }
    };

    const settings = {
      model: config.model || 'gpt-5-mini',
      maxOutputTokens: config.maxCompletionTokens,
      reasoningEffort: config.reasoningEffort,
      verbosity: config.verbosity
    };

    const completion = await client.complete(messages, responseFormat, settings);
    const content = completion.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No content in LLM response');
    }

    return extractJsonFromResponse(content);
  },

  /**
   * Output JSON Schema
   *
   * Comprehensive schema for enriched provisions.
   *
   * Structure:
   * - 10 fields from Agent 2A (preserved unchanged)
   * - 8 new fields from Agent 2B (enrichment metadata)
   *
   * Total: 18 required fields per provision
   *
   * Key validation:
   * - All fields from 2A must be present and unchanged
   * - internalProvisionId must match Agent 2A input
   * - ELI patterns validated with regex
   * - CELEX pattern validated (8 chars: 4 digits + letter + 4 digits)
   * - URL patterns validated for Justel and EUR-Lex
   */
  outputSchema: {
    type: "object",
    required: ["citedProvisions"],
    additionalProperties: false,
    properties: {
      citedProvisions: {
        type: "array",
        minItems: 0, // Some decisions may cite no provisions
        items: {
          type: "object",
          required: [
            // ========================================
            // FROM AGENT 2A (10 fields - preserved unchanged)
            // ========================================
            "provisionId",
            "parentActId",
            "internalProvisionId",
            "internalParentActId",
            "provisionNumber",
            "provisionNumberKey",
            "parentActType",
            "parentActName",
            "parentActDate",
            "parentActNumber",

            // ========================================
            // FROM AGENT 2B (8 new enrichment fields)
            // ========================================
            "provisionEli",
            "parentActEli",
            "parentActCelex",
            "provisionUrlJustel",
            "parentActUrlJustel",
            "provisionUrlEurlex",
            "parentActUrlEurlex",
            "citationReference",
          ],
          additionalProperties: false,
          properties: {
            // ========================================
            // RESERVED DATABASE MAPPING FIELDS (FROM 2A)
            // ========================================
            provisionId: {
              type: "null",
              description: "Reserved for database mapping - always null",
            },
            parentActId: {
              type: "null",
              description: "Reserved for database mapping - always null",
            },

            // ========================================
            // INTERNAL REFERENCE IDs (FROM 2A)
            // ========================================
            internalProvisionId: {
              type: "string",
              pattern: "^ART-[a-zA-Z0-9:.]+-\\d{3}$",
              description: "CRITICAL: Must match Agent 2A input - ART-{decisionId}-{seq}",
            },
            internalParentActId: {
              type: "string",
              pattern: "^ACT-[a-zA-Z0-9:.]+-\\d{3}$",
              description: "Parent act ID - ACT-{decisionId}-{seq}",
            },

            // ========================================
            // PROVISION IDENTIFICATION (FROM 2A)
            // ========================================
            provisionNumber: {
              type: "string",
              minLength: 5,
              maxLength: 200,
              description: "Verbatim provision number (from Agent 2A)",
            },
            provisionNumberKey: {
              type: "string",
              minLength: 1,
              maxLength: 50,
              description: "Normalized core number (from Agent 2A)",
            },

            // ========================================
            // PARENT ACT TYPE (FROM 2A - BILINGUAL ENUM)
            // ========================================
            parentActType: {
              type: "string",
              enum: [
                // French (11 values)
                "LOI",
                "ARRETE_ROYAL",
                "CODE",
                "CONSTITUTION",
                "REGLEMENT_UE",
                "DIRECTIVE_UE",
                "TRAITE",
                "ARRETE_GOUVERNEMENT",
                "ORDONNANCE",
                "DECRET",
                "AUTRE",

                // Dutch (11 values)
                "WET",
                "KONINKLIJK_BESLUIT",
                "WETBOEK",
                "GRONDWET",
                "EU_VERORDENING",
                "EU_RICHTLIJN",
                "VERDRAG",
                "BESLUIT_VAN_DE_REGERING",
                "ORDONNANTIE",
                "DECREET",
                "ANDERE",
              ],
              description: "Parent act type (from Agent 2A)",
            },

            // ========================================
            // PARENT ACT INFORMATION (FROM 2A)
            // ========================================
            parentActName: {
              type: "string",
              minLength: 10,
              maxLength: 500,
              description: "Verbatim parent act name (from Agent 2A)",
            },
            parentActDate: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^\\d{4}-\\d{2}-\\d{2}$",
                },
                {
                  type: "null",
                },
              ],
              description: "Date in YYYY-MM-DD or null (from Agent 2A)",
            },
            parentActNumber: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^([12][7890]\\d{2}[0-9A-E]\\d{5}|\\d{4}-\\d{2}-\\d{2}/\\d{1,3}|M\\.B\\..*|B\\.S\\..*|.{1,100})$",
                  minLength: 1,
                  maxLength: 100,
                  description: "NUMAC (10 chars: year 1789-2025, pos 5 = digit or A-E), file reference (YYYY-MM-DD/NN), or publication reference (M.B./B.S.)"
                },
                {
                  type: "null",
                },
              ],
              description: "Official act number or null (from Agent 2A or enriched by 2B)",
            },

            // ========================================
            // PROVISION-LEVEL IDENTIFIERS (NEW IN 2B)
            // ========================================
            provisionEli: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^eli/[a-z]+(/[a-z]+)?/[0-9]{4}/[0-9]{1,5}(/[0-9]{1,2}/[0-9]{1,2}/[0-9a-zA-Z]+)?(/art_[0-9a-z_-]+)?(/[a-z]{2,3})?(/oj)?$",
                  description: "ELI for provision - Belgian (eli/be/loi/.../art_31) or EU (eli/reg/2016/679/oj/art_6)",
                },
                {
                  type: "null",
                },
              ],
              description: "European Legislation Identifier for the specific provision or null",
            },
            provisionUrlJustel: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^https?://www\\.ejustice\\.just\\.fgov\\.be/.*$",
                  description: "Justel URL pointing to specific provision with anchor (e.g., #Art.31)",
                },
                {
                  type: "null",
                },
              ],
              description: "Belgian Justel URL for specific provision or null",
            },
            provisionUrlEurlex: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^https?://eur-lex\\.europa\\.eu/.*$",
                  description: "EUR-Lex URL pointing to specific provision with fragment",
                },
                {
                  type: "null",
                },
              ],
              description: "EUR-Lex URL for specific provision or null",
            },

            // ========================================
            // PARENT ACT IDENTIFIERS (NEW IN 2B)
            // ========================================
            parentActEli: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^eli/[a-z]+(/[a-z]+)?/[0-9]{4}/[0-9]{1,5}(/[0-9]{1,2}/[0-9]{1,2}/[0-9a-zA-Z]+)?(/[a-z]{2,3})?(/oj)?$",
                  description: "ELI for parent act - Belgian (eli/be/loi/2007/05/10/2007202032) or EU (eli/reg/2016/679/oj)",
                },
                {
                  type: "null",
                },
              ],
              description: "European Legislation Identifier for entire parent act or null",
            },
            parentActCelex: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^[356]\\d{4}[A-Z]{1,2}\\d{4,6}(?:R\\(\\d{2}\\))?$",
                  description: "CELEX number (EU law): 9-13 chars, sectors 3/5/6 (e.g., 32016R0679, 62019CJ0311, 52020DC0066). Optional corrigendum suffix R(XX).",
                },
                {
                  type: "null",
                },
              ],
              description: "CELEX number for EU legislation or null",
            },
            parentActUrlJustel: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^https?://www\\.ejustice\\.just\\.fgov\\.be/.*$",
                  description: "Justel URL pointing to entire parent act (no article anchor)",
                },
                {
                  type: "null",
                },
              ],
              description: "Belgian Justel URL for entire parent act or null",
            },
            parentActUrlEurlex: {
              anyOf: [
                {
                  type: "string",
                  pattern: "^https?://eur-lex\\.europa\\.eu/.*$",
                  description: "EUR-Lex URL pointing to entire parent act (no fragment)",
                },
                {
                  type: "null",
                },
              ],
              description: "EUR-Lex URL for entire parent act or null",
            },

            // ========================================
            // CITATION REFERENCE (NEW IN 2B)
            // ========================================
            citationReference: {
              anyOf: [
                {
                  type: "string",
                  minLength: 20,
                  maxLength: 500,
                  description: "Formal Bluebook-style citation extracted verbatim from decision",
                },
                {
                  type: "null",
                },
              ],
              description: "Formal legal citation or null",
            },
          },
        },
      },
    },
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "provision_enrichment_2b",

  /**
   * Provider and Model Configuration
   */
  provider: "openai",
  model: "gpt-5-mini",
  maxCompletionTokens: 64000,       
  reasoningEffort: "medium",            // Metadata extraction requires less reasoning
  verbosity: "low",                   // Concise responses preferred

  /**
   * Custom ID prefix
   */
  customIdPrefix: "enrich-provisions",
};

export default config;
