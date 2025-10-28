import type { AbbreviationEntry } from './abbreviationExtractor.js';

interface RawProvision {
  provisionSequence: number;
  parentActSequence: number;
  provisionNumber: string;
  provisionNumberKey: string;
  parentActType: string;
  parentActName: string;
  parentActDate: string | null;
  parentActNumber: string | null;
  internalProvisionId?: string | null;
  internalParentActId?: string | null;
  provisionId?: string | null;
  parentActId?: string | null;
}

interface SanitiseOptions {
  decisionId: string;
  language: string;
  abbreviations?: AbbreviationEntry[];
}

const FR_PARENT_TYPE_MAP: Record<string, string> = {
  'loi': 'LOI',
  'lois': 'LOI',
  'arrêté royal': 'ARRETE_ROYAL',
  'arrete royal': 'ARRETE_ROYAL',
  'a.r.': 'ARRETE_ROYAL',
  'ar': 'ARRETE_ROYAL',
  'code': 'CODE',
  'constitution': 'CONSTITUTION',
  'règlement (ue)': 'REGLEMENT_UE',
  'reglement (ue)': 'REGLEMENT_UE',
  'règlement': 'REGLEMENT_UE',
  'directive (ue)': 'DIRECTIVE_UE',
  'directive': 'DIRECTIVE_UE',
  'traité': 'TRAITE',
  'traite': 'TRAITE',
  'arrêté du gouvernement': 'ARRETE_GOUVERNEMENT',
  'arrete du gouvernement': 'ARRETE_GOUVERNEMENT',
  'ordonnance': 'ORDONNANCE',
  'décret': 'DECRET',
  'decret': 'DECRET',
};

const NL_PARENT_TYPE_MAP: Record<string, string> = {
  'wet': 'WET',
  'w.': 'WET',
  'koninklijk besluit': 'KONINKLIJK_BESLUIT',
  'k.b.': 'KONINKLIJK_BESLUIT',
  'kb': 'KONINKLIJK_BESLUIT',
  'wetboek': 'WETBOEK',
  'grondwet': 'GRONDWET',
  'verordening (eu)': 'EU_VERORDENING',
  'verordening': 'EU_VERORDENING',
  'richtlijn (eu)': 'EU_RICHTLIJN',
  'richtlijn': 'EU_RICHTLIJN',
  'verdrag': 'VERDRAG',
  'besluit van de regering': 'BESLUIT_VAN_DE_REGERING',
  'ordonnantie': 'ORDONNANTIE',
  'decreet': 'DECREET',
};

const SYNONYM_ACT_NAMES: Record<string, string> = {
  'w. venn.': 'wetboek van vennootschappen',
  'w.vern.': 'wetboek van vennootschappen',
  'w.v.': 'wetboek van vennootschappen',
  'wetboek van vennootschappen en verenigingen': 'wetboek van vennootschappen',
  'code des droits d\'enregistrement': 'code des droits d\'enregistrement',
  'code d\'instruction criminelle': 'code d\'instruction criminelle',
};

