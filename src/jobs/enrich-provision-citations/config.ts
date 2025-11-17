import { JobConfig } from "../JobConfig.js";
import { ENRICH_PROVISION_CITATIONS_PROMPT } from "./prompt.js";
import { enrichProvisionCitationsSchema, SCHEMA_NAME } from "./schema.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";
import { generateBlocksFromMarkdown } from "../../utils/markdownToHtml.js";

/**
 * Enrich Provision Citations Job Configuration - Agent 2D (Stage 2)
 *
 * ARCHITECTURE: BLOCK-BASED (v2)
 *
 * Enriches cited provisions from Agent 2C with block-based citations for UI highlighting.
 * Maps relationships between provisions and decisions cited in same context.
 *
 * CRITICAL FEATURES (v2.0):
 * - Block-based citations: Returns block IDs + snippets instead of HTML strings
 * - Comprehensive extraction: All section types (formal basis, party arguments, reasoning)
 * - Rich metadata tagging: citationType, relevanceScore, confidence, sectionType, courtResponse
 * - NO self-references: Relationships exclude the provision itself (v2.0 removed this)
 * - Robust UI highlighting via CSS selectors: querySelector([data-id="..."])
 * - Complex relationship objects: With co-occurrence counts and relationship sources
 * - Provision-to-provision relationship mapping (co-cited, compared, combined)
 * - Provision-to-decision relationship mapping (precedents interpreting provisions)
 * - Comprehensive search: reasoning, procedural, facts, judgment, formal basis, party arguments
 *
 * DEPENDENCIES (all required):
 * - interpret-provisions (Agent 2C): Source of provisions to enrich
 * - extract-legal-teachings (Agent 5A): Teachings for cross-reference
 * - extract-cited-decisions (Agent 3): Decisions for relationship mapping
 *
 * MARKDOWN SOURCE: decisions_md.full_md (converted to HTML via pandoc)
 *
 * EXECUTION MODE: Evaluation mode on 197-decision test set (not full-data pipeline)
 *
 * SKIP LOGIC: If ANY of the 3 dependencies is missing, row cannot be processed
 */

const config: JobConfig = {
  id: "enrich-provision-citations",

  description:
    "Enrich cited provisions with exact HTML citations for UI highlighting and map provision/decision relationships (Agent 2D - Stage 2)",

  /**
   * Dependencies (3 required - all from concurrent/results, latest timestamp)
   *
   * All dependencies use composite key matching: (decision_id, language_metadata)
   * All dependencies have required: true - if ANY missing, processing will fail
   */
  dependencies: [
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
    console.log(`📊 Enrich Provision Citations test set: ${summary.total} decisions`);
    console.log(`   Languages: ${JSON.stringify(summary.byLanguage)}`);

    const { decisionIds, languages } = TestSetLoader.toQueryParams(testSet);
    return [decisionIds, languages];
  })(),

  /**
   * Preprocessing: Check dependencies, transform HTML to blocks
   *
   * DependencyResolver loads and attaches dependencies to row:
   * - row.agent2c.citedProvisions
   * - row.agent5a.legalTeachings
   * - row.agent3.citedDecisions
   *
   * We explicitly check if ANY dependency is missing and skip the row
   * to avoid wasting API calls on incomplete data.
   *
   * Then we generate blocks from markdown (load → pandoc → transform)
   * to create block metadata with stable data-id attributes for LLM processing.
   */
  preprocessRow: async (row: any) => {
    // Check if all 3 required dependencies are present
    const hasAgent2c = row.agent2c && row.agent2c.citedProvisions;
    const hasAgent5a = row.agent5a && row.agent5a.legalTeachings;
    const hasAgent3 = row.agent3 && row.agent3.citedDecisions;

    // If ANY dependency missing, skip this row
    if (!hasAgent2c || !hasAgent5a || !hasAgent3) {
      console.warn(
        `⚠️  Skipping decision ${row.decision_id} (${row.language_metadata}): ` +
        `Missing dependencies - ` +
        `Agent2C: ${hasAgent2c ? '✓' : '✗'}, ` +
        `Agent5A: ${hasAgent5a ? '✓' : '✗'}, ` +
        `Agent3: ${hasAgent3 ? '✓' : '✗'}`
      );
      return null; // Skip this row
    }

    // Generate blocks from markdown (load markdown → convert to HTML → transform to blocks)
    const { blocks, blocksJson } = await generateBlocksFromMarkdown(
      row.decision_id,
      row.language_metadata
    );

    // Enrich row with blocks data
    return {
      ...row,
      blocks: blocks,
      blocks_json: blocksJson
    };
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
   * 3. {blocks} - JSON array of block metadata (NEW: replaces {fullText.html})
   * 4. {citedProvisions} - JSON array from Agent 2C
   * 5. {legalTeachings} - JSON array from Agent 5A
   * 6. {citedDecisions} - JSON array from Agent 3
   *
   * NOTE: Variable injection order differs from teaching citations:
   * - Provisions come BEFORE teachings in this prompt
   */
  promptTemplate: (row) => {
    return ENRICH_PROVISION_CITATIONS_PROMPT
      .replace("{decisionId}", row.decision_id || "")
      .replace("{proceduralLanguage}", row.language_metadata || "FR")
      .replace("{blocks}", row.blocks_json || "[]")
      .replace("{citedProvisions}", JSON.stringify(row.agent2c?.citedProvisions || [], null, 2))
      .replace("{legalTeachings}", JSON.stringify(row.agent5a?.legalTeachings || [], null, 2))
      .replace("{citedDecisions}", JSON.stringify(row.agent3?.citedDecisions || [], null, 2));
  },

  /**
   * Output JSON Schema
   *
   * Validates:
   * - citedProvisions: Array with internalProvisionId, citations (blockId + snippet), relationship mappings
   * - metadata: Statistics about citations and relationship mappings
   */
  outputSchema: enrichProvisionCitationsSchema,

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
   * - Block search and identification across document structure
   * - Relationship mapping logic
   */
  provider: "openai",
  openaiProvider: "azure",
  model: "gpt-5-mini",
  maxCompletionTokens: 64000,
  reasoningEffort: "medium",
  verbosity: "low",

  /**
   * Concurrency Configuration
   *
   * Standard concurrency for evaluation runs on test set.
   */
  concurrencyLimit: 300,

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
