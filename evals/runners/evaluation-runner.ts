/**
 * Evaluation Runner
 *
 * Main orchestrator for running evaluations on extraction results
 */

import fs from 'fs/promises';
import path from 'path';
import { loadExtractionResults, validateExtractionResults } from '../loaders/extraction-result-loader.js';
import { batchLoadSourceDocuments, loadSourceDocument, SourceDocumentWithMetadata } from '../loaders/source-document-loader.js';
import { scoreExtraction, extractScoresForBraintrust } from '../scorers/gpt5-judge-scorer.js';
import { createExperiment, logEvaluation, summarizeExperiment } from '../config/braintrust.js';
import { getJudgePromptFile } from '../config/job-prompt-map.js';
import { loadJudgePrompt } from '../utils/prompt-loader.js';
import { generateEnhancedExperimentName, generateExperimentName } from '../utils/experiment-naming.js';
import { filterToExtractionFields } from '../utils/extraction-filter.js';
import {
  EvalOptions,
  EvaluationResult,
  DecisionEvaluationInput,
  EvaluationProgress,
  ExperimentMetadata,
  GroundTruthData,
} from '../types.js';

/**
 * Type for scorer function
 */
type ScorerFunction = (
  decisionId: string,
  groundTruthData: GroundTruthData,
  extractedJSON: any,
  judgePromptTemplate: string,
  jobType?: string
) => Promise<EvaluationResult>;

/**
 * Run evaluation on extraction results
 *
 * @param jobType - Job type to evaluate (e.g., "extract-comprehensive")
 * @param timestamp - Optional specific timestamp, or use latest
 * @param options - Evaluation options
 * @returns Array of evaluation results
 */
