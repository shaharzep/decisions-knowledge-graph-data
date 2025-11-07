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
   * Stage 2B: Enrich provisions with URLs/identifiers
   */
  'enrich-provisions': [
    'citedProvisions',        // Enriched provisions array (correct field name)
    'extractedReferences',    // Pre-extracted metadata (celex, eli, numac, urls) - CRITICAL for judge
  ],

  /**
   * Stage 2C: Provisions interpretation
   */
  'interpret-provisions': [
    'decisionId',
    'language',
    'interpretedProvisions',
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
