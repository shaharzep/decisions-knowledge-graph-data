/**
 * Data Loader
 *
 * DB queries to load provisions and cited decisions for a single decision.
 * Consolidates queries from the individual mapping job configs.
 */

import { DatabaseConfig } from '../../config/database.js';

// ============================================================================
// Provision Buckets
// ============================================================================

export interface ProvisionBuckets {
  standard: any[];
  code: any[];
  noDate: any[];
}

// Cache to avoid redundant DB queries when multiple steps call loadAllProvisions
// for the same decision within one pipeline run
const provisionCache = new Map<string, ProvisionBuckets>();

/**
 * Clear the provision cache (call between pipeline runs if reusing the module)
 */
export function clearProvisionCache(): void {
  provisionCache.clear();
}

// ============================================================================
// Load All Provisions (single query, pre-bucketed, cached)
// ============================================================================

/**
 * Load all cited provisions for a decision, bucketed by type.
 * Single query with post-query bucketing to avoid 3 separate DB calls.
 * Results are cached per decisionId within a pipeline run.
 */
export async function loadAllProvisions(decisionId: string): Promise<ProvisionBuckets> {
  if (provisionCache.has(decisionId)) {
    return provisionCache.get(decisionId)!;
  }

  const query = `
    SELECT DISTINCT ON (dcp.id)
      dcp.id,
      dcp.internal_parent_act_id,
      dcp.internal_provision_id,
      d.decision_id,
      d.decision_date,
      d.language_metadata,
      dcp.parent_act_name,
      dcp.parent_act_date,
      dcp.parent_act_type,
      dcp.provision_number,
      dcp.provision_number_key
    FROM decision_cited_provisions dcp
    JOIN decisions1 d ON d.id = dcp.decision_id
    WHERE d.decision_id = $1
      AND dcp.internal_parent_act_id IS NOT NULL
      AND dcp.parent_act_type NOT LIKE 'EU%'
      AND dcp.parent_act_type NOT LIKE '%_UE'
    ORDER BY dcp.id
  `;

  const rows = await DatabaseConfig.executeReadOnlyQuery(query, [decisionId]);

  const CODE_TYPES = ['CODE', 'WETBOEK', 'GRONDWET', 'CONSTITUTION'];

  const buckets: ProvisionBuckets = { standard: [], code: [], noDate: [] };

  for (const row of rows) {
    const actType = (row as any).parent_act_type?.toUpperCase() || '';

    if (CODE_TYPES.includes(actType)) {
      buckets.code.push(row);
    } else if ((row as any).parent_act_date == null) {
      buckets.noDate.push(row);
    } else {
      buckets.standard.push(row);
    }
  }

  provisionCache.set(decisionId, buckets);
  return buckets;
}

// ============================================================================
// Load Cited Decisions
// ============================================================================

export async function loadCitedDecisions(decisionId: string): Promise<any[]> {
  const query = `
    SELECT DISTINCT ON (cd.internal_decision_id)
      cd.internal_decision_id,
      cd.decision_id AS source_decision_db_id,
      cd.court_name AS cited_court_name,
      cd.cited_date,
      cd.case_number AS cited_case_number,
      cd.ecli AS cited_ecli,
      cd.cited_type,
      cd.treatment,
      d.decision_id AS source_ecli,
      d.language_metadata
    FROM cited_decisions cd
    JOIN decisions1 d ON d.id = cd.decision_id
    WHERE d.decision_id = $1
      AND cd.cited_date IS NOT NULL
      AND cd.cited_type = 'PRECEDENT'
    ORDER BY cd.internal_decision_id
  `;

  return DatabaseConfig.executeReadOnlyQuery(query, [decisionId]);
}

// ============================================================================
// Load Related Context (citations + teaching texts)
// ============================================================================

export interface RelatedContext {
  citations: Map<string, string>;  // internal_provision_id -> relevant_snippet
  teachingTexts: string[];
}

export async function loadRelatedContext(decisionId: string): Promise<RelatedContext> {
  // Load citation paragraphs
  const citationQuery = `
    SELECT drc.internal_provision_id, drcc.relevant_snippet
    FROM decision_related_citations drc
    JOIN decision_related_citations_citations drcc
      ON drcc.decision_related_citations_id = drc.id
    JOIN decisions1 d ON d.decision_id = $1 AND d.id = drc.decision_id
  `;
  const citationRows = await DatabaseConfig.executeReadOnlyQuery(citationQuery, [decisionId]);

  const citations = new Map<string, string>();
  for (const row of citationRows) {
    const r = row as any;
    if (r.internal_provision_id && r.relevant_snippet) {
      citations.set(r.internal_provision_id, r.relevant_snippet);
    }
  }

  // Load teaching texts
  const teachingQuery = `
    SELECT dlt.teaching_text
    FROM decision_legal_teachings dlt
    JOIN decisions1 d ON d.decision_id = $1 AND d.id = dlt.decision_id
  `;
  const teachingRows = await DatabaseConfig.executeReadOnlyQuery(teachingQuery, [decisionId]);
  const teachingTexts = teachingRows
    .map((r: any) => r.teaching_text)
    .filter((t: string) => t != null);

  return { citations, teachingTexts };
}

// ============================================================================
// Load Source Markdown
// ============================================================================

export async function loadSourceMarkdown(decisionId: string, language: string): Promise<string | null> {
  const query = `
    SELECT full_md
    FROM decisions_md
    WHERE decision_id = $1 AND language = $2
    LIMIT 1
  `;

  const rows = await DatabaseConfig.executeReadOnlyQuery(query, [decisionId, language]);
  return rows.length > 0 ? (rows[0] as any).full_md : null;
}

// ============================================================================
// Load Decision Date
// ============================================================================

export async function loadDecisionDate(decisionId: string): Promise<string | null> {
  const query = `
    SELECT decision_date
    FROM decisions1
    WHERE decision_id = $1
    LIMIT 1
  `;

  const rows = await DatabaseConfig.executeReadOnlyQuery(query, [decisionId]);
  if (rows.length === 0) return null;
  const d = (rows[0] as any).decision_date;
  if (!d) return null;
  const date = new Date(d);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
