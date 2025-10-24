/**
 * Extraction Result Loader for Evaluations
 *
 * Loads processed extraction results for evaluation
 */

import {
  getLatestResults,
  getResultsByTimestamp,
  loadExtractedData,
  loadSummary,
  listAvailableResults,
} from '../../src/utils/jobResultLoader.js';
import { ExperimentMetadata } from '../types.js';

/**
 * Load extraction results for evaluation
 *
 * @param jobType - Job type (e.g., "extract-comprehensive")
 * @param timestamp - Optional specific timestamp, or use latest
 * @param baseDir - Base directory (default: 'results', can use 'concurrent/results')
 * @returns Extracted data array and metadata
 */
export async function loadExtractionResults(
  jobType: string,
  timestamp?: string,
  baseDir: string = 'results'
): Promise<{
  data: any[];
  metadata: ExperimentMetadata;
  resultsDir: string;
}> {
  let resultsDir: string;
  let data: any[];
  let summary: any;

  if (timestamp) {
    // Load specific timestamp
    resultsDir = getResultsByTimestamp(jobType, timestamp, baseDir);
    data = await loadExtractedData(resultsDir);
    summary = await loadSummary(resultsDir);
  } else {
    // Load latest results
    const latest = await getLatestResults(jobType, baseDir);
    resultsDir = latest.resultsDir;
    data = latest.data;
    summary = latest.summary;
  }

  // Extract metadata for experiment
  const metadata: ExperimentMetadata = {
    jobType: summary.jobType || jobType,
    timestamp: timestamp || summary.processedAt || new Date().toISOString(),
    model: extractModelFromSummary(summary),
    totalRecords: summary.totalRecords || data.length,
    successfulRecords: summary.successful || data.length,
    failedRecords: summary.failed || 0,
    extractionDate: summary.processedAt || new Date().toISOString(),
  };

  return {
    data,
    metadata,
    resultsDir,
  };
}

/**
 * Extract model name from summary metadata
 *
 * Tries to infer from jobType or defaults to "o4-mini"
 */
function extractModelFromSummary(summary: any): string {
  // Check if model is explicitly in metadata
  if (summary.model) {
    return summary.model;
  }

  // Check job type for model hints
  const jobType = summary.jobType || '';
  if (jobType.includes('gpt-5')) {
    return 'gpt-5';
  }
  if (jobType.includes('o4')) {
    return 'o4-mini';
  }

  // Default to o4-mini (current configuration)
  return 'o4-mini';
}

/**
 * List available result timestamps for a job
 *
 * @param jobType - Job type
 * @returns Array of timestamp strings
 */
export async function listAvailableExtractionResults(
  jobType: string
): Promise<string[]> {
  return await listAvailableResults(jobType);
}

/**
 * Validate that extraction results are suitable for evaluation
 *
 * @param data - Extracted data array
 * @throws Error if data is invalid
 */
export function validateExtractionResults(data: any[]): void {
  if (!Array.isArray(data)) {
    throw new Error('Extraction results must be an array');
  }

  if (data.length === 0) {
    throw new Error('No extraction results to evaluate');
  }

  // Check that each result has required fields
  const firstResult = data[0];
  if (!firstResult.decisionId && !firstResult.decision_id) {
    throw new Error(
      'Extraction results missing decisionId field. ' +
        'Results may be from an old extraction format.'
    );
  }

  console.log(`✅ Validated ${data.length} extraction results`);
}
