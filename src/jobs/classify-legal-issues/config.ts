/**
 * ULIT Legal Issue Classification Job Configuration
 *
 * Classifies legal teachings using the Universal Legal Issue Taxonomy.
 * Entity = Legal Teaching (not Decision) - one teaching = one classification.
 *
 * PIPELINE: 4-stage execution
 * - Stage 1: Candidate Generation (LLM, LOW reasoning)
 * - Stage 2: Topic Set Selection (LLM, LOW reasoning)
 * - Stage 3: Issue Type Set Selection (LLM, LOW reasoning)
 * - Stage 4: Validation & Issue Key (no LLM)
 *
 * DEPENDENCY: extract-legal-teachings (full-data)
 * - Loads ALL teachings from latest full-data run
 * - Each teaching becomes one row to process
 *
 * MODEL: gpt-5-mini with LOW reasoning via Azure OpenAI
 */

import { JobConfig } from '../JobConfig.js';
import { classifyLegalIssuesSchema, SCHEMA_NAME } from './schema.js';
import {
  TeachingInput,
  runStage1CandidateGeneration,
  runStage2TopicSetSelection,
  runStage3WithRetry,
} from './stages.js';
import { buildFinalClassification, validateClassification } from './validation.js';
import fs from 'fs';
import path from 'path';

/**
 * Get latest full-data run timestamp for a job
 */
function getLatestFullDataTimestamp(jobId: string): string | null {
  const resultsDir = path.join(process.cwd(), 'full-data', jobId);

  if (!fs.existsSync(resultsDir)) {
    return null;
  }

  const timestamps = fs
    .readdirSync(resultsDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.test(name))
    .sort()
    .reverse();

  return timestamps[0] || null;
}

/**
 * Load ALL teachings from extract-legal-teachings full-data
 *
 * Expands each decision's legalTeachings array into individual teaching objects.
 * Returns flattened array where each element is a single teaching to classify.
 */
function loadAllTeachings(timestamp: string): TeachingInput[] {
  const jsonsDir = path.join(
    process.cwd(),
    'full-data',
    'extract-legal-teachings',
    timestamp,
    'jsons'
  );

  if (!fs.existsSync(jsonsDir)) {
    throw new Error(
      `Full-data results not found: ${jsonsDir}\n\nPlease run extract-legal-teachings first:\n  npm run dev concurrent extract-legal-teachings`
    );
  }

  const jsonFiles = fs.readdirSync(jsonsDir).filter((f) => f.endsWith('.json'));

  if (jsonFiles.length === 0) {
    throw new Error('No decision JSONs found in extract-legal-teachings full-data directory.');
  }

  console.log(`Loading teachings from ${jsonFiles.length} decision files...`);

  const allTeachings: TeachingInput[] = [];
  let decisionsProcessed = 0;

  for (const filename of jsonFiles) {
    const filepath = path.join(jsonsDir, filename);
    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      const decisionId = data.decision_id;
      const teachings = data.legalTeachings || [];
      const language = data.language || data.language_metadata;

      decisionsProcessed++;

      for (const teaching of teachings) {
        // Map teaching fields to TeachingInput
        allTeachings.push({
          teachingId: teaching.teachingId,
          text: teaching.text,
          courtVerbatim: teaching.courtVerbatim,
          factualTrigger: teaching.factualTrigger,
          principleType: teaching.principleType,
          relatedCitedProvisions: teaching.relatedCitedProvisions?.map((id: string) => ({
            // We only have IDs, not full provision data - this is fine for classification
            parentActName: id,
            provisionNumber: '',
          })) || [],
          decisionId,
          language,
        });
      }
    } catch (error) {
      console.warn(`Failed to read ${filename}: ${error}`);
    }
  }

  console.log(`✅ Loaded ${allTeachings.length} teachings from ${decisionsProcessed} decisions`);

  return allTeachings;
}

// Auto-detect latest extract-legal-teachings run
const LATEST_TEACHINGS_TIMESTAMP = getLatestFullDataTimestamp('extract-legal-teachings');

