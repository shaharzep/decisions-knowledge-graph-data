/**
 * Generate Parent Act ID Fixes
 *
 * Identifies all internal_parent_act_id values that incorrectly span multiple
 * decisions (due to truncated ECLI codes), looks up the correct ECLI from
 * decisions1 table, and generates a JSON file with the fixes.
 *
 * Usage:
 *   npx tsx src/scripts/generate-parent-act-id-fixes.ts
 *
 * Output:
 *   src/scripts/output/parent-act-id-fixes.json
 */

import { DatabaseConfig } from '../config/database.js';
import fs from 'fs';
import path from 'path';

// =============================================================================
// TYPES
// =============================================================================

interface AffectedRow {
  row_id: number;
  decision_fk: number;
  old_internal_parent_act_id: string;
  correct_ecli: string;
  parent_act_type: string | null;
  parent_act_name: string | null;
  provision_number: string | null;
}

interface FixEntry {
  rowId: number;
  decisionFk: number;
  oldInternalParentActId: string;
  correctEcli: string;
  extractedSequence: string;
  newInternalParentActId: string;
  parentActType: string | null;
  parentActName: string | null;
  provisionNumber: string | null;
}

interface FixesReport {
  generatedAt: string;
  summary: {
    problematicIdCount: number;
    totalRowsToFix: number;
    sequenceExtractionFailures: number;
  };
  fixes: FixEntry[];
  failures: Array<{
    rowId: number;
    oldInternalParentActId: string;
    reason: string;
  }>;
}

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Find all internal_parent_act_ids that appear in multiple decisions
 *
 * These are the problematic IDs with truncated/corrupted ECLI codes.
 */
async function findProblematicParentActIds(): Promise<string[]> {
  console.log('Finding problematic internal_parent_act_ids...');

  const query = `
    SELECT internal_parent_act_id
    FROM decision_cited_provisions
    WHERE internal_parent_act_id IS NOT NULL
    GROUP BY internal_parent_act_id
    HAVING COUNT(DISTINCT decision_id) > 1
    ORDER BY COUNT(DISTINCT decision_id) DESC
  `;

  const rows = await DatabaseConfig.executeReadOnlyQuery<{ internal_parent_act_id: string }>(query);
  const ids = rows.map(r => r.internal_parent_act_id);

  console.log(`Found ${ids.length} problematic IDs`);
  return ids;
}

/**
 * Extract the 3-digit sequence suffix from an internal_parent_act_id
 *
 * Example: "ACT-ECLI:BE:GHCC:200-004" -> "004"
 *
 * The sequence is always the last 3 digits after the final hyphen.
 */
function extractSequenceFromId(id: string): string | null {
  // Match pattern: anything followed by hyphen and exactly 3 digits at the end
  const match = id.match(/-(\d{3})$/);
  return match ? match[1] : null;
}

/**
 * Fetch all affected rows with their correct ECLI codes
 *
 * Joins decision_cited_provisions to decisions1 to get the real ECLI
 * for each row that has a problematic internal_parent_act_id.
 */
async function fetchAffectedRowsWithCorrectEcli(
  problematicIds: string[]
): Promise<AffectedRow[]> {
  if (problematicIds.length === 0) {
    return [];
  }

  console.log(`Fetching affected rows for ${problematicIds.length} problematic IDs...`);

  // Use ANY with array parameter for efficient IN clause
  const query = `
    SELECT
      dcp.id as row_id,
      dcp.decision_id as decision_fk,
      dcp.internal_parent_act_id as old_internal_parent_act_id,
      d.decision_id as correct_ecli,
      dcp.parent_act_type,
      dcp.parent_act_name,
      dcp.provision_number
    FROM decision_cited_provisions dcp
    JOIN decisions1 d ON d.id = dcp.decision_id
    WHERE dcp.internal_parent_act_id = ANY($1)
    ORDER BY dcp.internal_parent_act_id, dcp.id
  `;

  const rows = await DatabaseConfig.executeReadOnlyQuery<AffectedRow>(query, [problematicIds]);

  console.log(`Found ${rows.length} rows to fix`);
  return rows;
}

/**
 * Generate the fixes JSON report
 *
 * Main orchestrator that:
 * 1. Finds problematic IDs
 * 2. Fetches affected rows with correct ECLI
 * 3. Constructs new IDs
 * 4. Writes JSON output
 */
