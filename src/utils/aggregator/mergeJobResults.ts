/**
 * Job Results Aggregator
 *
 * Merges extraction results from multiple jobs into single aggregated JSON per decision.
 * Uses (decision_id, language) as composite key.
 *
 * CRITICAL: Only merges decisions that exist in ALL jobs.
 * Skips and logs decisions missing from any job.
 */

import fs from 'fs/promises';
import path from 'path';
import {
  MergeOptions,
  JobLoadResult,
  MergeStatistics,
  AggregatedDecision,
  DecisionMetadata
} from './types.js';
import { JOB_MAPPINGS, METADATA_FIELDS, EXCLUDED_FIELDS, getOutputField } from './jobMappings.js';

/**
 * Main orchestrator for merging all job results
 *
 * @param options - Merge configuration options
 */
export async function mergeAllJobResults(options: MergeOptions): Promise<void> {
  const baseDir = options.baseDir || 'concurrent/results';

  console.log('\n📊 Starting job results aggregation...\n');
  console.log(`Model: ${options.model}`);
  console.log(`Base directory: ${baseDir}`);
  console.log(`Jobs to merge: ${JOB_MAPPINGS.length}\n`);

  // Step 1: Load all job results
  console.log('📥 Loading job results from latest timestamps...\n');
  const jobResults: JobLoadResult[] = [];
  const stats: MergeStatistics = {
    totalJobs: JOB_MAPPINGS.length,
    jobsLoaded: 0,
    jobsFailed: [],
    totalDecisionsAcrossJobs: 0,
    decisionsInAllJobs: 0,
    decisionsSkipped: 0,
    skippedDecisions: []
  };

  for (const mapping of JOB_MAPPINGS) {
    try {
      const result = await loadJobResults(mapping.jobId, options.model, baseDir);
      jobResults.push(result);
      stats.jobsLoaded++;
      stats.totalDecisionsAcrossJobs += result.decisionCount;

      console.log(`✅ ${mapping.jobId.padEnd(30)} | ${result.decisionCount} decisions | ${result.timestamp}`);
    } catch (error: any) {
      stats.jobsFailed.push(mapping.jobId);
      console.log(`❌ ${mapping.jobId.padEnd(30)} | Failed: ${error.message}`);
    }
  }

  console.log(`\n📊 Loaded ${stats.jobsLoaded}/${stats.totalJobs} jobs successfully\n`);

  if (stats.jobsLoaded === 0) {
    throw new Error('No jobs loaded successfully. Cannot proceed with merge.');
  }

  // Step 2: Find decisions present in ALL jobs
  console.log('🔍 Finding decisions present in ALL jobs...\n');
  const { completeDecisions, incompleteDecisions } = findCompleteDecisions(jobResults);

  stats.decisionsInAllJobs = completeDecisions.size;
  stats.decisionsSkipped = incompleteDecisions.length;
  stats.skippedDecisions = incompleteDecisions;

  console.log(`✅ ${completeDecisions.size} decisions present in all ${stats.jobsLoaded} jobs`);
  console.log(`⚠️  ${incompleteDecisions.length} decisions skipped (missing from at least one job)\n`);

  // Log skipped decisions
  if (incompleteDecisions.length > 0 && options.verbose) {
    console.log('⚠️  Skipped decisions:');
    for (const skipped of incompleteDecisions) {
      console.log(`   ${skipped.decision_id} (${skipped.language}) - missing from: ${skipped.missingFrom.join(', ')}`);
    }
    console.log('');
  }

  // Step 3: Merge complete decisions
  console.log('🔄 Merging decision data...\n');
  const aggregatedDecisions = mergeDecisions(completeDecisions, jobResults);

  console.log(`✅ Merged ${aggregatedDecisions.length} decisions\n`);

  // Step 4: Write output (one JSON file per decision)
  console.log('💾 Writing individual decision files...\n');
  const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, 'Z');
  const outputPath = path.join(options.outputDir, options.model, timestamp);
  await fs.mkdir(outputPath, { recursive: true });

  // Write each decision to its own file
  let filesWritten = 0;
  for (const decision of aggregatedDecisions) {
    const filename = `${decision.decision_id}_${decision.language}.json`;
    const filepath = path.join(outputPath, filename);
    await fs.writeFile(filepath, JSON.stringify(decision, null, 2));
    filesWritten++;

    if (options.verbose && filesWritten % 50 === 0) {
      console.log(`   Written ${filesWritten}/${aggregatedDecisions.length} files...`);
    }
  }

  // Write statistics file
  const statsFile = path.join(outputPath, 'merge-statistics.json');
  await fs.writeFile(statsFile, JSON.stringify(stats, null, 2));

  console.log(`✅ Written ${filesWritten} decision files to:`);
  console.log(`   ${outputPath}/`);
  console.log(`   Format: {decision_id}_{language}.json`);
  console.log(`\n💾 Statistics written to:`);
  console.log(`   ${statsFile}\n`);

  console.log('✅ Aggregation complete!\n');
}

/**
 * Find latest timestamp directory for a job
 *
 * @param jobId - Job identifier
 * @param model - Model directory name
 * @param baseDir - Base results directory
 * @returns Latest timestamp string or null if not found
 */
