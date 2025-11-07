/**
 * Belgian Court Decision Reference Extractor - this is the one being used. 
 *
 * Production-tested regex extraction of legal references from Belgian/EU court decisions.
 * Ported from N8N code node with zero changes to validation logic.
 *
 * Extracts and validates:
 * - EU References: CELEX codes and Europa URLs
 * - Belgian References: NUMAC codes, file numbers, and official URLs
 *
 * Output Format:
 * {
 *   url: { eu: string[], be: string[] },
 *   reference: {
 *     eu: { extracted: string[], verified: string[] },
 *     be: { extracted: string[], verifiedNumac: string[], verifiedFileNumber: string[] }
 *   }
 * }
 */

export interface ReferenceExtractionResult {
  url: {
    eu: string[];
    be: string[];
  };
  reference: {
    eu: {
      extracted: string[];
      verified: string[];
    };
    be: {
      extracted: string[];
      verifiedNumac: string[];
      verifiedFileNumber: string[];
    };
  };
}

export class ReferenceExtractorN8N {
  private currentYear: number;

  // Regex patterns for extraction
  private celexPattern: RegExp;
  private celexPrefixPattern: RegExp;
  private numacPattern: RegExp;
  private numacPrefixPattern: RegExp;
  private eliPattern: RegExp;
  private etaambPattern: RegExp;
  private fileNumberPattern: RegExp;
  private ejusticePattern: RegExp;
  private urlEuPattern: RegExp;
  private urlBeEjusticePattern: RegExp;
  private urlBeEtaambPattern: RegExp;