if (!LATEST_TEACHINGS_TIMESTAMP) {
  throw new Error(
    'No extract-legal-teachings full-data results found.\n\nPlease run extract-legal-teachings first:\n  npm run dev concurrent extract-legal-teachings'
  );
}

console.log(`\n📋 Using extract-legal-teachings results from: ${LATEST_TEACHINGS_TIMESTAMP}`);

// Load ALL teachings from full-data
const ALL_TEACHINGS = loadAllTeachings(LATEST_TEACHINGS_TIMESTAMP);

console.log(`\n✅ ${ALL_TEACHINGS.length} teachings ready to classify\n`);

const config: JobConfig = {
  id: 'classify-legal-issues',

  description:
    'Classify legal teachings using ULIT - 4-stage pipeline with set-based topics and issue types (full dataset)',

  /**
   * Dependencies - none (data loaded from full-data files)
   */
  dependencies: [],

  /**
   * Static Rows (no database needed)
   *
   * Teachings are pre-loaded from extract-legal-teachings full-data output.
   * Each row contains the full teaching object ready for classification.
   */
  staticRows: ALL_TEACHINGS.map((teaching) => ({
    teaching_id: teaching.teachingId,
    teaching,
  })),

  /**
   * Row Metadata Fields
   *
   * Track teaching_id for output filenames and analysis.
   */
  rowMetadataFields: ['teaching_id'],

  /**
   * Custom Execution
   *
   * 4-stage pipeline with 3 LLM calls + 1 validation step.
   * This replaces promptTemplate for multi-step LLM workflows.
   */
  customExecution: async (row: { teaching_id: string; teaching: TeachingInput }, client: any) => {
    const teaching = row.teaching;

    // Stage 1: Candidate Generation
    const stage1Result = await runStage1CandidateGeneration(teaching, client);

    // Stage 2: Topic Set Selection
    const stage2Result = await runStage2TopicSetSelection(teaching, stage1Result, client);

    // Stage 3: Issue Type Set Selection (with retry on validation failure)
    const { result: stage3Result, retried, originalErrors } = await runStage3WithRetry(
      teaching,
      stage1Result,
      stage2Result,
      client,
      validateClassification
    );

    if (retried) {
      console.log(`📝 Teaching ${teaching.teachingId}: Stage 3 retry was triggered`);
    }

    // Stage 4: Validation & Issue Key (no LLM)
    const classification = buildFinalClassification(teaching, stage1Result, stage2Result, stage3Result);

    // Include teaching input metadata and retry info in output for easier analysis
    return {
      ...classification,
      teaching_input: {
        teachingId: teaching.teachingId,
        text: teaching.text,
        courtVerbatim: teaching.courtVerbatim,
        factualTrigger: teaching.factualTrigger,
        principleType: teaching.principleType,
        decisionId: teaching.decisionId,
        language: teaching.language,
        relatedCitedProvisions: teaching.relatedCitedProvisions,
      },
      stage3_retry: {
        retried,
        originalErrors: originalErrors || [],
      },
    };
  },

  /**
   * Output JSON Schema
   */
  outputSchema: classifyLegalIssuesSchema,

  /**
   * Schema name for structured outputs (not used with customExecution)
   */
  outputSchemaName: SCHEMA_NAME,

  /**
   * Provider and Model Configuration
   *
   * gpt-5-mini with LOW reasoning via Azure OpenAI.
   * Each teaching requires 3 LLM calls with LOW reasoning effort.
   */
  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-5-mini',
  reasoningEffort: 'low',

  /**
   * Concurrency Configuration
   *
   * Conservative concurrency for multi-stage pipeline:
   * - 200 concurrent teachings (each = 3 API calls)
   * - Effective 600 concurrent API calls maximum
   * - Rate limiting via requestsPerSecond to prevent bursts
   */
  concurrencyLimit: 200,
  maxConcurrentApiCalls: 300,
  requestsPerSecond: 100,

  /**
   * Full-Data Pipeline Mode
   *
   * Writes per-teaching JSONs to full-data/classify-legal-issues/<timestamp>/jsons/
   * Required for large datasets and downstream processing.
   */
  useFullDataPipeline: true,

  /**
   * Custom ID prefix
   */
  customIdPrefix: 'classify-issues',
};

export default config;
