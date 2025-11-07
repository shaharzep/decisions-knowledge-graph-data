import { JobConfig } from "../JobConfig.js";
import { buildPrompt } from "./prompt.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";

/**
 * Structure Full HTML Job Configuration
 *
 * Converts markdown decision text to structured HTML using GPT-4.1 via Azure.
 *
 * INPUT:
 * - Full text from decision_fulltext1 table
 * - Metadata from decisions1 table (court, date, rol number, decision type)
 * - Court names from courts table (courtfr, courtnl)
 *
 * OUTPUT:
 * - Structured HTML fragment with semantic CSS classes
 * - Preserves all original text with absolute fidelity
 * - Includes header generated from metadata
 * - Applies BEM-style CSS classes for styling
 *
 * PROCESS:
 * 1. Build frontmatter with metadata (court, decision type, rol number, date, language)
 * 2. Combine frontmatter + full text into structured prompt
 * 3. LLM converts to semantic HTML with CSS classes
 * 4. Validate HTML structure and save results
 *
 * MODEL: GPT-4.1 via Azure OpenAI
 * SCOPE: Belgian court decisions (197 test set)
 */

const config: JobConfig = {
  id: "structure-full-html",

  description:
    "Convert markdown decision text to structured HTML using semantic CSS classes. Generates headers from metadata, preserves all text with absolute fidelity, applies BEM-style classes.",

  /**
   * Concurrency Configuration
   *
   * Start conservative with 50 concurrent requests.
   * Can increase after validating results quality.
   */
  concurrencyLimit: 50,

  /**
   * Full-Data Pipeline Mode
   *
   * Use standard mode for test runs on comprehensive-197.csv.
   * Switch to true for full dataset (64k decisions).
   */
  useFullDataPipeline: false,

  /**
   * Database Query
   *
   * Joins three tables:
   * - decisions1: Core metadata (decision_id, date, rol_number, decision_type, court)
   * - decisions_md: Full markdown text
   * - courts: Court names in FR and NL
   *
   * Filters by comprehensive-197.csv test set using unnest().
   */
  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      d.decision_date,
      d.rol_number,
      d.decision_type_ecli_code,
      d.court_ecli_code,
      dm.full_md,
      c.courtfr,
      c.courtnl,
      LENGTH(dm.full_md) as text_length
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    LEFT JOIN courts c
      ON c.id = d.court_ecli_code
    WHERE (d.decision_id, d.language_metadata) IN (
      SELECT unnest($1::text[]), unnest($2::text[])
    )
      AND dm.full_md IS NOT NULL
      AND dm.full_md != ''
  `,

  /**
   * Database Query Parameters
   *
   * Loads comprehensive-197.csv test set and extracts decision IDs and languages.
   * Returns [decisionIds[], languages[]] for unnest() query.
   */
  dbQueryParams: await (async () => {
    const testSet = await TestSetLoader.loadTestSet('evals/test-sets/comprehensive-197.csv');
    const summary = TestSetLoader.getSummary(testSet);
    console.log(`📊 Structure Full HTML test set: ${summary.total} decisions`);
    console.log(`   Languages: ${JSON.stringify(summary.byLanguage)}`);

    const { decisionIds, languages } = TestSetLoader.toQueryParams(testSet);
    return [decisionIds, languages];
  })(),

  /**
   * Preprocess Row
   *
   * Add computed fields for analysis and filtering:
   * - text_length_category: Categorize by text length
   * - court_name: Select court name based on language (courtfr or courtnl)
   */
  preprocessRow: async (row: any) => {
    // Categorize text length
    let text_length_category = 'unknown';
    if (row.text_length) {
      if (row.text_length < 10000) text_length_category = 'short';
      else if (row.text_length < 30000) text_length_category = 'medium';
      else if (row.text_length < 60000) text_length_category = 'long';
      else text_length_category = 'very_long';
    }

    // Select court name based on language
    const court_name = row.language_metadata === 'FR' ? row.courtfr : row.courtnl;

    return {
      ...row,
      text_length_category,
      court_name,
    };
  },

  /**
   * Row Metadata Fields
   *
   * Track all metadata for analysis and filtering.
   * Includes court_name (computed in preprocessRow) for judge validation.
   */
  rowMetadataFields: [
    "id",
    "decision_id",
    "language_metadata",
    "decision_date",
    "rol_number",
    "decision_type_ecli_code",
    "court_ecli_code",
    "court_name",           // Computed in preprocessRow - needed for header validation
    "text_length",
    "text_length_category",
  ],

  /**
   * Prompt Template
   *
   * Build structured prompt with frontmatter + full text.
   * Uses exact prompt logic from original implementation.
   */
  promptTemplate: (row: any) => buildPrompt(row),

  /**
   * Output JSON Schema
   *
   * Simple schema with single html field containing structured HTML fragment.
   */
  outputSchema: {
    type: "object",
    required: ["html"],
    additionalProperties: false,
    properties: {
      html: {
        type: "string",
        minLength: 100,
        maxLength: 500000,
        description: "Structured HTML fragment with semantic CSS classes"
      }
    }
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "structured_html_output",

  /**
   * Provider and Model Configuration
   *
   * Using GPT-4.1 via Azure OpenAI for high-quality HTML generation.
   */
  provider: "openai",
  openaiProvider: "azure",
  model: "gpt-4.1",
  maxCompletionTokens: 65535,
  temperature: 0,  // Deterministic output

  /**
   * Custom ID prefix
   */
  customIdPrefix: "structured-html",
};

export default config;
