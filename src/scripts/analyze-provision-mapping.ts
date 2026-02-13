#!/usr/bin/env node
/**
 * Provision Mapping Statistical Analysis Script
 *
 * Analyzes extracted provision mappings from full-data pipeline output.
 * Generates statistics on match counts and score distributions.
 *
 * Usage:
 *   npx tsx src/scripts/analyze-provision-mapping.ts
 *   npx tsx src/scripts/analyze-provision-mapping.ts /path/to/jsons/directory
 */

import * as fs from 'fs/promises';
import * as path from 'path';

interface Match {
  document_number: string | null;
  score: number;
  reasoning: string;
}

interface ProvisionMapping {
  internal_parent_act_id?: string;
  decision_id?: string;
  parent_act_name?: string;
  provision_number?: string;
  matches: Match[];
  _filename?: string; // Added during loading for reference
}

interface NoMatchDetail {
  parent_act_name: string;
  provision_number: string;
  internal_parent_act_id?: string;
  filename?: string;
}

interface Stats {
  totalProvisions: number;
  matchCounts: {
    zero: number;
    one: number;
    two: number;
    three: number;
    more: number;
  };
  scoreDistribution: {
    [key: string]: number; // "90-100", "80-89", etc.
  };
  noMatchByParentAct: Map<string, number>;
  noMatchDetails: NoMatchDetail[];
  averageScore: number;
  medianScore: number;
  minScore: number;
  maxScore: number;
}

