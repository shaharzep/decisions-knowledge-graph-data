/**
 * Citation Statistics Analyzer
 *
 * Comprehensive statistical analysis for extracted cited decisions.
 * Analyzes type classification, treatment, jurisdiction, courts, temporal patterns, and per-decision metrics.
 */

// ========================================
// TYPE DEFINITIONS
// ========================================

export interface CitedDecision {
  decisionId: null;
  decisionSequence: number;
  courtJurisdictionCode: 'BE' | 'EU' | 'INT';
  courtName: string;
  date: string | null;
  caseNumber: string | null;
  ecli: string | null;
  treatment: 'FOLLOWED' | 'DISTINGUISHED' | 'OVERRULED' | 'CITED' | 'UNCERTAIN';
  type: 'PRECEDENT' | 'PROCEDURAL';
  internalDecisionId: string;
}

export interface DecisionFile {
  id: number;
  decision_id: string;
  language: string;
  decision_type_ecli_code: string;
  court_ecli_code: string;
  decision_date: string;
  md_length: number;
  length_category: string;
  citedDecisions: CitedDecision[];
}

export interface TypeStats {
  totalPrecedent: number;
  totalProcedural: number;
  decisionsWithPrecedent: number;
  decisionsWithProcedural: number;
  decisionsWithBoth: number;
  avgPrecedentPerDecision: number;
  avgProceduralPerDecision: number;
}

export interface TreatmentStats {
  FOLLOWED: number;
  DISTINGUISHED: number;
  OVERRULED: number;
  CITED: number;
  UNCERTAIN: number;
  byType: {
    PRECEDENT: {
      FOLLOWED: number;
      DISTINGUISHED: number;
      OVERRULED: number;
      CITED: number;
      UNCERTAIN: number;
    };
    PROCEDURAL: {
      FOLLOWED: number;
      DISTINGUISHED: number;
      OVERRULED: number;
      CITED: number;
      UNCERTAIN: number;
    };
  };
}

export interface JurisdictionStats {
  BE: number;
  EU: number;
  INT: number;
  byType: {
    BE: { PRECEDENT: number; PROCEDURAL: number };
    EU: { PRECEDENT: number; PROCEDURAL: number };
    INT: { PRECEDENT: number; PROCEDURAL: number };
  };
}

export interface CourtFrequency {
  courtName: string;
  count: number;
  jurisdiction: 'BE' | 'EU' | 'INT';
  precedentCount: number;
  proceduralCount: number;
}

export interface TemporalStats {
  byDecade: { [decade: string]: number };
  missingDateCount: number;
  missingDatePercentage: number;
  citationsWithDates: number;
  oldestCitation: string | null;
  newestCitation: string | null;
}

export interface PerDecisionMetrics {
  decisionsWithZeroCitations: number;
  decisionsWithCitations: number;
  minCitations: number;
  maxCitations: number;
  avgCitations: number;
  medianCitations: number;
  distribution: {
    zero: number;
    oneToFive: number;
    sixToTen: number;
    elevenToTwenty: number;
    twentyOnePlus: number;
  };
  topCitingDecisions: Array<{
    decision_id: string;
    citationCount: number;
    precedentCount: number;
    proceduralCount: number;
  }>;
}

export interface DataQualityMetrics {
  totalCitations: number;
  missingECLI: number;
  missingECLIPercentage: number;
  missingCaseNumber: number;
  missingCaseNumberPercentage: number;
  missingDate: number;
  missingDatePercentage: number;
}

export interface CitationStatistics {
  totalDecisions: number;
  totalCitations: number;
  typeStats: TypeStats;
  treatmentStats: TreatmentStats;
  jurisdictionStats: JurisdictionStats;
  courtFrequencies: CourtFrequency[];
  temporalStats: TemporalStats;
  perDecisionMetrics: PerDecisionMetrics;
  dataQuality: DataQualityMetrics;
}

// ========================================
// MAIN ANALYSIS FUNCTION
// ========================================

export function analyzeCitations(decisions: DecisionFile[]): CitationStatistics {
  const totalDecisions = decisions.length;
  const totalCitations = decisions.reduce((sum, d) => sum + d.citedDecisions.length, 0);

  return {
    totalDecisions,
    totalCitations,
    typeStats: calculateTypeDistribution(decisions),
    treatmentStats: calculateTreatmentDistribution(decisions),
    jurisdictionStats: calculateJurisdictionDistribution(decisions),
    courtFrequencies: calculateCourtFrequencies(decisions),
    temporalStats: calculateTemporalPatterns(decisions),
    perDecisionMetrics: calculatePerDecisionMetrics(decisions),
    dataQuality: calculateDataQualityMetrics(decisions),
  };
}

