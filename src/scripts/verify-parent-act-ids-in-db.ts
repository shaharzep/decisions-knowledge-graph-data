/**
 * Verify Parent Act IDs in Database
 *
 * Scans JSON files and verifies that each internal_parent_act_id
 * (both existing correct ones and computed corrected ones) exists
 * in the decision_cited_provisions table.
 *
 * Usage:
 *   npx tsx src/scripts/verify-parent-act-ids-in-db.ts
 */

import fs from 'fs';
import path from 'path';
import { DatabaseConfig } from '../config/database.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

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
// TYPES
// =============================================================================

interface VerificationResult {
  jobId: string;
  label: string;
  totalFiles: number;
  alreadyCorrect: number;
  needsFix: number;
  matchesInDb: number;
  missingFromDb: number;
  errors: number;
  missingIds: string[];
}

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
 * Check if internal_parent_act_id is correct (contains the decision_id)
 */
function isCorrectId(internalParentActId: string, decisionId: string): boolean {
  const expectedPrefix = `ACT-${decisionId}-`;
  return internalParentActId.startsWith(expectedPrefix);
}

/**
 * Load all internal_parent_act_ids from database into a Set for fast lookup
 */
async function loadDbIds(): Promise<Set<string>> {
  console.log('Loading internal_parent_act_ids from database...');

  const query = `
    SELECT DISTINCT internal_parent_act_id
    FROM decision_cited_provisions
    WHERE internal_parent_act_id IS NOT NULL
  `;

  const rows = await DatabaseConfig.executeReadOnlyQuery<{ internal_parent_act_id: string }>(query);
  const idSet = new Set(rows.map(r => r.internal_parent_act_id));

  console.log(`Loaded ${idSet.size.toLocaleString()} unique IDs from database\n`);
  return idSet;
}

/**
 * Verify all JSON files in a directory
 */
function verifyDirectory(
  dirConfig: typeof DIRECTORIES_TO_SCAN[0],
  dbIds: Set<string>
): VerificationResult {
  const result: VerificationResult = {
    jobId: dirConfig.jobId,
    label: dirConfig.label,
    totalFiles: 0,
    alreadyCorrect: 0,
    needsFix: 0,
    matchesInDb: 0,
    missingFromDb: 0,
    errors: 0,
    missingIds: [],
  };

  if (!fs.existsSync(dirConfig.path)) {
    console.log(`  Directory not found: ${dirConfig.path}`);
    return result;
  }

  const files = fs.readdirSync(dirConfig.path).filter(f => f.endsWith('.json'));
  result.totalFiles = files.length;

  console.log(`  Scanning ${files.length.toLocaleString()} files...`);

  for (const filename of files) {
    const filePath = path.join(dirConfig.path, filename);

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const json = JSON.parse(content);

      const decisionId = json.decision_id;
      const currentId = json.internal_parent_act_id;

      if (!decisionId || !currentId) {
        result.errors++;
        continue;
      }

      // Determine the ID that should be in the database
      let expectedDbId: string;

      if (isCorrectId(currentId, decisionId)) {
        // Already correct - use as-is
        result.alreadyCorrect++;
        expectedDbId = currentId;
      } else {
        // Needs fix - compute corrected ID
        result.needsFix++;
        const sequence = extractSequence(currentId);
        if (!sequence) {
          result.errors++;
          continue;
        }
        expectedDbId = `ACT-${decisionId}-${sequence}`;
      }

      // Check if this ID exists in database
      if (dbIds.has(expectedDbId)) {
        result.matchesInDb++;
      } else {
        result.missingFromDb++;
        if (result.missingIds.length < 20) {
          result.missingIds.push(expectedDbId);
        }
      }
    } catch {
      result.errors++;
    }
  }

  return result;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(70));
  console.log('VERIFY PARENT ACT IDS IN DATABASE');
  console.log('='.repeat(70));
  console.log('');

  try {
    // Load all IDs from database
    const dbIds = await loadDbIds();

    // Verify each directory
    const results: VerificationResult[] = [];

    for (const dirConfig of DIRECTORIES_TO_SCAN) {
      console.log(`Processing: ${dirConfig.jobId} (${dirConfig.label})`);
      const result = verifyDirectory(dirConfig, dbIds);
      results.push(result);
      console.log(`  Matches: ${result.matchesInDb.toLocaleString()}, Missing: ${result.missingFromDb.toLocaleString()}`);
      console.log('');
    }

    // Print summary
    console.log('='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));

    let totalFiles = 0;
    let totalMatches = 0;
    let totalMissing = 0;
    let totalNeedsFix = 0;

    for (const result of results) {
      console.log(`\n${result.jobId} (${result.label}):`);
      console.log(`  Total files:      ${result.totalFiles.toLocaleString()}`);
      console.log(`  Already correct:  ${result.alreadyCorrect.toLocaleString()}`);
      console.log(`  Needs fix:        ${result.needsFix.toLocaleString()}`);
      console.log(`  Matches in DB:    ${result.matchesInDb.toLocaleString()}`);
      console.log(`  Missing from DB:  ${result.missingFromDb.toLocaleString()}`);
      console.log(`  Errors:           ${result.errors}`);

      if (result.missingIds.length > 0) {
        console.log(`  Sample missing IDs:`);
        for (const id of result.missingIds.slice(0, 5)) {
          console.log(`    - ${id}`);
        }
        if (result.missingIds.length > 5) {
          console.log(`    ... and ${result.missingIds.length - 5} more`);
        }
      }

      totalFiles += result.totalFiles;
      totalMatches += result.matchesInDb;
      totalMissing += result.missingFromDb;
      totalNeedsFix += result.needsFix;
    }

    console.log('\n' + '-'.repeat(70));
    console.log(`TOTAL FILES:        ${totalFiles.toLocaleString()}`);
    console.log(`TOTAL NEEDS FIX:    ${totalNeedsFix.toLocaleString()}`);
    console.log(`MATCHES IN DB:      ${totalMatches.toLocaleString()}`);
    console.log(`MISSING FROM DB:    ${totalMissing.toLocaleString()}`);

    if (totalMissing === 0) {
      console.log('\n✓ All IDs verified - safe to run apply script!');
    } else {
      console.log('\n⚠ Some IDs are missing from database - investigate before proceeding');
    }

    console.log('='.repeat(70));

  } finally {
    await DatabaseConfig.close();
  }
}

main().catch(console.error);
