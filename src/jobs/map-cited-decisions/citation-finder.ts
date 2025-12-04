/**
 * Citation Finder Utility
 *
 * Locates where a specific cited decision appears in source decision text.
 * Uses targeted regex patterns built from citation identifiers (ECLI, case number, court+date).
 *
 * Returns a text snippet (~600 chars) around the citation for LLM context.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

const DEFAULT_SNIPPET_SIZE = 600;

/**
 * Month name mappings for date pattern building
 */
const MONTH_PATTERNS: Record<number, string> = {
  1: '(?:janvier|januari|jan\\.?)',
  2: '(?:février|februari|feb\\.?)',
  3: '(?:mars|maart|mar\\.?)',
  4: '(?:avril|april|apr\\.?)',
  5: '(?:mai|mei)',
  6: '(?:juin|juni|jun\\.?)',
  7: '(?:juillet|juli|jul\\.?)',
  8: '(?:août|augustus|aug\\.?)',
  9: '(?:septembre|september|sept?\\.?)',
  10: '(?:octobre|oktober|oct\\.?|okt\\.?)',
  11: '(?:novembre|november|nov\\.?)',
  12: '(?:décembre|december|dec\\.?)',
};

// ============================================================================
// PATTERN BUILDERS
// ============================================================================

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build ECLI pattern - most specific identifier
 */
function buildEcliPattern(ecli: string): RegExp | null {
  if (!ecli) return null;

  // Allow flexible spacing around colons: ECLI:BE:CASS or ECLI : BE : CASS
  const parts = ecli.split(':');
  if (parts.length < 5) return null;

  const flexiblePattern = parts.map(escapeRegex).join('\\s*:\\s*');
  return new RegExp(flexiblePattern, 'i');
}

/**
 * Build case number patterns - handles format variations
 * Input: "C.17.0234.F" should match "C.17.0234.F", "C170234F", "C 17 0234 F"
 */
function buildCaseNumberPatterns(caseNumber: string): RegExp[] {
  if (!caseNumber) return [];

  const patterns: RegExp[] = [];

  // Pattern 1: Exact match (escaped)
  patterns.push(new RegExp(escapeRegex(caseNumber), 'i'));

  // Pattern 2: Flexible separators (dots, spaces, dashes become optional separators)
  const flexPattern = caseNumber
    .split(/[\s.\-\/]+/)
    .filter(Boolean)
    .map(escapeRegex)
    .join('[\\s.\\-\\/]*');
  if (flexPattern !== escapeRegex(caseNumber)) {
    patterns.push(new RegExp(flexPattern, 'i'));
  }

  // Pattern 3: For Belgian Cassation format X.YY.ZZZZ.L - extract core numbers
  // More flexible: allows 2-4 digit year, 1-5 digit number
  const cassMatch = caseNumber.match(/^([A-Z])\.?(\d{2,4})\.?(\d{1,5})\.?([A-Z])$/i);
  if (cassMatch) {
    const [, letter, year, num, lang] = cassMatch;
    patterns.push(new RegExp(`${letter}[\\s.\\-]*${year}[\\s.\\-]*0*${num}[\\s.\\-]*${lang}`, 'i'));
  }

  return patterns;
}

/**
 * Build date patterns for a YYYY-MM-DD date
 * Generates patterns for various date formats used in Belgian legal texts
 */