  constructor() {
    this.currentYear = new Date().getFullYear();

    // Initialize regex patterns
    this.celexPattern = /\b([1-9CE0][12][90][0-9]{2}[A-Z][0-9A-Z()_-]+)\b/gi;
    this.celexPrefixPattern = /CELEX\s*[:\s]\s*([0-9CE][0-9A-Z()_-]+)/gi;
    this.numacPattern = /\b([12][7890][0-9]{2}[0-9ABCDE][0-9]{5})\b/g;
    this.numacPrefixPattern = /numac[_\s]*[=:\s]\s*([0-9A-E]{10})/gi;
    this.eliPattern = /\/eli\/[^/]+\/[^/]+\/[^/]+\/([0-9]{10})/gi;
    this.etaambPattern = /etaamb\.openjustice\.be\/[^_]+_n([0-9]{10})/gi;
    this.fileNumberPattern = /\b([12][7890][0-9]{2}[-/\s]?[01][0-9][-/\s]?[0123][0-9][-/\s]?[0-9]{2})\b/g;
    this.ejusticePattern = /ejustice\.just\.fgov\.be[^\s]*[?&]cn[_\s]*search=([0-9]{10})/gi;
    this.urlEuPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]*europa\.eu[^\s<>"{}|\\^`\[\]]*/gi;
    this.urlBeEjusticePattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]*ejustice\.just\.fgov\.be[^\s<>"{}|\\^`\[\]]*/gi;
    this.urlBeEtaambPattern = /https?:\/\/[^\s<>"{}|\\^`\[\]]*etaamb\.openjustice\.be[^\s<>"{}|\\^`\[\]]*/gi;
  }

  /**
   * Normalize text for extraction
   * - Removes excessive whitespace in URLs
   * - Collapses broken words
   */
  private normalizeText(text: string): string {
    if (!text) return '';

    // Fix broken URLs by removing spaces within URL patterns
    text = text.replace(/(https?:\/\/[\S\s]+?)(?=\s+https?:\/\/|\s{2,}|$)/g, m => m.replace(/\s+/g, ''));

    // Fix broken words (character followed by space followed by character)
    text = text.replace(/(\w)\s+(\w)(?=\S{0,2}\s+\w|\S{0,2}[^\w\s])/g, '$1$2');

    return text;
  }

  /**
   * Validate CELEX code format
   * Format: [sector][year][type][number]
   * Example: 32016R0679 (GDPR)
   */
  private validateCelex(candidate: string): boolean {
    if (!candidate || candidate.length < 7) return false;

    const u = candidate.toUpperCase();

    // Sector: 1-9, C, E, 0
    if (!'1234567890CE'.includes(u[0])) return false;

    // Year digits 1-2: must be 1 or 2
    if (!'12'.includes(u[1])) return false;

    // Year digits 3: must be 9 or 0
    if (!'90'.includes(u[2])) return false;

    // Year digit 4: must be digit
    if (!/[0-9]/.test(u[3])) return false;

    // Year digit 5: must be digit
    if (!/[0-9]/.test(u[4])) return false;

    // Type code: must be letter
    if (!/[A-Z]/.test(u[5])) return false;

    return true;
  }

  /**
   * Validate NUMAC code format
   * Format: YYYYMXXXXX (10 digits/letters)
   * - YYYY: year (1789-current)
   * - M: month indicator (0-9, A-E)
   * - XXXXX: sequence number
   */
  private validateNumac(candidate: string): boolean {
    if (!candidate) return false;

    const c = candidate.toUpperCase().replace(/[^0-9A-E]/g, '');

    // Must be exactly 10 characters
    if (c.length !== 10) return false;

    // First char: 1 or 2 (millennium)
    if (!'12'.includes(c[0])) return false;

    // Second char: 7, 8, 9, 0 (century)
    if (!'7890'.includes(c[1])) return false;

    // Third and fourth: must be digits
    if (!/[0-9]/.test(c[2]) || !/[0-9]/.test(c[3])) return false;

    // Fifth char: month indicator (0-9, A-E)
    if (!'0123456789ABCDE'.includes(c[4])) return false;

    // Last 5 chars: must be digits
    if (!/^[0-9]{5}$/.test(c.slice(5))) return false;

    // Validate year range
    const year = parseInt(c.slice(0, 4));
    return year >= 1789 && year <= this.currentYear;
  }

  /**
   * Validate Belgian file number format
   * Format: YYYY-MM-DD-XX or YYYY/MM/DD/XX
   * Example: 2024-01-15-02
   */
  private validateFileNumber(candidate: string): boolean {
    if (!candidate) return false;

    // Remove delimiters
    const c = candidate.replace(/[-/\s]/g, '');

    // Must be exactly 10 digits
    if (c.length !== 10 || !/^\d{10}$/.test(c)) return false;

    // First char: 1 or 2 (millennium)
    if (!'12'.includes(c[0])) return false;

    // Second char: 7, 8, 9, 0 (century)
    if (!'7890'.includes(c[1])) return false;

    // Month first digit: 0 or 1
    if (!'01'.includes(c[4])) return false;

    // Day first digit: 0, 1, 2, 3
    if (!'0123'.includes(c[6])) return false;

    // Validate date components
    const year = parseInt(c.slice(0, 4));
    const month = parseInt(c.slice(4, 6));
    const day = parseInt(c.slice(6, 8));

    // Year range check
    if (year < 1789 || year > this.currentYear) return false;

    // Month range check
    if (month < 1 || month > 12) return false;

    // Day range check
    if (day < 1 || day > 31) return false;

    // Validate against actual calendar days per month
    const daysInMonth: Record<number, number> = {
      1: 31, 2: 29, 3: 31, 4: 30, 5: 31, 6: 30,
      7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31
    };

    return day <= daysInMonth[month];
  }

  /**
   * Extract reference codes from text using regex patterns
   * Returns candidates for CELEX, NUMAC, and file numbers
   */
  private extractReferencesFromText(text: string): {
    celexCandidates: string[];
    numacCandidates: string[];
    fileNumberCandidates: string[];
  } {
    const norm = this.normalizeText(text);
    const celex = new Set<string>();
    const numac = new Set<string>();
    const fileNum = new Set<string>();

    let m: RegExpExecArray | null;

    // Extract CELEX codes (bare patterns)
    while ((m = this.celexPattern.exec(norm)) !== null) {
      celex.add(m[1].toUpperCase());
    }
    this.celexPattern.lastIndex = 0;

    // Extract CELEX codes (with prefix)
    while ((m = this.celexPrefixPattern.exec(norm)) !== null) {
      celex.add(m[1].toUpperCase());
    }
    this.celexPrefixPattern.lastIndex = 0;

    // Extract NUMAC codes (bare patterns)
    while ((m = this.numacPattern.exec(norm)) !== null) {
      numac.add(m[1]);
    }
    this.numacPattern.lastIndex = 0;

    // Extract NUMAC codes (with prefix)
    while ((m = this.numacPrefixPattern.exec(norm)) !== null) {
      numac.add(m[1].toUpperCase());
    }
    this.numacPrefixPattern.lastIndex = 0;

    // Extract NUMAC from ELI paths
    while ((m = this.eliPattern.exec(norm)) !== null) {
      numac.add(m[1]);
    }
    this.eliPattern.lastIndex = 0;

    // Extract NUMAC from etaamb URLs
    while ((m = this.etaambPattern.exec(norm)) !== null) {
      numac.add(m[1]);
    }
    this.etaambPattern.lastIndex = 0;

    // Extract file numbers (bare patterns)
    while ((m = this.fileNumberPattern.exec(norm)) !== null) {
      const c = m[1].replace(/[-/\s]/g, '');
      if (c.length === 10 && /^\d{10}$/.test(c)) {
        fileNum.add(c);
      }
    }
    this.fileNumberPattern.lastIndex = 0;

    // Extract file numbers from ejustice URLs
    while ((m = this.ejusticePattern.exec(norm)) !== null) {
      fileNum.add(m[1]);
    }
    this.ejusticePattern.lastIndex = 0;

    return {
      celexCandidates: Array.from(celex),
      numacCandidates: Array.from(numac),
      fileNumberCandidates: Array.from(fileNum)
    };
  }

  /**
   * Extract URLs from text
   * Returns EU URLs (europa.eu) and Belgian URLs (ejustice, etaamb)
   */
  private extractUrls(text: string): { euUrls: string[]; beUrls: string[] } {
    const norm = this.normalizeText(text);
    const eu = new Set<string>();
    const be = new Set<string>();

    let m: RegExpExecArray | null;

    // Extract EU URLs (europa.eu)
    while ((m = this.urlEuPattern.exec(norm)) !== null) {
      const url = m[0];
      // Only include if contains CELEX or has validated CELEX in path
      if (/CELEX/i.test(url) || url.split('/').some(p => this.validateCelex(p))) {
        eu.add(url);
      }
    }
    this.urlEuPattern.lastIndex = 0;

    // Extract Belgian ejustice URLs
    while ((m = this.urlBeEjusticePattern.exec(norm)) !== null) {
      const url = m[0];
      // Only include if contains 10-digit code
      if (url.split(/[/?&=]/).some(p => p.length === 10 && (/^\d{10}$/.test(p) || this.validateNumac(p)))) {
        be.add(url);
      }
    }
    this.urlBeEjusticePattern.lastIndex = 0;

    // Extract Belgian etaamb URLs
    while ((m = this.urlBeEtaambPattern.exec(norm)) !== null) {
      const url = m[0];
      // Only include if contains _n pattern
      if (url.includes('_n')) {
        be.add(url);
      }
    }
    this.urlBeEtaambPattern.lastIndex = 0;

    return { euUrls: Array.from(eu), beUrls: Array.from(be) };
  }

  /**
   * Process a decision and extract all references
   *
   * @param _decisionId - ECLI identifier of the decision (unused but kept for API consistency)
   * @param markdownText - Full markdown text of the decision
   * @returns Reference extraction result with URLs and validated references
   */
  processDecision(_decisionId: string, markdownText: string): ReferenceExtractionResult {
    // Extract candidates
    const { celexCandidates, numacCandidates, fileNumberCandidates } =
      this.extractReferencesFromText(markdownText);
    const { euUrls, beUrls } = this.extractUrls(markdownText);

    // Validate EU references (CELEX)
    const euVerified: string[] = [];
    const euExtracted: string[] = [];
    for (const c of celexCandidates) {
      if (this.validateCelex(c)) {
        euVerified.push(c);
      } else {
        euExtracted.push(c);
      }
    }

    // Validate Belgian references (NUMAC and file numbers)
    const beVerifiedNumac: string[] = [];
    const beVerifiedFile: string[] = [];
    const beExtracted: string[] = [];

    for (const c of numacCandidates) {
      if (this.validateNumac(c)) {
        beVerifiedNumac.push(c);
      } else {
        beExtracted.push(c);
      }
    }

    for (const c of fileNumberCandidates) {
      if (this.validateFileNumber(c)) {
        beVerifiedFile.push(c);
      } else {
        beExtracted.push(c);
      }
    }

    // Return result with deduplicated and sorted arrays
    return {
      url: {
        eu: [...new Set(euUrls)].sort(),
        be: [...new Set(beUrls)].sort()
      },
      reference: {
        eu: {
          extracted: [...new Set(euExtracted)].sort(),
          verified: [...new Set(euVerified)].sort()
        },
        be: {
          extracted: [...new Set(beExtracted)].sort(),
          verifiedNumac: [...new Set(beVerifiedNumac)].sort(),
          verifiedFileNumber: [...new Set(beVerifiedFile)].sort()
        }
      }
    };
  }
}
