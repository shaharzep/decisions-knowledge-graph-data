#!/usr/bin/env node

import { DatabaseConfig } from './config/database.js';
import { AzureConfig } from './config/azure.js';
import { OpenAIConfig } from './config/openai.js';
import { BatchJobRunner } from './core/BatchJobRunner.js';
import { JobStatusTracker } from './core/JobStatusTracker.js';
import { logger } from './utils/logger.js';

/**
 * CLI for Batch API Legal Data Extraction
 *
 * Supports Azure OpenAI and standard OpenAI Batch APIs
 *
 * Usage:
 *   npm run dev submit <job-type>           - Submit a batch job
 *   npm run dev status <job-type>           - Check job status
 *   npm run dev process <job-type>          - Process completed results
 *   npm run dev list                        - List all jobs
 *   npm run dev test-connections            - Test database and provider connections
 */

const COMMANDS = ['submit', 'status', 'process', 'list', 'test-connections', 'concurrent', 'retry', 'merge', 'help'];

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

  // Reset client caches to pick up any .env changes
  AzureConfig.resetClient();
  OpenAIConfig.resetClient();

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

  // Reset client caches to pick up any .env changes
  AzureConfig.resetClient();
  OpenAIConfig.resetClient();

  const config = await loadJobConfig(jobType);
  const runner = new BatchJobRunner(config);

  await runner.checkStatus();
}

/**
 * Process completed results
 */
async function processResults(jobType: string): Promise<void> {
  logger.info(`Processing results for: ${jobType}`);

  // Reset client caches to pick up any .env changes
  AzureConfig.resetClient();
  OpenAIConfig.resetClient();

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
 * Test database and provider connections
 */
async function testConnections(): Promise<void> {
  console.log('\n🧪 Testing connections...\n');

  let allOk = true;

  // Test database
  console.log('Testing PostgreSQL connection...');
  const dbOk = await DatabaseConfig.testConnection();

  if (dbOk) {
    console.log('✅ Database connection successful\n');
  } else {
    console.log('❌ Database connection failed\n');
    allOk = false;
  }

  // Test Azure OpenAI
  console.log('Testing Azure OpenAI configuration...');
  const azureOk = AzureConfig.validate();

  if (azureOk) {
    console.log('✅ Azure OpenAI configuration valid\n');
  } else {
    console.log('⚠️  Azure OpenAI configuration invalid (optional)\n');
  }

  // Test standard OpenAI
  console.log('Testing OpenAI configuration...');
  const openaiOk = OpenAIConfig.validate();

  if (openaiOk) {
    console.log('✅ OpenAI configuration valid\n');
  } else {
    console.log('⚠️  OpenAI configuration invalid (optional)\n');
  }

  // At least one provider must be configured
  if (!azureOk && !openaiOk) {
    console.log('❌ No batch provider configured. Please configure either Azure OpenAI or OpenAI.\n');
    allOk = false;
  }

  if (allOk && (azureOk || openaiOk)) {
    console.log('✅ All required connections successful!');
    if (azureOk && openaiOk) {
      console.log('   Both Azure and OpenAI providers available');
    } else if (azureOk) {
      console.log('   Azure OpenAI provider available');
    } else {
      console.log('   OpenAI provider available');
    }
  } else {
    console.log('❌ Some required connections failed. Please check your .env file.');
    process.exit(1);
  }
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Batch API Legal Data Extraction System

Supports Azure OpenAI and standard OpenAI Batch APIs

USAGE:
  npm run dev <command> [options]

COMMANDS:
  submit <job-type>              Submit a new batch job
  submit <job-type> --wait       Submit and wait for completion
  status <job-type>              Check status of a job
  process <job-type>             Download and process completed results
  list                           List all jobs and their statuses
  test-connections               Test database and provider connections
  concurrent <job-type>          Process decisions concurrently (fast, non-batch)
  retry <job-type> <timestamp>   Retry failed decisions from a specific run
  retry <job-type> <timestamp> --dry-run   Analyze failures without retrying
  merge <job-type> <original> <retry>      Merge successful retry JSONs into original
  help                           Show this help message

PROVIDER CONFIGURATION:
  - Set provider in job config (provider: 'azure' | 'openai')
  - Or set BATCH_PROVIDER environment variable
  - Default: 'azure'

EXAMPLES:
  npm run dev submit extract-comprehensive
  npm run dev submit extract-comprehensive --wait
  npm run dev status extract-comprehensive
  npm run dev process extract-comprehensive
  npm run dev list
  npm run dev test-connections
  npm run dev concurrent extract-comprehensive
  npm run dev retry extract-comprehensive 2025-10-25T06-02-48-674Z
  npm run dev retry extract-comprehensive 2025-10-25T06-02-48-674Z --dry-run
  npm run dev merge extract-comprehensive 2025-10-25T06-02-48-674Z 2025-10-25T06-02-48-674Z-retry-1

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

      case 'concurrent':
        if (!jobType) {
          console.error('Error: Job type is required');
          console.error('Usage: npm run dev concurrent <job-type>');
          process.exit(1);
        }
        const { ConcurrentRunner } = await import('./concurrent/ConcurrentRunner.js');
        const concurrentConfig = await loadJobConfig(jobType);
        const concurrentRunner = new ConcurrentRunner(concurrentConfig);
        await concurrentRunner.run();
        break;

      case 'retry':
        if (!jobType) {
          console.error('Error: Job type is required');
          console.error('Usage: npm run dev retry <job-type> <timestamp>');
          process.exit(1);
        }
        const timestamp = args[2];
        if (!timestamp) {
          console.error('Error: Timestamp is required');
          console.error('Usage: npm run dev retry <job-type> <timestamp>');
          console.error('Example: npm run dev retry extract-comprehensive 2025-10-25T06-02-48-674Z');
          process.exit(1);
        }
        const { RetryOrchestrator } = await import('./utils/retryOrchestrator.js');
        const retryFlags = args.slice(3);
        await RetryOrchestrator.retryFailedDecisions(jobType, timestamp, {
          dryRun: retryFlags.includes('--dry-run'),
        });
        break;

      case 'merge':
        if (!jobType) {
          console.error('Error: Job type is required');
          console.error('Usage: npm run dev merge <job-type> <original-timestamp> <retry-timestamp>');
          process.exit(1);
        }
        const originalTimestamp = args[2];
        const retryTimestamp = args[3];
        if (!originalTimestamp || !retryTimestamp) {
          console.error('Error: Both original and retry timestamps are required');
          console.error('Usage: npm run dev merge <job-type> <original-timestamp> <retry-timestamp>');
          console.error('Example: npm run dev merge extract-comprehensive 2025-10-25T06-02-48-674Z 2025-10-25T06-02-48-674Z-retry-1');
          process.exit(1);
        }
        const { mergeRetryResults } = await import('./utils/mergeRetryResults.js');
        await mergeRetryResults(jobType, originalTimestamp, retryTimestamp);
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
