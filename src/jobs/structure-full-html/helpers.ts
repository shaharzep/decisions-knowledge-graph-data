/**
 * Structure Full HTML Helpers
 *
 * Utility functions for metadata transformation and formatting
 */

import {
  DecisionMetadata,
  DECISION_TYPE_MAPPINGS,
  MONTH_NAMES,
  TOKEN_OVERHEAD_MULTIPLIER,
  CHARACTER_TO_TOKEN_RATIO
} from './types.js';

/**
 * Map ECLI decision type code to localized name
 *
 * @param code ECLI decision type code (ARR, JUG, etc.)
 * @param language Decision language (FR or NL)
 * @returns Localized decision type name
 */
export function mapDecisionType(code: string, language: string): string {
  const lang = language === 'FR' ? 'FR' : 'NL';
  return DECISION_TYPE_MAPPINGS[lang]?.[code] || code;
}

/**
 * Format date from YYYY-MM-DD to localized format
 *
 * French: "du DD mois YYYY"
 * Dutch: "van DD maand YYYY"
 *
 * @param dateStr Date string in YYYY-MM-DD format
 * @param language Decision language (FR or NL)
 * @returns Formatted date string
 */
export function formatDate(dateStr: string, language: string): string {
  if (!dateStr) return '';

  const date = new Date(dateStr);
  const day = date.getDate();
  const monthIndex = date.getMonth();
  const year = date.getFullYear();

  const lang = language === 'FR' ? 'FR' : 'NL';
  const monthName = MONTH_NAMES[lang][monthIndex];

  if (lang === 'FR') {
    return `du ${day} ${monthName} ${year}`;
  } else {
    return `van ${day} ${monthName} ${year}`;
  }
}

/**
 * Build frontmatter block with decision metadata
 *
 * @param metadata Decision metadata
 * @returns YAML frontmatter string
 */
export function buildFrontmatter(metadata: DecisionMetadata): string {
  return `---
court_name: ${metadata.court_name || ''}
decision_type: ${metadata.decision_type || ''}
role_number: ${metadata.rol_number || ''}
date: ${metadata.date || ''}
language: ${metadata.language.toLowerCase()}
---`;
}

/**
 * Estimate output tokens for a given text
 *
 * @param text Input text
 * @returns Estimated token count
 */
export function estimateOutputTokens(text: string): number {
  const charCount = text.length;
  return Math.ceil(
    (charCount * TOKEN_OVERHEAD_MULTIPLIER) / CHARACTER_TO_TOKEN_RATIO
  );
}