// ========================================
// TYPE DISTRIBUTION
// ========================================

export function calculateTypeDistribution(decisions: DecisionFile[]): TypeStats {
  let totalPrecedent = 0;
  let totalProcedural = 0;
  let decisionsWithPrecedent = 0;
  let decisionsWithProcedural = 0;
  let decisionsWithBoth = 0;

  for (const decision of decisions) {
    let hasPrecedent = false;
    let hasProcedural = false;

    for (const citation of decision.citedDecisions) {
      if (citation.type === 'PRECEDENT') {
        totalPrecedent++;
        hasPrecedent = true;
      } else if (citation.type === 'PROCEDURAL') {
        totalProcedural++;
        hasProcedural = true;
      }
    }

    if (hasPrecedent) decisionsWithPrecedent++;
    if (hasProcedural) decisionsWithProcedural++;
    if (hasPrecedent && hasProcedural) decisionsWithBoth++;
  }

  return {
    totalPrecedent,
    totalProcedural,
    decisionsWithPrecedent,
    decisionsWithProcedural,
    decisionsWithBoth,
    avgPrecedentPerDecision: totalPrecedent / decisions.length,
    avgProceduralPerDecision: totalProcedural / decisions.length,
  };
}

// ========================================
// TREATMENT DISTRIBUTION
// ========================================

export function calculateTreatmentDistribution(decisions: DecisionFile[]): TreatmentStats {
  const stats: TreatmentStats = {
    FOLLOWED: 0,
    DISTINGUISHED: 0,
    OVERRULED: 0,
    CITED: 0,
    UNCERTAIN: 0,
    byType: {
      PRECEDENT: {
        FOLLOWED: 0,
        DISTINGUISHED: 0,
        OVERRULED: 0,
        CITED: 0,
        UNCERTAIN: 0,
      },
      PROCEDURAL: {
        FOLLOWED: 0,
        DISTINGUISHED: 0,
        OVERRULED: 0,
        CITED: 0,
        UNCERTAIN: 0,
      },
    },
  };

  for (const decision of decisions) {
    for (const citation of decision.citedDecisions) {
      // Overall treatment count
      stats[citation.treatment]++;

      // Treatment by type
      stats.byType[citation.type][citation.treatment]++;
    }
  }

  return stats;
}

// ========================================
// JURISDICTION DISTRIBUTION
// ========================================

export function calculateJurisdictionDistribution(decisions: DecisionFile[]): JurisdictionStats {
  const stats: JurisdictionStats = {
    BE: 0,
    EU: 0,
    INT: 0,
    byType: {
      BE: { PRECEDENT: 0, PROCEDURAL: 0 },
      EU: { PRECEDENT: 0, PROCEDURAL: 0 },
      INT: { PRECEDENT: 0, PROCEDURAL: 0 },
    },
  };

  for (const decision of decisions) {
    for (const citation of decision.citedDecisions) {
      const jurisdiction = citation.courtJurisdictionCode;
      const type = citation.type;

      stats[jurisdiction]++;
      stats.byType[jurisdiction][type]++;
    }
  }

  return stats;
}

// ========================================
// COURT FREQUENCIES
// ========================================

export function calculateCourtFrequencies(decisions: DecisionFile[]): CourtFrequency[] {
  const courtMap = new Map<string, CourtFrequency>();

  for (const decision of decisions) {
    for (const citation of decision.citedDecisions) {
      const key = `${citation.courtName}|${citation.courtJurisdictionCode}`;

      if (!courtMap.has(key)) {
        courtMap.set(key, {
          courtName: citation.courtName,
          count: 0,
          jurisdiction: citation.courtJurisdictionCode,
          precedentCount: 0,
          proceduralCount: 0,
        });
      }

      const court = courtMap.get(key)!;
      court.count++;

      if (citation.type === 'PRECEDENT') {
        court.precedentCount++;
      } else {
        court.proceduralCount++;
      }
    }
  }

  // Sort by count descending
  return Array.from(courtMap.values()).sort((a, b) => b.count - a.count);
}

// ========================================
// TEMPORAL PATTERNS
// ========================================

