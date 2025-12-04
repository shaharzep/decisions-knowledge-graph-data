import { JobConfig } from '../JobConfig.js';
import { CITED_DECISION_MAPPING_PROMPT } from './prompt.js';
import { DatabaseConfig } from '../../config/database.js';
import { findCitationSnippet } from './citation-finder.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

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
 * Load missing courts from JSON file
 * These are courts that don't exist in the database - skip processing them
 */
function loadMissingCourts(): Set<string> {
  const jsonContent = readFileSync(join(__dirname, 'missing-courts.json'), 'utf-8');
  const courts: string[] = JSON.parse(jsonContent);
  return new Set(courts.map(normalizeCourtName));
}

const missingCourts = loadMissingCourts();

/**
 * Check if court is known to be missing from database
 * Returns true if court should be skipped
 */
function isKnownMissingCourt(courtName: string): boolean {
  if (!courtName) return false;
  return missingCourts.has(normalizeCourtName(courtName));
}

/**
 * Format date to YYYY-MM-DD for DB query
 * Uses UTC to avoid timezone-related off-by-one errors
 */
function formatDate(date: Date | string | null): string {
  if (!date) return '';
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Build result for no-match cases (0 candidates from date filter)
 */
function buildNoMatchResult(reason: string): object {
  return {
    matches: [],
    no_match_reason: reason
  };
}

/**
 * Build result for fast-path single-match cases (skip LLM)
 */
function buildFastMatchResult(candidate: any, reason: string): object {
  return {
    matches: [{
      decision_id: candidate.decision_id,
      court_name: candidate.court_name || null,
      score: 100,
      confidence: 1.0,
      reasoning: reason
    }],
    no_match_reason: null
  };
}

interface Candidate {
  decision_id: string;
  court_ecli_code: string;
  court_name: string;
  decision_date: string;
  decision_type: string | null;
  rol_number: string | null;
  teaching_texts: string[] | null;
  summaries: string[] | null;
}

/**
 * Fetch candidate decisions from decisions1 matching the cited date
 * Optionally filters by court if mapping is available
 * Includes rol_number for case number matching, plus teaching_texts and summaries for context
 */
async function fetchCandidateDecisions(
  citedDate: string,
  courtEcliCode: string | null
): Promise<Candidate[]> {
  // Base query: match by date, include rol_number for case number matching
  // Join with courts for court name and decision_types for decision type name
  // Include teaching_texts (from decision_legal_teachings) and summaries for context
  let query = `
    SELECT
      d.id AS db_id,
      d.decision_id,
      d.court_ecli_code,
      d.language_metadata,
      c.courtfr AS court_name_fr,
      c.courtnl AS court_name_nl,
      d.decision_date,
      dt.decision_type_fr,
      dt.decision_type_nl,
      d.rol_number,
      (
        SELECT ARRAY_AGG(dlt.teaching_text)
        FROM decision_legal_teachings dlt
        WHERE dlt.decision_id = d.id
      ) AS teaching_texts,
      (
        SELECT ARRAY_AGG(s.summary)
        FROM summaries s
        WHERE s.decision_id = d.id
      ) AS summaries
    FROM decisions1 d
    LEFT JOIN courts c ON c.id = d.court_ecli_code
    LEFT JOIN decision_types dt ON dt.decisiontypeeclicode = d.decision_type_ecli_code
    WHERE d.decision_date::date = $1::date
  `;

  const params: any[] = [citedDate];

  // Add court filter if available
  if (courtEcliCode) {
    query += ` AND d.court_ecli_code = $2`;
    params.push(courtEcliCode);
  }

  query += ` ORDER BY d.decision_id`;

  try {
    const rows = await DatabaseConfig.executeReadOnlyQuery(query, params);
    return rows.map((r: any) => {
      // Use language-appropriate names based on candidate's language_metadata
      const isNL = r.language_metadata === 'NL';

      return {
        decision_id: r.decision_id,
        court_ecli_code: r.court_ecli_code,
        court_name: isNL
          ? (r.court_name_nl || r.court_name_fr || r.court_ecli_code)
          : (r.court_name_fr || r.court_name_nl || r.court_ecli_code),
        decision_date: formatDate(r.decision_date),
        decision_type: isNL
          ? (r.decision_type_nl || r.decision_type_fr || null)
          : (r.decision_type_fr || r.decision_type_nl || null),
        rol_number: r.rol_number || null,
        teaching_texts: r.teaching_texts || null,
        summaries: r.summaries || null
      };
    });
  } catch (error) {
    console.error(`Error fetching candidates for date ${citedDate}:`, error);
    return [];
  }
}

/**
 * Map Cited Decisions Job
 *
 * Maps cited decisions from extract-cited-decisions to actual decisions in decisions1.
 * Uses date filter (mandatory) + court filter (optional via CSV mapping) + LLM disambiguation.
 * LLM focuses on case number (cited) vs rol_number (candidate) matching + context.
 */
const config: JobConfig = {
  id: 'map-cited-decisions',
  description: 'Map cited decisions to actual decisions in decisions1 table',

  concurrencyLimit: 200,

  /**
   * Select cited decisions with dates for mapping
   * Joins with source decision to get language and legal teachings for context
   */
  dbQuery: `
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
      d.language_metadata,
      dm.full_md AS source_full_md,
      (
        SELECT ARRAY_AGG(dlt.teaching_text)
        FROM decision_legal_teachings dlt
        WHERE dlt.decision_id = cd.decision_id
      ) AS teaching_texts
    FROM cited_decisions cd
    JOIN decisions1 d ON d.id = cd.decision_id
    LEFT JOIN decisions_md dm ON dm.decision_id = d.decision_id AND dm.language = d.language_metadata
    WHERE cd.cited_date IS NOT NULL
      AND cd.cited_type = 'PRECEDENT'
    ORDER BY cd.internal_decision_id
    LIMIT 100
  `,

  dbQueryParams: [],

  /**
   * Preprocess: Filter by date, extract context, apply fast-paths
   * Court alignment is handled by the main LLM prompt (STEP 1 in prompt.ts)
   *
   * Returns:
   * - null to skip rows (known missing courts)
   * - { ...row, _skipLLM: true, _result: {...} } for fast-path cases
   * - { ...row, candidates: [...] } for LLM disambiguation
   */
  preprocessRow: async (row: any) => {
    const { cited_date, cited_court_name, cited_ecli, cited_case_number, source_full_md } = row;

    // Skip known missing courts (exact matches from missing-courts.json)
    if (isKnownMissingCourt(cited_court_name)) {
      return null;
    }

    // Format and validate date
    const searchDate = formatDate(cited_date);
    if (!searchDate) {
      return {
        ...row,
        _skipLLM: true,
        _result: buildNoMatchResult('cited_date is null or invalid'),
        candidate_count: 0
      };
    }

    // Extract citation snippet for context
    const { snippet, matchedOn } = findCitationSnippet(
      source_full_md,
      cited_court_name,
      searchDate,
      cited_case_number,
      cited_ecli
    );
    row.citation_snippet = snippet;
    row.snippet_match_type = matchedOn;

    // Fetch all candidates for this date (LLM handles court filtering)
    const candidates = await fetchCandidateDecisions(searchDate, null);

    // No candidates for date
    if (candidates.length === 0) {
      return {
        ...row,
        _skipLLM: true,
        _result: buildNoMatchResult(`No decisions found for date ${searchDate}`),
        candidate_count: 0
      };
    }

    // Fast-path: exact ECLI match
    if (cited_ecli) {
      const ecliMatch = candidates.find(c =>
        c.decision_id.toLowerCase() === cited_ecli.toLowerCase()
      );
      if (ecliMatch) {
        return {
          ...row,
          _skipLLM: true,
          _result: buildFastMatchResult(ecliMatch, `Exact ECLI match: ${cited_ecli}`),
          candidate_count: candidates.length
        };
      }
    }

    // Fast-path: single candidate
    if (candidates.length === 1) {
      return {
        ...row,
        _skipLLM: true,
        _result: buildFastMatchResult(candidates[0], 'Single candidate from date filter'),
        candidate_count: 1
      };
    }

    // Multiple candidates - LLM handles court alignment and disambiguation
    return {
      ...row,
      candidates,
      candidate_count: candidates.length
    };
  },

  /**
   * Generate prompt for LLM disambiguation
   * Only called when multiple candidates need resolution
   * Focuses on case number (cited) vs rol_number (candidate) matching
   */
  promptTemplate: (row: any) => {
    const candidates = row.candidates || [];

    // Helper to truncate long text
    const truncate = (text: string | null, maxLen: number): string => {
      if (!text) return 'Not available';
      return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
    };

    // Helper to format context (teaching_texts first, then summaries as fallback)
    const formatContext = (c: Candidate): string => {
      if (c.teaching_texts && c.teaching_texts.length > 0) {
        const teachingsText = c.teaching_texts
          .slice(0, 3)
          .map((t, idx) => `     ${idx + 1}. ${truncate(t, 250)}`)
          .join('\n');
        return `   Legal Teachings:\n${teachingsText}`;
      } else if (c.summaries && c.summaries.length > 0) {
        const summariesText = c.summaries
          .slice(0, 3)
          .map((s, idx) => `     ${idx + 1}. ${truncate(s, 200)}`)
          .join('\n');
        return `   Summaries:\n${summariesText}`;
      }
      return '   Context: Not available';
    };

    // Format candidates list with rol_number and context
    const candidatesList = candidates.length > 0
      ? candidates.map((c: Candidate, i: number) =>
          `${i + 1}. [${c.decision_id}]
   Court: ${c.court_name}
   Date: ${c.decision_date}
   Type: ${c.decision_type || 'Unknown'}
   Case Number (rol_number): ${c.rol_number || 'Not available'}
${formatContext(c)}`
        ).join('\n\n')
      : 'No candidates found.';

    // Format legal teachings for context
    const legalTeachings = row.teaching_texts?.length > 0
      ? row.teaching_texts.slice(0, 5).map((t: string, i: number) => `${i + 1}. ${t}`).join('\n\n')
      : 'No legal teachings available.';

    // Format citation snippet (where citation appears in source text)
    const citationSnippet = row.citation_snippet
      ? `${row.citation_snippet}\n\n(Matched on: ${row.snippet_match_type})`
      : 'Citation location not found in source text.';

    return CITED_DECISION_MAPPING_PROMPT
      .replace('{citedCourtName}', row.cited_court_name || 'Unknown')
      .replace('{citedDate}', formatDate(row.cited_date) || 'Unknown')
      .replace('{citedCaseNumber}', row.cited_case_number || 'Not provided')
      .replace('{citedEcli}', row.cited_ecli || 'Not provided')
      .replace('{sourceDecisionEcli}', row.source_ecli || 'Unknown')
      .replace('{legalTeachings}', legalTeachings)
      .replace('{treatment}', row.treatment || 'Not specified')
      .replace('{citationSnippet}', citationSnippet)
      .replace('{candidatesList}', candidatesList)
      .replace('{candidateCount}', String(candidates.length));
  },

  outputSchema: {
    type: 'object',
    required: ['matches', 'no_match_reason'],
    additionalProperties: false,
    properties: {
      matches: {
        type: 'array',
        maxItems: 3,
        items: {
          type: 'object',
          required: ['decision_id', 'court_name', 'score', 'confidence', 'reasoning'],
          additionalProperties: false,
          properties: {
            decision_id: {
              type: 'string',
              description: 'ECLI identifier of the matched decision'
            },
            court_name: {
              type: ['string', 'null'],
              description: 'Court name of the matched decision'
            },
            score: {
              type: 'integer',
              minimum: 0,
              maximum: 100,
              description: 'Match confidence score 0-100'
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              description: 'Match confidence 0.0-1.0'
            },
            reasoning: {
              type: 'string',
              description: 'Explanation of why this candidate matches'
            }
          }
        }
      },
      no_match_reason: {
        type: ['string', 'null'],
        description: 'If no matches found, explains why'
      }
    }
  },

  outputSchemaName: 'cited_decision_mapping',

  provider: 'openai',
  openaiProvider: 'azure',
  model: 'gpt-5-mini',
  reasoningEffort: 'medium',

  rowMetadataFields: [
    'internal_decision_id',
    'source_decision_db_id',
    'source_ecli',
    'cited_court_name',
    'cited_date',
    'cited_case_number',
    'cited_ecli',
    'cited_type',
    'treatment',
    'language_metadata',
    'candidate_count',
    'citation_snippet',
    'snippet_match_type',
    'teaching_texts',
    'candidates'
  ],

  customIdPrefix: 'map-cited-dec',

  useFullDataPipeline: false
};

export default config;
