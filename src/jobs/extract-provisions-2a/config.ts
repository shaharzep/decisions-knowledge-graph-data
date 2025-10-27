import { JobConfig } from "../JobConfig.js";
import { PROVISIONS_2A_PROMPT } from "./prompt.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";
import { extractProvisionContexts } from "../../utils/provisionContextExtractor.js";

/**
 * Extract Provisions 2A Job Configuration - P1 STAGE 2A (Context-Based)
 *
 * NEW APPROACH - CONTEXT-BASED EXTRACTION:
 *
 * Preprocessing extracts provision mention snippets using Python script, then
 * LLM processes only these targeted contexts (not full decision text).
 *
 * Extracts cited legal provisions with essential metadata:
 * - Provision numbers (article/artikel) - verbatim
 * - Parent act information (name, type, date) - verbatim from snippet context
 * - Internal reference IDs (ART-xxx-001, ACT-xxx-001)
 * - Provision number keys (normalized for matching)
 *
 * Key Design Improvements:
 * - Python preprocessing filters pronominal references ("du même article")
 * - Highlighted markers guide LLM: **[PROVISION: article]**
 * - Context-only parent act identification (no cross-snippet inference)
 * - Enforces completeness: process EVERY snippet
 * - Reduced token usage (~80% less than full text)
 * - Better accuracy through focused attention
 *
 * Does NOT extract (deferred to other agents):
 * - URLs, ELI, CELEX identifiers (Agent 2B)
 * - Interpretation, context, application (Agent 2C)
 */