function buildDatePatterns(isoDate: string): RegExp[] {
  if (!isoDate) return [];

  const match = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return [];

  const [, year, monthStr, dayStr] = match;
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const monthNum = parseInt(monthStr, 10);

  const patterns: RegExp[] = [];
  const monthPattern = MONTH_PATTERNS[month];

  // Day pattern: matches both "5" and "05"
  const dayPattern = day < 10 ? `0?${day}` : String(day);
  // Month pattern for numeric: matches both "3" and "03"
  const monthNumPattern = monthNum < 10 ? `0?${monthNum}` : String(monthNum);

  // Pattern 1: "15 mars 2022" or "15 maart 2022" or "1er juin 2022"
  if (monthPattern) {
    patterns.push(new RegExp(`${dayPattern}(?:er|ère)?\\s+${monthPattern}\\s+${year}`, 'i'));
  }

  // Pattern 2: DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY (flexible padding)
  patterns.push(new RegExp(`${dayPattern}\\s*[\\/\\-\\.]\\s*${monthNumPattern}\\s*[\\/\\-\\.]\\s*${year}`, 'i'));

  // Pattern 3: Short year DD/MM/YY (flexible padding)
  const shortYear = year.slice(2);
  patterns.push(new RegExp(`${dayPattern}\\s*[\\/\\-\\.]\\s*${monthNumPattern}\\s*[\\/\\-\\.]\\s*${shortYear}\\b`, 'i'));

  return patterns;
}

/**
 * Build court name pattern - normalize common abbreviations
 */
function buildCourtPattern(courtName: string): RegExp | null {
  if (!courtName) return null;

  // First escape special regex chars, then apply transformations
  const escaped = escapeRegex(courtName);

  // Now apply transformations on the escaped string
  const normalized = escaped
    .replace(/\\s\+/g, '\\s+')   // Restore flexible whitespace (escapeRegex turned \s into \\s)
    .replace(/\s+/g, '\\s+')     // Make whitespace flexible
    .replace(/\\\./g, '\\.?');   // Make dots optional (escapeRegex turned . into \.)

  return new RegExp(normalized, 'i');
}

// ============================================================================
// SEARCH FUNCTIONS
// ============================================================================

interface PatternMatch {
  position: number;
  matchedText: string;
  matchType: 'ECLI' | 'CASE_NUMBER' | 'COURT_DATE' | 'COURT_ONLY';
}

/**
 * Search text for pattern matches
 */
function searchPattern(
  text: string,
  pattern: RegExp,
  matchType: PatternMatch['matchType']
): PatternMatch | null {
  const match = text.match(pattern);
  if (!match || match.index === undefined) return null;

  return {
    position: match.index,
    matchedText: match[0],
    matchType,
  };
}

/**
 * Find all citation matches in text, ordered by specificity
 */
function findCitationPositions(
  fullMd: string,
  ecli: string | null,
  caseNumber: string | null,
  courtName: string | null,
  isoDate: string | null
): PatternMatch | null {
  // Priority 1: ECLI (most specific)
  if (ecli) {
    const ecliPattern = buildEcliPattern(ecli);
    if (ecliPattern) {
      const match = searchPattern(fullMd, ecliPattern, 'ECLI');
      if (match) return match;
    }
  }

  // Priority 2: Case number
  if (caseNumber) {
    const casePatterns = buildCaseNumberPatterns(caseNumber);
    for (const pattern of casePatterns) {
      const match = searchPattern(fullMd, pattern, 'CASE_NUMBER');
      if (match) return match;
    }
  }

  // Priority 3: Court + Date combination
  if (courtName && isoDate) {
    const courtPattern = buildCourtPattern(courtName);
    const datePatterns = buildDatePatterns(isoDate);

    if (courtPattern && datePatterns.length > 0) {
      // Find court mentions
      const courtRegex = new RegExp(courtPattern.source, 'gi');
      let courtMatch;

      while ((courtMatch = courtRegex.exec(fullMd)) !== null) {
        const courtPos = courtMatch.index;

        // Look for date within 200 chars of court mention
        const searchStart = Math.max(0, courtPos - 100);
        const searchEnd = Math.min(fullMd.length, courtPos + courtMatch[0].length + 200);
        const searchWindow = fullMd.slice(searchStart, searchEnd);

        for (const datePattern of datePatterns) {
          const dateMatch = searchWindow.match(datePattern);
          if (dateMatch) {
            return {
              position: courtPos,
              matchedText: courtMatch[0],
              matchType: 'COURT_DATE',
            };
          }
        }
      }
    }
  }

  // Priority 4: Court name only (lowest confidence)
  if (courtName) {
    const courtPattern = buildCourtPattern(courtName);
    if (courtPattern) {
      const match = searchPattern(fullMd, courtPattern, 'COURT_ONLY');
      if (match) return match;
    }
  }

  return null;
}