function normaliseWhitespace(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function normaliseParentActKey(
  provision: RawProvision,
  abbreviations?: AbbreviationEntry[]
): string {
  let parentActName = normaliseWhitespace(provision.parentActName).toLowerCase();

  if (abbreviations && abbreviations.length > 0) {
    for (const entry of abbreviations) {
      const pattern = new RegExp(`\\b${entry.abbreviation}\\b`, 'i');
      if (pattern.test(parentActName)) {
        parentActName = normaliseWhitespace(entry.fullName).toLowerCase();
        break;
      }
    }
  }

  const synonym = SYNONYM_ACT_NAMES[parentActName];
  if (synonym) {
    parentActName = synonym;
  }

  return [
    provision.parentActType,
    parentActName,
    provision.parentActDate ?? '',
  ]
    .map((segment) => segment ?? '')
    .join('||');
}

function isTreatyDecimal(
  provision: RawProvision,
  provisionNumberKey: string
): boolean {
  const treatyTypes = new Set([
    'TRAITE',
    'VERDRAG',
    'REGLEMENT_UE',
    'EU_VERORDENING',
    'DIRECTIVE_UE',
    'EU_RICHTLIJN',
  ]);

  if (!treatyTypes.has(provision.parentActType)) {
    return false;
  }

  return /^[0-9]{1,3}\.[0-9]{1,3}$/.test(provisionNumberKey);
}

function normaliseParentActType(
  rawType: string | undefined,
  language: string | undefined
): string | null {
  if (!rawType) return null;

  const cleaned = rawType.trim().toUpperCase();
  if (!cleaned) return null;

  const lang = (language || 'FR').toUpperCase();
  const map = lang === 'NL' ? NL_PARENT_TYPE_MAP : FR_PARENT_TYPE_MAP;

  if (Object.values(map).includes(cleaned)) {
    return cleaned;
  }

  const lower = cleaned.toLowerCase();
  const normalised = map[lower];
  return normalised || null;
}

function normaliseProvisionNumberKey(
  rawKey: string | undefined,
  provision: RawProvision
): string | null {
  if (!rawKey) return null;
  let key = rawKey.trim();
  if (!key) return null;

  // Keep treaty decimals (X.Y) for EU/International law
  if (isTreatyDecimal(provision, key)) {
    return key;
  }

  // Remove paragraph markers, degree signs, commas, letters
  key = key
    .replace(/§+\s*\d+/gi, '')
    .replace(/[°º]/g, '')
    .replace(/[,]/g, '')
    .replace(/\b(lid|alinéa|alin\.?)\b/gi, '')
    .replace(/[a-zA-Z]/g, '')
    .replace(/\s+/g, '')
    .replace(/\.+$/g, '');

  if (!key) return null;
  return key;
}

const ARTICLE_REGEX = /\b(art\.?|article|artikelen?|artikel)\b\s*[0-9]/i;

export function sanitiseCitedProvisions(
  rawProvisions: RawProvision[],
  options: SanitiseOptions
): RawProvision[] {
  if (!Array.isArray(rawProvisions) || rawProvisions.length === 0) {
    return [];
  }

  const parentActSequences = new Map<string, number>();
  const provisionKeys = new Set<string>();
  let nextParentActSequence = 1;
  let nextProvisionSequence = 1;

  const sanitised: RawProvision[] = [];

  rawProvisions.forEach((provision) => {
    const normalisedType = normaliseParentActType(
      provision.parentActType,
      options.language
    );
    if (!normalisedType) {
      return;
    }

    const workingProvision: RawProvision = {
      ...provision,
      parentActType: normalisedType,
    };

    const normalisedKey = normaliseProvisionNumberKey(
      provision.provisionNumberKey,
      workingProvision
    );
    if (!normalisedKey) {
      return;
    }

    if (
      !workingProvision.provisionNumber ||
      !ARTICLE_REGEX.test(workingProvision.provisionNumber)
    ) {
      return;
    }

    const parentKey = normaliseParentActKey(
      workingProvision,
      options.abbreviations
    );

    if (!parentActSequences.has(parentKey)) {
      parentActSequences.set(parentKey, nextParentActSequence++);
    }

    const parentActSequence = parentActSequences.get(parentKey)!;
    const provisionNumberKey = normalisedKey;

    const dedupKey = `${parentActSequence}::${provisionNumberKey.toLowerCase()}`;

    if (
      provisionKeys.has(dedupKey) &&
      !isTreatyDecimal(workingProvision, provisionNumberKey)
    ) {
      return;
    }

    provisionKeys.add(dedupKey);

    const parentActId = `ACT-${options.decisionId}-${String(
      parentActSequence
    ).padStart(3, '0')}`;
    const provisionId = `ART-${options.decisionId}-${String(
      nextProvisionSequence
    ).padStart(3, '0')}`;

    sanitised.push({
      ...provision,
      parentActSequence,
      provisionSequence: nextProvisionSequence++,
      internalParentActId: parentActId,
      internalProvisionId: provisionId,
      provisionId: null,
      parentActId: null,
      provisionNumber: normaliseWhitespace(workingProvision.provisionNumber),
      provisionNumberKey: normalisedKey,
      parentActType: normalisedType,
      parentActName: normaliseWhitespace(workingProvision.parentActName),
      parentActNumber: normaliseWhitespace(workingProvision.parentActNumber) || null,
    });
  });

  return sanitised;
}

export type { SanitiseOptions };