async function findLatestTimestamp(jobId: string, model: string, baseDir: string): Promise<string | null> {
  const jobDir = path.join(baseDir, jobId, model);

  try {
    const entries = await fs.readdir(jobDir, { withFileTypes: true });
    const timestamps = entries
      .filter(e => e.isDirectory() && e.name.match(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}/))
      .map(e => e.name)
      .sort()
      .reverse();

    return timestamps[0] || null;
  } catch (error) {
    return null;
  }
}

/**
 * Load job results from latest timestamp
 *
 * @param jobId - Job identifier
 * @param model - Model directory name
 * @param baseDir - Base results directory
 * @returns Job load result with data Map
 */
async function loadJobResults(jobId: string, model: string, baseDir: string): Promise<JobLoadResult> {
  const timestamp = await findLatestTimestamp(jobId, model, baseDir);

  if (!timestamp) {
    throw new Error(`No timestamp directories found for ${jobId}`);
  }

  const dataFile = path.join(baseDir, jobId, model, timestamp, 'extracted-data.json');

  try {
    const content = await fs.readFile(dataFile, 'utf-8');
    const data = JSON.parse(content);

    if (!Array.isArray(data)) {
      throw new Error('Expected array in extracted-data.json');
    }

    // Build Map keyed by "decision_id|language"
    const dataMap = new Map<string, any>();
    for (const decision of data) {
      const key = makeKey(decision.decision_id, decision.language || decision.language_metadata);
      dataMap.set(key, decision);
    }

    return {
      jobId,
      timestamp,
      decisionCount: dataMap.size,
      data: dataMap
    };
  } catch (error: any) {
    throw new Error(`Failed to load ${dataFile}: ${error.message}`);
  }
}

/**
 * Create composite key from decision_id and language
 */
function makeKey(decision_id: string, language: string): string {
  return `${decision_id}|${language}`;
}

/**
 * Find decisions present in ALL jobs
 *
 * @param jobResults - Results from all jobs
 * @returns Complete decisions and list of incomplete decisions with missing jobs
 */
function findCompleteDecisions(jobResults: JobLoadResult[]): {
  completeDecisions: Set<string>;
  incompleteDecisions: Array<{ decision_id: string; language: string; missingFrom: string[] }>;
} {
  // Collect all unique keys across all jobs
  const allKeys = new Set<string>();
  for (const job of jobResults) {
    for (const key of job.data.keys()) {
      allKeys.add(key);
    }
  }

  const completeDecisions = new Set<string>();
  const incompleteDecisions: Array<{ decision_id: string; language: string; missingFrom: string[] }> = [];

  // Check each key to see if present in ALL jobs
  for (const key of allKeys) {
    const missingFrom: string[] = [];

    for (const job of jobResults) {
      if (!job.data.has(key)) {
        missingFrom.push(job.jobId);
      }
    }

    if (missingFrom.length === 0) {
      // Present in all jobs
      completeDecisions.add(key);
    } else {
      // Missing from at least one job
      const [decision_id, language] = key.split('|');
      incompleteDecisions.push({ decision_id, language, missingFrom });
    }
  }

  return { completeDecisions, incompleteDecisions };
}

/**
 * Merge decisions present in all jobs
 *
 * @param completeKeys - Set of decision keys present in all jobs
 * @param jobResults - Results from all jobs
 * @returns Array of aggregated decisions
 */
function mergeDecisions(completeKeys: Set<string>, jobResults: JobLoadResult[]): AggregatedDecision[] {
  const aggregated: AggregatedDecision[] = [];

  for (const key of completeKeys) {
    const [decision_id, language] = key.split('|');

    // Get first job's data for metadata extraction
    const firstJob = jobResults[0];
    const firstDecision = firstJob.data.get(key)!;

    // Build aggregated decision
    const merged: AggregatedDecision = {
      decision_id,
      language,
      metadata: extractMetadata(firstDecision)
    };

    // Add data from each job
    for (const job of jobResults) {
      const decision = job.data.get(key)!;
      const outputField = getOutputField(job.jobId);

      if (outputField) {
        // Extract job-specific fields (exclude metadata and common fields)
        const jobData = extractJobData(decision);
        (merged as any)[outputField] = jobData;
      }
    }

    aggregated.push(merged);
  }

  // Sort by decision_id for consistency
  aggregated.sort((a, b) => a.decision_id.localeCompare(b.decision_id));

  return aggregated;
}

/**
 * Extract metadata fields from decision object
 */
function extractMetadata(decision: any): DecisionMetadata {
  const metadata: DecisionMetadata = {};

  for (const field of METADATA_FIELDS) {
    if (field in decision) {
      (metadata as any)[field] = decision[field];
    }
  }

  return metadata;
}

/**
 * Extract job-specific data (exclude metadata and common fields)
 */
function extractJobData(decision: any): any {
  const jobData: any = {};

  for (const [key, value] of Object.entries(decision)) {
    if (!EXCLUDED_FIELDS.includes(key)) {
      jobData[key] = value;
    }
  }

  return jobData;
}