async function loadAllProvisionFiles(jsonsDir: string): Promise<ProvisionMapping[]> {
  console.log(`\n📂 Loading provision files from: ${jsonsDir}\n`);

  const files = await fs.readdir(jsonsDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  console.log(`   Found ${jsonFiles.length.toLocaleString()} JSON files\n`);

  const provisions: ProvisionMapping[] = [];
  let loadedCount = 0;
  let errorCount = 0;

  for (const file of jsonFiles) {
    try {
      const filePath = path.join(jsonsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const provision = JSON.parse(content) as ProvisionMapping;
      provision._filename = file; // Store filename for reference

      provisions.push(provision);
      loadedCount++;

      if (loadedCount % 5000 === 0) {
        console.log(`   Loaded ${loadedCount.toLocaleString()} files...`);
      }
    } catch (error) {
      errorCount++;
      if (errorCount <= 5) {
        console.error(`   Error loading ${file}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  console.log(`\n✅ Loaded ${loadedCount.toLocaleString()} provisions successfully`);
  if (errorCount > 0) {
    console.log(`⚠️  Failed to load ${errorCount} files\n`);
  }

  return provisions;
}

function calculateStats(provisions: ProvisionMapping[]): Stats {
  const stats: Stats = {
    totalProvisions: provisions.length,
    matchCounts: { zero: 0, one: 0, two: 0, three: 0, more: 0 },
    scoreDistribution: {
      '90-100': 0,
      '80-89': 0,
      '70-79': 0,
      '60-69': 0,
      '50-59': 0,
      '< 50': 0,
    },
    noMatchByParentAct: new Map<string, number>(),
    noMatchDetails: [],
    averageScore: 0,
    medianScore: 0,
    minScore: 100,
    maxScore: 0,
  };

  const allScores: number[] = [];

  for (const p of provisions) {
    const matchCount = p.matches ? p.matches.length : 0;

    // Match Counts
    if (matchCount === 0) {
      stats.matchCounts.zero++;
      // Track by parent_act_name
      const actName = p.parent_act_name || 'UNKNOWN';
      stats.noMatchByParentAct.set(actName, (stats.noMatchByParentAct.get(actName) || 0) + 1);
      // Store details for inspection
      stats.noMatchDetails.push({
        parent_act_name: actName,
        provision_number: p.provision_number || 'UNKNOWN',
        internal_parent_act_id: p.internal_parent_act_id,
        filename: p._filename,
      });
    }
    else if (matchCount === 1) stats.matchCounts.one++;
    else if (matchCount === 2) stats.matchCounts.two++;
    else if (matchCount === 3) stats.matchCounts.three++;
    else stats.matchCounts.more++;

    // Score Stats (only for the best match if available)
    if (matchCount > 0 && p.matches[0]) {
      const score = p.matches[0].score;
      allScores.push(score);

      if (score >= 90) stats.scoreDistribution['90-100']++;
      else if (score >= 80) stats.scoreDistribution['80-89']++;
      else if (score >= 70) stats.scoreDistribution['70-79']++;
      else if (score >= 60) stats.scoreDistribution['60-69']++;
      else if (score >= 50) stats.scoreDistribution['50-59']++;
      else stats.scoreDistribution['< 50']++;

      if (score < stats.minScore) stats.minScore = score;
      if (score > stats.maxScore) stats.maxScore = score;
    }
  }

  if (allScores.length > 0) {
    stats.averageScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    allScores.sort((a, b) => a - b);
    const mid = Math.floor(allScores.length / 2);
    stats.medianScore = allScores.length % 2 !== 0 ? allScores[mid] : (allScores[mid - 1] + allScores[mid]) / 2;
  } else {
    stats.minScore = 0;
  }

  return stats;
}

function displayResults(stats: Stats): void {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  PROVISION MAPPING STATISTICAL ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  console.log('📊 OVERVIEW');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`   Total Provisions Analyzed: ${stats.totalProvisions.toLocaleString()}`);
  console.log('');

  console.log('🔢 MATCH COUNTS');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`   0 Matches:   ${stats.matchCounts.zero.toLocaleString().padStart(6)} (${((stats.matchCounts.zero / stats.totalProvisions) * 100).toFixed(1)}%)`);
  console.log(`   1 Match:     ${stats.matchCounts.one.toLocaleString().padStart(6)} (${((stats.matchCounts.one / stats.totalProvisions) * 100).toFixed(1)}%)`);
  console.log(`   2 Matches:   ${stats.matchCounts.two.toLocaleString().padStart(6)} (${((stats.matchCounts.two / stats.totalProvisions) * 100).toFixed(1)}%)`);
  console.log(`   3 Matches:   ${stats.matchCounts.three.toLocaleString().padStart(6)} (${((stats.matchCounts.three / stats.totalProvisions) * 100).toFixed(1)}%)`);
  console.log(`   >3 Matches:  ${stats.matchCounts.more.toLocaleString().padStart(6)} (${((stats.matchCounts.more / stats.totalProvisions) * 100).toFixed(1)}%)`);
  console.log('');

  console.log('🎯 SCORE DISTRIBUTION (Top Match)');
  console.log('─────────────────────────────────────────────────────────────────');
  const totalWithMatches = stats.totalProvisions - stats.matchCounts.zero;
  
  if (totalWithMatches > 0) {
    Object.entries(stats.scoreDistribution).forEach(([range, count]) => {
      console.log(`   ${range.padEnd(8)}: ${count.toLocaleString().padStart(6)} (${((count / totalWithMatches) * 100).toFixed(1)}%)`);
    });
    console.log('');
    console.log(`   Average Score: ${stats.averageScore.toFixed(2)}`);
    console.log(`   Median Score:  ${stats.medianScore.toFixed(1)}`);
    console.log(`   Min Score:     ${stats.minScore}`);
    console.log(`   Max Score:     ${stats.maxScore}`);
  } else {
    console.log('   No matches found to analyze scores.');
  }
  console.log('');

  // No-match breakdown by parent_act_name
  if (stats.matchCounts.zero > 0 && stats.noMatchByParentAct.size > 0) {
    console.log('❌ NO-MATCH BREAKDOWN BY PARENT ACT NAME (Top 25)');
    console.log('─────────────────────────────────────────────────────────────────');

    // Sort by count descending
    const sorted = Array.from(stats.noMatchByParentAct.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25);

    for (const [actName, count] of sorted) {
      const pct = ((count / stats.matchCounts.zero) * 100).toFixed(1);
      console.log(`   ${count.toLocaleString().padStart(6)} (${pct.padStart(5)}%)  ${actName}`);
    }

    if (stats.noMatchByParentAct.size > 25) {
      console.log(`   ... and ${stats.noMatchByParentAct.size - 25} more parent act names`);
    }
    console.log('');

    // Detailed list of all no-matches
    console.log('📋 NO-MATCH DETAILS (All provisions with no matches)');
    console.log('─────────────────────────────────────────────────────────────────');

    // Group by parent_act_name for cleaner output
    const groupedByAct = new Map<string, NoMatchDetail[]>();
    for (const detail of stats.noMatchDetails) {
      const existing = groupedByAct.get(detail.parent_act_name) || [];
      existing.push(detail);
      groupedByAct.set(detail.parent_act_name, existing);
    }

    // Sort by count descending
    // @ts-expect-error unused but kept for future use
    const sortedGroups = Array.from(groupedByAct.entries())
      .sort((a, b) => b[1].length - a[1].length);

  }

  console.log('═══════════════════════════════════════════════════════════════════\n');
}

async function main(): Promise<void> {
  try {
    let jsonsDir: string;

    if (process.argv.length > 2) {
      jsonsDir = process.argv[2];
    } else {
      // Default to a specific recent run if known, otherwise user must provide it
      // For now, we'll try to find the latest in the standard location
      const baseDir = path.join(process.cwd(), 'full-data', 'map-provisions-standard');
      try {
        const dirs = await fs.readdir(baseDir);
        // Filter for timestamp-like directories and sort descending
        const latestDir = dirs.sort().reverse()[0];
        if (latestDir) {
           jsonsDir = path.join(baseDir, latestDir, 'jsons');
           console.log(`ℹ️  No directory provided, using latest found: ${jsonsDir}`);
        } else {
           throw new Error('No results found in default location');
        }
      } catch (e) {
        console.error('❌ Error: Could not auto-detect results directory. Please provide path.');
        console.error('Usage: npx tsx src/scripts/analyze-provision-mapping.ts /path/to/jsons/directory');
        process.exit(1);
      }
    }

    try {
      await fs.access(jsonsDir);
    } catch (error) {
      console.error(`\n❌ Error: Directory not found: ${jsonsDir}\n`);
      process.exit(1);
    }

    const provisions = await loadAllProvisionFiles(jsonsDir);

    if (provisions.length === 0) {
      console.error('\n❌ Error: No valid provision files found\n');
      process.exit(1);
    }

    console.log('🔍 Analyzing statistics...\n');
    const stats = calculateStats(provisions);
    displayResults(stats);

  } catch (error) {
    console.error('\n❌ Fatal Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
