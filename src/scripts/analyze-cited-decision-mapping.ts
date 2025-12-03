/**
 * Analyze Cited Decision Mapping Statistics
 *
 * Calculates average potential candidates using:
 * - Date filter (mandatory)
 * - Court filter (when court name can be mapped via CSV)
 *
 * Usage: npx tsx src/scripts/analyze-cited-decision-mapping.ts
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { DatabaseConfig } from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Normalize court name for consistent lookup
 */
function normalizeCourtName(name: string): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/['']/g, "'");
}

/**
 * Load court mapping from CSV file
 */
function loadCourtMappingFromCsv(): Record<string, string> {
  const csvPath = join(__dirname, '../jobs/map-cited-decisions/court-mapping.csv');
  const csvContent = readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n');
  const mapping: Record<string, string> = {};

  // Skip header row
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const match = line.match(/^"([^"]*)",([^,]+),/);
    if (match) {
      const originalString = match[1];
      const mappedId = match[2];
      mapping[normalizeCourtName(originalString)] = mappedId;
    }
  }

  return mapping;
}

interface MatchStats {
  totalWithDate: number;
  avgMatchesDateOnly: number;
  avgMatchesWithCourt: number;
  minMatches: number;
  maxMatches: number;
  medianMatches: number;
  zeroMatches: number;
  exactOneMatch: number;
  multipleMatches: number;
  courtMappingFound: number;
  courtMappingNotFound: number;
}

