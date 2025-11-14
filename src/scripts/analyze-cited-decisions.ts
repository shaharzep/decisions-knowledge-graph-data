#!/usr/bin/env node
/**
 * Cited Decisions Statistical Analysis Script
 *
 * Analyzes extracted cited decisions from full-data pipeline output.
 * Generates comprehensive statistics on type, treatment, jurisdiction, courts, and temporal patterns.
 *
 * Usage:
 *   npm run analyze:citations
 *   npm run analyze:citations -- /path/to/jsons/directory
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  analyzeCitations,
  DecisionFile,
  CitationStatistics,
} from '../utils/citationStatisticsAnalyzer.js';

// ========================================
// FILE LOADING
// ========================================

async function loadAllDecisionFiles(jsonsDir: string): Promise<DecisionFile[]> {
  console.log(`\n📂 Loading decision files from: ${jsonsDir}\n`);

  const files = await fs.readdir(jsonsDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  console.log(`   Found ${jsonFiles.length.toLocaleString()} JSON files\n`);

  const decisions: DecisionFile[] = [];
  let loadedCount = 0;
  let errorCount = 0;

  for (const file of jsonFiles) {
    try {
      const filePath = path.join(jsonsDir, file);
      const content = await fs.readFile(filePath, 'utf-8');
      const decision = JSON.parse(content) as DecisionFile;

      decisions.push(decision);
      loadedCount++;

      // Progress logging every 5000 files
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

  console.log(`\n✅ Loaded ${loadedCount.toLocaleString()} decisions successfully`);
  if (errorCount > 0) {
    console.log(`⚠️  Failed to load ${errorCount} files\n`);
  }

  return decisions;
}

// ========================================
// RESULTS DISPLAY
// ========================================

function displayResults(stats: CitationStatistics): void {
  console.log('\n═══════════════════════════════════════════════════════════════════');
  console.log('  CITED DECISIONS STATISTICAL ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════\n');

  // ========================================
  // OVERVIEW
  // ========================================
  console.log('📊 OVERVIEW');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`   Total Decisions Analyzed:  ${stats.totalDecisions.toLocaleString()}`);
  console.log(`   Total Citations Extracted: ${stats.totalCitations.toLocaleString()}`);
  console.log(
    `   Avg Citations per Decision: ${stats.perDecisionMetrics.avgCitations.toFixed(2)}`
  );
  console.log(
    `   Median Citations per Decision: ${stats.perDecisionMetrics.medianCitations.toFixed(1)}`
  );
  console.log('');

  // ========================================
  // TYPE CLASSIFICATION
  // ========================================
  console.log('🏛️  TYPE CLASSIFICATION (Precedent vs Procedural)');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`   Total PRECEDENT Citations:   ${stats.typeStats.totalPrecedent.toLocaleString()} (${((stats.typeStats.totalPrecedent / stats.totalCitations) * 100).toFixed(1)}%)`);
  console.log(`   Total PROCEDURAL Citations:  ${stats.typeStats.totalProcedural.toLocaleString()} (${((stats.typeStats.totalProcedural / stats.totalCitations) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`   Decisions with ≥1 Precedent:  ${stats.typeStats.decisionsWithPrecedent.toLocaleString()} (${((stats.typeStats.decisionsWithPrecedent / stats.totalDecisions) * 100).toFixed(1)}%)`);
  console.log(`   Decisions with ≥1 Procedural: ${stats.typeStats.decisionsWithProcedural.toLocaleString()} (${((stats.typeStats.decisionsWithProcedural / stats.totalDecisions) * 100).toFixed(1)}%)`);
  console.log(`   Decisions with Both Types:    ${stats.typeStats.decisionsWithBoth.toLocaleString()} (${((stats.typeStats.decisionsWithBoth / stats.totalDecisions) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`   Avg Precedent per Decision:   ${stats.typeStats.avgPrecedentPerDecision.toFixed(2)}`);
  console.log(`   Avg Procedural per Decision:  ${stats.typeStats.avgProceduralPerDecision.toFixed(2)}`);
  console.log('');

  // ========================================
  // TREATMENT CLASSIFICATION
  // ========================================
  console.log('⚖️  TREATMENT CLASSIFICATION');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log('   Overall:');
  console.log(`      FOLLOWED:       ${stats.treatmentStats.FOLLOWED.toLocaleString().padStart(8)} (${((stats.treatmentStats.FOLLOWED / stats.totalCitations) * 100).toFixed(1)}%)`);
  console.log(`      DISTINGUISHED:  ${stats.treatmentStats.DISTINGUISHED.toLocaleString().padStart(8)} (${((stats.treatmentStats.DISTINGUISHED / stats.totalCitations) * 100).toFixed(1)}%)`);
  console.log(`      OVERRULED:      ${stats.treatmentStats.OVERRULED.toLocaleString().padStart(8)} (${((stats.treatmentStats.OVERRULED / stats.totalCitations) * 100).toFixed(1)}%)`);
  console.log(`      CITED:          ${stats.treatmentStats.CITED.toLocaleString().padStart(8)} (${((stats.treatmentStats.CITED / stats.totalCitations) * 100).toFixed(1)}%)`);
  console.log(`      UNCERTAIN:      ${stats.treatmentStats.UNCERTAIN.toLocaleString().padStart(8)} (${((stats.treatmentStats.UNCERTAIN / stats.totalCitations) * 100).toFixed(1)}%)`);
  console.log('');

  console.log('   By Type:');
  console.log(`      PRECEDENT → FOLLOWED:      ${stats.treatmentStats.byType.PRECEDENT.FOLLOWED.toLocaleString().padStart(8)} (${((stats.treatmentStats.byType.PRECEDENT.FOLLOWED / stats.typeStats.totalPrecedent) * 100).toFixed(1)}%)`);
  console.log(`      PRECEDENT → DISTINGUISHED: ${stats.treatmentStats.byType.PRECEDENT.DISTINGUISHED.toLocaleString().padStart(8)} (${((stats.treatmentStats.byType.PRECEDENT.DISTINGUISHED / stats.typeStats.totalPrecedent) * 100).toFixed(1)}%)`);
  console.log(`      PRECEDENT → OVERRULED:     ${stats.treatmentStats.byType.PRECEDENT.OVERRULED.toLocaleString().padStart(8)} (${((stats.treatmentStats.byType.PRECEDENT.OVERRULED / stats.typeStats.totalPrecedent) * 100).toFixed(1)}%)`);
  console.log(`      PRECEDENT → CITED:         ${stats.treatmentStats.byType.PRECEDENT.CITED.toLocaleString().padStart(8)} (${((stats.treatmentStats.byType.PRECEDENT.CITED / stats.typeStats.totalPrecedent) * 100).toFixed(1)}%)`);
  console.log(`      PRECEDENT → UNCERTAIN:     ${stats.treatmentStats.byType.PRECEDENT.UNCERTAIN.toLocaleString().padStart(8)} (${((stats.treatmentStats.byType.PRECEDENT.UNCERTAIN / stats.typeStats.totalPrecedent) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`      PROCEDURAL → FOLLOWED:      ${stats.treatmentStats.byType.PROCEDURAL.FOLLOWED.toLocaleString().padStart(8)} (${((stats.treatmentStats.byType.PROCEDURAL.FOLLOWED / stats.typeStats.totalProcedural) * 100).toFixed(1)}%)`);
  console.log(`      PROCEDURAL → DISTINGUISHED: ${stats.treatmentStats.byType.PROCEDURAL.DISTINGUISHED.toLocaleString().padStart(8)} (${((stats.treatmentStats.byType.PROCEDURAL.DISTINGUISHED / stats.typeStats.totalProcedural) * 100).toFixed(1)}%)`);
  console.log(`      PROCEDURAL → OVERRULED:     ${stats.treatmentStats.byType.PROCEDURAL.OVERRULED.toLocaleString().padStart(8)} (${((stats.treatmentStats.byType.PROCEDURAL.OVERRULED / stats.typeStats.totalProcedural) * 100).toFixed(1)}%)`);
  console.log(`      PROCEDURAL → CITED:         ${stats.treatmentStats.byType.PROCEDURAL.CITED.toLocaleString().padStart(8)} (${((stats.treatmentStats.byType.PROCEDURAL.CITED / stats.typeStats.totalProcedural) * 100).toFixed(1)}%)`);
  console.log(`      PROCEDURAL → UNCERTAIN:     ${stats.treatmentStats.byType.PROCEDURAL.UNCERTAIN.toLocaleString().padStart(8)} (${((stats.treatmentStats.byType.PROCEDURAL.UNCERTAIN / stats.typeStats.totalProcedural) * 100).toFixed(1)}%)`);
  console.log('');

  // ========================================
  // JURISDICTION DISTRIBUTION
  // ========================================
  console.log('🌍 JURISDICTION DISTRIBUTION');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`   Belgian (BE):       ${stats.jurisdictionStats.BE.toLocaleString().padStart(8)} (${((stats.jurisdictionStats.BE / stats.totalCitations) * 100).toFixed(1)}%)`);
  console.log(`   European (EU):      ${stats.jurisdictionStats.EU.toLocaleString().padStart(8)} (${((stats.jurisdictionStats.EU / stats.totalCitations) * 100).toFixed(1)}%)`);
  console.log(`   International (INT): ${stats.jurisdictionStats.INT.toLocaleString().padStart(7)} (${((stats.jurisdictionStats.INT / stats.totalCitations) * 100).toFixed(1)}%)`);
  console.log('');

  console.log('   By Type:');
  console.log(`      BE  → PRECEDENT:   ${stats.jurisdictionStats.byType.BE.PRECEDENT.toLocaleString().padStart(8)} (${((stats.jurisdictionStats.byType.BE.PRECEDENT / stats.jurisdictionStats.BE) * 100).toFixed(1)}% of BE)`);
  console.log(`      BE  → PROCEDURAL:  ${stats.jurisdictionStats.byType.BE.PROCEDURAL.toLocaleString().padStart(8)} (${((stats.jurisdictionStats.byType.BE.PROCEDURAL / stats.jurisdictionStats.BE) * 100).toFixed(1)}% of BE)`);
  console.log(`      EU  → PRECEDENT:   ${stats.jurisdictionStats.byType.EU.PRECEDENT.toLocaleString().padStart(8)} (${((stats.jurisdictionStats.byType.EU.PRECEDENT / stats.jurisdictionStats.EU) * 100).toFixed(1)}% of EU)`);
  console.log(`      EU  → PROCEDURAL:  ${stats.jurisdictionStats.byType.EU.PROCEDURAL.toLocaleString().padStart(8)} (${((stats.jurisdictionStats.byType.EU.PROCEDURAL / stats.jurisdictionStats.EU) * 100).toFixed(1)}% of EU)`);
  console.log(`      INT → PRECEDENT:   ${stats.jurisdictionStats.byType.INT.PRECEDENT.toLocaleString().padStart(8)} (${((stats.jurisdictionStats.byType.INT.PRECEDENT / stats.jurisdictionStats.INT) * 100).toFixed(1)}% of INT)`);
  console.log(`      INT → PROCEDURAL:  ${stats.jurisdictionStats.byType.INT.PROCEDURAL.toLocaleString().padStart(8)} (${((stats.jurisdictionStats.byType.INT.PROCEDURAL / stats.jurisdictionStats.INT) * 100).toFixed(1)}% of INT)`);
  console.log('');

  // ========================================
  // TOP COURTS
  // ========================================
  console.log('🏛️  TOP 20 MOST-CITED COURTS');
  console.log('─────────────────────────────────────────────────────────────────');
  const topCourts = stats.courtFrequencies.slice(0, 20);
  topCourts.forEach((court, index) => {
    const rank = `${index + 1}.`.padStart(3);
    const name = court.courtName.padEnd(45);
    const count = court.count.toLocaleString().padStart(6);
    const jurisdiction = `[${court.jurisdiction}]`;
    const types = `(P:${court.precedentCount} / R:${court.proceduralCount})`;
    console.log(`   ${rank} ${name} ${count} ${jurisdiction} ${types}`);
  });
  console.log('');

  // ========================================
  // TEMPORAL PATTERNS
  // ========================================
  console.log('📅 TEMPORAL PATTERNS');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`   Citations with Dates:    ${stats.temporalStats.citationsWithDates.toLocaleString()}`);
  console.log(`   Citations Missing Dates: ${stats.temporalStats.missingDateCount.toLocaleString()} (${stats.temporalStats.missingDatePercentage.toFixed(1)}%)`);
  console.log(`   Oldest Citation:         ${stats.temporalStats.oldestCitation || 'N/A'}`);
  console.log(`   Newest Citation:         ${stats.temporalStats.newestCitation || 'N/A'}`);
  console.log('');

  console.log('   Citations by Decade:');
  const decades = Object.keys(stats.temporalStats.byDecade).sort();
  for (const decade of decades) {
    const count = stats.temporalStats.byDecade[decade];
    const percentage = ((count / stats.temporalStats.citationsWithDates) * 100).toFixed(1);
    console.log(`      ${decade}: ${count.toLocaleString().padStart(8)} (${percentage}%)`);
  }
  console.log('');

  // ========================================
  // PER-DECISION METRICS
  // ========================================
  console.log('📈 PER-DECISION CITATION METRICS');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`   Decisions with 0 Citations:     ${stats.perDecisionMetrics.decisionsWithZeroCitations.toLocaleString()} (${((stats.perDecisionMetrics.decisionsWithZeroCitations / stats.totalDecisions) * 100).toFixed(1)}%)`);
  console.log(`   Decisions with ≥1 Citation:     ${stats.perDecisionMetrics.decisionsWithCitations.toLocaleString()} (${((stats.perDecisionMetrics.decisionsWithCitations / stats.totalDecisions) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`   Min Citations (non-zero):       ${stats.perDecisionMetrics.minCitations}`);
  console.log(`   Max Citations:                  ${stats.perDecisionMetrics.maxCitations}`);
  console.log(`   Average Citations:              ${stats.perDecisionMetrics.avgCitations.toFixed(2)}`);
  console.log(`   Median Citations:               ${stats.perDecisionMetrics.medianCitations.toFixed(1)}`);
  console.log('');

  console.log('   Distribution:');
  console.log(`      0 citations:      ${stats.perDecisionMetrics.distribution.zero.toLocaleString().padStart(8)} (${((stats.perDecisionMetrics.distribution.zero / stats.totalDecisions) * 100).toFixed(1)}%)`);
  console.log(`      1-5 citations:    ${stats.perDecisionMetrics.distribution.oneToFive.toLocaleString().padStart(8)} (${((stats.perDecisionMetrics.distribution.oneToFive / stats.totalDecisions) * 100).toFixed(1)}%)`);
  console.log(`      6-10 citations:   ${stats.perDecisionMetrics.distribution.sixToTen.toLocaleString().padStart(8)} (${((stats.perDecisionMetrics.distribution.sixToTen / stats.totalDecisions) * 100).toFixed(1)}%)`);
  console.log(`      11-20 citations:  ${stats.perDecisionMetrics.distribution.elevenToTwenty.toLocaleString().padStart(8)} (${((stats.perDecisionMetrics.distribution.elevenToTwenty / stats.totalDecisions) * 100).toFixed(1)}%)`);
  console.log(`      21+ citations:    ${stats.perDecisionMetrics.distribution.twentyOnePlus.toLocaleString().padStart(8)} (${((stats.perDecisionMetrics.distribution.twentyOnePlus / stats.totalDecisions) * 100).toFixed(1)}%)`);
  console.log('');

  console.log('   Top 10 Most-Citing Decisions:');
  stats.perDecisionMetrics.topCitingDecisions.forEach((d, index) => {
    const rank = `${index + 1}.`.padStart(4);
    const ecli = d.decision_id.padEnd(50);
    const total = `Total: ${d.citationCount}`.padEnd(12);
    const breakdown = `(P:${d.precedentCount} / R:${d.proceduralCount})`;
    console.log(`      ${rank} ${ecli} ${total} ${breakdown}`);
  });
  console.log('');

  // ========================================
  // DATA QUALITY
  // ========================================
  console.log('✅ DATA QUALITY METRICS');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(`   Total Citations:             ${stats.dataQuality.totalCitations.toLocaleString()}`);
  console.log(`   Missing ECLI:                ${stats.dataQuality.missingECLI.toLocaleString()} (${stats.dataQuality.missingECLIPercentage.toFixed(1)}%)`);
  console.log(`   Missing Case Number:         ${stats.dataQuality.missingCaseNumber.toLocaleString()} (${stats.dataQuality.missingCaseNumberPercentage.toFixed(1)}%)`);
  console.log(`   Missing Date:                ${stats.dataQuality.missingDate.toLocaleString()} (${stats.dataQuality.missingDatePercentage.toFixed(1)}%)`);
  console.log('');

  console.log('═══════════════════════════════════════════════════════════════════\n');
}

// ========================================
// MAIN ENTRY POINT
// ========================================

async function main(): Promise<void> {
  try {
    // Determine directory path
    let jsonsDir: string;

    if (process.argv.length > 2) {
      // Use provided path
      jsonsDir = process.argv[2];
    } else {
      // Default to latest extract-cited-decisions run
      const defaultDir = '/Users/shaharzep/knowledge-graph/full-data/extract-cited-decisions/2025-11-06T23-35-17-789Z/jsons';
      jsonsDir = defaultDir;
      console.log(`ℹ️  No directory provided, using default: ${defaultDir}`);
    }

    // Verify directory exists
    try {
      await fs.access(jsonsDir);
    } catch (error) {
      console.error(`\n❌ Error: Directory not found: ${jsonsDir}\n`);
      console.error('Usage: npm run analyze:citations [/path/to/jsons/directory]\n');
      process.exit(1);
    }

    // Load all decision files
    const decisions = await loadAllDecisionFiles(jsonsDir);

    if (decisions.length === 0) {
      console.error('\n❌ Error: No valid decision files found\n');
      process.exit(1);
    }

    // Analyze citations
    console.log('🔍 Analyzing citation statistics...\n');
    const stats = analyzeCitations(decisions);

    // Display results
    displayResults(stats);

    console.log('✅ Analysis complete!\n');
  } catch (error) {
    console.error('\n❌ Fatal Error:', error instanceof Error ? error.message : String(error));
    console.error(error instanceof Error && error.stack ? error.stack : '');
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
