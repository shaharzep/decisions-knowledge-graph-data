/**
 * Verify Cited Decision Candidates
 *
 * Identifies JSON files that were processed with buggy date comparison logic.
 * Compares each JSON's candidates array against fresh DB query using fixed date logic.
 *
 * Usage:
 *   npx tsx src/scripts/verify-cited-decision-candidates.ts <jsons-directory>
 *
 * Example:
 *   npx tsx src/scripts/verify-cited-decision-candidates.ts full-data/map-cited-decisions/2025-12-04T22-23-20-074Z/jsons
 */

import fs from 'fs';
import path from 'path';
import { DatabaseConfig } from '../config/database.js';

// ============================================================================
// TYPES
// ============================================================================

interface VerificationResult {
  internal_decision_id: string;
  cited_date: string;
  json_candidate_count: number;
  db_candidate_count: number;
  matches: boolean;
  reason: string;
}

interface VerificationSummary {
  verified: number;
  needsReprocessing: number;
  skipped: number;
  total: number;
  reprocessList: string[];
  details: VerificationResult[];
}

// ============================================================================
// DATABASE QUERY
// ============================================================================

/**
 * Fetch candidate decision_ids from DB using FIXED date comparison
 * This uses exact match (no ::date cast) to avoid timezone issues
 */
async function fetchCandidatesFromDb(citedDate: string): Promise<string[]> {
  // FIXED query - no ::date cast, exact match
  const query = `
    SELECT decision_id
    FROM decisions1
    WHERE decision_date = $1
    ORDER BY decision_id
  `;

  try {
    const rows = await DatabaseConfig.executeReadOnlyQuery(query, [citedDate]);
    return rows.map((r: any) => r.decision_id);
  } catch (error) {
    console.error(`Error fetching candidates for date ${citedDate}:`, error);
    return [];
  }
}

// ============================================================================
// JSON PROCESSING
// ============================================================================

/**
 * Extract decision_ids from JSON's candidates array into a Set
 */
function extractCandidateIds(candidates: any[] | null | undefined): Set<string> {
  if (!candidates || !Array.isArray(candidates)) {
    return new Set();
  }

  return new Set(
    candidates
      .filter((c: any) => c && c.decision_id)
      .map((c: any) => c.decision_id)
  );
}

/**
 * Compare JSON candidates with DB candidates
 * Returns true if they match exactly
 */
function compareCandidates(jsonIds: Set<string>, dbIds: string[]): boolean {
  if (jsonIds.size !== dbIds.length) {
    return false;
  }

  for (const id of dbIds) {
    if (!jsonIds.has(id)) {
      return false;
    }
  }

  return true;
}

/**
 * Extract YYYY-MM-DD from cited_date field
 * Handles both ISO strings and date objects
 */
function extractDateString(citedDate: any): string | null {
  if (!citedDate) return null;

  const dateStr = String(citedDate);

  // Already YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return dateStr;
  }

  // ISO format: 2024-12-04T22:23:20.074Z - take first 10 chars
  if (dateStr.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 10);
  }

  return null;
}

// ============================================================================
// MAIN VERIFICATION LOGIC
// ============================================================================

/**
 * Verify a single JSON file
 */
async function verifyJsonFile(
  filePath: string,
  jsonData: any
): Promise<VerificationResult | null> {
  const internalDecisionId = jsonData.internal_decision_id;

  if (!internalDecisionId) {
    console.warn(`Skipping ${filePath}: missing internal_decision_id`);
    return null;
  }

  const citedDate = extractDateString(jsonData.cited_date);

  if (!citedDate) {
    // No date means it was already marked as invalid - skip
    return null;
  }

  // Get candidates from JSON
  const jsonCandidateIds = extractCandidateIds(jsonData.candidates);

  // Get candidates from DB using FIXED query
  const dbCandidateIds = await fetchCandidatesFromDb(citedDate);

  // Compare
  const matches = compareCandidates(jsonCandidateIds, dbCandidateIds);

  // Determine reason for mismatch
  let reason = '';
  if (matches) {
    reason = 'Candidates match DB';
  } else if (jsonCandidateIds.size === 0 && dbCandidateIds.length > 0) {
    reason = `JSON has no candidates but DB has ${dbCandidateIds.length}`;
  } else if (jsonCandidateIds.size > 0 && dbCandidateIds.length === 0) {
    reason = `JSON has ${jsonCandidateIds.size} candidates but DB has none`;
  } else {
    reason = `Candidate mismatch: JSON has ${jsonCandidateIds.size}, DB has ${dbCandidateIds.length}`;
  }

  return {
    internal_decision_id: internalDecisionId,
    cited_date: citedDate,
    json_candidate_count: jsonCandidateIds.size,
    db_candidate_count: dbCandidateIds.length,
    matches,
    reason
  };
}

