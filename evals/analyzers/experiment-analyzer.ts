/**
 * Experiment Analyzer
 *
 * Orchestrates fetching, analyzing, and displaying experiment results.
 * Used by both the CLI and automatic post-evaluation analysis.
 */

import {
  getExperimentId,
  fetchExperimentResults,
  extractMetadataFromEvents,
} from './braintrust-fetcher.js';
import { analyzeExperiment } from './results-analyzer.js';
import { formatAnalysisReport } from './report-formatter.js';

/**
 * Analyze an experiment from Braintrust and display results
 *
 * Fetches experiment data, runs analysis, and displays console output.
 * Used for automatic analysis after evaluation completes.
 *
 * @param experimentNameOrId - Braintrust experiment name or ID
 * @param projectName - Project name (default: belgian-legal-extraction)
 */
export async function analyzeExperimentFromBraintrust(
  experimentNameOrId: string,
  projectName: string = 'belgian-legal-extraction'
): Promise<void> {
  // Resolve experiment name to ID
  const experimentId = await getExperimentId(experimentNameOrId, projectName);

  // Fetch experiment results from Braintrust
  const events = await fetchExperimentResults(experimentId);

  if (events.length === 0) {
    console.warn('⚠️  No events found for this experiment');
    return;
  }

  // Parse events into evaluations
  const evaluations = extractMetadataFromEvents(events);

  // Check if metadata is available
  const hasMetadata = evaluations.some(
    (e) => e.language || e.courtEcliCode || e.lengthCategory
  );

  if (!hasMetadata) {
    console.warn('⚠️  Warning: No metadata found in evaluations');
    console.warn('   Dimension breakdowns will show "Unknown" for all values.');
    console.warn('');
  }

  // Analyze experiment
  const report = analyzeExperiment(evaluations, experimentId);

  // Format and display
  const formattedReport = formatAnalysisReport(report);
  console.log(formattedReport);
}
