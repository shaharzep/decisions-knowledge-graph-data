#!/usr/bin/env node

/**
 * Full-Data Extraction Analysis
 *
 * Analyzes extraction quality across full-data results by validating:
 * - Length vs arguments correlation (longer decisions → more arguments)
 * - Court order coverage (should be 100%)
 * - Statistics breakdown by length category
 */

import fs from 'fs/promises';
import path from 'path';

/**
 * Metrics extracted from each decision
 */
interface DecisionMetrics {
  decision_id: string;
  language: string;
  md_length: number;
  length_category: string;
  arguments_count: number;
  has_courtOrder: boolean;
  courtOrder_length: number;
  requests_count: number;
  parties_count: number;
  file_path: string;
}

/**
 * Statistical summary for numeric data
 */
interface Stats {
  min: number;
  max: number;
  avg: number;
  median: number;
  p25: number;
  p75: number;
}

/**
 * Category-level statistics
 */
interface CategoryStats {
  count: number;
  md_length: Stats;
  arguments: Stats;
  requests: Stats;
  parties: Stats;
  courtOrder_coverage: number;
  courtOrder_missing: number;
}

/**
 * Correlation analysis results
 */
interface CorrelationAnalysis {
  md_length_vs_arguments: number;
  md_length_vs_requests: number;
  interpretation: string;
}

/**
 * Court order validation results
 */
interface CourtOrderValidation {
  total: number;
  present: number;
  missing: number;
  coverage: number;
  missing_decisions: Array<{
    decision_id: string;
    language: string;
    md_length: number;
    file_path: string;
  }>;
}

/**
 * Complete analysis report
 */
interface AnalysisReport {
  metadata: {
    jobType: string;
    timestamp: string;
    totalDecisions: number;
    analyzedAt: string;
  };
  byLengthCategory: Record<string, CategoryStats>;
  correlation: CorrelationAnalysis;
  courtOrder: CourtOrderValidation;
  raw_metrics?: DecisionMetrics[];
}

/**
 * Find latest full-data directory for job type
 */
async function findLatestFullDataDirectory(jobType: string): Promise<string> {
  const fullDataBase = path.join(process.cwd(), 'full-data', jobType);

  try {
    const entries = await fs.readdir(fullDataBase, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    if (directories.length === 0) {
      throw new Error(`No full-data directories found for ${jobType}`);
    }

    const latest = directories[directories.length - 1];
    return path.join(fullDataBase, latest);
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `No full-data directory found for job type '${jobType}'.\n` +
        `Expected directory: ${fullDataBase}\n` +
        `Please run: npm run dev concurrent ${jobType} (with useFullDataPipeline: true)`
      );
    }
    throw error;
  }
}

/**
 * Load all JSON files from full-data directory
 */
async function loadFullDataResults(
  jobType: string,
  timestamp?: string
): Promise<Array<{ filePath: string; data: any }>> {
  let fullDataDir: string;

  if (timestamp) {
    fullDataDir = path.join(process.cwd(), 'full-data', jobType, timestamp);
  } else {
    fullDataDir = await findLatestFullDataDirectory(jobType);
  }

  const jsonsDir = path.join(fullDataDir, 'jsons');

  console.log(`📂 Loading JSONs from: ${jsonsDir}\n`);

  try {
    await fs.access(jsonsDir);
  } catch {
    throw new Error(
      `JSONs directory not found: ${jsonsDir}\n` +
      `Expected structure: full-data/${jobType}/<timestamp>/jsons/`
    );
  }

  const files = await fs.readdir(jsonsDir);
  const jsonFiles = files.filter((f) => f.endsWith('.json'));

  console.log(`Found ${jsonFiles.length} JSON files\n`);

  const results: Array<{ filePath: string; data: any }> = [];

  for (const file of jsonFiles) {
    const filePath = path.join(jsonsDir, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      results.push({ filePath, data });
    } catch (error) {
      console.warn(`⚠️  Failed to parse ${file}: ${error}`);
    }
  }

  return results;
}

/**
 * Extract metrics from a single decision
 */
function extractMetrics(decision: any, filePath: string): DecisionMetrics {
  const arguments_count = decision.currentInstance?.arguments?.length || 0;
  const requests_count = decision.currentInstance?.requests?.length || 0;
  const parties_count = decision.parties?.length || 0;
  const courtOrder = decision.currentInstance?.courtOrder;
  const has_courtOrder = !!courtOrder && courtOrder.trim().length > 0;

  return {
    decision_id: decision.decision_id || decision.decisionId || 'unknown',
    language: decision.language_metadata || decision.language || 'unknown',
    md_length: decision.md_length || 0,
    length_category: decision.length_category || 'UNKNOWN',
    arguments_count,
    has_courtOrder,
    courtOrder_length: courtOrder?.length || 0,
    requests_count,
    parties_count,
    file_path: filePath,
  };
}

/**
 * Calculate statistics for an array of numbers
 */
