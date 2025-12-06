/**
 * Check Parent Act Consistency
 *
 * Validates that rows sharing the same internal_parent_act_id belong to
 * the same decision_id. If the same internal_parent_act_id appears across
 * different decisions, this indicates a bug in ID generation.
 *
 * Usage:
 *   npx tsx src/scripts/check-parent-act-consistency.ts
 */

import { DatabaseConfig } from '../config/database.js';

interface InconsistentActId {
  internal_parent_act_id: string;
  decision_ids: number[];
  row_count: number;
}

interface ConsistencyReport {
  totalUniqueActIds: number;
  consistentActIds: number;
  inconsistentActIds: number;
  inconsistentByDecisionId: InconsistentActId[];
}

async function checkConsistency(): Promise<ConsistencyReport> {
  console.log('Checking parent act consistency...\n');

  // Query to find internal_parent_act_ids with multiple different decision_ids
  // This would indicate a bug - same act ID should not span multiple decisions
  const inconsistentDecisionIdQuery = `
    SELECT
      internal_parent_act_id,
      ARRAY_AGG(DISTINCT decision_id) as decision_ids,
      COUNT(*) as row_count
    FROM decision_cited_provisions
    WHERE internal_parent_act_id IS NOT NULL
    GROUP BY internal_parent_act_id
    HAVING COUNT(DISTINCT decision_id) > 1
    ORDER BY COUNT(DISTINCT decision_id) DESC
  `;

  // Query to count total unique internal_parent_act_ids
  const totalQuery = `
    SELECT COUNT(DISTINCT internal_parent_act_id) as total
    FROM decision_cited_provisions
    WHERE internal_parent_act_id IS NOT NULL
  `;

  console.log('Querying for internal_parent_act_ids spanning multiple decisions...');
  const inconsistentByDecisionId = await DatabaseConfig.executeReadOnlyQuery<any>(inconsistentDecisionIdQuery);

  console.log('Counting total unique act IDs...');
  const totalResult = await DatabaseConfig.executeReadOnlyQuery<{ total: string }>(totalQuery);
  const totalUniqueActIds = parseInt(totalResult[0].total, 10);

  const report: ConsistencyReport = {
    totalUniqueActIds,
    consistentActIds: totalUniqueActIds - inconsistentByDecisionId.length,
    inconsistentActIds: inconsistentByDecisionId.length,
    inconsistentByDecisionId: inconsistentByDecisionId.map((row: any) => ({
      internal_parent_act_id: row.internal_parent_act_id,
      decision_ids: row.decision_ids,
      row_count: parseInt(row.row_count, 10)
    }))
  };

  return report;
}

function printReport(report: ConsistencyReport): void {
  console.log('\n' + '='.repeat(70));
  console.log('PARENT ACT CONSISTENCY REPORT');
  console.log('='.repeat(70));

  console.log('\n## SUMMARY\n');
  console.log(`Total unique internal_parent_act_ids: ${report.totalUniqueActIds.toLocaleString()}`);
  console.log(`Consistent (same decision_id):        ${report.consistentActIds.toLocaleString()} (${((report.consistentActIds / report.totalUniqueActIds) * 100).toFixed(2)}%)`);
  console.log(`Inconsistent (multiple decisions):    ${report.inconsistentActIds.toLocaleString()} (${((report.inconsistentActIds / report.totalUniqueActIds) * 100).toFixed(2)}%)`);

  if (report.inconsistentByDecisionId.length > 0) {
    console.log(`\n## IDs SPANNING MULTIPLE DECISIONS (${report.inconsistentByDecisionId.length} found)\n`);
    console.log('These internal_parent_act_ids appear in MULTIPLE decisions (bug in ID generation):\n');

    for (const item of report.inconsistentByDecisionId.slice(0, 50)) {
      console.log(`- ${item.internal_parent_act_id}`);
      console.log(`  decision_ids: [${item.decision_ids.join(', ')}]`);
      console.log(`  row_count: ${item.row_count}`);
      console.log('');
    }

    if (report.inconsistentByDecisionId.length > 50) {
      console.log(`  ... and ${report.inconsistentByDecisionId.length - 50} more`);
    }
  } else {
    console.log('\n✅ No internal_parent_act_ids span multiple decisions.');
  }

  console.log('\n' + '='.repeat(70));

  if (report.inconsistentActIds === 0) {
    console.log('\n✅ All parent act IDs are consistent! No reprocessing needed.\n');
  } else {
    console.log('\n⚠️  Inconsistencies found. These IDs appear across multiple decisions.\n');
    console.log('This indicates a bug in ID generation - the decision ECLI should be part of the ID.\n');
  }
}

async function main() {
  try {
    const report = await checkConsistency();
    printReport(report);
  } finally {
    await DatabaseConfig.close();
  }
}

main().catch(console.error);
