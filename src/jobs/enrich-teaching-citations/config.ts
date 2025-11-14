import { JobConfig } from "../JobConfig.js";
import { ENRICH_TEACHING_CITATIONS_PROMPT } from "./prompt.js";
import { enrichTeachingCitationsSchema, SCHEMA_NAME } from "./schema.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";

/**
 * Enrich Teaching Citations Job Configuration - Agent 5B (Stage 2)
 *
 * Enriches legal teachings from Agent 5A with exact HTML citations for UI highlighting.
 * Validates that claimed provision/decision relationships exist in extracted text.
 *
 * DEPENDENCIES (all required):
 * - extract-legal-teachings (Agent 5A): Source of teachings to enrich
 * - interpret-provisions (Agent 2C): Provisions for validation
 * - extract-cited-decisions (Agent 3): Decisions for validation
 *
 * HTML SOURCE: decision_fulltext1.full_html (database column, NOT from job)
 *
 * EXECUTION MODE: Evaluation mode on 197-decision test set (not full-data pipeline)
 *
 * SKIP LOGIC: If ANY of the 3 dependencies is missing, row cannot be processed
 * (dependency enrichment will fail validation)
 */

const config: JobConfig = {
  id: "enrich-teaching-citations",

  description:
    "Enrich legal teachings with exact HTML citations for UI highlighting and validate provision/decision relationships (Agent 5B - Stage 2)",

  /**
   * Dependencies (3 required - all from concurrent/results, latest timestamp)
   *
   * All dependencies use composite key matching: (decision_id, language_metadata)
   * All dependencies have required: true - if ANY missing, processing will fail
   */
  dependencies: [
    {
      jobId: "extract-legal-teachings",
      alias: "agent5a",
      required: true,
      source: "concurrent",
      matchOn: [
        { row: "decision_id", dependency: "decision_id" },
        { row: "language_metadata", dependency: "language" }
      ],
      transform: (dep) => ({
        legalTeachings: dep.legalTeachings || []
      })
    },
    {
      jobId: "interpret-provisions",
      alias: "agent2c",
      required: true,
      source: "concurrent",
      matchOn: [
        { row: "decision_id", dependency: "decision_id" },
        { row: "language_metadata", dependency: "language" }
      ],
      transform: (dep) => ({
        citedProvisions: dep.citedProvisions || []
      })
    },
    {
      jobId: "extract-cited-decisions",
      alias: "agent3",
      required: true,
      source: "concurrent",
      matchOn: [
        { row: "decision_id", dependency: "decision_id" },
        { row: "language_metadata", dependency: "language" }
      ],
      transform: (dep) => ({
        citedDecisions: dep.citedDecisions || []
      })
    }
  ],

  /**
   * Database Query
   *
   * Joins decisions1 + decision_fulltext1 to get full_html field.
   * Filtered by test set (comprehensive-197.csv) using unnest pattern.
   *
   * CRITICAL: decision_fulltext1.decision_id is FK to decisions1.id (not decision_id!)
   */
  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      df.full_html
    FROM decisions1 d
    INNER JOIN decision_fulltext1 df
      ON df.decision_id = d.id
    WHERE (d.decision_id, d.language_metadata) IN (
      SELECT unnest($1::text[]), unnest($2::text[])
    )
      AND df.full_html IS NOT NULL
      AND df.full_html != ''
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
    console.log(`📊 Enrich Teaching Citations test set: ${summary.total} decisions`);
    console.log(`   Languages: ${JSON.stringify(summary.byLanguage)}`);

    const { decisionIds, languages } = TestSetLoader.toQueryParams(testSet);
    return [decisionIds, languages];
  })(),

  /**
   * Preprocessing: Check dependencies and skip if any missing
   *
   * DependencyResolver loads and attaches dependencies to row:
   * - row.agent5a.legalTeachings
   * - row.agent2c.citedProvisions
   * - row.agent3.citedDecisions
   *
   * We explicitly check if ANY dependency is missing and skip the row
   * to avoid wasting API calls on incomplete data.
   */
  preprocessRow: async (row: any) => {
    // Check if all 3 required dependencies are present
    const hasAgent5a = row.agent5a && row.agent5a.legalTeachings;
    const hasAgent2c = row.agent2c && row.agent2c.citedProvisions;
    const hasAgent3 = row.agent3 && row.agent3.citedDecisions;

    // If ANY dependency missing, skip this row
    if (!hasAgent5a || !hasAgent2c || !hasAgent3) {
      console.warn(
        `⚠️  Skipping decision ${row.decision_id} (${row.language_metadata}): ` +
        `Missing dependencies - ` +
        `Agent5A: ${hasAgent5a ? '✓' : '✗'}, ` +
        `Agent2C: ${hasAgent2c ? '✓' : '✗'}, ` +
        `Agent3: ${hasAgent3 ? '✓' : '✗'}`
      );
      return null; // Skip this row
    }

    // All dependencies present - proceed with processing
    return row;
  },

  /**
   * Row Metadata Fields
   *
   * Track essential metadata for analysis and debugging.
   */
  rowMetadataFields: [
    "id",
    "decision_id",
    "language_metadata"
  ],

  /**
   * Prompt Template
   *
   * Injects 6 variables into prompt template:
   * 1. {decisionId} - ECLI identifier
   * 2. {proceduralLanguage} - FR or NL
   * 3. {fullText.html} - HTML from decision_fulltext1
   * 4. {legalTeachings} - JSON array from Agent 5A
   * 5. {citedProvisions} - JSON array from Agent 2C
   * 6. {citedDecisions} - JSON array from Agent 3
   */
  promptTemplate: (row) => {
    return ENRICH_TEACHING_CITATIONS_PROMPT
      .replace("{decisionId}", row.decision_id || "")
      .replace("{proceduralLanguage}", row.language_metadata || "FR")
      .replace("{fullText.html}", row.full_html || "")
      .replace("{legalTeachings}", JSON.stringify(row.agent5a?.legalTeachings || [], null, 2))
      .replace("{citedProvisions}", JSON.stringify(row.agent2c?.citedProvisions || [], null, 2))
      .replace("{citedDecisions}", JSON.stringify(row.agent3?.citedDecisions || [], null, 2));
  },

  /**
   * Output JSON Schema
   *
   * Validates:
   * - legalTeachings: Array with teachingId, relatedFullTextCitations, relationshipValidation
   * - metadata: Statistics about citations and validation results
   */
  outputSchema: enrichTeachingCitationsSchema,

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: SCHEMA_NAME,

  /**
   * Provider and Model Configuration
   *
   * Using gpt-5-mini with MEDIUM reasoning effort for citation extraction.
   * This is a complex task requiring:
   * - Semantic understanding of legal concepts
   * - Character-perfect HTML extraction
   * - Relationship validation logic
   */
  provider: "openai",
  openaiProvider: "azure",
  model: "gpt-5-mini",
  maxCompletionTokens: 128000,
  reasoningEffort: "medium",
  verbosity: "low",

  /**
   * Concurrency Configuration
   *
   * Standard concurrency for evaluation runs on test set.
   */
  concurrencyLimit: 200,

  /**
   * Evaluation Mode (NOT full-data pipeline)
   *
   * Running on test set, so use standard mode:
   * - Writes 4 aggregated JSONs to concurrent/results/
   * - Required for dependency resolution
   * - Suitable for evaluation and iteration
   */
  useFullDataPipeline: false,

  /**
   * Custom ID prefix
   */
  customIdPrefix: "enrich-citations",
};

export default config;