// ============================================================================
// SNIPPET EXTRACTION
// ============================================================================

/**
 * Find sentence boundary (period followed by space/newline or end of text)
 */
function findSentenceStart(text: string, position: number): number {
  // Search backwards for sentence end
  for (let i = position - 1; i >= Math.max(0, position - 300); i--) {
    const nextChar = i + 1 < text.length ? text[i + 1] : '';
    if (text[i] === '.' && (nextChar === ' ' || nextChar === '\n')) {
      return i + 2; // Start after ". "
    }
    if (text[i] === '\n' && nextChar === '\n') {
      return i + 2; // Start after paragraph break
    }
  }
  return Math.max(0, position - 300);
}

function findSentenceEnd(text: string, position: number): number {
  // Search forwards for sentence end
  for (let i = position; i < Math.min(text.length, position + 300); i++) {
    const nextChar = i + 1 < text.length ? text[i + 1] : '';
    const isEndOfText = i + 1 >= text.length;
    if (text[i] === '.' && (nextChar === ' ' || nextChar === '\n' || isEndOfText)) {
      return i + 1; // Include the period
    }
    if (text[i] === '\n' && nextChar === '\n') {
      return i; // Stop at paragraph break
    }
  }
  return Math.min(text.length, position + 300);
}

/**
 * Extract snippet around position, attempting sentence alignment
 */
function extractSnippet(
  fullMd: string,
  position: number,
  windowSize: number = DEFAULT_SNIPPET_SIZE
): string {
  const halfWindow = Math.floor(windowSize / 2);

  // Start with basic window
  let start = Math.max(0, position - halfWindow);
  let end = Math.min(fullMd.length, position + halfWindow);

  // Try to align with sentence boundaries
  const sentenceStart = findSentenceStart(fullMd, start + 50);
  const sentenceEnd = findSentenceEnd(fullMd, end - 50);

  // Use sentence boundaries if they don't expand window too much
  if (sentenceStart > start - 100) start = sentenceStart;
  if (sentenceEnd < end + 100) end = sentenceEnd;

  let snippet = fullMd.slice(start, end).trim();

  // Add ellipsis indicators
  if (start > 0) snippet = '...' + snippet;
  if (end < fullMd.length) snippet = snippet + '...';

  return snippet;
}

// ============================================================================
// MAIN EXPORT
// ============================================================================

export interface CitationSnippetResult {
  snippet: string | null;
  matchedOn: 'ECLI' | 'CASE_NUMBER' | 'COURT_DATE' | 'COURT_ONLY' | null;
  position: number | null;
}

/**
 * Find where a citation appears in source text and extract surrounding snippet
 *
 * @param fullMd - Source decision markdown text
 * @param citedCourtName - Court name from citation
 * @param citedDate - Date in YYYY-MM-DD format
 * @param citedCaseNumber - Case/roll number
 * @param citedEcli - ECLI code if available
 * @returns Snippet and match metadata, or nulls if not found
 */
export function findCitationSnippet(
  fullMd: string | null,
  citedCourtName: string | null,
  citedDate: string | null,
  citedCaseNumber: string | null,
  citedEcli: string | null
): CitationSnippetResult {
  if (!fullMd) {
    return { snippet: null, matchedOn: null, position: null };
  }

  const match = findCitationPositions(
    fullMd,
    citedEcli,
    citedCaseNumber,
    citedCourtName,
    citedDate
  );

  if (!match) {
    return { snippet: null, matchedOn: null, position: null };
  }

  const snippet = extractSnippet(fullMd, match.position);

  return {
    snippet,
    matchedOn: match.matchType,
    position: match.position,
  };
}
