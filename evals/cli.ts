#!/usr/bin/env node

/**
 * Evaluation CLI
 *
 * Command-line interface for running evaluations
 */

import { runEvaluation } from './runners/evaluation-runner.js';
import { generateComparisonReport, exportReportToMarkdown } from './reporters/analysis-reporter.js';
import { listAvailableExtractionResults } from './loaders/extraction-result-loader.js';
import { validateBraintrustConfig } from './config/braintrust.js';
import { validateGPT5Config } from './config/openai.js';
import { DatabaseConfig } from '../src/config/database.js';
import { getConfiguredJobTypes, hasEvalConfigured } from './config/job-prompt-map.js';

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Evaluation System for Belgian Legal Document Extraction

USAGE:
  npm run eval <job-type> [options]
  npm run eval <command> [args]

COMMANDS:
  <job-type>                     Run evaluation on latest concurrent results (DEFAULT)
  <job-type> --timestamp <ts>    Run evaluation on specific timestamp
  <job-type> --sample <n>        Run evaluation on sample of n decisions
  <job-type> --workers <n>       Run with n parallel workers (default: 5)
  <job-type> --batch             Evaluate batch processing results (instead of concurrent)
  compare <exp1> <exp2>          Compare two experiments and generate report
  list <job-type>                List available result timestamps
  test-connections               Test database, OpenAI, and Braintrust connections

EXAMPLES:
  npm run eval extract-comprehensive
  npm run eval extract-comprehensive --sample 50
  npm run eval extract-comprehensive --workers 10
  npm run eval extract-comprehensive --sample 50 --workers 10
  npm run eval extract-comprehensive --batch
  npm run eval extract-comprehensive --batch --sample 100
  npm run eval extract-comprehensive --batch --timestamp 2025-10-18T22-45-00-000Z
  npm run eval compare evals/results/exp1 evals/results/exp2
  npm run eval list extract-comprehensive
  npm run eval test-connections

ENVIRONMENT:
  Required environment variables in .env:
    - OPENAI_API_KEY          # OpenAI API key for GPT-5 judge
    - BRAINTRUST_API_KEY      # Braintrust API key
    - PGHOST, PGUSER, etc.    # PostgreSQL connection for source documents
`);
}

/**
 * Run evaluation command
 */
async function runEvalCommand(
  jobType: string,
  args: string[]
): Promise<void> {
  // Validate job type has eval configured
  if (!hasEvalConfigured(jobType)) {
    const configured = getConfiguredJobTypes();
    console.error(`❌ No eval configured for job type: ${jobType}\n`);
    console.error(`Configured job types:`);
    configured.forEach(j => console.error(`  - ${j}`));
    console.error(`\nTo add eval for this job:`);
    console.error(`  1. Edit: evals/config/job-prompt-map.ts`);
    console.error(`  2. Add: '${jobType}': 'llm-as-a-judge_XXX.md'`);
    console.error(`  3. Run: npm run eval run ${jobType}`);
    process.exit(1);
  }

  // Parse options
  const options: any = {};
  let timestamp: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sample' && args[i + 1]) {
      options.sampleSize = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--timestamp' && args[i + 1]) {
      timestamp = args[i + 1];
      i++;
    } else if (args[i] === '--workers' && args[i + 1]) {
      options.parallelWorkers = parseInt(args[i + 1], 10);
      i++;
    } else if (args[i] === '--no-save') {
      options.saveLocal = false;
    } else if (args[i] === '--batch') {
      options.batch = true;
    }
  }

  // Run evaluation
  const result = await runEvaluation(jobType, timestamp, options);

  console.log(`\n✨ Evaluation complete!`);
  console.log(`   Experiment ID: ${result.experimentId}`);
  console.log(`   View results in Braintrust: https://www.braintrustdata.com`);
}

/**
 * Compare experiments command
 */
