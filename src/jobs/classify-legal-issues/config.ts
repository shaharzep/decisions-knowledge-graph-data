/**
 * ULIT Legal Issue Classification Job Configuration
 *
 * Classifies legal teachings using the Universal Legal Issue Taxonomy.
 * Entity = Legal Teaching (not Decision) - one teaching = one classification.
 *
 * PIPELINE: 4-stage execution
 * - Stage 1: Candidate Generation (LLM, temp=0.3)
 * - Stage 2: Topic Set Selection (LLM, temp=0.1)
 * - Stage 3: Issue Type Set Selection (LLM, temp=0.2)
 * - Stage 4: Validation & Issue Key (no LLM)
 *
 * DEPENDENCY: extract-legal-teachings (full-data)
 * - Loads teachings from latest full-data run
 * - Filters to comprehensive-197.csv test set decisions
 * - Each teaching becomes one row to process
 *
 * MODEL: gpt-4.1-mini via standard OpenAI
 */

import { JobConfig } from '../JobConfig.js';
import { classifyLegalIssuesSchema, SCHEMA_NAME } from './schema.js';
import {
  TeachingInput,
  runStage1CandidateGeneration,
  runStage2TopicSetSelection,
  runStage3IssueTypeSetSelection,
} from './stages.js';
import { buildFinalClassification } from './validation.js';
import fs from 'fs';
import path from 'path';

/**
 * Load test set decision IDs from comprehensive-197.csv
 */
function loadTestSetDecisionIds(): Set<string> {
  const csvPath = path.join(process.cwd(), 'evals', 'test-sets', 'comprehensive-197.csv');

  if (!fs.existsSync(csvPath)) {
    throw new Error(`Test set CSV not found: ${csvPath}`);
  }

  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.trim().split('\n');

  // Skip header row, extract decision_id (first column)
  const decisionIds = new Set<string>();
  for (let i = 1; i < lines.length; i++) {
    const columns = lines[i].split(',');
    if (columns[0]) {
      decisionIds.add(columns[0].trim());
    }
  }

  console.log(`📋 Loaded ${decisionIds.size} decision IDs from comprehensive-197.csv test set`);
  return decisionIds;
}

// Load test set at module load time
const TEST_SET_DECISION_IDS = loadTestSetDecisionIds();

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
 * Load teachings from extract-legal-teachings full-data
 *
 * Expands each decision's legalTeachings array into individual teaching objects.
 * Filters to only include teachings from decisions in the test set.
 * Returns flattened array where each element is a single teaching to classify.
 */
function loadTestSetTeachings(timestamp: string, testSetDecisionIds: Set<string>): TeachingInput[] {
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

  console.log(`Scanning ${jsonFiles.length} decision files for test set matches...`);

  const testSetTeachings: TeachingInput[] = [];
  let decisionsMatched = 0;

  for (const filename of jsonFiles) {
    const filepath = path.join(jsonsDir, filename);
    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      const decisionId = data.decision_id;

      // Filter: only include decisions from test set
      if (!testSetDecisionIds.has(decisionId)) {
        continue;
      }

      decisionsMatched++;
      const teachings = data.legalTeachings || [];
      const language = data.language || data.language_metadata;

      for (const teaching of teachings) {
        // Map teaching fields to TeachingInput
        testSetTeachings.push({
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

  console.log(`✅ Found ${testSetTeachings.length} teachings from ${decisionsMatched}/${testSetDecisionIds.size} test set decisions`);

  return testSetTeachings;
}

// Auto-detect latest extract-legal-teachings run
const LATEST_TEACHINGS_TIMESTAMP = getLatestFullDataTimestamp('extract-legal-teachings');

if (!LATEST_TEACHINGS_TIMESTAMP) {
  throw new Error(
    'No extract-legal-teachings full-data results found.\n\nPlease run extract-legal-teachings first:\n  npm run dev concurrent extract-legal-teachings'
  );
}

console.log(`\n📋 Using extract-legal-teachings results from: ${LATEST_TEACHINGS_TIMESTAMP}`);

// Load teachings from test set only
const ALL_TEACHINGS = loadTestSetTeachings(LATEST_TEACHINGS_TIMESTAMP, TEST_SET_DECISION_IDS);

console.log(`\n✅ ${ALL_TEACHINGS.length} teachings ready to classify (from test set)\n`);

// Use all test set teachings (no resume mode for eval runs)
const teachingsToProcess = ALL_TEACHINGS;

const config: JobConfig = {
  id: 'classify-legal-issues',

  description:
    'Classify legal teachings using ULIT (comprehensive-197 test set) - 4-stage pipeline with set-based topics and issue types',

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
  staticRows: teachingsToProcess.map((teaching) => ({
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

    // Stage 3: Issue Type Set Selection
    const stage3Result = await runStage3IssueTypeSetSelection(
      teaching,
      stage1Result,
      stage2Result,
      client
    );

    // Stage 4: Validation & Issue Key (no LLM)
    const classification = buildFinalClassification(teaching, stage1Result, stage2Result, stage3Result);

    // Include teaching input metadata in output for easier analysis
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
   * gpt-4.1 via Azure OpenAI.
   * Each teaching requires 3 LLM calls with different temperatures.
   */
  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-4.1',

  /**
   * Concurrency Configuration
   *
   * Conservative concurrency for multi-stage pipeline:
   * - 100 concurrent teachings (each = 3 API calls)
   * - Effective 300 concurrent API calls maximum
   * - Rate limiting via requestsPerSecond to prevent bursts
   */
  concurrencyLimit: 100,
  maxConcurrentApiCalls: 150,
  requestsPerSecond: 50,

  /**
   * Standard Pipeline Mode (for test set evaluation)
   *
   * Writes aggregated results to concurrent/results/classify-legal-issues/
   */
  useFullDataPipeline: false,

  /**
   * Custom ID prefix
   */
  customIdPrefix: 'classify-issues',
};

export default config;
