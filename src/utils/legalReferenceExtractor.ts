/**
 * Legal Reference Extractor for Belgian Court Decisions
 *
 * Production-tested extraction of legal identifiers and references from Belgian/EU
 * court decisions. Handles OCR errors, spacing issues, and multiple format variations.
 *
 * Extracts:
 * - ELI (European Legislation Identifier) - Belgian and EU formats
 * - CELEX (EU document identifiers) - with sector-specific validation
 * - NUMAC (Belgian legal text identifiers)
 * - File numbers (Dossier Numéro)
 * - Domain-specific URLs (data.europa.eu, eur-lex, ejustice, etaamb)
 * - Bibliographic references
 */

export interface LegalReferences {
  eli: string[];
  celex: string[];
  numac: string[];
  fileNumber: string[];
  dataEuropa: string[];
  eurLexUrls: string[];
  justelUrls: string[];
  etaamb: string[];
  bibliographicRefs: string[];
}

const DIGIT_OCR_MAP: Record<string, string> = { O: '0', o: '0', I: '1', l: '1', ı: '1' };
const YEAR_MIN = 1789;
const YEAR_MAX = 2025;

const HOSTS = {
  DATA_EU: 'data.europa.eu',
  EUR_LEX: 'eur-lex.europa.eu',
  JUSTEL: 'ejustice.just.fgov.be',
  ETAAMB: 'etaamb.openjustice.be',
} as const;

// CELEX sector-specific type codes (from official tables)
const CELEX_TYPES: Record<string, Set<string>> = {
  // Sector 3: Legal acts
  '3': new Set(['A','B','C','D','E','F','G','H','J','K','L','M','O','Q','R','S','X','Y']),
  // Sector 5: Preparatory documents
  '5': new Set([
    'AG','KG','IG','XG',
    'PC','DC','JC','SC','EC','FC','GC','M','AT','AS','XC',
    'AP','BP','IP','DP','XP',
    'AA','TA','SA','XA',
    'AB','HB','XB',
    'AE','IE','AC','XE',
    'AR','IR','XR',
    'AK','XK',
    'XX',
  ]),
  // Sector 6: EU case-law
  '6': new Set([
    'CJ','CO','CC','CS','CT','CV','CX','CD','CP','CN','CA','CB','CU','CG',
    'TJ','TO','TC','TT',
  ]),
};

