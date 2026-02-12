#!/usr/bin/env tsx
/**
 * Single-Decision Pipeline CLI
 *
 * Usage:
 *   npm run pipeline -- --decision-id "ECLI:BE:CASS:2023:ARR.20230131.1F.1" --language FR
 *   npm run pipeline -- --decision-id "ECLI:BE:CASS:2023:ARR.20230131.1F.1" --language FR --state-file path/to/state.json
 */

import dotenv from 'dotenv';
dotenv.config();

import { DatabaseConfig } from '../config/database.js';
import { PipelineOrchestrator } from './PipelineOrchestrator.js';

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
    console.error('Usage: npm run pipeline -- --decision-id <ECLI> --language <FR|NL>');
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
// Fetch decision from database
// ============================================================================

async function fetchDecision(decisionId: string, language: string): Promise<any> {
  const rows = await DatabaseConfig.executeReadOnlyQuery(
    `SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      d.decision_type_ecli_code,
      d.court_ecli_code,
      d.decision_date,
      dm.full_md,
      LENGTH(dm.full_md) as md_length
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    WHERE d.decision_id = $1
      AND d.language_metadata = $2
      AND dm.full_md IS NOT NULL
      AND dm.full_md != ''
    LIMIT 1`,
    [decisionId, language]
  );

  if (rows.length === 0) {
    throw new Error(`Decision not found: ${decisionId} (${language})`);
  }

  const row = rows[0] as any;

  // Add computed length_category (same logic as preprocessRow in configs)
  let length_category = 'unknown';
  if (row.md_length) {
    if (row.md_length < 10000) length_category = 'short';
    else if (row.md_length < 30000) length_category = 'medium';
    else if (row.md_length < 60000) length_category = 'long';
    else length_category = 'very_long';
  }

  return { ...row, length_category };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const { decisionId, language, stateFile } = parseArgs();

  console.log(`\n📋 Single-Decision Pipeline`);
  console.log(`   Decision: ${decisionId}`);
  console.log(`   Language: ${language}\n`);

  // Fetch decision from database
  console.log('📥 Fetching decision from database...');
  const row = await fetchDecision(decisionId, language);
  console.log(`   Found: ${row.decision_id} (${row.language_metadata}), ${row.md_length} chars [${row.length_category}]`);

  // Create orchestrator
  const orchestrator = new PipelineOrchestrator(decisionId, language, row);

  // Try to resume from state file
  if (stateFile) {
    await orchestrator.loadState(stateFile);
  } else {
    await orchestrator.loadState(); // Try default state location
  }

  // Run pipeline
  const { success, summary } = await orchestrator.run();

  // Close database connection
  await DatabaseConfig.close();

  // Print summary
  console.log('\n📊 Step Summary:');
  for (const [stepId, stepState] of Object.entries(summary.steps)) {
    const state = stepState as any;
    const status = state.status === 'completed' ? '✅' : state.status === 'failed' ? '❌' : '⏸️';
    const duration = state.durationMs ? `${(state.durationMs / 1000).toFixed(1)}s` : '-';
    const tokens = state.tokenUsage ? `${state.tokenUsage.total.toLocaleString()} tokens` : '';
    const model = state.model || '';
    const attempts = state.attempts > 1 ? ` (${state.attempts} attempts)` : '';
    console.log(`   ${status} ${stepId.padEnd(30)} ${duration.padEnd(8)} ${model.padEnd(12)} ${tokens}${attempts}`);
  }

  if (!success) {
    console.error('\n❌ Pipeline failed. See logs above for details.');
    console.error('   To resume, re-run with the same arguments (state is auto-saved).');
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error('\n💥 Fatal error:', error.message);
  DatabaseConfig.close().catch(() => {});
  process.exit(1);
});
