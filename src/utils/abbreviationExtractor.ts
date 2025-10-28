import { logger } from './logger.js';

export interface AbbreviationEntry {
  abbreviation: string;
  fullName: string;
  context?: string;
}

const ABBREVIATION_PATTERN = /\b(?<name>[A-ZÉÈÀÂÔÛÄÖÜŸ][\w\s'’éèàçïöü\-:,/]{3,120}?)\s*\(\s*(?:ci[-\s]?après|ci[-\s]?dessus|ci[-\s]?nommé|ci[-\s]?désigné|ci[-\s]?apres|hereinafter|hierna|hierboven|hiernaar)\s+['"]?(?<abbr>[A-Z][A-Z0-9.\-]{1,20})['"]?\s*\)/gimu;

const ABBR_EQUALS_PATTERN =
  /\b(?<abbr>[A-Z][A-Z0-9.\-]{1,12})\s+(?:est|sont|signifie|signifient|staat|staan|vertaalt zich|betekent)\s+(?:[‘'"])?(?<name>[A-ZÉÈÀÂÔÛÄÖÜŸ][\w\s'’éèàçïöü\-:,/]{3,120})(?:[’'"])?/gimu;

function normalizeAbbreviation(raw: string): string {
  return raw.replace(/[\s.]/g, '').toUpperCase();
}

function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/[\u2019]/g, "'").trim();
}

export function extractAbbreviations(
  decisionId: string,
  markdownText: string
): AbbreviationEntry[] {
  const results = new Map<string, AbbreviationEntry>();

  if (!markdownText || markdownText.trim() === '') {
    return [];
  }

  const applyMatch = (
    abbr: string,
    fullName: string,
    context: string
  ) => {
    const normalizedAbbr = normalizeAbbreviation(abbr);
    const normalizedName = normalizeName(fullName);

    if (normalizedAbbr.length < 2 || normalizedAbbr.length > 12) {
      return;
    }

    if (!results.has(normalizedAbbr)) {
      results.set(normalizedAbbr, {
        abbreviation: normalizedAbbr,
        fullName: normalizedName,
        context,
      });
    }
  };

  for (const match of markdownText.matchAll(ABBREVIATION_PATTERN)) {
    const { groups } = match;
    if (!groups?.abbr || !groups.name) continue;

    applyMatch(groups.abbr, groups.name, match[0]);
  }

  for (const match of markdownText.matchAll(ABBR_EQUALS_PATTERN)) {
    const { groups } = match;
    if (!groups?.abbr || !groups.name) continue;
    applyMatch(groups.abbr, groups.name, match[0]);
  }

  if (results.size > 0) {
    logger.debug('Extracted legal abbreviations', {
      decisionId,
      abbreviations: Array.from(results.values()).map((entry) => ({
        abbreviation: entry.abbreviation,
        fullName: entry.fullName,
      })),
    });
  }

  return Array.from(results.values());
}