async function main() {
  console.log('Loading court mapping from CSV...');
  const courtMapping = loadCourtMappingFromCsv();
  console.log(`Loaded ${Object.keys(courtMapping).length} court mappings\n`);

  // Step 1: Get all cited decisions with dates and court names
  console.log('Fetching cited decisions...');
  const citedDecisions = await DatabaseConfig.executeReadOnlyQuery<{
    id: number;
    cited_date: string;
    court_name: string | null;
  }>(`
    SELECT id, cited_date, court_name
    FROM cited_decisions
    WHERE cited_date IS NOT NULL
  `);
  console.log(`Found ${citedDecisions.length.toLocaleString()} cited decisions with dates\n`);

  // Step 2: Get count of decisions per date (for date-only matching)
  console.log('Fetching date-based match counts...');
  const dateCountsResult = await DatabaseConfig.executeReadOnlyQuery<{
    decision_date: string;
    count: string;
  }>(`
    SELECT decision_date::date as decision_date, COUNT(*) as count
    FROM decisions1
    GROUP BY decision_date::date
  `);

  const dateCounts = new Map<string, number>();
  for (const row of dateCountsResult) {
    const dateStr = new Date(row.decision_date).toISOString().split('T')[0];
    dateCounts.set(dateStr, parseInt(row.count, 10));
  }
  console.log(`Found ${dateCounts.size.toLocaleString()} unique dates in decisions1\n`);

  // Step 3: Get count of decisions per date+court combination
  console.log('Fetching date+court match counts...');
  const dateCourtCountsResult = await DatabaseConfig.executeReadOnlyQuery<{
    decision_date: string;
    court_ecli_code: string;
    count: string;
  }>(`
    SELECT decision_date::date as decision_date, court_ecli_code, COUNT(*) as count
    FROM decisions1
    GROUP BY decision_date::date, court_ecli_code
  `);

  const dateCourtCounts = new Map<string, number>();
  for (const row of dateCourtCountsResult) {
    const dateStr = new Date(row.decision_date).toISOString().split('T')[0];
    const key = `${dateStr}|${row.court_ecli_code}`;
    dateCourtCounts.set(key, parseInt(row.count, 10));
  }
  console.log(`Found ${dateCourtCounts.size.toLocaleString()} unique date+court combinations\n`);

  // Step 4: Process each cited decision in memory
  console.log('Calculating match statistics...');

  const matchCountsDateOnly: number[] = [];
  const matchCountsWithCourt: number[] = [];
  let courtMappingFound = 0;
  let courtMappingNotFound = 0;

  for (const cd of citedDecisions) {
    const citedDateStr = new Date(cd.cited_date).toISOString().split('T')[0];

    // Date-only count
    const dateOnlyCount = dateCounts.get(citedDateStr) || 0;
    matchCountsDateOnly.push(dateOnlyCount);

    // Try court mapping
    const courtEcliCode = cd.court_name
      ? courtMapping[normalizeCourtName(cd.court_name)]
      : null;

    let finalCount: number;
    if (courtEcliCode) {
      courtMappingFound++;
      const key = `${citedDateStr}|${courtEcliCode}`;
      const courtCount = dateCourtCounts.get(key) || 0;

      // If court filter returns 0, fall back to date-only
      finalCount = courtCount > 0 ? courtCount : dateOnlyCount;
    } else {
      courtMappingNotFound++;
      finalCount = dateOnlyCount;
    }

    matchCountsWithCourt.push(finalCount);
  }

  // Calculate statistics (avoid spread operator for large arrays - causes stack overflow)
  const sum = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  const avg = (arr: number[]) => arr.length > 0 ? sum(arr) / arr.length : 0;
  const min = (arr: number[]) => arr.reduce((a, b) => Math.min(a, b), Infinity);
  const max = (arr: number[]) => arr.reduce((a, b) => Math.max(a, b), -Infinity);
  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  let zeroMatches = 0;
  let exactOneMatch = 0;
  let multipleMatches = 0;
  for (const c of matchCountsWithCourt) {
    if (c === 0) zeroMatches++;
    else if (c === 1) exactOneMatch++;
    else multipleMatches++;
  }

  const stats: MatchStats = {
    totalWithDate: citedDecisions.length,
    avgMatchesDateOnly: avg(matchCountsDateOnly),
    avgMatchesWithCourt: avg(matchCountsWithCourt),
    minMatches: min(matchCountsWithCourt),
    maxMatches: max(matchCountsWithCourt),
    medianMatches: median(matchCountsWithCourt),
    zeroMatches,
    exactOneMatch,
    multipleMatches,
    courtMappingFound,
    courtMappingNotFound
  };

  // Print results
  console.log('\n' + '='.repeat(60));
  console.log('CITED DECISION MAPPING STATISTICS');
  console.log('='.repeat(60));
  console.log();
  console.log('OVERALL:');
  console.log(`  Total cited decisions with date:     ${stats.totalWithDate.toLocaleString()}`);
  console.log();
  console.log('COURT MAPPING:');
  console.log(`  Court name mapped successfully:      ${stats.courtMappingFound.toLocaleString()} (${((stats.courtMappingFound/stats.totalWithDate)*100).toFixed(1)}%)`);
  console.log(`  Court name NOT mapped:               ${stats.courtMappingNotFound.toLocaleString()} (${((stats.courtMappingNotFound/stats.totalWithDate)*100).toFixed(1)}%)`);
  console.log();
  console.log('CANDIDATE COUNTS (Date filter only):');
  console.log(`  Average potential matches:           ${stats.avgMatchesDateOnly.toFixed(2)}`);
  console.log();
  console.log('CANDIDATE COUNTS (Date + Court filter):');
  console.log(`  Average potential matches:           ${stats.avgMatchesWithCourt.toFixed(2)}`);
  console.log(`  Minimum matches:                     ${stats.minMatches}`);
  console.log(`  Maximum matches:                     ${stats.maxMatches}`);
  console.log(`  Median matches:                      ${stats.medianMatches.toFixed(1)}`);
  console.log();
  console.log('MATCH DISTRIBUTION (with court filter when available):');
  console.log(`  Zero matches (not in DB):            ${stats.zeroMatches.toLocaleString()} (${((stats.zeroMatches/stats.totalWithDate)*100).toFixed(1)}%)`);
  console.log(`  Exactly one match (no LLM needed):   ${stats.exactOneMatch.toLocaleString()} (${((stats.exactOneMatch/stats.totalWithDate)*100).toFixed(1)}%)`);
  console.log(`  Multiple matches (LLM needed):       ${stats.multipleMatches.toLocaleString()} (${((stats.multipleMatches/stats.totalWithDate)*100).toFixed(1)}%)`);
  console.log();
  console.log('='.repeat(60));

  // Close database connection
  await DatabaseConfig.close();
}

main().catch(async (err) => {
  console.error('Error:', err);
  await DatabaseConfig.close();
  process.exit(1);
});
