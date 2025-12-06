/**
 * Analyze Find Provision Entities Results
 *
 * Analyzes the JSON output files from the find-provision-entities job.
 * Reports statistics on match rates, breakdown by parent_act_type, score distribution, etc.
 *
 * Usage:
 *   npx tsx src/scripts/analyze-provision-entities.ts [timestamp]
 *
 * If timestamp is omitted, uses the most recent run.
 */

import fs from 'fs/promises';
import path from 'path';

// =============================================================================
// TYPES
// =============================================================================

interface ProvisionResult {
  internal_provision_id: string;
  internal_parent_act_id: string;
  decision_id: number;
  parent_act_number: string;
  parent_act_name: string;
  provision_number: string;
  provision_number_key: string;
  parent_act_type: string;
  score: number;
  found: boolean;
  article_contents_id: number | null;
  article_number: string | null;
  document_number: string | null;
}

interface Stats {
  total: number;
  found: number;
  notFound: number;
  matchRate: number;
  byActType: Record<string, { total: number; found: number; rate: number }>;
  byScoreRange: Record<string, { total: number; found: number; rate: number }>;
  notFoundSamples: ProvisionResult[];
  corruptedFiles: string[];
}

// =============================================================================
// HELPERS
// =============================================================================

function getScoreRange(score: number): string {
  if (score >= 95) return '95-100';
  if (score >= 90) return '90-94';
  if (score >= 85) return '85-89';
  if (score >= 80) return '80-84';
  return '<80';
}

async function findLatestTimestamp(baseDir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(baseDir);
    const timestamps = entries.filter(e => e.match(/^\d{4}-\d{2}-\d{2}T/));
    if (timestamps.length === 0) return null;
    timestamps.sort().reverse();
    return timestamps[0];
  } catch {
    return null;
  }
}

// =============================================================================
// MAIN ANALYSIS
// =============================================================================

async function analyzeResults(jsonsDir: string): Promise<Stats> {
  const stats: Stats = {
    total: 0,
    found: 0,
    notFound: 0,
    matchRate: 0,
    byActType: {},
    byScoreRange: {},
    notFoundSamples: [],
    corruptedFiles: []
  };

  const files = await fs.readdir(jsonsDir);
  const jsonFiles = files.filter(f => f.endsWith('.json'));

  console.log(`\nAnalyzing ${jsonFiles.length.toLocaleString()} files...`);

  const corruptedFiles: string[] = [];

  let processed = 0;
  for (const file of jsonFiles) {
    const filePath = path.join(jsonsDir, file);
    const content = await fs.readFile(filePath, 'utf-8');

    let result: ProvisionResult;
    try {
      result = JSON.parse(content);
    } catch (e) {
      corruptedFiles.push(file);
      processed++;
      continue;
    }

    stats.total++;

    // Count found/not found
    if (result.found) {
      stats.found++;
    } else {
      stats.notFound++;
      // Collect samples of not found (max 20)
      if (stats.notFoundSamples.length < 20) {
        stats.notFoundSamples.push(result);
      }
    }

    // By parent_act_type
    const actType = result.parent_act_type || 'UNKNOWN';
    if (!stats.byActType[actType]) {
      stats.byActType[actType] = { total: 0, found: 0, rate: 0 };
    }
    stats.byActType[actType].total++;
    if (result.found) stats.byActType[actType].found++;

    // By score range
    const scoreRange = getScoreRange(result.score);
    if (!stats.byScoreRange[scoreRange]) {
      stats.byScoreRange[scoreRange] = { total: 0, found: 0, rate: 0 };
    }
    stats.byScoreRange[scoreRange].total++;
    if (result.found) stats.byScoreRange[scoreRange].found++;

    processed++;
    if (processed % 50000 === 0) {
      console.log(`  Processed ${processed.toLocaleString()}/${jsonFiles.length.toLocaleString()}...`);
    }
  }

  // Calculate rates
  stats.matchRate = stats.total > 0 ? (stats.found / stats.total) * 100 : 0;

  for (const type of Object.keys(stats.byActType)) {
    const s = stats.byActType[type];
    s.rate = s.total > 0 ? (s.found / s.total) * 100 : 0;
  }

  for (const range of Object.keys(stats.byScoreRange)) {
    const s = stats.byScoreRange[range];
    s.rate = s.total > 0 ? (s.found / s.total) * 100 : 0;
  }

  stats.corruptedFiles = corruptedFiles;

  return stats;
}