async function compareCommand(experimentPaths: string[]): Promise<void> {
  if (experimentPaths.length < 2) {
    console.error('Error: Need at least 2 experiment paths to compare');
    console.error('Usage: npm run eval compare <path1> <path2>');
    process.exit(1);
  }

  console.log(`\n📊 Comparing ${experimentPaths.length} experiments...\n`);

  const report = await generateComparisonReport(experimentPaths);

  // Save markdown report
  const outputPath = 'evals/comparison-report.md';
  await exportReportToMarkdown(report, outputPath);

  console.log(`\n✅ Comparison report generated: ${outputPath}`);

  // Print summary
  console.log(`\n📈 Summary:`);
  console.log(`   Better Experiment: ${report.comparisons.betterExperiment}`);
  console.log(`   Overall Score Diff: ${report.comparisons.overallScoreDiff.toFixed(1)}`);
  console.log(`   Verbatim Score Diff: ${report.comparisons.verbatimScoreDiff.toFixed(1)}`);
  console.log(`   Usable Rate Diff: ${(report.comparisons.usableRateDiff * 100).toFixed(1)}%`);
}

/**
 * List available results command
 */
async function listCommand(jobType: string): Promise<void> {
  console.log(`\n📋 Available results for ${jobType}:\n`);

  const timestamps = await listAvailableExtractionResults(jobType);

  if (timestamps.length === 0) {
    console.log(`No results found for ${jobType}`);
    console.log(`Run the job first:`);
    console.log(`  npm run dev submit ${jobType}`);
    console.log(`  npm run dev process ${jobType}`);
    return;
  }

  for (const ts of timestamps) {
    const hasEval = hasEvalConfigured(jobType) ? '✅' : '⚪';
    console.log(`  ${hasEval} ${ts}`);
  }

  console.log(`\nTotal: ${timestamps.length} result sets`);

  if (hasEvalConfigured(jobType)) {
    console.log(`\nTo evaluate a specific timestamp:`);
    console.log(`  npm run eval run ${jobType} --timestamp <timestamp>`);
  } else {
    console.log(`\n⚪ No eval configured for ${jobType} yet`);
    console.log(`To add eval, edit: evals/config/job-prompt-map.ts`);
  }
}

/**
 * Test connections command
 */
async function testConnectionsCommand(): Promise<void> {
  console.log('\n🧪 Testing connections...\n');

  // Test database
  console.log('Testing PostgreSQL connection...');
  const dbOk = await DatabaseConfig.testConnection();

  if (dbOk) {
    console.log('✅ Database connection successful\n');
  } else {
    console.log('❌ Database connection failed\n');
  }

  // Test OpenAI
  console.log('Testing OpenAI GPT-5 configuration...');
  const openaiOk = validateGPT5Config();
  if (!openaiOk) {
    console.log('');
  }

  // Test Braintrust
  console.log('\nTesting Braintrust configuration...');
  const braintrustOk = validateBraintrustConfig();
  if (!braintrustOk) {
    console.log('');
  }

  if (dbOk && openaiOk && braintrustOk) {
    console.log('\n✅ All connections successful!');
  } else {
    console.log('\n❌ Some connections failed. Please check your .env file.');
    process.exit(1);
  }
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    printHelp();
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  try {
    // Handle special commands
    switch (command) {
      case 'compare':
        if (commandArgs.length < 2) {
          console.error('Error: Need at least 2 experiment paths');
          console.error('Usage: npm run eval compare <path1> <path2>');
          process.exit(1);
        }
        await compareCommand(commandArgs);
        break;

      case 'list':
        if (!commandArgs[0]) {
          console.error('Error: Job type is required');
          console.error('Usage: npm run eval list <job-type>');
          process.exit(1);
        }
        await listCommand(commandArgs[0]);
        break;

      case 'test-connections':
        await testConnectionsCommand();
        break;

      default:
        // Treat as job type (e.g., "extract-comprehensive")
        // This is the default behavior - run evaluation on the job
        await runEvalCommand(command, commandArgs);
        break;
    }

    // Close database connection
    await DatabaseConfig.close();
  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    await DatabaseConfig.close();
    process.exit(1);
  }
}

// Run CLI
main();
