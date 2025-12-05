/**
 * FAST Verify Cited Decision Candidates
 *
 * Optimized version that caches DB queries by date.
 * Instead of 89k queries, queries once per unique date (~5-10k).
 *
 * Usage:
 *   npx tsx src/scripts/verify-cited-decision-candidates-fast.ts <jsons-directory>
 */

import fs from 'fs';
import path from 'path';
import { DatabaseConfig } from '../config/database.js';

// ============================================================================
// TYPES
// ============================================================================

interface JsonRecord {
  file: string;
  internal_decision_id: string;
  cited_date: string;
  candidate_ids: Set<string>;
}

interface VerificationResult {
  internal_decision_id: string;
  cited_date: string;
  json_candidate_count: number;
  db_candidate_count: number;
  reason: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function extractDateString(citedDate: any): string | null {
  if (!citedDate) return null;
  const dateStr = String(citedDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  if (dateStr.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(dateStr)) {
    return dateStr.substring(0, 10);
  }
  return null;
}

function extractCandidateIds(candidates: any[] | null | undefined): Set<string> {
  if (!candidates || !Array.isArray(candidates)) return new Set();
  return new Set(
    candidates.filter((c: any) => c?.decision_id).map((c: any) => c.decision_id)
  );
}

// ============================================================================
// PHASE 1: Load all JSONs and collect unique dates
// ============================================================================

async function loadAllJsons(directory: string): Promise<{
  records: JsonRecord[];
  uniqueDates: Set<string>;
  skipped: number;
}> {
  const files = fs.readdirSync(directory).filter(f => f.endsWith('.json'));
  const records: JsonRecord[] = [];
  const uniqueDates = new Set<string>();
  let skipped = 0;

  console.log(`\nPhase 1: Loading ${files.length} JSON files...`);

  for (let i = 0; i < files.length; i++) {
    if ((i + 1) % 10000 === 0) {
      console.log(`  Loaded ${i + 1}/${files.length}...`);
    }

    const file = files[i];
    try {
      const content = fs.readFileSync(path.join(directory, file), 'utf-8');
      const json = JSON.parse(content);

      const internalId = json.internal_decision_id;
      const citedDate = extractDateString(json.cited_date);

      if (!internalId || !citedDate) {
        skipped++;
        continue;
      }

      records.push({
        file,
        internal_decision_id: internalId,
        cited_date: citedDate,
        candidate_ids: extractCandidateIds(json.candidates)
      });

      uniqueDates.add(citedDate);
    } catch {
      skipped++;
    }
  }

  console.log(`  Loaded ${records.length} records, ${uniqueDates.size} unique dates, ${skipped} skipped`);
  return { records, uniqueDates, skipped };
}

// ============================================================================
// PHASE 2: Query DB for all unique dates (with caching)
// ============================================================================

async function buildDateCache(uniqueDates: Set<string>): Promise<Map<string, Set<string>>> {
  const cache = new Map<string, Set<string>>();
  const dates = Array.from(uniqueDates);

  console.log(`\nPhase 2: Querying DB for ${dates.length} unique dates...`);

  // Process in batches of 50 concurrent queries
  const BATCH_SIZE = 50;

  for (let i = 0; i < dates.length; i += BATCH_SIZE) {
    const batch = dates.slice(i, i + BATCH_SIZE);

    const promises = batch.map(async (date) => {
      const query = `
        SELECT decision_id
        FROM decisions1
        WHERE decision_date = $1
      `;
      try {
        const rows = await DatabaseConfig.executeReadOnlyQuery(query, [date]);
        const ids = new Set(rows.map((r: any) => r.decision_id));
        return { date, ids };
      } catch {
        return { date, ids: new Set<string>() };
      }
    });

    const results = await Promise.all(promises);
    for (const { date, ids } of results) {
      cache.set(date, ids);
    }

    if ((i + BATCH_SIZE) % 500 === 0 || i + BATCH_SIZE >= dates.length) {
      console.log(`  Queried ${Math.min(i + BATCH_SIZE, dates.length)}/${dates.length} dates...`);
    }
  }

  console.log(`  Cache built with ${cache.size} dates`);
  return cache;
}

// ============================================================================
// PHASE 3: Compare records against cache
// ============================================================================

function compareAllRecords(
  records: JsonRecord[],
  dateCache: Map<string, Set<string>>
): {
  verified: number;
  reprocessList: string[];
  details: VerificationResult[];
} {
  console.log(`\nPhase 3: Comparing ${records.length} records against cache...`);

  let verified = 0;
  const reprocessList: string[] = [];
  const details: VerificationResult[] = [];

  for (const record of records) {
    const dbIds = dateCache.get(record.cited_date) || new Set<string>();
    const jsonIds = record.candidate_ids;

    // Check if sets match
    let matches = jsonIds.size === dbIds.size;
    if (matches) {
      for (const id of dbIds) {
        if (!jsonIds.has(id)) {
          matches = false;
          break;
        }
      }
    }

    if (matches) {
      verified++;
    } else {
      reprocessList.push(record.internal_decision_id);

      let reason: string;
      if (jsonIds.size === 0 && dbIds.size > 0) {
        reason = `JSON has no candidates but DB has ${dbIds.size}`;
      } else if (jsonIds.size > 0 && dbIds.size === 0) {
        reason = `JSON has ${jsonIds.size} candidates but DB has none`;
      } else {
        reason = `Candidate mismatch: JSON has ${jsonIds.size}, DB has ${dbIds.size}`;
      }

      details.push({
        internal_decision_id: record.internal_decision_id,
        cited_date: record.cited_date,
        json_candidate_count: jsonIds.size,
        db_candidate_count: dbIds.size,
        reason
      });
    }
  }

  console.log(`  Verified: ${verified}, Need reprocessing: ${reprocessList.length}`);
  return { verified, reprocessList, details };
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: npx tsx src/scripts/verify-cited-decision-candidates-fast.ts <jsons-directory>');
    process.exit(1);
  }

  const directory = path.isAbsolute(args[0])
    ? args[0]
    : path.join(process.cwd(), args[0]);

  if (!fs.existsSync(directory)) {
    console.error(`Directory not found: ${directory}`);
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('FAST Cited Decision Candidate Verification');
  console.log('='.repeat(60));
  console.log(`Directory: ${directory}`);

  const startTime = Date.now();

  try {
    // Phase 1: Load JSONs
    const { records, uniqueDates, skipped } = await loadAllJsons(directory);

    // Phase 2: Build date cache from DB
    const dateCache = await buildDateCache(uniqueDates);

    // Phase 3: Compare
    const { verified, reprocessList, details } = compareAllRecords(records, dateCache);

    // Output
    const outputDir = path.dirname(directory);

    const reprocessListPath = path.join(outputDir, 'reprocess-list.json');
    fs.writeFileSync(reprocessListPath, JSON.stringify(reprocessList, null, 2));

    const reportPath = path.join(outputDir, 'verification-report.json');
    fs.writeFileSync(reportPath, JSON.stringify({
      timestamp: new Date().toISOString(),
      directory,
      stats: {
        total: records.length + skipped,
        verified,
        needsReprocessing: reprocessList.length,
        skipped,
        uniqueDates: uniqueDates.size
      },
      failures: details
    }, null, 2));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n' + '='.repeat(60));
    console.log('VERIFICATION COMPLETE');
    console.log('='.repeat(60));
    console.log(`Total files:        ${records.length + skipped}`);
    console.log(`Verified OK:        ${verified}`);
    console.log(`Need reprocessing:  ${reprocessList.length}`);
    console.log(`Skipped:            ${skipped}`);
    console.log(`Unique dates:       ${uniqueDates.size}`);
    console.log(`Time elapsed:       ${elapsed}s`);
    console.log('');
    console.log(`Reprocess list:     ${reprocessListPath}`);
    console.log(`Detailed report:    ${reportPath}`);

    if (reprocessList.length > 0 && details.length > 0) {
      console.log('\nSample failures (first 5):');
      for (const d of details.slice(0, 5)) {
        console.log(`  - ${d.internal_decision_id}: ${d.reason}`);
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