export async function runEvaluation(
  jobType: string,
  timestamp: string | undefined,
  options: EvalOptions = {}
): Promise<{
  evaluations: EvaluationResult[];
  experimentId: string;
  metadata: ExperimentMetadata;
}> {
  // DEFAULT: concurrent results (fast iteration)
  // Use --batch flag to evaluate batch results instead
  const baseDir = options.batch ? 'results' : 'concurrent/results';
  const sourceLabel = options.batch ? 'batch results' : 'concurrent results';

  console.log(`\n🚀 Starting evaluation for ${jobType}${timestamp ? ` (${timestamp})` : ' (latest)'} from ${sourceLabel}\n`);

  // Using Azure GPT-4.1 as LLM judge
  console.log(`🤖 Using LLM Judge: Azure GPT-4.1\n`);

  // Load judge prompt for this job type
  const promptFile = getJudgePromptFile(jobType);
  const judgePromptTemplate = await loadJudgePrompt(promptFile);
  console.log(`📋 Using judge prompt: ${promptFile}\n`);

  // Load extraction results
  console.log('📥 Loading extraction results...');
  const { data, metadata, resultsDir } = await loadExtractionResults(
    jobType,
    timestamp,
    baseDir
  );

  console.log(`✅ Loaded ${data.length} extraction results`);
  console.log(`   Model: ${metadata.model}`);
  console.log(`   Extraction date: ${metadata.extractionDate}`);

  // Validate results
  validateExtractionResults(data);

  // Apply sample size if specified
  let decisionsToEvaluate = data;
  if (options.sampleSize && options.sampleSize < data.length) {
    decisionsToEvaluate = data.slice(0, options.sampleSize);
    console.log(`\n📊 Sampling ${options.sampleSize} decisions for evaluation`);
  }

  console.log(`   Decisions to evaluate: ${decisionsToEvaluate.length}`);

  // Extract decision keys (decisionId + language) for batch loading source documents
  // IMPORTANT: Prioritize decision_id (from metadata/database) over decisionId (from model output)
  // Models can "correct" decision IDs, causing mismatches with database
  const decisionKeys = decisionsToEvaluate.map((d) => ({
    decisionId: d.decision_id || d.decisionId, // decision_id first (authoritative)
    language: d.language || d.language_metadata || d.procedureLanguage || 'FR', // Try multiple field names
  }));

  console.log(`   Decision keys extracted: ${decisionKeys.length}`);

  // Batch load source documents
  console.log(`\n📚 Loading ${decisionKeys.length} source documents from database...`);
  const sourceDocuments = await batchLoadSourceDocuments(decisionKeys);
  console.log(`✅ Loaded ${sourceDocuments.size} source documents`);

  // Create Braintrust experiment with enhanced naming (includes config params)
  let experimentName: string;
  if (metadata.experimentConfig) {
    // Enhanced naming with reasoningEffort, maxTokens, etc.
    experimentName = generateEnhancedExperimentName(jobType, {
      model: metadata.experimentConfig.model,
      reasoningEffort: metadata.experimentConfig.reasoningEffort,
      maxCompletionTokens: metadata.experimentConfig.maxCompletionTokens,
      verbosity: metadata.experimentConfig.verbosity,
      temperature: metadata.experimentConfig.temperature,
    });
    console.log(`\n🧪 Creating Braintrust experiment: ${experimentName}`);
    console.log(`   Using enhanced naming with config parameters`);
  } else {
    // Fallback to legacy naming (for old results without experimentConfig)
    experimentName = generateExperimentName(jobType, metadata.model);
    console.log(`\n🧪 Creating Braintrust experiment: ${experimentName}`);
    console.log(`   ⚠️  Using legacy naming (experimentConfig not found in summary.json)`);
  }

  const experiment = await createExperiment(
    'belgian-legal-extraction', // Project name
    experimentName,
    {
      jobType,
      model: metadata.model,
      extractionDate: metadata.extractionDate,
      totalRecords: metadata.totalRecords,
      sampleSize: options.sampleSize,
      // Include full experiment config for traceability
      experimentConfig: metadata.experimentConfig,
    }
  );

  console.log(`✅ Experiment created`);

  // Prepare evaluation inputs
  const evaluationInputs: DecisionEvaluationInput[] = [];

  for (const extracted of decisionsToEvaluate) {
    // IMPORTANT: Use decision_id from metadata (database) as authoritative source
    // Model output decisionId may have "corrections" that don't match database
    const decisionId = extracted.decision_id || extracted.decisionId;
    const language = extracted.language || extracted.language_metadata || extracted.procedureLanguage || 'FR';

    // Use composite key to look up source document
    const cacheKey = `${decisionId}|${language}`;
    const sourceDocWithMeta = sourceDocuments.get(cacheKey);

    if (!sourceDocWithMeta) {
      console.warn(`⚠️  Warning: Source document not found for ${decisionId} (${language}), skipping`);
      continue;
    }

    evaluationInputs.push({
      decisionId,
      sourceDocument: sourceDocWithMeta.fullMd,
      extractedData: extracted,
      metadata: {
        id: extracted.id,
        language,
        url: sourceDocWithMeta.url,
        decision_type_ecli_code: extracted.decision_type_ecli_code,
        decision_type_name: extracted.decision_type_name,
        court_ecli_code: extracted.court_ecli_code,
        court_name: extracted.court_name,
        decision_date: extracted.decision_date,
        md_length: extracted.md_length,
        length_category: extracted.length_category,
      },
    });
  }

  console.log(`\n🎯 Evaluating ${evaluationInputs.length} decisions...\n`);

  // Determine concurrency
  const concurrency = 100; // Default to 5 parallel workers
  console.log(`   Using ${concurrency} parallel workers\n`);

  // Run evaluations in parallel batches
  const evaluations: EvaluationResult[] = [];
  const progress: EvaluationProgress = {
    total: evaluationInputs.length,
    completed: 0,
    failed: 0,
    startTime: new Date(),
  };

  // Process in batches
  for (let batchStart = 0; batchStart < evaluationInputs.length; batchStart += concurrency) {
    const batch = evaluationInputs.slice(batchStart, batchStart + concurrency);

    // Process batch in parallel
    const batchPromises = batch.map(async (input, batchIndex) => {
      const globalIndex = batchStart + batchIndex;

      try {
        // Filter extraction data to remove metadata (judge should only see model output)
        const extractionOnly = filterToExtractionFields(input.extractedData, jobType);

        // Score the extraction with job type and language
        const evaluation = await evaluateSingleDecision(
          input.decisionId,
          extractionOnly,  // Pass filtered data (no metadata)
          input.sourceDocument,
          judgePromptTemplate,
          jobType,
          input.metadata?.language || 'FR',
          scoreExtraction  // Pass the selected scorer function
        );

        // Log to Braintrust with FULL data (metadata preserved for clustering/analysis)
        const scores = extractScoresForBraintrust(evaluation);
        logEvaluation(
          experiment,
          {
            decisionId: input.decisionId,
            sourceDocument: input.sourceDocument,
            extractedData: input.extractedData,  // Full data with metadata
            url: input.metadata?.url,
          },
          evaluation,
          scores,
          input.metadata // Pass full metadata for aggregation/analysis
        );

        progress.completed++;

        // Display progress
        const percent = Math.round((progress.completed / evaluationInputs.length) * 100);
        process.stdout.write(
          `\r[${progress.completed}/${evaluationInputs.length}] (${percent}%) Last: ${input.decisionId.substring(0, 35)}...`
        );

        return { success: true, evaluation, input };
      } catch (error: any) {
        progress.failed++;
        console.error(`\n❌ Error evaluating ${input.decisionId}: ${error.message}`);
        return { success: false, error: error.message, input };
      }
    });

    // Wait for batch to complete
    const batchResults = await Promise.all(batchPromises);

    // Collect successful evaluations
    for (const result of batchResults) {
      if (result.success && result.evaluation) {
        evaluations.push(result.evaluation);
      }
    }

    // Small delay between batches to respect rate limits
    if (batchStart + concurrency < evaluationInputs.length) {
      await new Promise((resolve) => setTimeout(resolve, 500)); // 500ms between batches
    }
  }

  console.log(`\n\n✅ Evaluation complete!`);
  console.log(`   Completed: ${progress.completed}/${progress.total}`);
  console.log(`   Failed: ${progress.failed}`);

  // Calculate summary stats
  const avgScore =
    evaluations.reduce((sum, e) => sum + e.score, 0) /
    evaluations.length;
  const passCount = evaluations.filter((e) => e.verdict === 'PASS').length;
  const failCount = evaluations.filter((e) => e.verdict === 'FAIL').length;
  const reviewCount = evaluations.filter((e) => e.verdict === 'REVIEW_REQUIRED').length;

  console.log(`\n📊 Summary Statistics:`);
  console.log(`   Average Score: ${avgScore.toFixed(1)}/100`);
  console.log(`   Verdict Distribution:`);
  console.log(`     ✅ PASS: ${passCount} (${((passCount / evaluations.length) * 100).toFixed(1)}%)`);
  console.log(`     ❌ FAIL: ${failCount} (${((failCount / evaluations.length) * 100).toFixed(1)}%)`);
  console.log(`     ⚠️  REVIEW: ${reviewCount} (${((reviewCount / evaluations.length) * 100).toFixed(1)}%)`);

  // Save local results if requested (job-first directory structure)
  if (options.saveLocal !== false) {
    const outputDir =
      options.outputDir ||
      path.join(process.cwd(), 'evals', 'results', jobType, experimentName);
    await saveLocalResults(evaluations, outputDir, metadata);
    console.log(`\n💾 Results saved to: ${outputDir}`);
  }

  // Summarize experiment in Braintrust
  await summarizeExperiment(experiment);

  // Automatically run analysis and display results
  console.log('\n📊 Running automatic analysis...\n');
  try {
    const { analyzeExperimentFromBraintrust } = await import('../analyzers/experiment-analyzer.js');
    await analyzeExperimentFromBraintrust(experimentName);
  } catch (error: any) {
    console.warn('⚠️  Could not run automatic analysis:', error.message);
    console.warn('   You can run it manually: npm run analyze-results --', experimentName);
  }

  return {
    evaluations,
    experimentId: experimentName,
    metadata,
  };
}

