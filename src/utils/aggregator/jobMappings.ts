/**
 * Job mappings and configuration for results aggregator
 */

import { JobMapping } from './types.js';

/**
 * Jobs to merge into aggregated output
 *
 * EXCLUDES:
 * - extract-provisions-2a (data included in interpret-provisions)
 * - enrich-provisions (data included in interpret-provisions)
 */
export const JOB_MAPPINGS: JobMapping[] = [
  {
    jobId: 'extract-comprehensive',
    outputField: 'comprehensive',
    description: 'Stage 1: Parties, facts, arguments, court order'
  },
  {
    jobId: 'interpret-provisions',
    outputField: 'citedProvisions',
    description: 'Stage 2C: Provisions with interpretation (includes 2A+2B data)'
  },
  {
    jobId: 'extract-cited-decisions',
    outputField: 'citedDecisions',
    description: 'Stage 3: Cited decisions'
  },
  {
    jobId: 'extract-keywords',
    outputField: 'customKeywords',
    description: 'Stage 4: Keywords extraction'
  },
  {
    jobId: 'extract-legal-teachings',
    outputField: 'legalTeachings',
    description: 'Stage 5A: Legal teachings'
  },
  {
    jobId: 'extract-micro-summary',
    outputField: 'microSummary',
    description: 'Agent 6: Micro-summary'
  },
  {
    jobId: 'enrich-provision-citations',
    outputField: 'relatedCitationsLegalProvisions',
    description: 'Agent 2D: Provision HTML citations and relationships'
  },
  {
    jobId: 'enrich-teaching-citations',
    outputField: 'relatedCitationsLegalTeachings',
    description: 'Agent 5B: Teaching HTML citations and validation'
  }
];

/**
 * Get list of job IDs to merge
 */
export function getJobIds(): string[] {
  return JOB_MAPPINGS.map(m => m.jobId);
}

/**
 * Get output field name for a job ID
 */
export function getOutputField(jobId: string): string | undefined {
  return JOB_MAPPINGS.find(m => m.jobId === jobId)?.outputField;
}

/**
 * Metadata fields to extract from decision objects
 * These are common across all jobs
 */
export const METADATA_FIELDS = [
  'id',
  'court_ecli_code',
  'court_name',
  'decision_date',
  'decision_type_ecli_code',
  'decision_type_name',
  'md_length',
  'length_category',
  'courtcategory'
];

/**
 * Fields to exclude when extracting job-specific data
 * (these go into metadata or are redundant)
 */
export const EXCLUDED_FIELDS = [
  ...METADATA_FIELDS,
  'decision_id',
  'language',
  'language_metadata',
  'url_official_publication'
];
