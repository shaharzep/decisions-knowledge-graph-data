import { JobConfig } from "../JobConfig.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";
import { createMicroSummaryPrompt } from "./prompt.js";

/**
 * Extract Micro-Summary Job Configuration
 *
 * APPROACH: Single-stage extraction with simple prompt template
 *
 * Task: Generate concise 2-4 sentence micro-summaries (50-800 chars)
 *   - Model extracts who/what/outcome directly from full markdown text
 *   - No dependencies on other extraction jobs
 *   - Returns summary in procedural language (FR/NL)
 *
 * Output:
 *   - microSummary: String (50-800 chars)
 *
 * Target: Quick, scannable summaries for all decisions
 */

const config: JobConfig = {
  id: "extract-micro-summary",

  description:
    "Single-stage extraction: Generate concise 2-4 sentence micro-summaries in procedural language. Model extracts directly from full decision text.",

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
   * Uses comprehensive-197.csv for full test set evaluation.
   */
  dbQueryParams: await (async () => {
    const testSet = await TestSetLoader.loadTestSet(
      "evals/test-sets/comprehensive-197.csv"
    );
    const summary = TestSetLoader.getSummary(testSet);
    console.log(`📊 Micro-Summary test set: ${summary.total} decisions`);
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
   * Enrich database rows with metadata from CSV test set.
   * Uses composite key lookup for correct language matching.
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
      const key = `${row.decision_id}|${row.language_metadata}`;
      const testSetEntry = testSetMap.get(key);

      if (testSetEntry) {
        return {
          ...row,
          decision_type_ecli_code: testSetEntry.decision_type_ecli_code,
          decision_type_name: testSetEntry.decision_type_name,
          court_ecli_code: testSetEntry.court_ecli_code,
          court_name: testSetEntry.court_name,
          courtcategory: testSetEntry.courtcategory,
          decision_date: testSetEntry.decision_date,
          md_length: testSetEntry.md_length,
          length_category: testSetEntry.length_category,
        };
      }

      return row;
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
   * Prompt Template Function
   *
   * Fills template with decision metadata and full markdown text.
   * Model extracts who/what/outcome directly from text.
   */
  promptTemplate: createMicroSummaryPrompt,

  /**
   * Output JSON Schema
   *
   * Simple schema with single string field.
   * Key features:
   * - microSummary: 50-800 characters
   * - Must be in procedural language (FR/NL)
   * - 2-4 sentences
   */
  outputSchema: {
    type: "object",
    required: ["microSummary"],
    additionalProperties: false,
    properties: {
      microSummary: {
        type: "string",
        minLength: 50,
        maxLength: 2000,
        description: "Concise micro-summary in procedural language (length scales 600-1800 chars based on decision complexity)",
      },
    },
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "micro_summary_extraction",

  /**
   * Provider and Model Configuration
   */
  provider: "openai",
  model: "gpt-5-mini",                // GPT-5 Mini with reasoning
  maxCompletionTokens: 16000,         // Summaries are short, don't need much
  reasoningEffort: "medium",           
  verbosity: "low",                   // Concise responses preferred

  /**
   * Custom ID prefix
   */
  customIdPrefix: "micro-summary",
};

export default config;