function calculateStats(values: number[]): Stats {
  if (values.length === 0) {
    return { min: 0, max: 0, avg: 0, median: 0, p25: 0, p75: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const sum = values.reduce((acc, val) => acc + val, 0);

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: sum / values.length,
    median: sorted[Math.floor(sorted.length / 2)],
    p25: sorted[Math.floor(sorted.length * 0.25)],
    p75: sorted[Math.floor(sorted.length * 0.75)],
  };
}

/**
 * Aggregate metrics by length category
 */
function aggregateByLengthCategory(
  metrics: DecisionMetrics[]
): Record<string, CategoryStats> {
  const grouped: Record<string, DecisionMetrics[]> = {};

  for (const metric of metrics) {
    const category = metric.length_category;
    if (!grouped[category]) {
      grouped[category] = [];
    }
    grouped[category].push(metric);
  }

  const result: Record<string, CategoryStats> = {};

  for (const [category, items] of Object.entries(grouped)) {
    const md_lengths = items.map((m) => m.md_length);
    const arguments_counts = items.map((m) => m.arguments_count);
    const requests_counts = items.map((m) => m.requests_count);
    const parties_counts = items.map((m) => m.parties_count);
    const courtOrders_missing = items.filter((m) => !m.has_courtOrder).length;

    result[category] = {
      count: items.length,
      md_length: calculateStats(md_lengths),
      arguments: calculateStats(arguments_counts),
      requests: calculateStats(requests_counts),
      parties: calculateStats(parties_counts),
      courtOrder_coverage: ((items.length - courtOrders_missing) / items.length) * 100,
      courtOrder_missing: courtOrders_missing,
    };
  }

  return result;
}

/**
 * Calculate Pearson correlation coefficient
 */
function calculateCorrelation(x: number[], y: number[]): number {
  if (x.length !== y.length || x.length === 0) {
    return 0;
  }

  const n = x.length;
  const sumX = x.reduce((acc, val) => acc + val, 0);
  const sumY = y.reduce((acc, val) => acc + val, 0);
  const sumXY = x.reduce((acc, val, i) => acc + val * y[i], 0);
  const sumX2 = x.reduce((acc, val) => acc + val * val, 0);
  const sumY2 = y.reduce((acc, val) => acc + val * val, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * Analyze correlation between length and extracted fields
 */
function analyzeCorrelation(metrics: DecisionMetrics[]): CorrelationAnalysis {
  const md_lengths = metrics.map((m) => m.md_length);
  const arguments_counts = metrics.map((m) => m.arguments_count);
  const requests_counts = metrics.map((m) => m.requests_count);

  const lengthVsArguments = calculateCorrelation(md_lengths, arguments_counts);
  const lengthVsRequests = calculateCorrelation(md_lengths, requests_counts);

  let interpretation = '';
  if (lengthVsArguments > 0.7) {
    interpretation = 'Strong positive correlation - longer decisions have more arguments ✅';
  } else if (lengthVsArguments > 0.4) {
    interpretation = 'Moderate positive correlation - some relationship between length and arguments';
  } else {
    interpretation = 'Weak correlation - length may not predict argument count ⚠️';
  }

  return {
    md_length_vs_arguments: lengthVsArguments,
    md_length_vs_requests: lengthVsRequests,
    interpretation,
  };
}

/**
 * Validate court order presence
 */
function validateCourtOrders(metrics: DecisionMetrics[]): CourtOrderValidation {
  const total = metrics.length;
  const missing = metrics.filter((m) => !m.has_courtOrder);
  const present = total - missing.length;

  return {
    total,
    present,
    missing: missing.length,
    coverage: (present / total) * 100,
    missing_decisions: missing.map((m) => ({
      decision_id: m.decision_id,
      language: m.language,
      md_length: m.md_length,
      file_path: m.file_path,
    })),
  };
}

/**
 * Format stats for display
 */
function formatStats(stats: Stats, decimals: number = 1): string {
  return `avg: ${stats.avg.toFixed(decimals)}, range: ${stats.min}-${stats.max}, median: ${stats.median.toFixed(decimals)}`;
}

/**
 * Generate formatted console report
 */
function generateReport(analysis: AnalysisReport): void {
  console.log('\n📊 Full-Data Extraction Analysis');
  console.log('================================\n');

  console.log(`Dataset: ${analysis.metadata.jobType}`);
  console.log(`Timestamp: ${analysis.metadata.timestamp}`);
  console.log(`Total Decisions: ${analysis.metadata.totalDecisions.toLocaleString()}`);
  console.log(`Analyzed: ${analysis.metadata.analyzedAt}\n`);

  console.log('📏 LENGTH CATEGORY BREAKDOWN');
  console.log('───────────────────────────────\n');

  const categoryOrder = ['SHORT', 'MEDIUM', 'LONG', 'VERY_LONG'];
  const sortedCategories = Object.keys(analysis.byLengthCategory).sort((a, b) => {
    const indexA = categoryOrder.indexOf(a);
    const indexB = categoryOrder.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });

  for (const category of sortedCategories) {
    const stats = analysis.byLengthCategory[category];
    const coverageIcon = stats.courtOrder_coverage === 100 ? '✅' : '⚠️';

    console.log(`${category}`);
    console.log(`  Count: ${stats.count} decisions`);
    console.log(`  MD Length: ${formatStats(stats.md_length, 0)} chars`);
    console.log(`  Arguments: ${formatStats(stats.arguments)}`);
    console.log(`  Requests: ${formatStats(stats.requests)}`);
    console.log(`  Parties: ${formatStats(stats.parties)}`);
    console.log(`  Court Order Coverage: ${stats.courtOrder_coverage.toFixed(2)}% ${coverageIcon}`);
    if (stats.courtOrder_missing > 0) {
      console.log(`  Missing Court Orders: ${stats.courtOrder_missing}`);
    }
    console.log('');
  }

  console.log('📈 CORRELATION ANALYSIS');
  console.log('───────────────────────────────');
  console.log(`MD Length ↔ Arguments Count: ${analysis.correlation.md_length_vs_arguments.toFixed(3)}`);
  console.log(`MD Length ↔ Requests Count: ${analysis.correlation.md_length_vs_requests.toFixed(3)}`);
  console.log(`\n${analysis.correlation.interpretation}\n`);

  console.log('⚖️  COURT ORDER VALIDATION');
  console.log('───────────────────────────────');
  console.log(`Total: ${analysis.courtOrder.total.toLocaleString()}`);
  console.log(`Present: ${analysis.courtOrder.present.toLocaleString()} ✅`);
  console.log(`Missing: ${analysis.courtOrder.missing.toLocaleString()} ${analysis.courtOrder.missing > 0 ? '⚠️' : '✅'}`);
  console.log(`Coverage: ${analysis.courtOrder.coverage.toFixed(2)}%\n`);

  if (analysis.courtOrder.missing_decisions.length > 0) {
    console.log('Missing Court Orders:');
    const showCount = Math.min(10, analysis.courtOrder.missing_decisions.length);
    for (let i = 0; i < showCount; i++) {
      const decision = analysis.courtOrder.missing_decisions[i];
      console.log(`  - ${decision.decision_id} (${decision.language}, ${decision.md_length.toLocaleString()} chars)`);
    }
    if (analysis.courtOrder.missing_decisions.length > 10) {
      console.log(`  ... and ${analysis.courtOrder.missing_decisions.length - 10} more`);
    }
    console.log('');
  }
}

/**
 * Export analysis report to JSON file
 */
async function exportReport(analysis: AnalysisReport, outputPath: string): Promise<void> {
  await fs.writeFile(outputPath, JSON.stringify(analysis, null, 2), 'utf-8');
  console.log(`💾 Report exported to: ${outputPath}\n`);
}

/**
 * Main analysis function
 */
async function analyzeFullData(
  jobType: string,
  options: {
    timestamp?: string;
    outputFile?: string;
    includeRawMetrics?: boolean;
  } = {}
): Promise<AnalysisReport> {
  console.log(`\n🔍 Analyzing full-data for ${jobType}...\n`);

  // Load all JSONs
  const results = await loadFullDataResults(jobType, options.timestamp);

  if (results.length === 0) {
    throw new Error('No JSON files found to analyze');
  }

  // Extract metrics from each decision
  console.log('📊 Extracting metrics...\n');
  const metrics = results.map((r) => extractMetrics(r.data, r.filePath));

  // Build analysis report
  const timestamp = options.timestamp || path.basename(await findLatestFullDataDirectory(jobType));

  const analysis: AnalysisReport = {
    metadata: {
      jobType,
      timestamp,
      totalDecisions: metrics.length,
      analyzedAt: new Date().toISOString(),
    },
    byLengthCategory: aggregateByLengthCategory(metrics),
    correlation: analyzeCorrelation(metrics),
    courtOrder: validateCourtOrders(metrics),
  };

  if (options.includeRawMetrics) {
    analysis.raw_metrics = metrics;
  }

  // Generate console report
  generateReport(analysis);

  // Export if requested
  if (options.outputFile) {
    await exportReport(analysis, options.outputFile);
  }

  return analysis;
}

/**
 * CLI entry point
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
Full-Data Extraction Analysis

USAGE:
  npm run analyze-full-data <job-type> [options]

OPTIONS:
  --timestamp <ts>     Analyze specific timestamp
  --output <file>      Export report to JSON file
  --include-raw        Include raw metrics in JSON export

EXAMPLES:
  npm run analyze-full-data extract-comprehensive
  npm run analyze-full-data extract-comprehensive --timestamp 2025-10-25T06-02-48-674Z
  npm run analyze-full-data extract-comprehensive --output report.json
  npm run analyze-full-data extract-comprehensive --output report.json --include-raw
`);
    return;
  }

  const jobType = args[0];
  const options: any = {};

  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--timestamp' && args[i + 1]) {
      options.timestamp = args[i + 1];
      i++;
    } else if (args[i] === '--output' && args[i + 1]) {
      options.outputFile = args[i + 1];
      i++;
    } else if (args[i] === '--include-raw') {
      options.includeRawMetrics = true;
    }
  }

  try {
    await analyzeFullData(jobType, options);
  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

// Run CLI
main();