const config: JobConfig = {
  id: "extract-provisions-2a",

  description:
    "Extract cited legal provisions from context snippets (P1 STAGE 2A: context-based, verbatim extraction, no inference)",

  /**
   * Database Query
   *
   * Uses test set to select specific decisions for processing.
   * Joins decisions1 with decisions_md to get full markdown text.
   * Uses composite key (decision_id + language) for correct matching.
   */
  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      dm.full_md
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    INNER JOIN unnest($1::text[], $2::text[]) AS test_set(decision_id, language)
      ON d.decision_id = test_set.decision_id
      AND d.language_metadata = test_set.language
    WHERE dm.full_md IS NOT NULL
      AND dm.full_md != ''
  `,

  /**
   * Database Query Parameters
   *
   * Loaded from CSV test set file at runtime.
   * Reuses comprehensive-197.csv initially for consistency.
   */
  dbQueryParams: await (async () => {
    const testSet = await TestSetLoader.loadTestSet(
      "evals/test-sets/comprehensive-197.csv"
    );
    const summary = TestSetLoader.getSummary(testSet);
    console.log(`📊 Provisions 2A test set: ${summary.total} decisions`);
    console.log(`   Languages: ${JSON.stringify(summary.byLanguage)}`);

    // Show distribution by length category
    const byLength: Record<string, number> = {};
    testSet.forEach((entry) => {
      if (entry.length_category) {
        byLength[entry.length_category] = (byLength[entry.length_category] || 0) + 1;
      }
    });
    console.log(`   Length distribution: ${JSON.stringify(byLength)}`);

    const params = TestSetLoader.toQueryParams(testSet);
    return [params.decisionIds, params.languages];
  })(),

  /**
   * Preprocess Row
   *
   * NEW: Extracts provision context snippets using Python script, then
   * enriches with metadata from CSV test set.
   *
   * Process:
   * 1. Call Python script to extract provision mentions with context
   * 2. Merge provision contexts into row
   * 3. Enrich with test set metadata for evaluation
   */
  preprocessRow: await (async () => {
    const testSet = await TestSetLoader.loadTestSet(
      "evals/test-sets/comprehensive-197.csv"
    );

    // Create map for fast lookup: key = decision_id + language
    const testSetMap = new Map<string, any>();
    testSet.forEach((entry) => {
      const key = `${entry.decision_id}|${entry.language}`;
      testSetMap.set(key, entry);
    });

    // Return preprocessor function
    return async (row: any) => {
      // Step 1: Extract provision snippets using Python script (ALT approach)
      const provisionSnippets = await extractProvisionContexts(
        row.decision_id,
        row.full_md,
        row.language_metadata || 'FR'
      );

      // Step 2: Enrich with test set metadata
      const key = `${row.decision_id}|${row.language_metadata}`;
      const testSetEntry = testSetMap.get(key);

      const enriched = {
        ...row,
        // Add provision snippets for prompt (ALT format)
        provision_snippets: provisionSnippets,
        // Add metadata from test set
        ...(testSetEntry ? {
          decision_type_ecli_code: testSetEntry.decision_type_ecli_code,
          decision_type_name: testSetEntry.decision_type_name,
          court_ecli_code: testSetEntry.court_ecli_code,
          court_name: testSetEntry.court_name,
          courtcategory: testSetEntry.courtcategory,
          decision_date: testSetEntry.decision_date,
          md_length: testSetEntry.md_length,
          length_category: testSetEntry.length_category,
        } : {})
      };

      return enriched;
    };
  })(),

  /**
   * Row Metadata Fields
   *
   * Track all metadata from CSV test set for evaluation and filtering.
   */
  rowMetadataFields: [
    "id",
    "decision_id",
    "language_metadata",
    "decision_type_ecli_code",
    "decision_type_name",
    "court_ecli_code",
    "court_name",
    "courtcategory",
    "decision_date",
    "md_length",
    "length_category",
  ],

  /**
   * Prompt Template
   *
   * ALT APPROACH: Injects simple text snippets (no highlighting, no markers).
   * LLM receives raw 250-char windows and does all extraction work.
   */
  promptTemplate: (row) => {
    // Format text_rows as numbered list for readability
    const textRows = row.provision_snippets.text_rows
      .map((snippet: string, idx: number) => `[${idx + 1}] ${snippet}`)
      .join('\n\n');

    return PROVISIONS_2A_PROMPT
      .replace("{decisionId}", row.decision_id || "")
      .replace("{language}", row.language_metadata || "FR")
      .replace("{text_rows}", textRows);
  },

  /**
   * Output JSON Schema - ALT APPROACH (Simplified Enums)
   *
   * CHANGES from previous version:
   * - Simplified enum values (LAW, REGULATION, etc. - no bilingual variants)
   * - Added parentActNumber field
   * - Added extractionMetadata wrapper
   * - Added provisionId/parentActId (always null - for database mapping later)
   *
   * Key features:
   * - Universal English enum values (easier to work with downstream)
   * - Includes human-readable summary in response (not validated)
   * - Same internal ID patterns (ART-xxx-001, ACT-xxx-001)
   */
  outputSchema: {
    type: "object",
    required: ["decisionId", "language", "extractionMetadata", "citedProvisions"],
    additionalProperties: false,
    properties: {
      decisionId: {
        type: "string",
        description: "Decision ECLI identifier",
      },
      language: {
        type: "string",
        enum: ["FR", "NL"],
        description: "Procedural language",
      },
      extractionMetadata: {
        type: "object",
        required: ["totalProvisionsExtracted", "totalUniqueParentActs", "extractionTimestamp"],
        additionalProperties: false,
        properties: {
          totalProvisionsExtracted: {
            type: "number",
            description: "Count of unique provisions extracted",
          },
          totalUniqueParentActs: {
            type: "number",
            description: "Count of unique parent acts identified",
          },
          extractionTimestamp: {
            type: "string",
            pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$",
            description: "ISO 8601 timestamp of extraction",
          },
        },
      },
      citedProvisions: {
        type: "array",
        minItems: 0, // Some decisions cite no provisions
        items: {
          type: "object",
          required: [
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
          ],
          additionalProperties: false,
          properties: {
            // ========================================
            // DATABASE MAPPING IDs (ALWAYS NULL)
            // ========================================
            provisionId: {
              type: "null",
              description: "Reserved for database matching - always null",
            },
            parentActId: {
              type: "null",
              description: "Reserved for database matching - always null",
            },

            // ========================================
            // INTERNAL REFERENCE IDs
            // ========================================
            internalProvisionId: {
              type: "string",
              pattern: "^ART-[a-zA-Z0-9:.]+-\\d{3}$",
              description: "Unique provision ID within decision: ART-{decisionId}-{sequence}",
            },
            internalParentActId: {
              type: "string",
              pattern: "^ACT-[a-zA-Z0-9:.]+-\\d{3}$",
              description: "Parent act ID (deduplicated across provisions citing same act)",
            },

            // ========================================
            // PROVISION IDENTIFICATION
            // ========================================
            provisionNumber: {
              type: "string",
              minLength: 3,
              maxLength: 200,
              description: "Provision number as written in text (verbatim)",
            },
            provisionNumberKey: {
              type: "string",
              minLength: 1,
              maxLength: 50,
              description: "Normalized core number (e.g., '174' from 'artikel 174, §1')",
            },

            // ========================================
            // PARENT ACT TYPE (SIMPLIFIED ENGLISH ENUM)
            // ========================================
            parentActType: {
              type: "string",
              enum: [
                "LAW",             // WET, LOI
                "REGULATION",      // KONINKLIJK BESLUIT, ARRÊTÉ ROYAL, KB, AR
                "DECREE",          // DECREET, DÉCRET
                "ORDINANCE",       // ORDONNANTIE, ORDONNANCE
                "CONSTITUTION",    // GRONDWET, CONSTITUTION
                "TREATY",          // VERDRAG, TRAITÉ
                "CODE",            // WETBOEK, CODE (CIVIL, PENAL, etc.)
                "DIRECTIVE",       // RICHTLIJN, DIRECTIVE
                "EU_REGULATION",   // VERORDENING (EU), RÈGLEMENT (UE)
                "OTHER",           // Other types
              ],
              description: "Type of parent legal act (simplified English enum)",
            },

            // ========================================
            // PARENT ACT INFORMATION
            // ========================================
            parentActName: {
              anyOf: [
                {
                  type: "string",
                  minLength: 5,
                  maxLength: 500,
                },
                {
                  type: "null",
                },
              ],
              description: "Parent act name verbatim from text or null",
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
              description: "Date in YYYY-MM-DD format or null",
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
              description: "Official act number (e.g., numac) or null",
            },
          },
        },
      },
    },
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "provision_extraction_2a",

  /**
   * Provider and Model Configuration
   */
  provider: "openai",
  model: "gpt-5-mini",
  maxCompletionTokens: 64000,        // Provision extraction simpler than comprehensive
  reasoningEffort: "low",         // Medium reasoning needed for documents with many provisions (96+)
  verbosity: "low",                   // Concise responses preferred
  /**
   * Custom ID prefix
   */
  customIdPrefix: "provisions-2a",
};

export default config;
