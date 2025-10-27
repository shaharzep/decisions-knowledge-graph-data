/**
 * Check if the "empty provision" decisions actually have provision mentions
 */

import { DatabaseConfig } from './src/config/database.js';
import { extractProvisionContexts } from './src/utils/provisionContextExtractor.js';

const EMPTY_PROVISION_DECISIONS = [
  { decision_id: 'ECLI:BE:HBANT:2011:ARR.20110118.7', language: 'NL' },
  { decision_id: 'ECLI:BE:NTRCND:2006:ARR.20060306.9', language: 'NL' },
  { decision_id: 'ECLI:BE:NTRCND:2006:ARR.20061108.14', language: 'NL' },
  { decision_id: 'ECLI:BE:COPRIV:2012:ARR.20120513.1', language: 'FR' },
];

async function checkEmptyProvisions() {
  console.log('='.repeat(80));
  console.log('Checking decisions that returned empty citedProvisions arrays');
  console.log('='.repeat(80));
  console.log();

  try {
    for (const dec of EMPTY_PROVISION_DECISIONS) {
      console.log(`\n${'='.repeat(80)}`);
      console.log(`Decision: ${dec.decision_id} (${dec.language})`);
      console.log(`${'='.repeat(80)}`);

      const query = `
        SELECT
          d.decision_id,
          d.language_metadata,
          dm.full_md,
          LENGTH(dm.full_md) as md_length
        FROM decisions1 d
        INNER JOIN decisions_md dm
          ON dm.decision_id = d.decision_id
          AND dm.language = d.language_metadata
        WHERE d.decision_id = $1
          AND d.language_metadata = $2
      `;

      const rows = await DatabaseConfig.executeReadOnlyQuery(query, [
        dec.decision_id,
        dec.language
      ]);

      if (rows.length === 0) {
        console.log('❌ Not found in database');
        continue;
      }

      const row = rows[0];

      // Extract provision contexts
      const result = await extractProvisionContexts(
        row.decision_id,
        row.full_md
      );

      console.log(`Document length: ${row.md_length.toLocaleString()} chars`);
      console.log(`Python found: ${result.total_provision_mentions} provision mentions`);
      console.log();

      if (result.total_provision_mentions === 0) {
        console.log('✓ Correctly returned empty (no provisions in document)');
      } else {
        console.log(`⚠️  PROBLEM: Python found ${result.total_provision_mentions} mentions but LLM returned 0`);
        console.log();
        console.log('First 5 contexts:');
        result.contexts.slice(0, 5).forEach((ctx, idx) => {
          console.log(`\n  ${idx + 1}. Snippet ${ctx.snippet_id}:`);
          console.log(`     ${ctx.context_text.substring(0, 150)}...`);
        });
      }
    }

    console.log();
    console.log('='.repeat(80));
    console.log('SUMMARY');
    console.log('='.repeat(80));
    console.log('If all show "Correctly returned empty", then the LLM is right.');
    console.log('If any show "PROBLEM", then we have a prompt/instruction issue.');
    console.log();

  } catch (error) {
    console.error('❌ Check failed:', error);
    process.exit(1);
  } finally {
    await DatabaseConfig.close();
  }
}

checkEmptyProvisions();
