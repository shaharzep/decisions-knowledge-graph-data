/**
 * Scan Provision Mapping JSONs for Problematic IDs
 *
 * Scans JSON files in full-data directories for map-provisions-code,
 * map-provisions-no-date, and map-provisions-standard to identify
 * internal_parent_act_id values with truncated/corrupted ECLI codes.
 *
 * Detection logic:
 * - Each JSON has decision_id (correct ECLI) and internal_parent_act_id
 * - If internal_parent_act_id doesn't start with "ACT-{decision_id}-", it's problematic
 *
 * Usage:
 *   npx tsx src/scripts/scan-provision-mapping-jsons.ts
 */

import fs from 'fs';
import path from 'path';

// =============================================================================
// TYPES
// =============================================================================

interface ProblematicEntry {
  jobId: string;
  filePath: string;
  decisionId: string;
  currentInternalParentActId: string;
  expectedPrefix: string;
  extractedSequence: string | null;
  correctedId: string | null;
}

interface JobScanResult {
  jobId: string;
  timestamp: string;
  totalFiles: number;
  problematicCount: number;
  entries: ProblematicEntry[];
}

// =============================================================================
// CONSTANTS
// =============================================================================

// Explicit directories to scan (matches apply-parent-act-id-fixes.ts)
const DIRECTORIES_TO_SCAN = [
  {
    jobId: 'map-provisions-code',
    path: path.join(process.cwd(), 'full-data', 'map-provisions-code', '2025-12-02T12-09-54-214Z', 'jsons'),
    label: '2025-12-02T12-09-54-214Z',
  },
  {
    jobId: 'map-provisions-standard',
    path: path.join(process.cwd(), 'full-data', 'map-provisions-standard', 'new-results', 'jsons'),
    label: 'new-results',
  },
  {
    jobId: 'map-provisions-no-date',
    path: path.join(process.cwd(), 'full-data', 'map-provisions-no-date', '2025-12-02T21-31-52-341Z', 'jsons'),
    label: '2025-12-02T21-31-52-341Z',
  },
];

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Extract the 3-digit sequence suffix from an internal_parent_act_id
 */
function extractSequence(id: string): string | null {
  const match = id.match(/-(\d{3})$/);
  return match ? match[1] : null;
}

/**
 * Check if an internal_parent_act_id is problematic
 *
 * Returns true if the ID does NOT contain the correct decision_id
 */
function isProblematicId(internalParentActId: string, decisionId: string): boolean {
  const expectedPrefix = `ACT-${decisionId}-`;
  return !internalParentActId.startsWith(expectedPrefix);
}

/**
 * Scan a job's JSON directory for problematic entries
 */
function scanJobDirectory(jobId: string, jsonsDir: string, label: string): JobScanResult {
  if (!fs.existsSync(jsonsDir)) {
    return {
      jobId,
      timestamp: label,
      totalFiles: 0,
      problematicCount: 0,
      entries: [],
    };
  }

  const jsonFiles = fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'));
  const problematicEntries: ProblematicEntry[] = [];

  for (const filename of jsonFiles) {
    const filePath = path.join(jsonsDir, filename);

    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      const decisionId = data.decision_id;
      const internalParentActId = data.internal_parent_act_id;

      // Skip if missing required fields
      if (!decisionId || !internalParentActId) {
        continue;
      }

      // Check if problematic
      if (isProblematicId(internalParentActId, decisionId)) {
        const sequence = extractSequence(internalParentActId);
        const correctedId = sequence ? `ACT-${decisionId}-${sequence}` : null;

        problematicEntries.push({
          jobId,
          filePath,
          decisionId,
          currentInternalParentActId: internalParentActId,
          expectedPrefix: `ACT-${decisionId}-`,
          extractedSequence: sequence,
          correctedId,
        });
      }
    } catch (error) {
      console.warn(`Failed to read ${filename}: ${error}`);
    }
  }

  return {
    jobId,
    timestamp: label,
    totalFiles: jsonFiles.length,
    problematicCount: problematicEntries.length,
    entries: problematicEntries,
  };
}

/**
 * Main function
 */
function main() {
  console.log('Scanning provision mapping JSONs for problematic IDs...\n');

  const results: JobScanResult[] = [];
  let totalProblematic = 0;
  let totalFiles = 0;

  for (const dir of DIRECTORIES_TO_SCAN) {
    if (!fs.existsSync(dir.path)) {
      console.log(`[${dir.jobId}] Directory not found: ${dir.path}, skipping`);
      continue;
    }

    console.log(`[${dir.jobId}] Scanning ${dir.label}...`);
    const result = scanJobDirectory(dir.jobId, dir.path, dir.label);
    results.push(result);

    totalFiles += result.totalFiles;
    totalProblematic += result.problematicCount;

    console.log(`  Files: ${result.totalFiles.toLocaleString()}, Problematic: ${result.problematicCount.toLocaleString()}`);
  }

  // Print summary
  console.log('\n' + '='.repeat(70));
  console.log('PROVISION MAPPING JSON SCAN REPORT');
  console.log('='.repeat(70));

  console.log('\n## SUMMARY\n');
  console.log(`Total files scanned:     ${totalFiles.toLocaleString()}`);
  console.log(`Total problematic:       ${totalProblematic.toLocaleString()}`);
  console.log(`Percentage:              ${totalFiles > 0 ? ((totalProblematic / totalFiles) * 100).toFixed(4) : 0}%`);

  console.log('\n## BY JOB\n');
  for (const result of results) {
    const pct = result.totalFiles > 0
      ? ((result.problematicCount / result.totalFiles) * 100).toFixed(2)
      : '0.00';
    console.log(`${result.jobId}:`);
    console.log(`  Timestamp:    ${result.timestamp}`);
    console.log(`  Total files:  ${result.totalFiles.toLocaleString()}`);
    console.log(`  Problematic:  ${result.problematicCount.toLocaleString()} (${pct}%)`);
    console.log('');
  }

  // Print samples
  if (totalProblematic > 0) {
    console.log('## SAMPLES (first 10 per job)\n');

    for (const result of results) {
      if (result.entries.length === 0) continue;

      console.log(`### ${result.jobId} (${result.problematicCount} total)\n`);

      for (const entry of result.entries.slice(0, 10)) {
        console.log(`  File: ${path.basename(entry.filePath)}`);
        console.log(`    Decision ID: ${entry.decisionId}`);
        console.log(`    Current:     ${entry.currentInternalParentActId}`);
        console.log(`    Corrected:   ${entry.correctedId || 'CANNOT FIX (no sequence)'}`);
        console.log('');
      }

      if (result.entries.length > 10) {
        console.log(`  ... and ${result.entries.length - 10} more\n`);
      }
    }
  } else {
    console.log('\n## No problematic IDs found!\n');
  }

  console.log('='.repeat(70));
}

main();