/**
 * Evaluate a single decision
 *
 * @param decisionId - ECLI identifier
 * @param extractedData - Extracted JSON data
 * @param sourceDocument - Original markdown document
 * @param judgePromptTemplate - The loaded judge prompt markdown content
 * @param jobType - Job type (for context)
 * @param language - Procedural language (FR or NL)
 * @param scorer - Scorer function to use (Claude or GPT-5)
 * @returns Evaluation result
 */
export async function evaluateSingleDecision(
  decisionId: string,
  extractedData: any,
  sourceDocument: string,
  judgePromptTemplate: string,
  jobType: string,
  language: string,
  scorer: ScorerFunction
): Promise<EvaluationResult> {
  // Score the extraction using the provided scorer
  return await scorer(
    decisionId,
    sourceDocument,
    extractedData,
    judgePromptTemplate,
    jobType
  );
}

/**
 * Save evaluation results locally
 *
 * @param evaluations - Array of evaluation results
 * @param outputDir - Output directory path
 * @param metadata - Experiment metadata
 */
export async function saveLocalResults(
  evaluations: EvaluationResult[],
  outputDir: string,
  metadata: ExperimentMetadata
): Promise<void> {
  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // Save full evaluations
  const evaluationsPath = path.join(outputDir, 'evaluations.json');
  await fs.writeFile(
    evaluationsPath,
    JSON.stringify(evaluations, null, 2),
    'utf-8'
  );

  // Calculate and save summary
  const summary = {
    metadata,
    totalEvaluated: evaluations.length,
    avgScore:
      evaluations.reduce((sum, e) => sum + e.score, 0) /
      evaluations.length,
    verdictDistribution: {
      pass: evaluations.filter((e) => e.verdict === 'PASS').length,
      fail: evaluations.filter((e) => e.verdict === 'FAIL').length,
      reviewRequired: evaluations.filter((e) => e.verdict === 'REVIEW_REQUIRED').length,
    },
    issueStats: {
      avgCriticalIssues:
        evaluations.reduce((sum, e) => sum + e.criticalIssues.length, 0) /
        evaluations.length,
      avgMajorIssues:
        evaluations.reduce((sum, e) => sum + e.majorIssues.length, 0) /
        evaluations.length,
      avgMinorIssues:
        evaluations.reduce((sum, e) => sum + e.minorIssues.length, 0) /
        evaluations.length,
    },
    recommendationDistribution: evaluations.reduce(
      (acc, e) => {
        acc[e.recommendation] = (acc[e.recommendation] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    confidenceDistribution: evaluations.reduce(
      (acc, e) => {
        acc[e.confidence] = (acc[e.confidence] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>
    ),
    generatedAt: new Date().toISOString(),
  };

  const summaryPath = path.join(outputDir, 'summary.json');
  await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf-8');

  // Save failures and reviews
  const failures = evaluations.filter((e) => e.verdict === 'FAIL');
  const reviews = evaluations.filter((e) => e.verdict === 'REVIEW_REQUIRED');

  if (failures.length > 0) {
    const failuresPath = path.join(outputDir, 'failures.json');
    await fs.writeFile(
      failuresPath,
      JSON.stringify(failures, null, 2),
      'utf-8'
    );
  }

  if (reviews.length > 0) {
    const reviewsPath = path.join(outputDir, 'reviews.json');
    await fs.writeFile(
      reviewsPath,
      JSON.stringify(reviews, null, 2),
      'utf-8'
    );
  }
}
