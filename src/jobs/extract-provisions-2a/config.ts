import { JobConfig } from "../JobConfig.js";
import { buildProvisionsPrompt } from "./prompt.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";
import { extractCandidateSnippets } from "../../utils/provisionSnippetExtractor.js";
import { extractAbbreviations } from "../../utils/abbreviationExtractor.js";
import { sanitiseCitedProvisions } from "../../utils/provisionAggregator.js";
import type { TextChunk } from "../../utils/chunkDecisionText.js";

function formatAbbreviationGuide(entries: ReturnType<typeof extractAbbreviations>): string {
  if (!entries || entries.length === 0) {
    return '(No explicit abbreviations detected in earlier sections)';
  }
  return entries
    .map(
      (entry) =>
        `- ${entry.abbreviation} ➝ ${entry.fullName}` +
        (entry.context ? ` (source: ${entry.context.slice(0, 120)}...)` : '')
    )
    .join('\n');
}

function computeSectionGuide(fullText: string, maxSections: number = 8): string {
  if (!fullText || fullText.trim() === '') {
    return '(Preamble → Facts → Arguments → Reasoning → Dispositif → Footnotes)';
  }

  const headingPattern = /^#{1,6}\s+(.+)$/;
  const sections: string[] = [];
  const lines = fullText.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(headingPattern);
    if (match) {
      sections.push(match[1].trim());
      if (sections.length >= maxSections) break;
    }
  }

  if (sections.length === 0) {
    return '(Preamble → Facts → Arguments → Reasoning → Dispositif → Footnotes)';
  }

  return sections.map((title, index) => `- Section ${index + 1}: ${title}`).join('\n');
}

function formatProvisionSnippets(snippets: any[]): string {
  if (!snippets || snippets.length === 0) {
    return '(No snippets extracted - document may contain no provision citations)';
  }

  return snippets
    .map(
      (snippet: any, index: number) =>
        `[${index + 1}] char ${snippet.char_start}-${snippet.char_end}: "${snippet.snippet}"`
    )
    .join('\n');
}

function formatChunkProvisionSnippets(snippets: any[], chunk: TextChunk): string {
  if (!snippets || snippets.length === 0) {
    return '(No snippets extracted in this segment)';
  }

  const filtered = snippets.filter(
    (snippet: any) =>
      snippet.char_start < chunk.end && snippet.char_end > chunk.start
  );

  if (filtered.length === 0) {
    return '(No snippets extracted in this segment)';
  }

  return filtered
    .map((snippet: any, index: number) => {
      const relativeStart = Math.max(snippet.char_start - chunk.start, 0);
      const relativeEnd = Math.max(snippet.char_end - chunk.start, relativeStart);
      return `[${index + 1}] local ${relativeStart}-${relativeEnd} (global ${snippet.char_start}-${snippet.char_end}): "${snippet.snippet}"`;
    })
    .join('\n');
}

/**
 * Extract Provisions 2A Job Configuration - P1 STAGE 2A (Full-Text + Snippet Verification)
 *
 * FULL-TEXT APPROACH WITH SNIPPET-BASED VERIFICATION:
 *
 * Processes complete decision markdown text to extract cited legal provisions.
 * Uses dual-pass strategy for maximum completeness:
 * 1. Full-text sweep: Systematic extraction following comprehensive rules
 * 2. Snippet verification: Cross-checks against regex-extracted provision mentions
 *
 * Extracts cited legal provisions with essential metadata:
 * - Provision numbers (article/artikel) - verbatim
 * - Parent act information (name, type, date) - verbatim
 * - Internal reference IDs (ART-xxx-001, ACT-xxx-001)
 * - Provision number keys (normalized for matching)
 *
 * Key Features:
 * - Verbatim extraction (no standardization or translation)
 * - Bilingual enum values (LOI/WET, ARRETE_ROYAL/KONINKLIJK_BESLUIT, etc.)
 * - Parent act deduplication within decision
 * - Complete context for accurate extraction
 * - Snippet-based verification to catch missed provisions (target 99.5%+ recall)
 *
 * Snippet Extraction Strategy:
 * - 3 specialized regex patterns (article+source, treaties, EU instruments)
 * - 150-character context windows around provision mentions (300+ chars total)
 * - Position tracking for verification in full text
 * - Mandatory second-pass verification in prompt
 *
 * Does NOT extract (deferred to other agents):
 * - URLs, ELI, CELEX identifiers (Agent 2B)
 * - Interpretation, context, application (Agent 2C)
 */

const TEST_SET_PATH =
  process.env.PROVISIONS_TEST_SET || "evals/test-sets/comprehensive-197.csv";

