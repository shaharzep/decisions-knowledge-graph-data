#!/usr/bin/env node
/**
 * Cited Decision Mapping Results Analysis Script
 *
 * Analyzes the full-data output from map-cited-decisions job.
 * Generates statistics on match counts, scores, candidate distribution,
 * court mapping effectiveness, and no-match reasons.
 *
 * Usage:
 *   npx tsx src/scripts/analyze-cited-decision-mapping-results.ts
 *   npx tsx src/scripts/analyze-cited-decision-mapping-results.ts /path/to/jsons/directory
 */

import * as fs from 'fs/promises';
import * as path from 'path';

interface Match {
  decision_id: string;
  court_name?: string | null;
  score: number;
  confidence: number;
  reasoning?: string;
}

interface CitedDecisionMapping {
  internal_decision_id: string;
  source_ecli?: string;
  cited_court_name?: string;
  cited_date?: string;
  cited_case_number?: string;
  cited_type?: string;
  treatment?: string;
  language?: string;
  candidate_count: number;
  court_mapping_found: boolean;
  matches: Match[];
  no_match_reason?: string | null;
}

interface Stats {
  total: number;
  matchCounts: {
    zero: number;
    one: number;
    two: number;
    three: number;
    more: number;
  };
  scoreDistribution: {
    [key: string]: number;
  };
  avgScore: number;
  medianScore: number;
  minScore: number;
  maxScore: number;
  candidateDistribution: {
    zero: number;
    one: number;
    twoToFive: number;
    sixToTen: number;
    elevenToTwenty: number;
    moreThanTwenty: number;
  };
  avgCandidates: number;
  candidateMatchRates: {
    zero: { total: number; matched: number };
    one: { total: number; matched: number };
    twoToFive: { total: number; matched: number };
    sixToTen: { total: number; matched: number };
    elevenToTwenty: { total: number; matched: number };
    moreThanTwenty: { total: number; matched: number };
  };
  courtMappingStats: {
    found: number;
    notFound: number;
    matchedWhenFound: number;
    matchedWhenNotFound: number;
  };
  noMatchReasons: Map<string, number>;
  byType: {
    PRECEDENT: { count: number; matched: number; scores: number[] };
    PROCEDURAL: { count: number; matched: number; scores: number[] };
    OTHER: { count: number; matched: number; scores: number[] };
  };
}