/**
 * Process all JSON files in directory
 */
async function verifyAllJsons(directory: string): Promise<VerificationSummary> {
  const summary: VerificationSummary = {
    verified: 0,
    needsReprocessing: 0,
    skipped: 0,
    total: 0,
    reprocessList: [],
    details: []
  };

  // Read directory
  const files = fs.readdirSync(directory).filter(f => f.endsWith('.json'));
  summary.total = files.length;

  console.log(`\nFound ${files.length} JSON files to verify\n`);

  // Process each file
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filePath = path.join(directory, file);

    // Progress logging every 100 files
    if ((i + 1) % 100 === 0 || i === files.length - 1) {
      console.log(`Progress: ${i + 1}/${files.length} (${summary.needsReprocessing} need reprocessing)`);
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const jsonData = JSON.parse(content);

      const result = await verifyJsonFile(filePath, jsonData);

      if (!result) {
        summary.skipped++;
        continue;
      }

      if (result.matches) {
        summary.verified++;
      } else {
        summary.needsReprocessing++;
        summary.reprocessList.push(result.internal_decision_id);
        summary.details.push(result);
      }

    } catch (error) {
      console.error(`Error processing ${file}:`, error);
      summary.skipped++;
    }
  }

  return summary;
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx tsx src/scripts/verify-cited-decision-candidates.ts <jsons-directory>');
    console.error('Example: npx tsx src/scripts/verify-cited-decision-candidates.ts full-data/map-cited-decisions/2025-12-04T22-23-20-074Z/jsons');
    process.exit(1);
  }

  const directory = args[0];

  // Resolve to absolute path if relative
  const absoluteDir = path.isAbsolute(directory)
    ? directory
    : path.join(process.cwd(), directory);

  if (!fs.existsSync(absoluteDir)) {
    console.error(`Directory not found: ${absoluteDir}`);
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Cited Decision Candidate Verification');
  console.log('='.repeat(60));
  console.log(`Directory: ${absoluteDir}`);

  try {
    const summary = await verifyAllJsons(absoluteDir);

    // Output directory (parent of jsons dir)
    const outputDir = path.dirname(absoluteDir);

    // Write reprocess list (just the IDs)
    const reprocessListPath = path.join(outputDir, 'reprocess-list.json');
    fs.writeFileSync(
      reprocessListPath,
      JSON.stringify(summary.reprocessList, null, 2),
      'utf-8'
    );

    // Write detailed report
    const reportPath = path.join(outputDir, 'verification-report.json');
    fs.writeFileSync(
      reportPath,
      JSON.stringify({
        timestamp: new Date().toISOString(),
        directory: absoluteDir,
        stats: {
          total: summary.total,
          verified: summary.verified,
          needsReprocessing: summary.needsReprocessing,
          skipped: summary.skipped
        },
        failures: summary.details
      }, null, 2),
      'utf-8'
    );

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('VERIFICATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total files:        ${summary.total}`);
    console.log(`Verified OK:        ${summary.verified}`);
    console.log(`Need reprocessing:  ${summary.needsReprocessing}`);
    console.log(`Skipped:            ${summary.skipped}`);
    console.log('');
    console.log(`Reprocess list:     ${reprocessListPath}`);
    console.log(`Detailed report:    ${reportPath}`);

    if (summary.needsReprocessing > 0) {
      console.log('\nSample failures (first 5):');
      for (const detail of summary.details.slice(0, 5)) {
        console.log(`  - ${detail.internal_decision_id}: ${detail.reason}`);
      }
    }

  } catch (error) {
    console.error('Verification failed:', error);
    process.exit(1);
  } finally {
    await DatabaseConfig.close();
  }
}

main();
