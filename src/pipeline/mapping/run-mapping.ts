#!/usr/bin/env tsx
/**
 * Mapping Pipeline CLI
 *
 * Runs all 4 mapping steps for a single decision.
 *
 * Usage:
 *   npm run mapping-pipeline -- --decision-id "ECLI:BE:CASS:2023:ARR.20230131.1F.1" --language FR
 *   npm run mapping-pipeline -- --decision-id "ECLI:..." --language FR --state-file path/to/state.json
 */

import dotenv from 'dotenv';
dotenv.config();

import { DatabaseConfig } from '../../config/database.js';
import { MappingOrchestrator } from './MappingOrchestrator.js';

// ============================================================================
// Parse CLI arguments
// ============================================================================

function parseArgs(): { decisionId: string; language: string; stateFile?: string } {
  const args = process.argv.slice(2);
  let decisionId = '';
  let language = '';
  let stateFile: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--decision-id' && args[i + 1]) {
      decisionId = args[++i];
    } else if (args[i] === '--language' && args[i + 1]) {
      language = args[++i].toUpperCase();
    } else if (args[i] === '--state-file' && args[i + 1]) {
      stateFile = args[++i];
    }
  }

  if (!decisionId || !language) {
    console.error('Usage: npm run mapping-pipeline -- --decision-id <ECLI> --language <FR|NL>');
    console.error('  Options:');
    console.error('    --decision-id  ECLI identifier (required)');
    console.error('    --language     FR or NL (required)');
    console.error('    --state-file   Path to state file for resume (optional)');
    process.exit(1);
  }

  if (language !== 'FR' && language !== 'NL') {
    console.error(`Invalid language: ${language}. Must be FR or NL.`);
    process.exit(1);
  }

  return { decisionId, language, stateFile };
}

// ============================================================================
// Validate decision exists
// ============================================================================

async function validateDecision(decisionId: string): Promise<void> {
  const rows = await DatabaseConfig.executeReadOnlyQuery(
    `SELECT decision_id FROM decisions1 WHERE decision_id = $1 LIMIT 1`,
    [decisionId]
  );

  if (rows.length === 0) {
    throw new Error(`Decision not found: ${decisionId}`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { decisionId, language, stateFile } = parseArgs();

  console.log(`\nMapping Pipeline`);
  console.log(`   Decision: ${decisionId}`);
  console.log(`   Language: ${language}\n`);

  // Validate decision exists
  console.log('   Validating decision...');
  await validateDecision(decisionId);
  console.log('   Decision found.');

  // Create orchestrator
  const orchestrator = new MappingOrchestrator(decisionId, language);

  // Try to resume from state file
  if (stateFile) {
    await orchestrator.loadState(stateFile);
  } else {
    await orchestrator.loadState();
  }

  // Run pipeline
  const { success, summary } = await orchestrator.run();

  // Close database connection
  await DatabaseConfig.close();

  // Print summary
  console.log('\nStep Summary:');
  for (const [stepId, stepState] of Object.entries(summary.steps)) {
    const s = stepState as any;
    const status = s.status === 'completed' ? 'OK' : s.status === 'failed' ? 'FAIL' : 'SKIP';
    const duration = s.durationMs ? `${(s.durationMs / 1000).toFixed(1)}s` : '-';
    const counts = `${s.totalItems} total / ${s.completedItems} completed / ${s.skippedItems} fast-path / ${s.failedItems} failed`;
    console.log(`   [${status}] ${stepId.padEnd(30)} ${duration.padEnd(8)} ${counts}`);
  }

  if (!success) {
    console.error('\nPipeline failed. See logs above for details.');
    console.error('To resume, re-run with the same arguments (state is auto-saved).');
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('\nFatal error:', error.message);
  DatabaseConfig.close().catch(() => {});
  process.exit(1);
});