async function generateFixesJson(): Promise<FixesReport> {
  // Step 1: Find problematic IDs
  const problematicIds = await findProblematicParentActIds();

  if (problematicIds.length === 0) {
    console.log('No problematic IDs found. Nothing to fix.');
    return {
      generatedAt: new Date().toISOString(),
      summary: {
        problematicIdCount: 0,
        totalRowsToFix: 0,
        sequenceExtractionFailures: 0,
      },
      fixes: [],
      failures: [],
    };
  }

  // Step 2: Fetch affected rows with correct ECLI
  const affectedRows = await fetchAffectedRowsWithCorrectEcli(problematicIds);

  // Step 3: Generate fixes
  const fixes: FixEntry[] = [];
  const failures: Array<{ rowId: number; oldInternalParentActId: string; reason: string }> = [];

  for (const row of affectedRows) {
    const sequence = extractSequenceFromId(row.old_internal_parent_act_id);

    if (!sequence) {
      failures.push({
        rowId: row.row_id,
        oldInternalParentActId: row.old_internal_parent_act_id,
        reason: 'Could not extract sequence from ID (expected -XXX suffix)',
      });
      continue;
    }

    const newInternalParentActId = `ACT-${row.correct_ecli}-${sequence}`;

    fixes.push({
      rowId: row.row_id,
      decisionFk: row.decision_fk,
      oldInternalParentActId: row.old_internal_parent_act_id,
      correctEcli: row.correct_ecli,
      extractedSequence: sequence,
      newInternalParentActId,
      parentActType: row.parent_act_type,
      parentActName: row.parent_act_name,
      provisionNumber: row.provision_number,
    });
  }

  const report: FixesReport = {
    generatedAt: new Date().toISOString(),
    summary: {
      problematicIdCount: problematicIds.length,
      totalRowsToFix: fixes.length,
      sequenceExtractionFailures: failures.length,
    },
    fixes,
    failures,
  };

  return report;
}

/**
 * Write report to JSON file
 */
function writeReportToFile(report: FixesReport): string {
  const outputDir = path.join(process.cwd(), 'src', 'scripts', 'output');

  // Create output directory if it doesn't exist
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'parent-act-id-fixes.json');
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');

  return outputPath;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('Generating parent act ID fixes...\n');

  try {
    const report = await generateFixesJson();

    // Write to file
    const outputPath = writeReportToFile(report);

    // Print summary
    console.log('\n' + '='.repeat(70));
    console.log('PARENT ACT ID FIXES REPORT');
    console.log('='.repeat(70));
    console.log(`\nGenerated at: ${report.generatedAt}`);
    console.log(`\nSummary:`);
    console.log(`  Problematic IDs:            ${report.summary.problematicIdCount}`);
    console.log(`  Total rows to fix:          ${report.summary.totalRowsToFix}`);
    console.log(`  Sequence extraction failures: ${report.summary.sequenceExtractionFailures}`);

    if (report.fixes.length > 0) {
      console.log(`\nSample fixes (first 5):`);
      for (const fix of report.fixes.slice(0, 5)) {
        console.log(`\n  Row ${fix.rowId}:`);
        console.log(`    Old: ${fix.oldInternalParentActId}`);
        console.log(`    New: ${fix.newInternalParentActId}`);
        console.log(`    Type: ${fix.parentActType || 'null'}`);
        console.log(`    Name: ${fix.parentActName?.substring(0, 60) || 'null'}${(fix.parentActName?.length || 0) > 60 ? '...' : ''}`);
        console.log(`    Provision: ${fix.provisionNumber || 'null'}`);
      }
    }

    if (report.failures.length > 0) {
      console.log(`\nFailures (${report.failures.length}):`);
      for (const failure of report.failures.slice(0, 5)) {
        console.log(`  Row ${failure.rowId}: ${failure.reason}`);
      }
      if (report.failures.length > 5) {
        console.log(`  ... and ${report.failures.length - 5} more`);
      }
    }

    console.log(`\nOutput written to: ${outputPath}`);
    console.log('='.repeat(70));

  } finally {
    await DatabaseConfig.close();
  }
}

main().catch(console.error);