async function loadAllMappingFiles(jsonsDir: string): Promise<CitedDecisionMapping[]> {
  console.log(`\n📂 Loading cited decision mapping files from: ${jsonsDir}\n`);

  const files = await fs.readdir(jsonsDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  console.log(`   Found ${jsonFiles.length.toLocaleString()} JSON files\n`);

  const mappings: CitedDecisionMapping[] = [];
  let loadedCount = 0;
  let errorCount = 0;

  for (const file of jsonFiles) {
    try {
      const filePath = path.join(jsonsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const mapping = JSON.parse(content) as CitedDecisionMapping;

      mappings.push(mapping);
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

  console.log(`\n✅ Loaded ${loadedCount.toLocaleString()} cited decision mappings successfully`);
  if (errorCount > 0) {
    console.log(`⚠️  Failed to load ${errorCount} files\n`);
  }

  return mappings;
}

function calculateStats(mappings: CitedDecisionMapping[]): Stats {
  const stats: Stats = {
    total: mappings.length,
    matchCounts: { zero: 0, one: 0, two: 0, three: 0, more: 0 },
    scoreDistribution: {
      '90-100': 0,
      '80-89': 0,
      '70-79': 0,
      '60-69': 0,
      '50-59': 0,
      '< 50': 0,
    },
    avgScore: 0,
    medianScore: 0,
    minScore: 100,
    maxScore: 0,
    candidateDistribution: {
      zero: 0,
      one: 0,
      twoToFive: 0,
      sixToTen: 0,
      elevenToTwenty: 0,
      moreThanTwenty: 0,
    },
    avgCandidates: 0,
    candidateMatchRates: {
      zero: { total: 0, matched: 0 },
      one: { total: 0, matched: 0 },
      twoToFive: { total: 0, matched: 0 },
      sixToTen: { total: 0, matched: 0 },
      elevenToTwenty: { total: 0, matched: 0 },
      moreThanTwenty: { total: 0, matched: 0 },
    },
    courtMappingStats: {
      found: 0,
      notFound: 0,
      matchedWhenFound: 0,
      matchedWhenNotFound: 0,
    },
    noMatchReasons: new Map(),
    byType: {
      PRECEDENT: { count: 0, matched: 0, scores: [] },
      PROCEDURAL: { count: 0, matched: 0, scores: [] },
      OTHER: { count: 0, matched: 0, scores: [] },
    },
  };

  const allScores: number[] = [];
  let totalCandidates = 0;

  for (const m of mappings) {
    const matchCount = m.matches ? m.matches.length : 0;
    const hasMatch = matchCount > 0;
    const candidateCount = m.candidate_count || 0;

    // Match Counts
    if (matchCount === 0) stats.matchCounts.zero++;
    else if (matchCount === 1) stats.matchCounts.one++;
    else if (matchCount === 2) stats.matchCounts.two++;
    else if (matchCount === 3) stats.matchCounts.three++;
    else stats.matchCounts.more++;

    // Score Stats (top match only)
    if (hasMatch && m.matches[0]) {
      const score = m.matches[0].score;
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

    // Candidate Distribution
    totalCandidates += candidateCount;
    let candidateBucket: keyof typeof stats.candidateMatchRates;

    if (candidateCount === 0) {
      stats.candidateDistribution.zero++;
      candidateBucket = 'zero';
    } else if (candidateCount === 1) {
      stats.candidateDistribution.one++;
      candidateBucket = 'one';
    } else if (candidateCount <= 5) {
      stats.candidateDistribution.twoToFive++;
      candidateBucket = 'twoToFive';
    } else if (candidateCount <= 10) {
      stats.candidateDistribution.sixToTen++;
      candidateBucket = 'sixToTen';
    } else if (candidateCount <= 20) {
      stats.candidateDistribution.elevenToTwenty++;
      candidateBucket = 'elevenToTwenty';
    } else {
      stats.candidateDistribution.moreThanTwenty++;
      candidateBucket = 'moreThanTwenty';
    }

    stats.candidateMatchRates[candidateBucket].total++;
    if (hasMatch) stats.candidateMatchRates[candidateBucket].matched++;

    // Court Mapping Stats
    if (m.court_mapping_found) {
      stats.courtMappingStats.found++;
      if (hasMatch) stats.courtMappingStats.matchedWhenFound++;
    } else {
      stats.courtMappingStats.notFound++;
      if (hasMatch) stats.courtMappingStats.matchedWhenNotFound++;
    }

    // No-Match Reasons
    if (!hasMatch && m.no_match_reason) {
      // Extract first meaningful phrase
      const reason = m.no_match_reason.substring(0, 60).trim();
      const category = categorizeNoMatchReason(reason);
      stats.noMatchReasons.set(category, (stats.noMatchReasons.get(category) || 0) + 1);
    }

    // By Type
    const citedType = m.cited_type?.toUpperCase() || 'OTHER';
    const typeKey = citedType === 'PRECEDENT' ? 'PRECEDENT' : citedType === 'PROCEDURAL' ? 'PROCEDURAL' : 'OTHER';
    stats.byType[typeKey].count++;
    if (hasMatch) {
      stats.byType[typeKey].matched++;
      if (m.matches[0]) {
        stats.byType[typeKey].scores.push(m.matches[0].score);
      }
    }
  }

  // Calculate averages and medians
  stats.avgCandidates = mappings.length > 0 ? totalCandidates / mappings.length : 0;

  if (allScores.length > 0) {
    stats.avgScore = allScores.reduce((a, b) => a + b, 0) / allScores.length;
    allScores.sort((a, b) => a - b);
    const mid = Math.floor(allScores.length / 2);
    stats.medianScore = allScores.length % 2 !== 0 ? allScores[mid] : (allScores[mid - 1] + allScores[mid]) / 2;
  } else {
    stats.minScore = 0;
  }

  return stats;
}

function categorizeNoMatchReason(reason: string): string {
  const lower = reason.toLowerCase();

  if (lower.includes('no decisions found') || lower.includes('no candidates found')) {
    return 'No decisions found for date';
  }
  if (lower.includes('no candidate matches') || lower.includes('none of the candidate')) {
    return 'No candidate matches case number';
  }
  if (lower.includes('insufficient') || lower.includes('not enough')) {
    return 'Insufficient context to match';
  }
  if (lower.includes('ambiguous') || lower.includes('multiple')) {
    return 'Ambiguous - multiple possible matches';
  }
  if (lower.includes('court') || lower.includes('jurisdiction')) {
    return 'Court/jurisdiction mismatch';
  }

  return reason.length > 40 ? reason.substring(0, 40) + '...' : reason;
}

function displayResults(stats: Stats): void {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  CITED DECISION MAPPING RESULTS ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // Overview
  const withMatches = stats.total - stats.matchCounts.zero;
  console.log('📊 OVERVIEW');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`   Total Cited Decisions:    ${stats.total.toLocaleString()}`);
  console.log(`   With Matches:             ${withMatches.toLocaleString()} (${((withMatches / stats.total) * 100).toFixed(1)}%)`);
  console.log(`   Without Matches:          ${stats.matchCounts.zero.toLocaleString()} (${((stats.matchCounts.zero / stats.total) * 100).toFixed(1)}%)`);
  console.log('');

  // Match Counts
  console.log('🔢 MATCH COUNT DISTRIBUTION');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`   0 Matches:   ${stats.matchCounts.zero.toLocaleString().padStart(8)} (${((stats.matchCounts.zero / stats.total) * 100).toFixed(1)}%)`);
  console.log(`   1 Match:     ${stats.matchCounts.one.toLocaleString().padStart(8)} (${((stats.matchCounts.one / stats.total) * 100).toFixed(1)}%)`);
  console.log(`   2 Matches:   ${stats.matchCounts.two.toLocaleString().padStart(8)} (${((stats.matchCounts.two / stats.total) * 100).toFixed(1)}%)`);
  console.log(`   3 Matches:   ${stats.matchCounts.three.toLocaleString().padStart(8)} (${((stats.matchCounts.three / stats.total) * 100).toFixed(1)}%)`);
  if (stats.matchCounts.more > 0) {
    console.log(`   >3 Matches:  ${stats.matchCounts.more.toLocaleString().padStart(8)} (${((stats.matchCounts.more / stats.total) * 100).toFixed(1)}%)`);
  }
  console.log('');

  // Score Distribution
  console.log('🎯 SCORE DISTRIBUTION (Top Match)');
  console.log('─────────────────────────────────────────────────────────────────');
  if (withMatches > 0) {
    Object.entries(stats.scoreDistribution).forEach(([range, count]) => {
      console.log(`   ${range.padEnd(8)}: ${count.toLocaleString().padStart(8)} (${((count / withMatches) * 100).toFixed(1)}%)`);
    });
    console.log('');
    console.log(`   Average Score: ${stats.avgScore.toFixed(1)}`);
    console.log(`   Median Score:  ${stats.medianScore.toFixed(1)}`);
    console.log(`   Min Score:     ${stats.minScore}`);
    console.log(`   Max Score:     ${stats.maxScore}`);
  } else {
    console.log('   No matches found to analyze scores.');
  }
  console.log('');

  // Candidate Distribution
  console.log('📋 CANDIDATE COUNT DISTRIBUTION');
  console.log('─────────────────────────────────────────────────────────────────');
  const candLabels: [keyof typeof stats.candidateDistribution, string][] = [
    ['zero', '0 candidates'],
    ['one', '1 candidate'],
    ['twoToFive', '2-5 candidates'],
    ['sixToTen', '6-10 candidates'],
    ['elevenToTwenty', '11-20 candidates'],
    ['moreThanTwenty', '>20 candidates'],
  ];
  for (const [key, label] of candLabels) {
    const count = stats.candidateDistribution[key];
    const rateData = stats.candidateMatchRates[key];
    const matchRate = rateData.total > 0 ? ((rateData.matched / rateData.total) * 100).toFixed(1) : '0.0';
    console.log(`   ${label.padEnd(16)}: ${count.toLocaleString().padStart(8)} (${((count / stats.total) * 100).toFixed(1)}%)  → Match rate: ${matchRate}%`);
  }
  console.log('');
  console.log(`   Average Candidates per Decision: ${stats.avgCandidates.toFixed(1)}`);
  console.log('');

  // Court Mapping Effectiveness
  console.log('🏛️  COURT MAPPING EFFECTIVENESS');
  console.log('─────────────────────────────────────────────────────────────────');
  const foundRate = stats.courtMappingStats.found > 0
    ? ((stats.courtMappingStats.matchedWhenFound / stats.courtMappingStats.found) * 100).toFixed(1)
    : '0.0';
  const notFoundRate = stats.courtMappingStats.notFound > 0
    ? ((stats.courtMappingStats.matchedWhenNotFound / stats.courtMappingStats.notFound) * 100).toFixed(1)
    : '0.0';
  console.log(`   Court Mapped:       ${stats.courtMappingStats.found.toLocaleString().padStart(8)} (${((stats.courtMappingStats.found / stats.total) * 100).toFixed(1)}%)  → Match rate: ${foundRate}%`);
  console.log(`   Court Not Mapped:   ${stats.courtMappingStats.notFound.toLocaleString().padStart(8)} (${((stats.courtMappingStats.notFound / stats.total) * 100).toFixed(1)}%)  → Match rate: ${notFoundRate}%`);
  console.log('');

  // Citation Type Breakdown
  console.log('📑 CITATION TYPE BREAKDOWN');
  console.log('─────────────────────────────────────────────────────────────────');
  for (const [type, data] of Object.entries(stats.byType)) {
    if (data.count > 0) {
      const matchRate = ((data.matched / data.count) * 100).toFixed(1);
      const avgScore = data.scores.length > 0
        ? (data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(1)
        : 'N/A';
      console.log(`   ${type.padEnd(12)}: ${data.count.toLocaleString().padStart(8)} (${((data.count / stats.total) * 100).toFixed(1)}%)  → Match rate: ${matchRate}%, Avg score: ${avgScore}`);
    }
  }
  console.log('');

  // No-Match Reasons
  if (stats.noMatchReasons.size > 0) {
    console.log('❌ TOP NO-MATCH REASONS');
    console.log('─────────────────────────────────────────────────────────────────');
    const sortedReasons = [...stats.noMatchReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [reason, count] of sortedReasons) {
      console.log(`   ${count.toLocaleString().padStart(6)}x  ${reason}`);
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════════════\n');
}

async function main(): Promise<void> {
  try {
    let jsonsDir: string;

    if (process.argv.length > 2) {
      jsonsDir = process.argv[2];
    } else {
      // Auto-detect latest directory
      const baseDir = path.join(process.cwd(), 'full-data', 'map-cited-decisions');
      try {
        const dirs = await fs.readdir(baseDir);
        const latestDir = dirs.filter(d => d.match(/^\d{4}-\d{2}-\d{2}T/)).sort().reverse()[0];
        if (latestDir) {
          jsonsDir = path.join(baseDir, latestDir, 'jsons');
          console.log(`ℹ️  No directory provided, using latest found: ${jsonsDir}`);
        } else {
          throw new Error('No results found in default location');
        }
      } catch (e) {
        console.error('❌ Error: Could not auto-detect results directory. Please provide path.');
        console.error('Usage: npx tsx src/scripts/analyze-cited-decision-mapping-results.ts /path/to/jsons/directory');
        process.exit(1);
      }
    }

    try {
      await fs.access(jsonsDir);
    } catch (error) {
      console.error(`\n❌ Error: Directory not found: ${jsonsDir}\n`);
      process.exit(1);
    }

    const mappings = await loadAllMappingFiles(jsonsDir);

    if (mappings.length === 0) {
      console.error('\n❌ Error: No valid mapping files found\n');
      process.exit(1);
    }

    console.log('🔍 Analyzing statistics...\n');
    const stats = calculateStats(mappings);
    displayResults(stats);

  } catch (error) {
    console.error('\n❌ Fatal Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();
