import { JobConfig } from "../JobConfig.js";
import { convertMarkdownToHtml } from "../../utils/markdownToHtml.js";
import { transformDecisionHtml } from "../../utils/htmlTransformer.js";
import * as cheerio from 'cheerio';

/**
 * Convert Markdown to HTML Job Configuration
 *
 * Converts decision markdown to HTML with block-based data-id attributes.
 *
 * SCOPE: All Belgian court decisions with markdown content (regardless of PDF availability)
 *
 * INPUT:
 * - Full markdown text from decisions_md table
 * - Metadata from decisions1 table (decision_id, language_metadata)
 * - Filter: Only decisions with full_md IS NOT NULL AND full_md != ''
 *
 * OUTPUT STRUCTURE:
 * {
 *   decision_id: "ECLI:BE:...",
 *   language: "FR" | "NL",
 *   full_html: "<p data-id=\"ECLI:BE:...:block-001\">...</p>"
 * }
 *
 * APPROACH: Pandoc conversion + block transformation (NO LLM)
 * - Step 1: Convert markdown → HTML5 (pandoc subprocess)
 * - Step 2: Add data-id attributes to content blocks (cheerio)
 * - Zero API cost, instant processing
 *
 * OUTPUT MODE: Full-data pipeline
 * - Writes per-decision JSONs to full-data/convert-md-to-html/<timestamp>/jsons/
 * - Filename format: <ECLI>_<LANG>.json
 * - HTML ready for block-based citation linking (Agents 2D, 5B)
 */

const config: JobConfig = {
  id: "convert-md-to-html",

  description:
    "Convert decision markdown to HTML with block-based data-id attributes using pandoc + cheerio - NO LLM",

  /**
   * Dependencies
   *
   * None - this is a standalone conversion job
   */
  dependencies: [],

  /**
   * Database Query
   *
   * Select all decisions that:
   * 1. Have markdown content available in decisions_md
   * 2. Regardless of url_pdf availability
   *
   * This ensures we process all decisions where:
   * - Markdown text exists for conversion
   * - No filtering on PDF availability (processes all with markdown)
   */
  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      d.decision_type_ecli_code,
      d.court_ecli_code,
      d.decision_date,
      d.url_pdf,
      dm.full_md,
      LENGTH(dm.full_md) as md_length,
      CASE
        WHEN LENGTH(dm.full_md) < 10000 THEN 'short'
        WHEN LENGTH(dm.full_md) < 30000 THEN 'medium'
        WHEN LENGTH(dm.full_md) < 60000 THEN 'long'
        ELSE 'very_long'
      END as length_category
    FROM decisions_md dm
    INNER JOIN decisions1 d
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    WHERE dm.full_md IS NOT NULL
      AND dm.full_md != ''
    ORDER BY d.decision_id, d.language_metadata
  `,

  /**
   * Database Query Parameters
   *
   * No parameters needed for this query
   */
  dbQueryParams: [],

  /**
   * Row Metadata Fields
   *
   * Track metadata for analysis and debugging.
   * decision_id and language are automatically tracked.
   */
  rowMetadataFields: [
    "id",
    "decision_id",
    "language_metadata",
    "decision_type_ecli_code",
    "court_ecli_code",
    "decision_date",
    "url_pdf",
    "md_length",
    "length_category"
  ],

  /**
   * Custom Execution: Pandoc + Block Transformation
   *
   * NO LLM CALLS - Pure pandoc conversion + cheerio transformation.
   *
   * Process:
   * 1. Extract markdown from row.full_md
   * 2. Convert markdown → HTML using pandoc subprocess
   * 3. Strip HTML/HEAD/BODY wrapper tags (keep only body content)
   * 4. Add data-id attributes to content blocks (p, h1-h6, blockquote, li, td, th)
   * 5. Return structure: { decision_id, language, full_html }
   *
   * Uses existing utilities:
   * - convertMarkdownToHtml(): pandoc --from markdown --to html5 --no-highlight --mathml
   * - transformDecisionHtml(): Adds data-id="ECLI:BE:...:block-NNN" to elements
   */
  customExecution: async (row: any, _client: any) => {
    try {
      const markdown = row.full_md || '';

      if (!markdown || markdown.trim() === '') {
        console.warn(`⚠️  Empty markdown for decision ${row.decision_id} (${row.language_metadata}), skipping`);
        return {
          decision_id: row.decision_id,
          language: row.language_metadata,
          full_html: ''
        };
      }

      // Step 1: Convert markdown to HTML using pandoc
      let html = await convertMarkdownToHtml(markdown);

      // Step 2: Strip HTML/HEAD/BODY wrapper tags
      const $ = cheerio.load(html);
      const bodyContent = $('body').html();
      if (bodyContent) {
        html = bodyContent;
      }

      // Step 3: Add data-id attributes to content blocks
      const { transformedHtml } = transformDecisionHtml(row.decision_id, html);

      return {
        decision_id: row.decision_id,
        language: row.language_metadata,
        full_html: transformedHtml
      };
    } catch (error: any) {
      console.error(`❌ Conversion failed for ${row.decision_id} (${row.language_metadata}): ${error.message}`);
      throw error;
    }
  },

  /**
   * Output JSON Schema
   *
   * Simple structure with three required fields:
   * - decision_id: ECLI identifier
   * - language: Procedural language (FR or NL)
   * - full_html: HTML5 output from pandoc with data-id block attributes
   */
  outputSchema: {
    type: "object",
    required: ["decision_id", "language", "full_html"],
    additionalProperties: false,
    properties: {
      decision_id: {
        type: "string",
        pattern: "^ECLI:BE:[A-Z]+:\\d{4}:[A-Z]+\\.",
        description: "ECLI identifier for the decision"
      },
      language: {
        type: "string",
        enum: ["FR", "NL"],
        description: "Procedural language of the decision"
      },
      full_html: {
        type: "string",
        minLength: 0,
        maxLength: 100000000, // 100MB max - extremely generous to handle any decision length
        description: "HTML5 output from pandoc conversion with data-id block attributes"
      }
    }
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "markdown_to_html_conversion",

  /**
   * Provider and Model Configuration
   *
   * NOTE: No LLM is used in this job (pandoc conversion + cheerio transformation).
   * These settings are required by JobConfig type but unused.
   */
  provider: "openai",
  openaiProvider: "azure",
  model: "gpt-5-mini",
  maxCompletionTokens: 1000,
  reasoningEffort: "low",

  /**
   * Concurrency Configuration
   *
   * Pandoc + Cheerio transformation is memory-intensive.
   * Set to 50 for safe concurrent processing.
   * Use with high-memory mode: npm run dev:highmem concurrent convert-md-to-html
   */
  concurrencyLimit: 50,

  /**
   * Full-Data Pipeline Mode
   *
   * Enabled for full dataset processing.
   * Writes per-decision JSONs to full-data/convert-md-to-html/<timestamp>/jsons/
   *
   * Output format:
   * - Directory: full-data/convert-md-to-html/<timestamp>/jsons/
   * - Filenames: ECLI:BE:CASS:2001:ARR.001_FR.json
   * - Content: { decision_id, language, full_html }
   */
  useFullDataPipeline: true,

  /**
   * Custom ID prefix
   */
  customIdPrefix: "convert-md-to-html",
};

export default config;