function printReport(stats: Stats): void {
  console.log('\n' + '='.repeat(70));
  console.log('PROVISION ENTITY LOOKUP ANALYSIS');
  console.log('='.repeat(70));

  console.log('\n## OVERALL STATISTICS\n');
  console.log(`Total provisions processed:  ${stats.total.toLocaleString()}`);
  console.log(`Found in article_contents:   ${stats.found.toLocaleString()} (${stats.matchRate.toFixed(1)}%)`);
  console.log(`Not found:                   ${stats.notFound.toLocaleString()} (${(100 - stats.matchRate).toFixed(1)}%)`);

  console.log('\n## BY PARENT ACT TYPE\n');
  const sortedTypes = Object.entries(stats.byActType)
    .sort((a, b) => b[1].total - a[1].total);

  console.log('| Act Type | Total | Found | Rate |');
  console.log('|----------|-------|-------|------|');
  for (const [type, s] of sortedTypes) {
    console.log(`| ${type.padEnd(20)} | ${s.total.toLocaleString().padStart(7)} | ${s.found.toLocaleString().padStart(7)} | ${s.rate.toFixed(1).padStart(5)}% |`);
  }

  console.log('\n## BY MAPPING SCORE RANGE\n');
  const scoreOrder = ['95-100', '90-94', '85-89', '80-84', '<80'];
  console.log('| Score Range | Total | Found | Rate |');
  console.log('|-------------|-------|-------|------|');
  for (const range of scoreOrder) {
    const s = stats.byScoreRange[range];
    if (s) {
      console.log(`| ${range.padEnd(11)} | ${s.total.toLocaleString().padStart(7)} | ${s.found.toLocaleString().padStart(7)} | ${s.rate.toFixed(1).padStart(5)}% |`);
    }
  }

  if (stats.notFoundSamples.length > 0) {
    console.log('\n## SAMPLE NOT FOUND PROVISIONS (first 10)\n');
    for (const sample of stats.notFoundSamples.slice(0, 10)) {
      console.log(`- [${sample.parent_act_type}] "${sample.parent_act_name}"`);
      console.log(`  provision_number_key: "${sample.provision_number_key}", parent_act_number: "${sample.parent_act_number}"`);
      console.log(`  score: ${sample.score}`);
      console.log('');
    }
  }

  if (stats.corruptedFiles.length > 0) {
    console.log(`\n## CORRUPTED JSON FILES (${stats.corruptedFiles.length} total)\n`);
    console.log('These files have invalid JSON and were skipped:');
    for (const file of stats.corruptedFiles.slice(0, 20)) {
      console.log(`  - ${file}`);
    }
    if (stats.corruptedFiles.length > 20) {
      console.log(`  ... and ${stats.corruptedFiles.length - 20} more`);
    }
  }

  console.log('\n' + '='.repeat(70));
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const baseDir = 'full-data/find-provision-entities';

  // Get timestamp from args or find latest
  let timestamp: string | undefined = process.argv[2];
  if (!timestamp) {
    const latest = await findLatestTimestamp(baseDir);
    if (!latest) {
      console.error('No results found in', baseDir);
      process.exit(1);
    }
    timestamp = latest;
    console.log(`Using latest timestamp: ${timestamp}`);
  }

  const jsonsDir = path.join(baseDir, timestamp, 'jsons');

  try {
    await fs.access(jsonsDir);
  } catch {
    console.error(`Directory not found: ${jsonsDir}`);
    process.exit(1);
  }

  const stats = await analyzeResults(jsonsDir);
  printReport(stats);
}

main().catch(console.error);