function trimPunct(s: string): string {
  return s.replace(/[)\]\}.,;:!?…]+$/u, '').replace(/^[({\[]+/u, '').trim();
}

function collapseSpacesAroundDelims(s: string): string {
  return s
    .replace(/\u00AD/g, '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*\.\s*/g, '.')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*:\s*/g, ':');
}

function lowerSchemeHost(u: string): string {
  const m = u.match(/^(https?):\/\/([^\/?#]+)(.*)$/i);
  if (!m) return u;
  return `${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3] || ''}`;
}

function normalizeUrl(u: string): string | null {
  try {
    let s = collapseSpacesAroundDelims(trimPunct(u));
    s = s.replace(/h\s*t\s*t\s*p\s*s?\s*:\s*\/\s*\/\s*/gi, 'https://');
    const hasScheme = /^[a-z]+:\/\//i.test(s);
    if (!hasScheme) s = 'https://' + s.replace(/^\/+/, '');
    const url = new URL(s);
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

function onlyDigitsOCR(s: string): string {
  return s.replace(/[OIlı]/g, (c) => DIGIT_OCR_MAP[c] || c);
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function isValidYMD(y: number, m: number, d: number): boolean {
  const dt = new Date(y, m - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/* =============================== ELI =============================== */

function extractELI(text: string): string[] {
  const found = new Set<string>();

  const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const raw = m[0];
    const norm = normalizeUrl(raw);
    if (!norm) continue;
    if (!/\/eli\//i.test(norm)) continue;
    const ok = validateEliUrl(norm);
    if (ok) found.add(ok);
  }

  const BARE_ELI = /\beli\/[^\s<>"')\]]+/gi;
  while ((m = BARE_ELI.exec(text)) !== null) {
    const raw = collapseSpacesAroundDelims(trimPunct(m[0]));
    const ok = validateEliPath(raw);
    if (ok) found.add(ok);
  }

  return Array.from(found);
}

function validateEliUrl(u: string): string | null {
  try {
    const url = new URL(u);
    const path = url.pathname;
    if (!/\/eli\//i.test(path)) return null;

    if (url.hostname.endsWith(HOSTS.JUSTEL)) {
      return isValidBelgianEliPath(path) ? lowerSchemeHost(u) : null;
    }

    if (url.hostname.endsWith(HOSTS.EUR_LEX) || url.hostname.endsWith(HOSTS.DATA_EU)) {
      return isLikelyEuEliPath(path) ? lowerSchemeHost(u) : null;
    }

    return (isValidBelgianEliPath(path) || isLikelyEuEliPath(path)) ? lowerSchemeHost(u) : null;
  } catch {
    return null;
  }
}

function validateEliPath(p: string): string | null {
  if (!/^eli\//i.test(p)) return null;
  const fakeUrl = 'https://host/' + p.replace(/^\/+/, '');
  return validateEliUrl(fakeUrl) ? p : null;
}

function isValidBelgianEliPath(path: string): boolean {
  const parts = path.replace(/^\/+/, '').split('/');
  if (parts.length < 6) return false;
  if (parts[0].toLowerCase() !== 'eli') return false;

  const yyyy = +parts[2], mm = +parts[3], dd = +parts[4];
  if (!(yyyy >= 1800 && yyyy <= YEAR_MAX)) return false;
  if (!isValidYMD(yyyy, mm, dd)) return false;

  const id = parts[5];
  const idDigits = onlyDigitsOCR(id);
  if (!/^[0-9A-Z]{10}$/.test(id) || idDigits.slice(0, 4) !== String(yyyy)) return false;

  return true;
}

function isLikelyEuEliPath(path: string): boolean {
  const p = path.toLowerCase();
  if (!/\/eli\//.test(p)) return false;

  const segs = p.replace(/^\/+/, '').split('/');
  if (segs[0] !== 'eli') return false;
  if (segs.length < 4) return false;

  const type = segs[1];
  if (!/^[a-z]{3,12}$/.test(type)) return false;

  const yyyy = segs[2];
  if (!/^\d{4}$/.test(yyyy)) return false;

  const third = segs[3];
  if (!/^(\d{1,5}|(\d{4}-\d{2}-\d{2}))$/.test(third)) return false;

  return true;
}

/* =============================== CELEX =============================== */

function extractCELEX(text: string): string[] {
  const out = new Set<string>();

  const LAB = /\bCELEX(?:%3A|[:=])?\s*([0-9A-Za-z()[\]\s]{8,32})/gi;
  let m: RegExpExecArray | null;
  while ((m = LAB.exec(text)) !== null) {
    const code = canonicalizeCelex(m[1]);
    if (code) out.add(code);
  }

  const BARE = /(?:^|[^A-Z0-9])([356](?:[0-9OIl]\s*){4}\s*[A-Za-z](?:\s*[A-Za-z])?\s*(?:[0-9OIl]\s*){4,6}(?:\s*R\s*\(\s*\d{2}\s*\))?)(?![A-Z0-9])/gi;
  while ((m = BARE.exec(text)) !== null) {
    const code = canonicalizeCelex(m[1]);
    if (code) out.add(code);
  }

  return Array.from(out);
}

function canonicalizeCelex(raw: string): string | null {
  let s = raw.replace(/\s+/g, '').toUpperCase();
  s = s.replace(/[OIl]/g, (c) => DIGIT_OCR_MAP[c] || c);

  let suffix = '';
  const corr = s.match(/R\(\d{2}\)$/);
  if (corr) {
    suffix = corr[0];
    s = s.slice(0, -corr[0].length);
  }

  const m = s.match(/^([356])(\d{4})([A-Z]{1,2})(\d{4,6})$/);
  if (!m) return null;

  const sector = m[1], year = m[2], typ = m[3], num = m[4];

  const set = CELEX_TYPES[sector];
  if (!set || !set.has(typ)) return null;

  const y = +year;
  if (!(y >= 1000 && y <= 2999)) return null;

  return sector + year + typ + num + suffix;
}

/* =============================== NUMAC =============================== */

function extractNUMAC(text: string): string[] {
  const out = new Set<string>();

  const LAB = /\bnumac\s*[:=]?\s*([0-9A-EOIl]{10})\b/gi;
  let m: RegExpExecArray | null;
  while ((m = LAB.exec(text)) !== null) {
    const norm = normalizeNumac(m[1]);
    if (norm) out.add(norm);
  }

  const Q = /\bnumac_search\s*=\s*([0-9A-EOIl]{10})\b/gi;
  while ((m = Q.exec(text)) !== null) {
    const norm = normalizeNumac(m[1]);
    if (norm) out.add(norm);
  }

  const FREE = /((?:[0-9A-EOIl][\s./\-_]*){10})/g;
  while ((m = FREE.exec(text)) !== null) {
    const seq = m[1].replace(/[\s./\-_]/g, '');
    const norm = normalizeNumac(seq);
    if (norm) out.add(norm);
  }

  return Array.from(out);
}

function normalizeNumac(candidate: string): string | null {
  let s = candidate.toUpperCase().replace(/[\s./\-_]/g, '');
  if (s.length !== 10) return null;

  const yyyy = onlyDigitsOCR(s.slice(0, 4));
  if (!/^\d{4}$/.test(yyyy)) return null;
  const y = +yyyy;
  if (y < YEAR_MIN || y > YEAR_MAX) return null;

  const c5 = s[4];
  if (!(/[0-9A-E]/.test(c5))) return null;

  const tail = onlyDigitsOCR(s.slice(5));
  if (!/^\d{5}$/.test(tail)) return null;

  return yyyy + c5 + tail;
}

/* =============================== File Numbers =============================== */

function extractFileNumbers(text: string): string[] {
  const out = new Set<string>();

  const LAB = /doss(?:ier)?\s+num(?:é|e)ro|doss(?:ier)?\s+n[°ºo]/gi;
  let m: RegExpExecArray | null;
  while ((m = LAB.exec(text)) !== null) {
    const slice = text.slice(m.index, m.index + 60);
    const dm = slice.match(/(\d{4})\s*[-/.]\s*([01]?\d)\s*[-/.]\s*([0-3]?\d)\s*\/\s*(\d{1,3})/);
    if (dm) {
      const canon = canonFile(dm[1], dm[2], dm[3], dm[4]);
      if (canon) out.add(canon);
    }
  }

  const BARE = /([12][0-9OIl]{3})\s*[-/.]\s*([01OIl]?\d)\s*[-/.]\s*([0-3OIl]?\d)\s*\/\s*(\d{1,3})/gi;
  let b: RegExpExecArray | null;
  while ((b = BARE.exec(text)) !== null) {
    const canon = canonFile(b[1], b[2], b[3], b[4]);
    if (canon) out.add(canon);
  }

  return Array.from(out);
}

function canonFile(y: string, m: string, d: string, n: string): string | null {
  const Y = +onlyDigitsOCR(y), M = +onlyDigitsOCR(m), D = +onlyDigitsOCR(d), N = +onlyDigitsOCR(n);
  if (!(Y >= 1800 && Y <= YEAR_MAX)) return null;
  if (!isValidYMD(Y, M, D)) return null;
  return `${Y}-${pad2(M)}-${pad2(D)}/${pad2(N)}`;
}

/* =============================== Domain URLs =============================== */

function extractScopedUrls(text: string): {
  dataEuropa: string[];
  eurLexUrls: string[];
  justelUrls: string[];
  etaamb: string[];
} {
  const dataEuropa = new Set<string>();
  const eurLex = new Set<string>();
  const justel = new Set<string>();
  const etaamb = new Set<string>();

  const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const norm = normalizeUrl(m[0]);
    if (!norm) continue;
    try {
      const { hostname } = new URL(norm);
      if (hostname.endsWith(HOSTS.DATA_EU)) dataEuropa.add(norm);
      else if (hostname.endsWith(HOSTS.EUR_LEX)) eurLex.add(norm);
      else if (hostname.endsWith(HOSTS.JUSTEL)) justel.add(norm);
      else if (hostname.endsWith(HOSTS.ETAAMB)) etaamb.add(norm);
    } catch {}
  }

  return {
    dataEuropa: Array.from(dataEuropa),
    eurLexUrls: Array.from(eurLex),
    justelUrls: Array.from(justel),
    etaamb: Array.from(etaamb),
  };
}

/* =============================== Bibliographic refs =============================== */

function extractBiblio(text: string): string[] {
  const out = new Set<string>();

  const ART = /\b(?:art(?:\.|icle)?|articles?|artikel(?:en)?|art)\b[\s.]*\d{1,4}(?:\s*(?:bis|ter|quater))?(?:\s*(?:§|alinéa|al\.?)\s*\d+(?:er|re)?)?/gim;
  const WINDOW = 200;
  const CONTAINER = /\b(loi|wet|wetboek|code\b|C\.\s*(?:civ|p[ée]n|jud|soc)\.?|WIB\b|Codex\b|Règlement|R[eé]g\.)/i;

  let m: RegExpExecArray | null;
  while ((m = ART.exec(text)) !== null) {
    const start = m.index;
    const seg = text.slice(start, start + WINDOW);
    if (CONTAINER.test(seg)) {
      const cleaned = trimPunct(seg.split(/[\r\n]/, 1)[0]).replace(/\s+/g, ' ').trim();
      if (cleaned.length >= 6) out.add(cleaned);
    }
  }

  return Array.from(out).slice(0, 80);
}

/* =============================== Main =============================== */

/**
 * Extract all legal references from decision text
 *
 * Returns comprehensive reference object with 9 arrays covering all Belgian/EU
 * legal identifiers, URLs, and bibliographic citations.
 */
export function extractLegalReferences(text: string): LegalReferences {
  const empty: LegalReferences = {
    eli: [],
    celex: [],
    numac: [],
    fileNumber: [],
    dataEuropa: [],
    eurLexUrls: [],
    justelUrls: [],
    etaamb: [],
    bibliographicRefs: [],
  };

  if (!text || typeof text !== 'string' || !text.trim()) {
    return empty;
  }

  const sortAsc = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

  const eli = extractELI(text).sort(sortAsc);
  const celex = extractCELEX(text).sort(sortAsc);
  const numac = extractNUMAC(text).sort(sortAsc);
  const fileNumber = extractFileNumbers(text).sort(sortAsc);
  const urls = extractScopedUrls(text);
  const bibliographicRefs = extractBiblio(text).sort(sortAsc);

  return {
    eli,
    celex,
    numac,
    fileNumber,
    dataEuropa: urls.dataEuropa.sort(sortAsc),
    eurLexUrls: urls.eurLexUrls.sort(sortAsc),
    justelUrls: urls.justelUrls.sort(sortAsc),
    etaamb: urls.etaamb.sort(sortAsc),
    bibliographicRefs,
  };
}

/**
 * Check if any references were found
 *
 * Returns false if all arrays are empty (nothing to enrich).
 * Used for cost-saving: skip expensive LLM call if no enrichable content.
 */
export function hasAnyReferences(refs: LegalReferences): boolean {
  return (
    refs.eli.length > 0 ||
    refs.celex.length > 0 ||
    refs.numac.length > 0 ||
    refs.fileNumber.length > 0 ||
    refs.dataEuropa.length > 0 ||
    refs.eurLexUrls.length > 0 ||
    refs.justelUrls.length > 0 ||
    refs.etaamb.length > 0 ||
    refs.bibliographicRefs.length > 0
  );
}