const config: JobConfig = {
  id: "extract-provisions-2a",

  description:
    "Extract cited legal provisions with 100% completeness + accuracy (P1 STAGE 2A: full-text, verbatim with ALL qualifiers, fuzzy deduplication, anti-hallucination rules)",

  chunking: {
    maxChunkSize: 15000,
    overlap: 800,
  },

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
   * Using lowest-20-provisions.csv for targeted re-extraction of low-scoring decisions.
   */
  dbQueryParams: await (async () => {
    const testSet = await TestSetLoader.loadTestSet(
      TEST_SET_PATH
    );
    const summary = TestSetLoader.getSummary(testSet);
    console.log(`📊 Provisions 2A test set (LOWEST 20): ${summary.total} decisions`);
    console.log(`   Languages: ${JSON.stringify(summary.byLanguage)}`);

    // Show distribution by length category
    const byLength: Record<string, number> = {};
    testSet.forEach((entry) => {
      if (entry.length_category) {
        byLength[entry.length_category] =
          (byLength[entry.length_category] || 0) + 1;
      }
    });
    console.log(`   Length distribution: ${JSON.stringify(byLength)}`);

    const params = TestSetLoader.toQueryParams(testSet);
    return [params.decisionIds, params.languages];
  })(),

  /**
   * Preprocess Row
   *
   * Enriches rows with metadata from CSV test set for evaluation and filtering.
   * Also extracts provision snippets for verification in the prompt.
   */
  preprocessRow: await (async () => {
    const testSet = await TestSetLoader.loadTestSet(
      "evals/test-sets/lowest-20-provisions.csv"
    );

    // Create map for fast lookup: key = decision_id + language
    const testSetMap = new Map<string, any>();
    testSet.forEach((entry) => {
      const key = `${entry.decision_id}|${entry.language}`;
      testSetMap.set(key, entry);
    });
    

    // Return preprocessor function
    return async (row: any) => {
      // Enrich with test set metadata
      const key = `${row.decision_id}|${row.language_metadata}`;
      const testSetEntry = testSetMap.get(key);

      // Extract provision snippets from full markdown text
      // Use 150-char context window for comprehensive context
      // (Belgian legal citations are verbose with long parent act names)
      const fullText = row.full_md || '';
      const snippets = extractCandidateSnippets(fullText, 150);
      const abbreviations = extractAbbreviations(row.decision_id, fullText);
      const abbreviationGuide = formatAbbreviationGuide(abbreviations);
      const sectionGuide = computeSectionGuide(fullText);
      const formattedSnippets = formatProvisionSnippets(snippets);

      return {
        ...row,
        // Add metadata from test set
        ...(testSetEntry
          ? {
              decision_type_ecli_code: testSetEntry.decision_type_ecli_code,
              decision_type_name: testSetEntry.decision_type_name,
              court_ecli_code: testSetEntry.court_ecli_code,
              court_name: testSetEntry.court_name,
              courtcategory: testSetEntry.courtcategory,
              decision_date: testSetEntry.decision_date,
              md_length: testSetEntry.md_length,
              length_category: testSetEntry.length_category,
            }
          : {}),
        // Add extracted provision snippets for verification
        provisionSnippets: snippets,
        formattedProvisionSnippets: formattedSnippets,
        abbreviations,
        abbreviationGuide,
        sectionGuide,
      };
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
    "abbreviationGuide",
    "sectionGuide",
  ],

  /**
   * Prompt Template
   *
   * Injects full decision markdown text, decision ID, procedural language,
   * and formatted provision snippets for verification.
   */
  promptTemplate: (row) => {
    const abbreviationGuide =
      row.abbreviationGuide || formatAbbreviationGuide(row.abbreviations || []);
    const sectionGuide =
      row.sectionGuide || computeSectionGuide(row.full_md || '');
    const provisionSnippets =
      row.formattedProvisionSnippets ||
      formatProvisionSnippets(row.provisionSnippets || []);

    return buildProvisionsPrompt({
      decisionId: row.decision_id || '',
      proceduralLanguage:
        (row.language_metadata || 'FR').toUpperCase() === 'NL' ? 'NL' : 'FR',
      fullText: row.full_md || '',
      abbreviationGuide,
      sectionGuide,
      provisionSnippets,
      chunkInfo: row.chunkMetadata,
    });
  },

  chunkPromptTemplate: ({
    row,
    chunk,
    totalChunks,
    formattedSnippets,
  }) => {
    const abbreviationGuide =
      row.abbreviationGuide || formatAbbreviationGuide(row.abbreviations || []);

    const sectionGuide = `Segment ${chunk.index + 1}/${totalChunks} – ${chunk.label}`;
    const effectiveChunk: TextChunk = {
      index: chunk.index,
      start: chunk.start,
      end: chunk.end,
      label: chunk.label,
      text: (chunk.text ?? row.full_md) || '',
    };

    return buildProvisionsPrompt({
      decisionId: row.decision_id || '',
      proceduralLanguage:
        (row.language_metadata || 'FR').toUpperCase() === 'NL' ? 'NL' : 'FR',
      fullText: effectiveChunk.text,
      abbreviationGuide,
      sectionGuide,
      provisionSnippets:
        formattedSnippets ||
        formatChunkProvisionSnippets(row.provisionSnippets || [], effectiveChunk),
      chunkInfo: {
        index: chunk.index,
        total: totalChunks,
        label: chunk.label,
        charRange: `${chunk.start}-${chunk.end}`,
      },
    });
  },

  /**
   * Post-Processing: Construct IDs from Sequences
   *
   * This is where deterministic ID construction happens - the LLM only outputs
   * simple integer sequences, then TypeScript constructs the full IDs with
   * guaranteed-correct decisionId string concatenation.
   *
   * This eliminates all ID truncation/corruption errors because the LLM never
   * touches decisionId string manipulation.
   */
  postProcessRow: (row, result) => {
    const decisionId = row.decision_id;

    if (!decisionId) {
      throw new Error('decision_id is required for ID construction');
    }

    if (!result.citedProvisions || !Array.isArray(result.citedProvisions)) {
      result.citedProvisions = [];
      return result;
    }

    result.citedProvisions = sanitiseCitedProvisions(result.citedProvisions, {
      decisionId,
      language: row.language_metadata,
      abbreviations: row.abbreviations,
    });

    return result;
  },

  /**
   * Output JSON Schema - Full-Text Approach (Bilingual Enums)
   *
   * CHANGES from snippet-based version:
   * - Removed extractionMetadata wrapper
   * - Removed top-level decisionId and language fields (provided via metadata)
   * - Bilingual enum values (LOI/WET, ARRETE_ROYAL/KONINKLIJK_BESLUIT, etc.)
   * - Direct citedProvisions array at top level
   *
   * Key features:
   * - Language-specific enum values matching procedural language
   * - Verbatim extraction requirements
   * - Parent act deduplication via internalParentActId
   * - Same internal ID patterns (ART-xxx-001, ACT-xxx-001)
   */
  outputSchema: {
    type: "object",
    required: ["citedProvisions"],
    additionalProperties: false,
    properties: {
      citedProvisions: {
        type: "array",
        minItems: 0, // Some decisions cite no provisions
        items: {
          type: "object",
          required: [
            "provisionId",
            "parentActId",
            "provisionSequence",
            "parentActSequence",
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
            // SEQUENCING (IDs constructed in postProcessRow)
            // ========================================
            provisionSequence: {
              type: "integer",
              minimum: 1,
              maximum: 9999,
              description:
                "Sequential provision number: 1, 2, 3, 4, ... Increment for each provision, never skip or reuse.",
            },
            parentActSequence: {
              type: "integer",
              minimum: 1,
              maximum: 999,
              description:
                "Parent act sequence (deduplicated): same parent act = same number, different act = new number.",
            },

            // ========================================
            // PROVISION IDENTIFICATION
            // ========================================
            provisionNumber: {
              type: "string",
              minLength: 3,
              maxLength: 200,
              description:
                "Provision number VERBATIM from text (no standardization)",
            },
            provisionNumberKey: {
              type: "string",
              minLength: 1,
              maxLength: 50,
              description:
                "Normalized core number (e.g., '31' from 'article 31, § 2', '87' from 'article 87quater')",
            },

            // ========================================
            // PARENT ACT TYPE (BILINGUAL ENUM)
            // ========================================
            parentActType: {
              type: "string",
              enum: [
                // French values
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
                // Dutch values
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
              description:
                "Type of parent legal act (bilingual enum - use language-specific value)",
            },

            // ========================================
            // PARENT ACT INFORMATION
            // ========================================
            parentActName: {
              type: "string",
              minLength: 5,
              maxLength: 500,
              description:
                "Parent act name VERBATIM with ALL qualifiers (coordonné..., approuvé..., modifié...)",
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
              description:
                "Date in YYYY-MM-DD format (from name or qualifier) or null",
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
  outputSchemaName: "provision_extraction",

  /**
   * Provider and Model Configuration
   */
  provider: "openai",
  model: "gpt-5-mini",
  maxCompletionTokens: 128000, // Full text processing requires more tokens
  reasoningEffort: "medium", // Medium reasoning for complex provision extraction
  verbosity: "low", // Concise responses preferred
  /**
   * Custom ID prefix
   */
  customIdPrefix: "provisions-2a",
};

export default config;
