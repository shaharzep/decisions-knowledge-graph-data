import { JobConfig } from "../JobConfig.js";
import { ENRICH_PROVISIONS_PROMPT } from "./prompt.js";
import { extractLegalReferences } from "../../utils/legalReferenceExtractor.js";

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
      source: 'concurrent', // Load from concurrent or batch results directory

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
   * Selects top 200 decisions with the most ejustice or eur-lex URLs.
   * No test set filtering - query is self-contained with URL counts.
   *
   * Joins decisions1 with decisions_md to get full markdown text.
   * Includes all metadata fields from decisions1 for evaluation.
   * Adds URL count metadata: justel_urls, eurlex_urls, total_urls.
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
    WHERE
      (dm.full_md ~ 'ejustice\\.just\\.fgov\\.be' OR dm.full_md ~ 'eur-lex\\.europa\\.eu')
      AND dm.full_md IS NOT NULL
      AND dm.full_md != ''
    ORDER BY total_urls DESC
    LIMIT 200
  `,

  /**
   * Database Query Parameters
   *
   * No parameters needed - query is self-contained with URL filtering.
   */
  dbQueryParams: [],

  /**
   * Preprocess Row
   *
   * Extracts all legal references (ELI, CELEX, NUMAC, URLs) from markdown text
   * using comprehensive regex patterns. Provides structured data to LLM for
   * improved enrichment accuracy and reduced hallucination.
   */
  preprocessRow: async (row: any) => {
    const references = extractLegalReferences(row.full_md || '');

    return {
      ...row,
      extractedReferences: references,
      extractedReferencesJson: JSON.stringify(references, null, 2)
    };
  },

  /**
   * Row Metadata Fields
   *
   * Track all metadata for evaluation and filtering.
   * Includes URL count metadata from query and extracted references from preprocessing.
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
  ],

  /**
   * Prompt Template
   *
   * Injects 5 variables into Agent 2B prompt:
   * 1. {decisionId} - ECLI identifier
   * 2. {proceduralLanguage} - FR or NL
   * 3. {citedProvisions} - Stringified JSON from Agent 2A
   * 4. {extractedReferences} - Pre-scanned legal references (ELI, CELEX, URLs)
   * 5. {fullText.markdown} - Full decision text
   *
   * Dependencies are loaded automatically, row.agent2a.citedProvisionsJson
   * contains provisions from Agent 2A. Preprocessing adds extractedReferencesJson.
   */
  promptTemplate: (row) => {
    const prompt = ENRICH_PROVISIONS_PROMPT
      .replace("{decisionId}", row.decision_id || "")
      .replace("{proceduralLanguage}", row.language_metadata || "FR")
      .replace("{citedProvisions}", row.agent2a?.citedProvisionsJson || "[]")
      .replace("{extractedReferences}", row.extractedReferencesJson || '{"eli":[],"celex":[],"numac":[],"eurLexUrls":[],"justelUrls":[]}')
      .replace("{fullText.markdown}", row.full_md || "");

    return prompt;
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
                  minLength: 1,
                  maxLength: 100,
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
                  pattern: "^eli/[a-z]+/[a-z0-9_-]+/[0-9]{4}/[0-9]{2}/[0-9]{2}/[0-9]+/art_[0-9a-z_-]+(/[a-z]{2,3})?$",
                  description: "ELI for specific provision (e.g., eli/be/loi/2007/05/10/2007202032/art_31)",
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
                  pattern: "^eli/[a-z]+/[a-z0-9_-]+/[0-9]{4}/[0-9]{2}/[0-9]{2}/[0-9]+(/[a-z]{2,3})?$",
                  description: "ELI for entire parent act (e.g., eli/be/loi/2007/05/10/2007202032)",
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
                  pattern: "^[0-9]{4}[A-Z][0-9]{4}$",
                  description: "CELEX number (EU law only): 8 chars (e.g., 32016R0679)",
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