export function calculateTemporalPatterns(decisions: DecisionFile[]): TemporalStats {
  const byDecade: { [decade: string]: number } = {};
  let missingDateCount = 0;
  let citationsWithDates = 0;
  let oldestCitation: string | null = null;
  let newestCitation: string | null = null;

  for (const decision of decisions) {
    for (const citation of decision.citedDecisions) {
      if (!citation.date) {
        missingDateCount++;
        continue;
      }

      citationsWithDates++;

      // Extract year and decade
      const year = parseInt(citation.date.substring(0, 4));
      const decade = Math.floor(year / 10) * 10;
      const decadeKey = `${decade}s`;

      byDecade[decadeKey] = (byDecade[decadeKey] || 0) + 1;

      // Track oldest and newest
      if (!oldestCitation || citation.date < oldestCitation) {
        oldestCitation = citation.date;
      }
      if (!newestCitation || citation.date > newestCitation) {
        newestCitation = citation.date;
      }
    }
  }

  const totalCitations = citationsWithDates + missingDateCount;

  return {
    byDecade,
    missingDateCount,
    missingDatePercentage: totalCitations > 0 ? (missingDateCount / totalCitations) * 100 : 0,
    citationsWithDates,
    oldestCitation,
    newestCitation,
  };
}

// ========================================
// PER-DECISION METRICS
// ========================================

export function calculatePerDecisionMetrics(decisions: DecisionFile[]): PerDecisionMetrics {
  const citationCounts = decisions.map((d) => d.citedDecisions.length);

  const decisionsWithZeroCitations = citationCounts.filter((c) => c === 0).length;
  const decisionsWithCitations = citationCounts.filter((c) => c > 0).length;

  const minCitations = Math.min(...citationCounts);
  const maxCitations = Math.max(...citationCounts);
  const avgCitations = citationCounts.reduce((sum, c) => sum + c, 0) / citationCounts.length;

  // Calculate median
  const sorted = [...citationCounts].sort((a, b) => a - b);
  const medianCitations =
    sorted.length % 2 === 0
      ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
      : sorted[Math.floor(sorted.length / 2)];

  // Distribution buckets
  const distribution = {
    zero: 0,
    oneToFive: 0,
    sixToTen: 0,
    elevenToTwenty: 0,
    twentyOnePlus: 0,
  };

  for (const count of citationCounts) {
    if (count === 0) distribution.zero++;
    else if (count <= 5) distribution.oneToFive++;
    else if (count <= 10) distribution.sixToTen++;
    else if (count <= 20) distribution.elevenToTwenty++;
    else distribution.twentyOnePlus++;
  }

  // Top citing decisions
  const decisionsWithCounts = decisions.map((d) => ({
    decision_id: d.decision_id,
    citationCount: d.citedDecisions.length,
    precedentCount: d.citedDecisions.filter((c) => c.type === 'PRECEDENT').length,
    proceduralCount: d.citedDecisions.filter((c) => c.type === 'PROCEDURAL').length,
  }));

  const topCitingDecisions = decisionsWithCounts
    .filter((d) => d.citationCount > 0)
    .sort((a, b) => b.citationCount - a.citationCount)
    .slice(0, 10);

  return {
    decisionsWithZeroCitations,
    decisionsWithCitations,
    minCitations,
    maxCitations,
    avgCitations,
    medianCitations,
    distribution,
    topCitingDecisions,
  };
}

// ========================================
// DATA QUALITY METRICS
// ========================================

export function calculateDataQualityMetrics(decisions: DecisionFile[]): DataQualityMetrics {
  let totalCitations = 0;
  let missingECLI = 0;
  let missingCaseNumber = 0;
  let missingDate = 0;

  for (const decision of decisions) {
    for (const citation of decision.citedDecisions) {
      totalCitations++;

      if (citation.ecli === null) missingECLI++;
      if (citation.caseNumber === null) missingCaseNumber++;
      if (citation.date === null) missingDate++;
    }
  }

  return {
    totalCitations,
    missingECLI,
    missingECLIPercentage: totalCitations > 0 ? (missingECLI / totalCitations) * 100 : 0,
    missingCaseNumber,
    missingCaseNumberPercentage: totalCitations > 0 ? (missingCaseNumber / totalCitations) * 100 : 0,
    missingDate,
    missingDatePercentage: totalCitations > 0 ? (missingDate / totalCitations) * 100 : 0,
  };
}
