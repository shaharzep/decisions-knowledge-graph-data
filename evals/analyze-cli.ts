#!/usr/bin/env node

/**
 * Analysis CLI
 *
 * Command-line interface for analyzing Braintrust experiment results
 */

import fs from 'fs/promises';
import path from 'path';
import { analyzeExperimentFromBraintrust } from './analyzers/experiment-analyzer.js';
import {
  getExperimentId,
  fetchExperimentResults,
  extractMetadataFromEvents,
} from './analyzers/braintrust-fetcher.js';
import { analyzeExperiment } from './analyzers/results-analyzer.js';
import {
  formatAnalysisReport,
  formatAsJson,
  formatAsMarkdown,
} from './analyzers/report-formatter.js';

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Analysis Tool for Braintrust Experiment Results

USAGE:
  npm run analyze-results -- <experimentNameOrId> [options]

ARGUMENTS:
  <experimentNameOrId>    Braintrust experiment name or ID
                          - Use name: "gpt-5-mini-latest"
                          - Use ID: "c2193b43-8eb3-4354-802f-adc51883fa72"

OPTIONS:
  --format <type>   Output format: console (default), json, or markdown
  --save            Save analysis report to file
  --output <path>   Output file path (default: evals/analysis/<experimentId>.<ext>)

EXAMPLES:
  npm run analyze-results -- exp-abc123xyz
  npm run analyze-results -- exp-abc123xyz --format json
  npm run analyze-results -- exp-abc123xyz --format markdown --save
  npm run analyze-results -- exp-abc123xyz --save --output analysis.md

NOTE:
  The "--" is required to separate npm options from script arguments.

DESCRIPTION:
  Fetches experiment results from Braintrust and analyzes them by metadata dimensions:
  - Language (FR vs NL)
  - Court (by ECLI code)
  - Decision Type (ARR, ORD, etc.)
  - Length Category (short, medium, long, very_long)

  Shows average scores, pass rates, and issue counts for each dimension.

REQUIREMENTS:
  - BRAINTRUST_API_KEY must be set in .env
  - Experiment must have metadata logged (language, court, etc.)
`);
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  // Check for help
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    printHelp();
    return;
  }

  // Parse arguments
  const experimentId = args[0];

  if (!experimentId || experimentId.startsWith('--')) {
    console.error('❌ Error: Experiment ID is required');
    console.error('Usage: npm run analyze-results <experimentId>');
    console.error('Run "npm run analyze-results help" for more information');
    process.exit(1);
  }

  // Parse options
  const formatIndex = args.indexOf('--format');
  const format =
    formatIndex !== -1 && args[formatIndex + 1]
      ? args[formatIndex + 1]
      : 'console';

  // Validate format
  if (!['console', 'json', 'markdown'].includes(format)) {
    console.error(`❌ Error: Invalid format "${format}"`);
    console.error('Valid formats: console, json, markdown');
    process.exit(1);
  }

  const options = {
    format: format as 'console' | 'json' | 'markdown',
    save: args.includes('--save'),
    output: args.includes('--output')
      ? args[args.indexOf('--output') + 1]
      : null,
  };

  try {
    // Validate Braintrust API key
    if (!process.env.BRAINTRUST_API_KEY) {
      console.error('❌ Error: BRAINTRUST_API_KEY not found in .env');
      console.error('Please add your Braintrust API key to .env file');
      process.exit(1);
    }

    // Step 1: Resolve experiment name to ID
    const resolvedExperimentId = await getExperimentId(experimentId);

    // Step 2: Fetch experiment results from Braintrust
    const events = await fetchExperimentResults(resolvedExperimentId);

    if (events.length === 0) {
      console.error('❌ Error: No events found for this experiment');
      console.error('Check that the experiment ID is correct');
      process.exit(1);
    }

    // Step 3: Parse events into evaluations
    const evaluations = extractMetadataFromEvents(events);

    // Check if metadata is available
    const hasMetadata = evaluations.some(
      (e) => e.language || e.courtEcliCode || e.lengthCategory
    );

    if (!hasMetadata) {
      console.warn(
        '⚠️  Warning: No metadata found in evaluations'
      );
      console.warn(
        '   Metadata was not logged to Braintrust and not found in extracted_data.'
      );
      console.warn(
        '   Dimension breakdowns will show "Unknown" for all values.'
      );
      console.warn('');
      console.warn(
        '   Note: Most experiments should have metadata in extracted_data from CSV test set.'
      );
      console.warn('');
    }

    // Step 4: Analyze experiment
    const report = analyzeExperiment(evaluations, resolvedExperimentId);

    // Step 5: Format based on output format
    let formattedContent: string;
    let defaultExtension: string;

    switch (options.format) {
      case 'json':
        formattedContent = formatAsJson(report);
        defaultExtension = 'json';
        break;
      case 'markdown':
        formattedContent = formatAsMarkdown(report);
        defaultExtension = 'md';
        break;
      case 'console':
      default:
        formattedContent = formatAnalysisReport(report);
        defaultExtension = 'txt';
        break;
    }

    // Display output (unless saving to file only)
    if (!options.save || options.format === 'console') {
      console.log(formattedContent);
    }

    // Step 6: Save to file if requested
    if (options.save) {
      const outputPath =
        options.output ||
        path.join(
          process.cwd(),
          'evals',
          'analysis',
          `${resolvedExperimentId}.${defaultExtension}`
        );

      // Ensure directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Save report
      await fs.writeFile(outputPath, formattedContent, 'utf-8');

      console.log(`💾 Analysis saved to: ${outputPath}`);
    }

    console.log('✅ Analysis complete!');
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run CLI
main();
