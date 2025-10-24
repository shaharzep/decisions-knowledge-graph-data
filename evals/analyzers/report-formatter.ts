/**
 * Report Formatter
 *
 * Formats analysis reports for console output
 */

import { AnalysisReport, DimensionBreakdown } from '../types.js';

/**
 * Format analysis report for console display
 *
 * Creates a formatted string with overall stats and dimension breakdowns.
 *
 * @param report - Complete analysis report
 * @returns Formatted string for console output
 */
export function formatAnalysisReport(report: AnalysisReport): string {
  const lines: string[] = [];

  // Header
  lines.push('');
  lines.push('━'.repeat(80));
  lines.push(`📊 Experiment Analysis: ${report.experimentId}`);
  lines.push('━'.repeat(80));
  lines.push('');

  // Overall Stats
  lines.push('Overall Statistics:');
  lines.push(`  Total Evaluations: ${report.totalEvaluations}`);
  lines.push(`  Average Score: ${report.overallStats.avgScore.toFixed(1)}/100`);
  lines.push('');
  lines.push('  Verdict Distribution:');
  lines.push(
    `    ✅ PASS: ${report.overallStats.passCount} (${report.overallStats.passRate.toFixed(1)}%)`
  );
  lines.push(
    `    ❌ FAIL: ${report.overallStats.failCount} (${report.overallStats.failRate.toFixed(1)}%)`
  );
  lines.push(
    `    ⚠️  REVIEW REQUIRED: ${report.overallStats.reviewCount} (${report.overallStats.reviewRate.toFixed(1)}%)`
  );
  lines.push('');

  // Dimension breakdowns
  lines.push('━'.repeat(80));
  lines.push('');

  // Language breakdown
  lines.push(formatDimensionBreakdown('Language', report.byLanguage));
  lines.push('');

  // Court breakdown
  lines.push(formatDimensionBreakdown('Court (ECLI Code)', report.byCourt));
  lines.push('');

  // Decision type breakdown
  lines.push(
    formatDimensionBreakdown('Decision Type', report.byDecisionType)
  );
  lines.push('');

  // Length breakdown
  lines.push(formatDimensionBreakdown('Length Category', report.byLength));
  lines.push('');

  // Footer
  lines.push('━'.repeat(80));
  lines.push(`Generated at: ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push('━'.repeat(80));
  lines.push('');

  return lines.join('\n');
}

/**
 * Format a single dimension breakdown as a table
 *
 * Creates an ASCII table showing stats for each group in the dimension.
 *
 * @param dimensionLabel - Human-readable dimension name
 * @param breakdown - Dimension breakdown data
 * @returns Formatted table string
 */
export function formatDimensionBreakdown(
  dimensionLabel: string,
  breakdown: DimensionBreakdown
): string {
  const lines: string[] = [];

  lines.push(`Breakdown by ${dimensionLabel}:`);
  lines.push('');

  if (breakdown.groups.length === 0) {
    lines.push('  (No data available)');
    return lines.join('\n');
  }

  // Calculate column widths
  const labelWidth = Math.max(
    15,
    ...breakdown.groups.map((g) => g.label.length)
  );
  const countWidth = 7;
  const scoreWidth = 12;
  const passRateWidth = 12;
  const issuesWidth = 18;

  // Header
  const headerLine = [
    padRight(dimensionLabel, labelWidth),
    padRight('Count', countWidth),
    padRight('Avg Score', scoreWidth),
    padRight('Pass Rate', passRateWidth),
    padRight('Avg Issues (C/M/m)', issuesWidth),
  ].join(' │ ');

  lines.push('  ┌' + '─'.repeat(headerLine.length - 2) + '┐');
  lines.push('  │' + headerLine + '│');
  lines.push('  ├' + '─'.repeat(headerLine.length - 2) + '┤');

  // Rows
  for (const group of breakdown.groups) {
    const issuesStr = `${group.avgCriticalIssues.toFixed(1)}/${group.avgMajorIssues.toFixed(1)}/${group.avgMinorIssues.toFixed(1)}`;

    const row = [
      padRight(group.label, labelWidth),
      padRight(String(group.count), countWidth),
      padRight(`${group.avgScore.toFixed(1)}/100`, scoreWidth),
      padRight(`${group.passRate.toFixed(1)}%`, passRateWidth),
      padRight(issuesStr, issuesWidth),
    ].join(' │ ');

    lines.push('  │' + row + '│');
  }

  // Footer
  lines.push('  └' + '─'.repeat(headerLine.length - 2) + '┘');

  return lines.join('\n');
}

/**
 * Pad string to right with spaces
 */
function padRight(str: string, width: number): string {
  if (str.length >= width) {
    return str.substring(0, width);
  }
  return str + ' '.repeat(width - str.length);
}

/**
 * Format analysis report as JSON
 *
 * Saves the report as a JSON file for programmatic access.
 *
 * @param report - Complete analysis report
 * @returns JSON string
 */
export function formatAsJson(report: AnalysisReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Format analysis report as Markdown
 *
 * Creates a clean, presentable markdown document with the analysis results.
 *
 * @param report - Complete analysis report
 * @returns Markdown string
 */
export function formatAsMarkdown(report: AnalysisReport): string {
  const lines: string[] = [];

  // Title
  lines.push(`# Experiment Analysis Report`);
  lines.push('');
  lines.push(`**Experiment ID:** \`${report.experimentId}\``);
  lines.push(`**Generated:** ${new Date(report.generatedAt).toLocaleString()}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // Overall Statistics
  lines.push('## Overall Statistics');
  lines.push('');
  lines.push(`- **Total Evaluations:** ${report.totalEvaluations}`);
  lines.push(`- **Average Score:** ${report.overallStats.avgScore.toFixed(1)}/100`);
  lines.push('');
  lines.push('### Verdict Distribution');
  lines.push('');
  lines.push('| Verdict | Count | Percentage |');
  lines.push('|---------|-------|------------|');
  lines.push(
    `| ✅ PASS | ${report.overallStats.passCount} | ${report.overallStats.passRate.toFixed(1)}% |`
  );
  lines.push(
    `| ❌ FAIL | ${report.overallStats.failCount} | ${report.overallStats.failRate.toFixed(1)}% |`
  );
  lines.push(
    `| ⚠️ REVIEW REQUIRED | ${report.overallStats.reviewCount} | ${report.overallStats.reviewRate.toFixed(1)}% |`
  );
  lines.push('');
  lines.push('---');
  lines.push('');

  // Language Breakdown
  lines.push('## Breakdown by Language');
  lines.push('');
  lines.push(formatDimensionAsMarkdownTable(report.byLanguage));
  lines.push('');

  // Court Breakdown
  lines.push('## Breakdown by Court');
  lines.push('');
  lines.push(formatDimensionAsMarkdownTable(report.byCourt));
  lines.push('');

  // Decision Type Breakdown
  lines.push('## Breakdown by Decision Type');
  lines.push('');
  lines.push(formatDimensionAsMarkdownTable(report.byDecisionType));
  lines.push('');

  // Length Category Breakdown
  lines.push('## Breakdown by Length Category');
  lines.push('');
  lines.push(formatDimensionAsMarkdownTable(report.byLength));
  lines.push('');

  // Footer
  lines.push('---');
  lines.push('');
  lines.push('*Report generated by Braintrust Experiment Analyzer*');
  lines.push('');

  return lines.join('\n');
}

/**
 * Format dimension breakdown as markdown table
 *
 * @param breakdown - Dimension breakdown data
 * @returns Markdown table string
 */
function formatDimensionAsMarkdownTable(breakdown: DimensionBreakdown): string {
  const lines: string[] = [];

  if (breakdown.groups.length === 0) {
    lines.push('*No data available*');
    return lines.join('\n');
  }

  // Header
  lines.push(
    '| Value | Count | Avg Score | Pass Rate | Critical Issues | Major Issues | Minor Issues |'
  );
  lines.push(
    '|-------|-------|-----------|-----------|-----------------|--------------|--------------|'
  );

  // Rows
  for (const group of breakdown.groups) {
    const row = [
      group.label,
      String(group.count),
      `${group.avgScore.toFixed(1)}/100`,
      `${group.passRate.toFixed(1)}%`,
      group.avgCriticalIssues.toFixed(1),
      group.avgMajorIssues.toFixed(1),
      group.avgMinorIssues.toFixed(1),
    ].join(' | ');

    lines.push(`| ${row} |`);
  }

  return lines.join('\n');
}
