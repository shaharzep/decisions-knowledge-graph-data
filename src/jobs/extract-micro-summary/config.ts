import { JobConfig } from "../JobConfig.js";
import { createMicroSummaryPrompt } from "./prompt.js";

/**
 * Extract Micro-Summary Job Configuration
 *
 * APPROACH: Single-stage extraction with dynamic length scaling
 *
 * Task: Generate concise micro-summaries with length scaling (600-1800 chars)
 *   - Model extracts who/what/outcome directly from full markdown text
 *   - No dependencies on other extraction jobs
 *   - Returns summary in procedural language (FR/NL)
 *   - Length scales with decision complexity (short → long → very_long)
 *
 * Output:
 *   - microSummary: String with dynamic length (600-1800 chars based on md_length)
 *
 * Target: Scannable summaries for all ~64,000 decisions
 */

const config: JobConfig = {
  id: "extract-micro-summary",

  description:
    "Single-stage extraction: Generate concise 2-4 sentence micro-summaries in procedural language. Model extracts directly from full decision text.",

  /**
   * Database Query
   *
   * Pulls all decisions from the database with full markdown text.
   * Includes metadata fields directly from decisions1 table for tracking.
   *
   * This query selects all ~64,000 decisions with complete markdown content.
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
      LENGTH(dm.full_md) as md_length
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    WHERE dm.full_md IS NOT NULL
      AND dm.full_md != ''
  `,

  /**
   * Database Query Parameters
   *
   * No parameters needed - query selects all decisions directly.
   */
  dbQueryParams: [],

  /**
   * Preprocess Row
   *
   * Add computed length category based on markdown length.
   * All other metadata comes directly from database query.
   */
  preprocessRow: async (row: any) => {
    let length_category = 'unknown';
    if (row.md_length) {
      if (row.md_length < 10000) length_category = 'short';
      else if (row.md_length < 30000) length_category = 'medium';
      else if (row.md_length < 60000) length_category = 'long';
      else length_category = 'very_long';
    }

    return {
      ...row,
      length_category,
    };
  },

  /**
   * Row Metadata Fields
   *
   * Track all metadata from database for analysis and filtering.
   * These fields will be merged into each extraction result, enabling:
   * - Filtering by language, court, decision type, length
   * - Performance analysis by category
   * - Identifying which types work well vs poorly
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
  model: "gpt-5-mini",
  maxCompletionTokens: 16000,
  reasoningEffort: "medium",
  verbosity: "low",

  /**
   * Concurrency Configuration
   *
   * For full dataset (64k decisions), use high concurrency to leverage rate limits:
   * - Recommended: 300 concurrent requests
   * - Monitor for 429 errors and adjust if needed
   */
  concurrencyLimit: 300,

  /**
   * Full-Data Pipeline Mode
   *
   * Enable for large dataset extraction (64k decisions).
   *
   * When true:
   * - Writes per-decision JSONs to full-data/<job>/<timestamp>/jsons/
   * - Streams results incrementally (durable for long runs)
   * - Suitable for full dataset extraction
   */
  useFullDataPipeline: true,

  /**
   * Custom ID prefix
   */
  customIdPrefix: "micro-summary",
};

export default config;
