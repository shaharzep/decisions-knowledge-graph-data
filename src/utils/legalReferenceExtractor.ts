/**
 * Legal Reference Extractor for Belgian Court Decisions
 *
 * Extracts legal metadata identifiers and URLs from decision text using
 * comprehensive regex patterns with OCR/typing error tolerance.
 *
 * Extracted references:
 * - ELI (European Legislation Identifier)
 * - CELEX (EU document identifiers)
 * - NUMAC (Belgian legal text identifiers)
 * - EUR-Lex URLs
 * - Justel URLs (Belgian e-Justice database)
 */

export interface LegalReferences {
  eli: string[];
  celex: string[];
  numac: string[];
  eurLexUrls: string[];
  justelUrls: string[];
}

interface PatternSet {
  strict: RegExp;
  tolerant: RegExp;
  withPrefix?: RegExp;
  normalize: (match: string) => string;
}

/**
 * Normalize ELI identifier
 *
 * Converts to lowercase, removes spaces, replaces colons with slashes,
 * ensures proper formatting between alpha and numeric segments.
 */
function normalizeEli(match: string): string {
  return match
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/:/g, '/')
    .replace(/([a-z])(\d)/g, '$1/$2')
    .replace(/(\d)([a-z])/g, '$1/$2');
}

/**
 * Normalize CELEX identifier
 *
 * Converts to uppercase, removes CELEX prefix, removes spaces,
 * converts OCR errors (O → 0).
 */
function normalizeCelex(match: string): string {
  return match
    .toUpperCase()
    .replace(/CELEX\s?:?\s?/gi, '')
    .replace(/\s+/g, '')
    .replace(/O/g, '0');
}

/**
 * Normalize NUMAC identifier
 *
 * Extracts 10 digits and formats as YYYY-NNNNNN.
 * Returns original if not 10 digits.
 */
function normalizeNumac(match: string): string {
  const digits = match.replace(/[^\d]/g, '');
  if (digits.length === 10) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  return digits;
}

/**
 * Normalize URL
 *
 * Fixes spacing issues, ensures proper protocol, removes trailing punctuation.
 */
function normalizeUrl(match: string, type: 'eurlex' | 'justel'): string {
  let url = match.trim().replace(/\s+/g, '');

  if (type === 'eurlex') {
    url = url
      .replace(/eur[\s-]?lex/gi, 'eur-lex')
      .replace(/europ[ae]?\.eu/gi, 'europa.eu');

    if (!url.startsWith('http')) {
      url = `https://${url}`;
    }
  } else {
    url = url
      .replace(/e[\s-]?justice/gi, 'ejustice')
      .replace(/f[\s-]?gov/gi, 'fgov');

    if (!url.startsWith('http')) {
      url = `http://${url}`;
    }
  }

  return url.replace(/[.,;:!?\)]+$/, '');
}

/**
 * Comprehensive regex patterns with OCR/typing error tolerance
 */
