#!/usr/bin/env node
/**
 * CLI tool for merging job results into aggregated decisions JSON
 *
 * Usage:
 *   npm run merge:results
 *   npm run merge:results -- --verbose
 *   npm run merge:results -- --model gpt-5-mini --output concurrent/results/aggregated
 */

import { mergeAllJobResults } from '../utils/aggregator/mergeJobResults.js';
import { MergeOptions } from '../utils/aggregator/types.js';

async function main() {
  // Parse command-line arguments
  const args = process.argv.slice(2);
  const options: MergeOptions = {
    model: 'gpt-5-mini',
    outputDir: 'concurrent/results/aggregated',
    baseDir: 'concurrent/results',
    verbose: false
  };

  // Simple argument parsing
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--model' && i + 1 < args.length) {
      options.model = args[i + 1];
      i++;
    } else if (arg === '--output' && i + 1 < args.length) {
      options.outputDir = args[i + 1];
      i++;
    } else if (arg === '--base-dir' && i + 1 < args.length) {
      options.baseDir = args[i + 1];
      i++;
    } else if (arg === '--verbose' || arg === '-v') {
      options.verbose = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  try {
    await mergeAllJobResults(options);
    process.exit(0);
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
📊 Job Results Aggregator

Merges extraction results from multiple jobs into single aggregated JSON per decision.
Uses (decision_id, language) as composite key.

CRITICAL: Only merges decisions that exist in ALL jobs.

Usage:
  npm run merge:results [options]

Options:
  --model <name>       Model directory to use (default: gpt-5-mini)
  --output <dir>       Output directory (default: concurrent/results/aggregated)
  --base-dir <dir>     Base directory with job results (default: concurrent/results)
  --verbose, -v        Enable verbose logging
  --help, -h           Show this help message

Examples:
  # Basic usage (uses defaults)
  npm run merge:results

  # Verbose output with skipped decisions logged
  npm run merge:results -- --verbose

  # Custom output directory
  npm run merge:results -- --output data/aggregated

Jobs Merged:
  - extract-comprehensive (Stage 1)
  - enrich-provisions (Agent 2B - extractedReferences)
  - interpret-provisions (Stage 2C, includes 2A)
  - extract-cited-decisions (Stage 3)
  - extract-keywords (Stage 4)
  - extract-legal-teachings (Stage 5A)
  - extract-micro-summary (Agent 6)
  - enrich-provision-citations (Agent 2D)
  - enrich-teaching-citations (Agent 5B)

Output:
  - aggregated-decisions.json: Array of merged decisions
  - merge-statistics.json: Merge stats and skipped decisions
`);
}

main();
