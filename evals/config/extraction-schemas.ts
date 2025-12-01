/**
 * Extraction Schema Definitions
 *
 * Defines which fields belong to each job's extraction output schema.
 * This separates "what the model extracted" from "metadata added by pipeline".
 *
 * ## Why This Matters
 *
 * Extraction results contain TWO types of fields:
 * 1. **Extraction fields**: What the model actually produced (e.g., citedProvisions)
 * 2. **Metadata fields**: Added by pipeline for tracking (e.g., court_ecli_code, md_length)
 *
 * The judge should ONLY see extraction fields. Metadata confuses the judge because
 * it's not part of the extraction task.
 *
 * ## Adding a New Job
 *
 * When you add a new extraction job:
 * 1. Look at the job's outputSchema in its config.ts
 * 2. List the top-level properties from that schema here
 * 3. Exclude any metadata fields (id, decision_id, court_ecli_code, etc.)
 *
 * Example:
 * ```typescript
 * 'extract-my-job': [
 *   'decisionId',        // From outputSchema
 *   'language',          // From outputSchema
 *   'extractedThings',   // From outputSchema
 *   // Don't include: court_ecli_code, md_length (metadata)
 * ],
 * ```
 */

/**
 * Extraction schema field definitions
 * Maps job types to their actual extraction output fields (excluding metadata)
 */
export const EXTRACTION_SCHEMAS: Record<string, string[]> = {
  /**
   * Stage 1: Comprehensive extraction (parties, facts, arguments, court order)
   */
  'extract-comprehensive': [
    'reference',          // Citation reference
    'parties',            // Party information
    'currentInstance',    // Facts, requests, arguments, court order, outcome
  ],

  /**
   * Stage 2A: Provisions essential metadata (context-based)
   */
  'extract-provisions-2a': [
    'decisionId',              // ECLI identifier
    'language',                // Procedural language
    'extractionMetadata',      // Counts and timestamp
    'citedProvisions',         // Array of provision objects
  ],

  /**
   * Stage 2B: Enrich provisions with URLs/identifiers (REGEX-ONLY)
   */
  'enrich-provisions': [
    'citedProvisions',        // Provisions array from Agent 2A (unchanged)
    'extractedReferences',    // Regex-extracted references (urls, celex, numac, file numbers)
  ],

  /**
   * Stage 2C: Provisions interpretation
   */
  'interpret-provisions': [
    'citedProvisions',  // Array of provisions with interpretation + factual context
  ],

  /**
   * Stage 3: Cited decisions extraction
   */
  'extract-cited-decisions': [
    'decisionId',
    'language',
    'citedDecisions',
  ],

  /**
   * Agent 6: Micro-summary extraction
   */
  'extract-micro-summary': [
    'decisionId',             // Decision identifier (from metadata)
    'language',               // Procedural language (from metadata)
    'microSummary',           // Concise 2-4 sentence summary (50-800 chars)
  ],

  /**
   * HTML Structure Conversion: Markdown to structured HTML
   */
  'structure-full-html': [
    'html',                   // Structured HTML fragment with semantic CSS classes
  ],

  /**
   * Markdown Cleaning: Remove LaTeX before HTML conversion
   */
  'clean-decision-markdown': [
    'cleanedMarkdown',        // Markdown with LaTeX removed/converted
  ],

  /**
   * RFTC Stage 2: Teaching citation enrichment (Agent 5B)
   */
  'enrich-teaching-citations': [
    'legalTeachings',         // Array of teachings with HTML citations and relationship validation
    'metadata',               // Citation statistics and validation summary
  ],

  /**
   * RFTC Stage 2: Provision citation enrichment (Agent 2D)
   */
  'enrich-provision-citations': [
    'citedProvisions',        // Array of provisions with HTML citations and relationship mappings
    'metadata',               // Citation statistics and relationship statistics
  ],

  /**
   * Map Provisions Standard: Map non-CODE provisions to parent acts
   * Note: Includes input fields because judge needs them to evaluate correctness
   */
  'map-provisions-standard': [
    // Inputs (judge needs these to evaluate)
    'parent_act_name',        // Input: cited act name
    'parent_act_date',        // Input: cited act date
    'parent_act_type',        // Input: type of act
    'citation_paragraph',     // Input: relevant snippet
    'teaching_texts',         // Input: legal teachings context
    'candidate_titles',       // Input: candidate documents
    // Outputs (what model produced)
    'citation_type',          // Type of legal instrument (LAW, DECREE, etc.)
    'matches',                // Array of matched documents with confidence
    'no_match_reason',        // Explanation if no matches (null otherwise)
  ],

  /**
   * Map Provisions Code: Map CODE/Constitution provisions to specific documents
   * Two-pass algorithm: Pass 1 identifies code family, Pass 2 matches exact document
   */
  'map-provisions-code': [
    // Inputs (judge needs these to evaluate)
    'parent_act_name',        // Input: cited act name (e.g., "Burgerlijk Wetboek")
    'provision_number',       // Input: article being cited
    'provision_number_key',   // Input: normalized article key
    'citation_paragraph',     // Input: context paragraph
    'teaching_texts',         // Input: legal teachings context
    // Outputs (what model produced)
    'decision_path',          // { title_matches, after_range_elimination, existence_status, semantic_disambiguation_used, semantic_match_reasoning }
    'matches',                // Array of document matches with title_match, range_status, existence_status, is_abrogated
    'final_decision',         // SINGLE_MATCH | RESOLVED_BY_RANGE | RESOLVED_BY_EXISTENCE | RESOLVED_BY_SEMANTIC | AMBIGUOUS | NO_MATCH
    'no_match_reason',        // Explanation if no match found (null otherwise)
    'candidate_titles',       // Array of candidate document titles considered
  ],
};

/**
 * Common metadata fields that should NEVER be sent to judge
 *
 * These are added by the pipeline for tracking/clustering but are not
 * part of what the model extracted.
 */
export const METADATA_FIELDS = [
  'id',                      // Database serial ID
  'decision_id',             // Database decision_id (vs model's decisionId)
  'language_metadata',       // Database language (vs model's language)
  'decision_type_ecli_code', // From CSV test set
  'decision_type_name',
  'court_ecli_code',         // From CSV test set
  'court_name',
  'courtcategory',
  'decision_date',           // From CSV test set
  'md_length',               // Document length
  'length_category',         // short/medium/long/very_long
  'url_official_publication',
  // Map provisions metadata
  'internal_parent_act_id',  // Provision mapping job identifier
  'parent_act_name',         // Input: cited act name
  'parent_act_date',         // Input: cited act date
  'parent_act_type',         // Input: type mapping
  'citation_paragraph',      // Input: relevant snippet from citations table
  'teaching_texts',          // Input: legal teachings context
  'candidate_titles',        // Input: candidate documents from DB
  'candidates',              // Input: raw candidate objects
];

/**
 * Get extraction-only fields for a job type
 *
 * @param jobType - Job type (e.g., "extract-provisions-2a")
 * @returns Array of field names, or null if job not configured
 */
export function getExtractionFields(jobType: string): string[] | null {
  return EXTRACTION_SCHEMAS[jobType] || null;
}

/**
 * Check if a field is metadata (should be excluded from judge evaluation)
 *
 * @param fieldName - Name of the field
 * @returns true if field is metadata
 */
export function isMetadataField(fieldName: string): boolean {
  return METADATA_FIELDS.includes(fieldName);
}

/**
 * Get all configured job types with schema definitions
 *
 * @returns Array of job type strings
 */
export function getConfiguredJobTypes(): string[] {
  return Object.keys(EXTRACTION_SCHEMAS);
}