const patterns: Record<string, PatternSet> = {
  eli: {
    strict: /\beli\/[a-z]+\/\d{4}\/\d{1,2}\/\d{1,2}\/\w+(?:\/[a-z]{2})?(?:\/oj)?\b/gi,
    tolerant: /\be\s?l\s?i\s?[\/:\s]\s?(?:dir|reg|dec|dec-impl|rec|res|agr|prot|conv|trait|act|proc|budget|other)?[a-z]*\s?[\/:\s]\s?\d{4}\s?[\/:\s]\s?\d{1,2}\s?[\/:\s]\s?\d{1,2}\s?[\/:\s]\s?[\w-]+(?:\s?[\/:\s]\s?[a-z]{2})?(?:\s?[\/:\s]\s?o\s?j)?/gi,
    normalize: normalizeEli,
  },

  celex: {
    strict: /\b[1-9]\d{3}[A-Z]{1,2}\d{3,4}\b/g,
    tolerant: /\b[1-9]\s?\d{3}\s?[A-Z0Oo]{1,2}\s?\d{3,4}\b|\b[1-9]\s?\d{3}\s?[A-Z]\s?[A-Z0Oo]?\s?\d{3,4}\b|\bCELEX\s?:?\s?[1-9]\s?\d{3}\s?[A-Z0Oo]{1,2}\s?\d{3,4}\b/gi,
    withPrefix: /\bCELEX\s?:?\s?[1-9]\s?\d{3}\s?[A-Z0Oo]{1,2}\s?\d{3,4}\b/gi,
    normalize: normalizeCelex,
  },

  numac: {
    strict: /\b\d{4}[-]?\d{6}\b/g,
    tolerant: /\bN\s?U\s?M\s?A\s?C\s?:?\s?\d{4}\s?[-–—]?\s?\d{2}\s?\d{4}\b|\b\d{4}\s?[-–—]?\s?\d{2}\s?\d{4}\b|\b\d{10}\b/gi,
    withPrefix: /\bN\s?U\s?M\s?A\s?C\s?:?\s?[\d\s-–—]{10,15}\b/gi,
    normalize: normalizeNumac,
  },

  eurlex: {
    strict: /(?:https?:\/\/)?eur-lex\.europa\.eu\/[^\s<>"'\)]+/gi,
    tolerant: /(?:https?:\/\/)?(?:www\.)?eur[\s-]?lex\.europ[ae]?\.eu[\/\s][^\s<>"'\)]{5,300}/gi,
    normalize: (match) => normalizeUrl(match, 'eurlex'),
  },

  justel: {
    strict: /(?:https?:\/\/)?(?:www\.)?ejustice\.just\.fgov\.be\/[^\s<>"'\)]+/gi,
    tolerant: /(?:https?:\/\/)?(?:www\.)?e[\s-]?justice\.just\.f[\s-]?gov\.be[\/\s][^\s<>"'\)]{5,300}/gi,
    normalize: (match) => normalizeUrl(match, 'justel'),
  },
};

/**
 * Extract and deduplicate matches using strict and tolerant patterns
 */
function extract(text: string, patternSet: PatternSet): string[] {
  const matches = new Set<string>();

  // Apply strict pattern
  const strictMatches = text.match(patternSet.strict) || [];
  strictMatches.forEach((match) => {
    const normalized = patternSet.normalize(match);
    if (normalized && normalized.length > 0) {
      matches.add(normalized);
    }
  });

  // Apply tolerant pattern for additional matches
  const tolerantMatches = text.match(patternSet.tolerant) || [];
  tolerantMatches.forEach((match) => {
    const normalized = patternSet.normalize(match);
    if (normalized && normalized.length > 0) {
      matches.add(normalized);
    }
  });

  // Apply prefix pattern if available
  if (patternSet.withPrefix) {
    const prefixMatches = text.match(patternSet.withPrefix) || [];
    prefixMatches.forEach((match) => {
      const normalized = patternSet.normalize(match);
      if (normalized && normalized.length > 0) {
        matches.add(normalized);
      }
    });
  }

  return Array.from(matches);
}

/**
 * Validate ELI format
 *
 * Must have at least 6 parts and start with 'eli'
 */
function validateEli(eli: string): boolean {
  const parts = eli.split('/');
  return parts.length >= 6 && parts[0] === 'eli';
}

/**
 * Validate CELEX format (basic check)
 */
function validateCelex(celex: string): boolean {
  return /^[1-9]\d{3}[A-Z]{1,2}\d{3,4}$/.test(celex);
}

/**
 * Validate NUMAC format
 *
 * Must be 10 digits starting with 19xx or 20xx (year)
 */
function validateNumac(numac: string): boolean {
  const clean = numac.replace(/[^\d]/g, '');
  return clean.length === 10 && /^(19|20)\d{2}/.test(clean);
}

/**
 * Extract CELEX numbers from EUR-Lex URLs
 *
 * EUR-Lex URLs often contain CELEX in the URI parameter.
 * Example: https://eur-lex.europa.eu/legal-content/FR/TXT/?uri=CELEX:32016R0679
 * Extracts: 32016R0679
 */
function extractCelexFromUrls(urls: string[]): string[] {
  const celexSet = new Set<string>();

  for (const url of urls) {
    // Match CELEX in URL parameters (uri=CELEX:... or uri=CELEX%3A...)
    const matches = url.match(/[?&]uri=CELEX[:%]3A([1-9]\d{4}[A-Z]{1,2}\d{3,4})/gi);
    if (matches) {
      for (const match of matches) {
        // Extract the CELEX number after CELEX: or CELEX%3A
        const celexMatch = match.match(/([1-9]\d{4}[A-Z]{1,2}\d{3,4})/);
        if (celexMatch) {
          celexSet.add(celexMatch[1]);
        }
      }
    }
  }

  return Array.from(celexSet);
}

/**
 * Extract all legal references from decision text
 *
 * Runs comprehensive regex patterns (strict + tolerant) to extract:
 * - ELI identifiers
 * - CELEX numbers (from text and EUR-Lex URLs)
 * - NUMAC identifiers
 * - EUR-Lex URLs
 * - Justel URLs
 *
 * All results are normalized, deduplicated, and validated.
 */
export function extractLegalReferences(text: string): LegalReferences {
  const results: LegalReferences = {
    eli: [],
    celex: [],
    numac: [],
    eurLexUrls: [],
    justelUrls: [],
  };

  if (!text || typeof text !== 'string') {
    return results;
  }

  // Extract each type
  results.eli = extract(text, patterns.eli);
  results.celex = extract(text, patterns.celex);
  results.numac = extract(text, patterns.numac);
  results.eurLexUrls = extract(text, patterns.eurlex);
  results.justelUrls = extract(text, patterns.justel);

  // Extract CELEX from EUR-Lex URLs (most reliable source)
  const celexFromUrls = extractCelexFromUrls(results.eurLexUrls);

  // Merge CELEX from text and URLs
  const allCelex = new Set([...results.celex, ...celexFromUrls]);
  results.celex = Array.from(allCelex);

  // Validate and filter
  results.eli = results.eli.filter(validateEli);
  results.celex = results.celex.filter(validateCelex);
  results.numac = results.numac.filter(validateNumac);
  results.eurLexUrls = results.eurLexUrls.filter((url) => url.includes('eur-lex.europa.eu'));
  results.justelUrls = results.justelUrls.filter((url) => url.includes('ejustice.just.fgov.be'));

  return results;
}
