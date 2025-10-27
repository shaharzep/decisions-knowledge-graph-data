/**
 * Extraction Data Filter
 *
 * Filters extraction results to separate model output from pipeline metadata.
 *
 * ## Problem
 *
 * Extraction results contain both:
 * - Model output fields (what we want to evaluate)
 * - Pipeline metadata fields (court_ecli_code, md_length, etc.)
 *
 * Judges should only see model output to avoid confusion.
 *
 * ## Solution
 *
 * Schema-based filtering:
 * 1. For configured jobs: Keep only schema fields
 * 2. For unconfigured jobs: Remove known metadata fields (backward compatible)
 */

import { getExtractionFields, isMetadataField } from '../config/extraction-schemas.js';
import { logger } from '../../src/utils/logger.js';

/**
 * Filter extraction data to only include schema fields (strip metadata)
 *
 * Uses job-specific schema if available, otherwise strips known metadata fields.
 *
 * @param extractedData - Full extraction result with metadata
 * @param jobType - Job type to determine schema
 * @returns Object with only extraction schema fields
 */
export function filterToExtractionFields(
  extractedData: any,
  jobType: string
): any {
  const schemaFields = getExtractionFields(jobType);

  // Strategy 1: Job has explicit schema definition
  if (schemaFields) {
    const filtered: any = {};

    for (const field of schemaFields) {
      if (field in extractedData) {
        filtered[field] = extractedData[field];
      }
    }

    // Log what we filtered for debugging
    const removedFields = Object.keys(extractedData).filter(
      (key) => !(key in filtered)
    );

    if (removedFields.length > 0) {
      logger.debug('Filtered metadata fields from judge input', {
        jobType,
        removedFields,
      });
    }

    return filtered;
  }

  // Strategy 2: No explicit schema - strip known metadata fields (backward compatible)
  logger.debug('No schema defined for job type, using metadata blacklist', {
    jobType,
  });

  const filtered: any = {};
  for (const [key, value] of Object.entries(extractedData)) {
    if (!isMetadataField(key)) {
      filtered[key] = value;
    }
  }

  return filtered;
}

/**
 * Check if extraction data contains metadata fields
 *
 * Useful for validation and debugging
 *
 * @param extractedData - Extraction result to check
 * @returns Object with metadata detection results
 */
export function detectMetadata(extractedData: any): {
  hasMetadata: boolean;
  metadataFields: string[];
} {
  const metadataFields = Object.keys(extractedData).filter((key) =>
    isMetadataField(key)
  );

  return {
    hasMetadata: metadataFields.length > 0,
    metadataFields,
  };
}

/**
 * Get statistics about what would be filtered
 *
 * Useful for debugging and validation
 *
 * @param extractedData - Full extraction data
 * @param jobType - Job type
 * @returns Statistics about filtering
 */
export function getFilterStats(
  extractedData: any,
  jobType: string
): {
  totalFields: number;
  extractionFields: number;
  metadataFields: number;
  fieldNames: {
    kept: string[];
    removed: string[];
  };
} {
  const allFields = Object.keys(extractedData);
  const filtered = filterToExtractionFields(extractedData, jobType);
  const keptFields = Object.keys(filtered);
  const removedFields = allFields.filter((f) => !keptFields.includes(f));

  return {
    totalFields: allFields.length,
    extractionFields: keptFields.length,
    metadataFields: removedFields.length,
    fieldNames: {
      kept: keptFields,
      removed: removedFields,
    },
  };
}
