#!/usr/bin/env node

import { DatabaseConfig } from './config/database.js';
import { AzureConfig } from './config/azure.js';
import { BatchJobRunner } from './core/BatchJobRunner.js';
import { JobStatusTracker } from './core/JobStatusTracker.js';
import { logger } from './utils/logger.js';

/**
 * CLI for Azure OpenAI Batch API Legal Data Extraction
 *
 * Usage:
 *   npm run dev submit <job-type>           - Submit a batch job
 *   npm run dev status <job-type>           - Check job status
 *   npm run dev process <job-type>          - Process completed results
 *   npm run dev list                        - List all jobs
 *   npm run dev test-connections            - Test database and Azure connections
 */

const COMMANDS = ['submit', 'status', 'process', 'list', 'test-connections', 'help'];

/**
 * Load job configuration by job type
 */
async function loadJobConfig(jobType: string): Promise<any> {
  try {
    // Import job configuration from configs directory
    const configPath = `./jobs/configs/${jobType}.js`;
    const module = await import(configPath);
    return module.default || module;
  } catch (error: any) {
    if (error.code === 'ERR_MODULE_NOT_FOUND') {
      logger.error(
        `Job configuration not found: ${jobType}. ` +
        `Please create a config file at src/jobs/configs/${jobType}.ts`
      );
    } else {
      logger.error(`Failed to load job configuration: ${error.message}`);
    }
    throw error;
  }
}

/**
 * Submit a batch job
 */
async function submitJob(jobType: string, wait: boolean = false): Promise<void> {
  logger.info(`Submitting batch job: ${jobType}`);

  const config = await loadJobConfig(jobType);
  const runner = new BatchJobRunner(config);

  await runner.run({
    waitForCompletion: wait,
    pollIntervalMs: 30000, // 30 seconds
  });
}

/**
 * Check job status
 */
async function checkStatus(jobType: string): Promise<void> {
  logger.info(`Checking status for: ${jobType}`);

  const config = await loadJobConfig(jobType);
  const runner = new BatchJobRunner(config);

  await runner.checkStatus();
}

/**
 * Process completed results
 */
async function processResults(jobType: string): Promise<void> {
  logger.info(`Processing results for: ${jobType}`);

  const config = await loadJobConfig(jobType);
  const runner = new BatchJobRunner(config);

  await runner.processResults();
}

/**
 * List all jobs
 */
async function listJobs(): Promise<void> {
  logger.info('Listing all jobs');

  const statuses = await JobStatusTracker.getAllStatuses();

  if (statuses.size === 0) {
    console.log('\nNo jobs found.');
    return;
  }

  console.log('\n📋 All Jobs:\n');

  for (const [jobType, metadata] of statuses) {
    const statusEmoji = {
      pending: '⏳',
      generated: '📝',
      submitted: '🚀',
      validating: '🔍',
      in_progress: '⚙️',
      finalizing: '🏁',
      completed: '✅',
      failed: '❌',
      cancelled: '🚫',
      processed: '✨',
    }[metadata.status] || '❓';

    console.log(`${statusEmoji} ${jobType}`);
    console.log(`   Status: ${metadata.status}`);
    console.log(`   Job ID: ${metadata.jobId}`);
    console.log(`   Created: ${new Date(metadata.createdAt).toLocaleString()}`);

    if (metadata.totalRecords) {
      console.log(`   Records: ${metadata.recordsProcessed || 0}/${metadata.totalRecords}`);
    }

    if (metadata.azureBatchJobId) {
      console.log(`   Azure Batch ID: ${metadata.azureBatchJobId}`);
    }

    if (metadata.errors.length > 0) {
      console.log(`   Errors: ${metadata.errors.length}`);
    }

    console.log('');
  }
}

/**
 * Test database and Azure connections
 */
async function testConnections(): Promise<void> {
  console.log('\n🧪 Testing connections...\n');

  // Test database
  console.log('Testing PostgreSQL connection...');
  const dbOk = await DatabaseConfig.testConnection();

  if (dbOk) {
    console.log('✅ Database connection successful\n');
  } else {
    console.log('❌ Database connection failed\n');
  }

  // Test Azure
  console.log('Testing Azure OpenAI configuration...');
  const azureOk = AzureConfig.validate();

  if (azureOk) {
    console.log('✅ Azure OpenAI configuration valid\n');
  } else {
    console.log('❌ Azure OpenAI configuration invalid\n');
  }

  if (dbOk && azureOk) {
    console.log('✅ All connections successful!');
  } else {
    console.log('❌ Some connections failed. Please check your .env file.');
    process.exit(1);
  }
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Azure OpenAI Batch API - Legal Data Extraction System

USAGE:
  npm run dev <command> [options]

COMMANDS:
  submit <job-type>              Submit a new batch job
  submit <job-type> --wait       Submit and wait for completion
  status <job-type>              Check status of a job
  process <job-type>             Download and process completed results
  list                           List all jobs and their statuses
  test-connections               Test database and Azure connections
  help                           Show this help message

EXAMPLES:
  npm run dev submit extract-parties
  npm run dev submit extract-parties --wait
  npm run dev status extract-parties
  npm run dev process extract-parties
  npm run dev list
  npm run dev test-connections

JOB TYPES:
  Job types are defined in src/jobs/configs/
  Create a new job config to add a new extraction type.

ENVIRONMENT:
  Configuration is loaded from .env file
  Required variables:
    - PGHOST, PGUSER, PGPASSWORD, PGDATABASE, PGPORT
    - AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY
    - AZURE_OPENAI_DEPLOYMENT, AZURE_API_VERSION

For more information, see README.md
`);
}

/**
 * Main CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === 'help') {
    printHelp();
    return;
  }

  const command = args[0];
  const jobType = args[1];
  const flags = args.slice(2);

  try {
    switch (command) {
      case 'submit':
        if (!jobType) {
          console.error('Error: Job type is required');
          console.error('Usage: npm run dev submit <job-type>');
          process.exit(1);
        }
        await submitJob(jobType, flags.includes('--wait'));
        break;

      case 'status':
        if (!jobType) {
          console.error('Error: Job type is required');
          console.error('Usage: npm run dev status <job-type>');
          process.exit(1);
        }
        await checkStatus(jobType);
        break;

      case 'process':
        if (!jobType) {
          console.error('Error: Job type is required');
          console.error('Usage: npm run dev process <job-type>');
          process.exit(1);
        }
        await processResults(jobType);
        break;

      case 'list':
        await listJobs();
        break;

      case 'test-connections':
        await testConnections();
        break;

      default:
        console.error(`Unknown command: ${command}`);
        console.error(`Valid commands: ${COMMANDS.join(', ')}`);
        printHelp();
        process.exit(1);
    }

    // Close database connection
    await DatabaseConfig.close();
  } catch (error) {
    logger.error('Command failed', error);
    console.error('\n❌ Command failed:', error instanceof Error ? error.message : String(error));
    await DatabaseConfig.close();
    process.exit(1);
  }
}

// Run CLI
main();
