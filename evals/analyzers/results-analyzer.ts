/**
 * Results Analyzer
 *
 * Aggregates and analyzes experiment results by metadata dimensions
 */

import {
  ExperimentEvaluation,
  DimensionBreakdown,
  DimensionGroupStats,
  AnalysisReport,
} from '../types.js';

/**
 * Aggregate evaluations by a metadata dimension
 *
 * Groups evaluations by a specific dimension (e.g., "courtEcliCode")
 * and calculates statistics for each group.
 *
 * @param evaluations - Array of experiment evaluations
 * @param dimension - Metadata dimension field name (e.g., "courtEcliCode")
 * @returns Dimension breakdown with stats per group
 */
export function aggregateByDimension(
  evaluations: ExperimentEvaluation[],
  dimension: keyof ExperimentEvaluation
): DimensionBreakdown {
  // Group evaluations by dimension value
  const groups = new Map<string, ExperimentEvaluation[]>();

  for (const evaluation of evaluations) {
    const value = evaluation[dimension];
    const key = value ? String(value) : 'Unknown';

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(evaluation);
  }

  // Calculate stats for each group
  const groupStats: DimensionGroupStats[] = [];

  for (const [label, groupEvals] of groups.entries()) {
    const count = groupEvals.length;

    // Calculate averages
    const avgScore =
      groupEvals.reduce((sum, e) => sum + e.overallScore, 0) / count;
    const avgCriticalIssues =
      groupEvals.reduce((sum, e) => sum + e.criticalIssuesCount, 0) / count;
    const avgMajorIssues =
      groupEvals.reduce((sum, e) => sum + e.majorIssuesCount, 0) / count;
    const avgMinorIssues =
      groupEvals.reduce((sum, e) => sum + e.minorIssuesCount, 0) / count;

    // Calculate verdict rates
    const passCount = groupEvals.filter((e) => e.verdict === 'PASS').length;
    const failCount = groupEvals.filter((e) => e.verdict === 'FAIL').length;
    const reviewCount = groupEvals.filter(
      (e) => e.verdict === 'REVIEW_REQUIRED'
    ).length;

    const passRate = (passCount / count) * 100;
    const failRate = (failCount / count) * 100;
    const reviewRate = (reviewCount / count) * 100;

    groupStats.push({
      label,
      count,
      avgScore,
      passRate,
      failRate,
      reviewRate,
      avgCriticalIssues,
      avgMajorIssues,
      avgMinorIssues,
    });
  }

  // Sort by count (descending)
  groupStats.sort((a, b) => b.count - a.count);

  return {
    dimension: String(dimension),
    groups: groupStats,
  };
}

/**
 * Analyze experiment results across all dimensions
 *
 * Runs aggregation across language, court, decision type, and length.
 * Also calculates overall experiment statistics.
 *
 * @param evaluations - Array of experiment evaluations
 * @param experimentId - Experiment identifier
 * @returns Complete analysis report
 */
export function analyzeExperiment(
  evaluations: ExperimentEvaluation[],
  experimentId: string
): AnalysisReport {
  console.log(`\n📊 Analyzing ${evaluations.length} evaluations...\n`);

  const total = evaluations.length;

  // Calculate overall stats
  const avgScore =
    evaluations.reduce((sum, e) => sum + e.overallScore, 0) / total;

  const passCount = evaluations.filter((e) => e.verdict === 'PASS').length;
  const failCount = evaluations.filter((e) => e.verdict === 'FAIL').length;
  const reviewCount = evaluations.filter(
    (e) => e.verdict === 'REVIEW_REQUIRED'
  ).length;

  const passRate = (passCount / total) * 100;
  const failRate = (failCount / total) * 100;
  const reviewRate = (reviewCount / total) * 100;

  // Aggregate by dimensions
  const byLanguage = aggregateByDimension(evaluations, 'language');
  const byCourt = aggregateByDimension(evaluations, 'courtEcliCode');
  const byDecisionType = aggregateByDimension(
    evaluations,
    'decisionTypeEcliCode'
  );
  const byLength = aggregateByDimension(evaluations, 'lengthCategory');

  console.log(`✅ Analysis complete\n`);

  return {
    experimentId,
    totalEvaluations: total,
    overallStats: {
      avgScore,
      passRate,
      failRate,
      reviewRate,
      passCount,
      failCount,
      reviewCount,
    },
    byLanguage,
    byCourt,
    byDecisionType,
    byLength,
    generatedAt: new Date().toISOString(),
  };
}
