/**
 * Regex-based Citation Region Detector
 *
 * NEW ARCHITECTURE: "Regex finds regions + LLM extracts everything"
 *
 * This module detects text REGIONS where citations likely exist, but does NOT extract structured fields.
 * Field extraction is delegated to the LLM in Stage 2.
 *
 * Algorithm:
 * 1. Find all triggers (ECLI, court names, dates, case numbers, biblio patterns)
 * 2. Cluster nearby triggers (within 500 chars) into regions
 * 3. Extract 1200-char windows around each cluster
 * 4. Return regions with metadata (confidence, jurisdiction hints)
 */

// ============================================================================
// INTERFACES
// ============================================================================

/**
 * Individual trigger detected by regex patterns
 */
export interface TriggerHit {
  type: 'ECLI' | 'COURT' | 'DATE' | 'CASE_NUMBER' | 'BIBLIO';
  text: string;       // The matched text
  position: number;   // Position in fullMarkdown
}

/**
 * Citation region - a text window potentially containing citation(s)
 * LLM will extract structured fields from these regions in Stage 2
 */
export interface CitationRegion {
  regionId: number;
  text: string;              // 1200-1500 char window containing potential citation(s)
  position: number;          // Start position of window in fullMarkdown
  triggerPosition: number;   // Position of the primary trigger that created this region
  triggerType: 'ECLI' | 'COURT_KEYWORD' | 'DATE_PATTERN' | 'BIBLIOGRAPHIC';
  triggers: TriggerHit[];    // All triggers in this region
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  potentialJurisdiction?: 'BE' | 'EU' | 'INT' | 'UNKNOWN';  // Hint for LLM, not definitive
}

// ============================================================================
// CONSTANTS (PRESERVED FROM ORIGINAL)
// ============================================================================

/**
 * Court tokens with jurisdiction info
 * PRESERVED: Domain-expert validated patterns
 */
interface CourtInfo {
  jurisdiction: 'BE' | 'EU' | 'INT';
  patterns: string[];
}

const COURT_TOKENS: Record<string, CourtInfo> = {
  // Belgian Courts
  'CASS': {
    jurisdiction: 'BE',
    patterns: ['Cass\\.?', 'Cassatie', 'Hof\\s+van\\s+Cassatie', 'Cour\\s+de\\s+cassation', 'Arr\\.\\s*Cass\\.?']
  },
  'GHCC': {
    jurisdiction: 'BE',
    patterns: ['GwH', 'Grondwettelijk\\s+Hof', 'Het\\s+Grondwettelijk\\s+Hof', 'C\\.\\s*Const\\.?', 'Cour\\s+constitutionnelle', 'Const\\.?', 'A\\.C\\.C\\.?']
  },
  'RVSCE': {
    jurisdiction: 'BE',
    patterns: ['C\\.\\s*E\\.?', 'RvS', "Conseil\\s+d['']État", 'Raad\\s+van\\s+State', 'C\\.\\s*Etat']
  },
  'ARBH': {
    jurisdiction: 'BE',
    patterns: ['Arbh\\.?', 'Arbeidshof', 'C\\.\\s*trav\\.?', 'Cour\\s+du\\s+travail']
  },
  'ARBRB': {
    jurisdiction: 'BE',
    patterns: ['Arbrb\\.?', 'Arbeidsrechtbank', 'Trib\\.\\s*trav\\.?', 'Tribunal\\s+du\\s+travail']
  },
  'COMM': {
    jurisdiction: 'BE',
    patterns: ['Comm\\.?', 'Kh\\.?', 'Trib\\.\\s*entr\\.?', "Tribunal\\s+de\\s+l['']entreprise", 'Ondernemingsrechtbank', 'Tribunal\\s+de\\s+commerce']
  },
  'TPI': {
    jurisdiction: 'BE',
    patterns: ['TPI', 'Trib\\.?', 'Rb\\.?', 'Rechtbank\\s+van\\s+Eerste\\s+Aanleg', 'Tribunal\\s+de\\s+première\\s+instance']
  },
  'APPEL': {
    jurisdiction: 'BE',
    patterns: ['C\\.\\s*appel', "Cour\\s+d['']appel", 'Hof\\s+van\\s+Beroep']
  },
  'ASSISES': {
    jurisdiction: 'BE',
    patterns: ['Cour\\s+ass\\.?', "Cour\\s+d['']assises", 'Hof\\s+van\\s+Assisen', 'Ass\\.?', 'Assis\\.?']
  },
  'POLICE': {
    jurisdiction: 'BE',
    patterns: ['Pol\\.?', 'Tribunal\\s+de\\s+police', 'Politierechtbank']
  },
  'PAIX': {
    jurisdiction: 'BE',
    patterns: ['JP', 'J\\.P\\.?', 'Justice\\s+de\\s+paix', 'Vredegerecht', 'Vred\\.?']
  },
  'KI': {
    jurisdiction: 'BE',
    patterns: ['KI', 'mis\\.\\s*acc\\.?', 'Chambre\\s+des\\s+mises\\s+en\\s+accusation', 'Kamer\\s+van\\s+inbeschuldigingstelling']
  },
  'CONSEIL': {
    jurisdiction: 'BE',
    patterns: ['ch\\.\\s*cons\\.?', 'Chambre\\s+du\\s+conseil', 'Raadkamer']
  },
  'CORR': {
    jurisdiction: 'BE',
    patterns: ['Trib\\.\\s*corr\\.?', 'Corr\\.\\s*rb\\.?', 'Tribunal\\s+correctionnel', 'Correctionele\\s+rechtbank']
  },

  // EU Courts
  'CJUE': {
    jurisdiction: 'EU',
    patterns: ['CJUE', 'HvJ', 'Cour\\s+de\\s+justice', 'Hof\\s+van\\s+Justitie', 'C\\.J\\.U\\.E\\.?', 'Court\\s+of\\s+Justice', 'ECJ']
  },
  'TUE': {
    jurisdiction: 'EU',
    patterns: ['TUE', "Tribunal\\s+de\\s+l['']UE", 'Gerecht\\s+van\\s+de\\s+EU', 'General\\s+Court']
  },
  'TFUE': {
    jurisdiction: 'EU',
    patterns: ['TFUE', 'Tribunal\\s+de\\s+la\\s+fonction\\s+publique', 'Gerecht\\s+voor\\s+ambtenarenzaken']
  },

  // International Courts
  'CEDH': {
    jurisdiction: 'INT',
    patterns: ['CEDH', 'EHRM', "Cour\\s+européenne\\s+des\\s+droits\\s+de\\s+l['']homme", 'Europees\\s+Hof\\s+voor\\s+de\\s+Rechten\\s+van\\s+de\\s+Mens', 'European\\s+Court\\s+of\\s+Human\\s+Rights', 'ECtHR']
  },
  'CIJ': {
    jurisdiction: 'INT',
    patterns: ['CIJ', 'ICJ', 'Cour\\s+internationale\\s+de\\s+justice', 'Internationaal\\s+Gerechtshof', 'International\\s+Court\\s+of\\s+Justice']
  },
  'CPI': {
    jurisdiction: 'INT',
    patterns: ['CPI', 'ICC', 'Cour\\s+pénale\\s+internationale', 'Internationaal\\s+Strafhof', 'International\\s+Criminal\\s+Court']
  },
  'BENELUX': {
    jurisdiction: 'INT',
    patterns: ['Jur\\.\\s*Ben\\.?', 'BenGH', 'Cour\\s+de\\s+justice\\s+Benelux', 'Benelux-Gerechtshof']
  },
  'TAS': {
    jurisdiction: 'INT',
    patterns: ['TAS', 'CAS', 'Tribunal\\s+arbitral\\s+du\\s+sport', 'Hof\\s+van\\s+Arbitrage\\s+voor\\s+Sport', 'Court\\s+of\\s+Arbitration\\s+for\\s+Sport']
  }
};

/**
 * Belgian court locations
 * PRESERVED: Used for jurisdiction hints
 */
const LOCATIONS = [
  'Antwerpen', 'Anvers', 'Bergen', 'Mons', 'Brussel', 'Bruxelles', 'Gent', 'Gand',
  'Luik', 'Liège', 'Leuven', 'Louvain', 'Namen', 'Namur', 'Hasselt', 'Tongeren',
  'Dendermonde', 'Mechelen', 'Turnhout', 'Oudenaarde', 'Charleroi', 'Eupen',
  'Hainaut', 'Henegouwen', 'Brabant\\s+Wallon', 'Waals-Brabant', 'Brabant',
  'Limburg', 'Limbourg', 'Luxembourg', 'Luxemburg', 'Oost-Vlaanderen', 'West-Vlaanderen',
  'Flandre\\s+Orientale', 'Flandre\\s+Occidentale'
];

// ============================================================================
// HELPER FUNCTIONS (PRESERVED FROM ORIGINAL)
// ============================================================================

/**
 * Determine jurisdiction from court name (used for hints)
 * PRESERVED: Reused for potentialJurisdiction hints
 */
function determineJurisdiction(courtName: string): 'BE' | 'EU' | 'INT' | 'UNKNOWN' {
  if (!courtName) return 'UNKNOWN';

  // Check each court type
  for (const courtInfo of Object.values(COURT_TOKENS)) {
    for (const pattern of courtInfo.patterns) {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(courtName)) {
        return courtInfo.jurisdiction;
      }
    }
  }

  const courtUpper = courtName.toUpperCase();

  // Fallback: EU keywords
  if (courtUpper.includes('EUROP') && !courtUpper.includes('RECHT') && !courtUpper.includes('DROIT')) {
    return 'EU';
  }

  // Fallback: International keywords
  if (courtUpper.includes('INTERNATIONAL') || courtUpper.includes('INTERNATIONA')) {
    return 'INT';
  }

  // Check for Belgian location indicators
  for (const location of LOCATIONS) {
    if (courtName.toLowerCase().includes(location.toLowerCase())) {
      return 'BE';
    }
  }

  return 'UNKNOWN';
}

/**
 * Get jurisdiction from ECLI code
 * PRESERVED: Used for ECLI trigger jurisdiction hints
 */
function getJurisdictionFromECLI(ecli: string): 'BE' | 'EU' | 'INT' | 'UNKNOWN' {
  if (!ecli) return 'UNKNOWN';

  const parts = ecli.split(':');
  if (parts.length < 2) return 'UNKNOWN';

  const country = parts[1];

  if (country === 'BE') return 'BE';
  if (country === 'EU' || country === 'CE') return 'EU';
  if (country === 'XX' || country === 'INT') return 'INT';

  return 'UNKNOWN';
}

// ============================================================================
// TRIGGER DETECTION FUNCTIONS (NEW)
// ============================================================================

/**
 * Find ECLI triggers in text
 * Returns positions where ECLI codes appear, filtering out self-references
 */
function findECLITriggers(text: string, decisionId: string): TriggerHit[] {
  const triggers: TriggerHit[] = [];
  const seenECLIs = new Set<string>();

  const ecliPatterns = [
    /ECLI:[A-Z]{2}:[A-Z0-9]+:\d{4}:[A-Z0-9\.\-]+/gi,
    /ECLI\s*:\s*[A-Z]{2}\s*:\s*[A-Z0-9]+\s*:\s*\d{4}\s*:\s*[A-Z0-9\.\-]+/gi,
    /\bECLI[-\s]*[A-Z]{2}[-\s]*[A-Z0-9]+[-\s]*\d{4}[-\s]*[A-Z0-9\.\-]+\b/gi
  ];

  for (const pattern of ecliPatterns) {
    const matches = [...text.matchAll(pattern)];

    for (const match of matches) {
      const ecli = match[0].replace(/\s+/g, '');

      // Filter self-references (exact ECLI match only)
      if (ecli === decisionId) {
        continue;
      }

      if (!seenECLIs.has(ecli)) {
        seenECLIs.add(ecli);

        triggers.push({
          type: 'ECLI',
          text: ecli,
          position: match.index!
        });
      }
    }
  }

  return triggers;
}

/**
 * Build comprehensive court regex from all variations
 */
function buildCourtRegex(): RegExp {
  const allPatterns: string[] = [];
  for (const courtInfo of Object.values(COURT_TOKENS)) {
    allPatterns.push(...courtInfo.patterns);
  }
  return new RegExp('\\b(' + allPatterns.join('|') + ')\\b', 'gi');
}

/**
 * Find court name triggers in text
 * Returns positions where court keywords appear
 */
function findCourtTriggers(text: string): TriggerHit[] {
  const triggers: TriggerHit[] = [];
  const courtRegex = buildCourtRegex();

  const matches = [...text.matchAll(courtRegex)];

  for (const match of matches) {
    triggers.push({
      type: 'COURT',
      text: match[0],
      position: match.index!
    });
  }

  return triggers;
}

/**
 * Find date triggers in text
 * Returns positions where date patterns appear
 */
function findDateTriggers(text: string): TriggerHit[] {
  const triggers: TriggerHit[] = [];

  const datePatterns = [
    // DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    /\b(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{4})\b/g,
    // DD/MM/YY or DD-MM-YY
    /\b(\d{1,2})[-\/\.](\d{1,2})[-\/\.](\d{2})\b/g,
    // DD month YYYY (Dutch)
    /\b(\d{1,2})\s+(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december)\s+(\d{4})\b/gi,
    // DD month YYYY (French)
    /\b(\d{1,2})\s+(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\s+(\d{4})\b/gi
  ];

  for (const pattern of datePatterns) {
    const matches = [...text.matchAll(pattern)];

    for (const match of matches) {
      triggers.push({
        type: 'DATE',
        text: match[0],
        position: match.index!
      });
    }
  }

  return triggers;
}

/**
 * Find case number triggers in text
 * Returns positions where case number patterns appear (for clustering context)
 */
function findCaseNumberTriggers(text: string): TriggerHit[] {
  const triggers: TriggerHit[] = [];

  const casePatterns = [
    // Belgian Cassation format: X.YY.ZZZZ.L
    /[A-Z]\.\d{2}\.\d{4}\.[A-Z]/g,
    // EU format: C-XXX/YY, T-XXX/YY, F-XXX/YY
    /[CTF]-\d+\/\d{2}/g,
    // Numbered decisions: nr. XXX, n° XXX
    /\b(?:nr\.|n°|nummer|numéro)\s*[\d]+[-\/]?\d{2,4}/gi,
    // Rol numbers
    /\b(?:rol|rôle)\s*(?:nr\.|n°)?\s*[\d]+/gi,
    // Case numbers
    /\b(?:zaak|affaire|case)\s+[\d]+[-\/]\d{2,4}/gi,
    // Arrest numbers
    /\b(?:arrest|arrêt)\s+(?:nr\.|n°)?\s*[\d]+[-\/]\d{2,4}/gi
  ];

  for (const pattern of casePatterns) {
    const matches = [...text.matchAll(pattern)];

    for (const match of matches) {
      // Skip paragraph references (B.X.X, §X, art. X)
      const text = match[0];
      if (/^[AB]\.\d+(\.\d+)?$/.test(text) ||
          /^§\s*\d+/.test(text) ||
          /^art\.\s*\d+/i.test(text)) {
        continue;
      }

      triggers.push({
        type: 'CASE_NUMBER',
        text: match[0],
        position: match.index!
      });
    }
  }

  return triggers;
}

/**
 * Find bibliographic triggers in text
 * Returns positions where bibliographic reference patterns appear
 */
function findBiblioTriggers(text: string): TriggerHit[] {
  const triggers: TriggerHit[] = [];

  const biblioPatterns = [
    /\b(?:Arr\.Cass\.|J\.T\.|Pas\.|R\.W\.|T\.B\.P\.|Rev\.dr\.pén\.|R\.A\.B\.G\.)\s*\d{4}/gi,
    /\b(?:Bull\.|Recueil)\s*\d{4}/gi,
    /\b(?:Jur\.|Jurispr\.)\s*\d{4}/gi
  ];

  for (const pattern of biblioPatterns) {
    const matches = [...text.matchAll(pattern)];

    for (const match of matches) {
      triggers.push({
        type: 'BIBLIO',
        text: match[0],
        position: match.index!
      });
    }
  }

  return triggers;
}

// ============================================================================
// CLUSTERING & REGION EXTRACTION
// ============================================================================

/**
 * Cluster triggers into regions
 * Triggers within CLUSTER_DISTANCE chars of each other are grouped together
 */
interface TriggerCluster {
  triggers: TriggerHit[];
  centerPosition: number;
  startPosition: number;
  endPosition: number;
}

const CLUSTER_DISTANCE = 500; // chars

function clusterTriggers(triggers: TriggerHit[]): TriggerCluster[] {
  if (triggers.length === 0) return [];

  // Sort triggers by position
  const sorted = [...triggers].sort((a, b) => a.position - b.position);

  const clusters: TriggerCluster[] = [];
  let currentCluster: TriggerHit[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];

    // If within CLUSTER_DISTANCE, add to current cluster
    if (curr.position - prev.position <= CLUSTER_DISTANCE) {
      currentCluster.push(curr);
    } else {
      // Finalize current cluster
      clusters.push(createClusterMetadata(currentCluster));

      // Start new cluster
      currentCluster = [curr];
    }
  }

  // Finalize last cluster
  if (currentCluster.length > 0) {
    clusters.push(createClusterMetadata(currentCluster));
  }

  return clusters;
}

/**
 * Create cluster metadata from trigger list
 */
function createClusterMetadata(triggers: TriggerHit[]): TriggerCluster {
  const positions = triggers.map(t => t.position);
  const startPosition = Math.min(...positions);
  const endPosition = Math.max(...positions);
  const centerPosition = Math.floor((startPosition + endPosition) / 2);

  return {
    triggers,
    centerPosition,
    startPosition,
    endPosition
  };
}

/**
 * Extract window of text around a position
 * Returns 1200-1500 char window centered on position
 */
const WINDOW_SIZE = 1200;

function extractWindow(text: string, centerPosition: number): {
  windowText: string;
  windowStart: number;
  windowEnd: number;
} {
  const halfWindow = Math.floor(WINDOW_SIZE / 2);
  const start = Math.max(0, centerPosition - halfWindow);
  const end = Math.min(text.length, centerPosition + halfWindow);

  return {
    windowText: text.substring(start, end),
    windowStart: start,
    windowEnd: end
  };
}

/**
 * Determine region confidence based on trigger types
 * HIGH: Has ECLI trigger
 * MEDIUM: Has both COURT and DATE triggers
 * LOW: Has only DATE or only BIBLIO triggers
 */
function determineConfidence(triggers: TriggerHit[]): 'HIGH' | 'MEDIUM' | 'LOW' {
  const types = new Set(triggers.map(t => t.type));

  if (types.has('ECLI')) return 'HIGH';
  if (types.has('COURT') && types.has('DATE')) return 'MEDIUM';
  return 'LOW';
}

/**
 * Determine primary trigger type for region
 * Priority: ECLI > COURT > BIBLIO > DATE
 */
function determinePrimaryTriggerType(triggers: TriggerHit[]): 'ECLI' | 'COURT_KEYWORD' | 'DATE_PATTERN' | 'BIBLIOGRAPHIC' {
  const types = triggers.map(t => t.type);

  if (types.includes('ECLI')) return 'ECLI';
  if (types.includes('COURT')) return 'COURT_KEYWORD';
  if (types.includes('BIBLIO')) return 'BIBLIOGRAPHIC';
  return 'DATE_PATTERN';
}

/**
 * Determine potential jurisdiction from triggers
 * Returns best guess based on ECLI or court name patterns
 */
function determinePotentialJurisdiction(triggers: TriggerHit[]): 'BE' | 'EU' | 'INT' | 'UNKNOWN' {
  // Priority 1: Check ECLI triggers
  for (const trigger of triggers) {
    if (trigger.type === 'ECLI') {
      const jurisdiction = getJurisdictionFromECLI(trigger.text);
      if (jurisdiction !== 'UNKNOWN') {
        return jurisdiction;
      }
    }
  }

  // Priority 2: Check court name triggers
  for (const trigger of triggers) {
    if (trigger.type === 'COURT') {
      const jurisdiction = determineJurisdiction(trigger.text);
      if (jurisdiction !== 'UNKNOWN') {
        return jurisdiction;
      }
    }
  }

  // Default: UNKNOWN (LLM will determine)
  return 'UNKNOWN';
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Detect citation regions in text
 *
 * NEW ARCHITECTURE:
 * - Finds text REGIONS where citations likely exist
 * - Does NOT extract structured fields
 * - Returns 1200-char windows with metadata hints for LLM
 *
 * @param fullMarkdown Complete decision text
 * @param decisionId ECLI of current decision (for self-reference filtering)
 * @returns Array of citation regions with statistics
 */
export function detectCitationRegions(
  fullMarkdown: string,
  decisionId: string
): {
  regions: CitationRegion[];
  stats: {
    totalRegions: number;
    byTriggerType: { ecli: number; courtKeyword: number; datePattern: number; bibliographic: number };
    byConfidence: { high: number; medium: number; low: number };
    totalTriggers: number;
  };
} {
  // Step 1: Find all triggers
  const ecliTriggers = findECLITriggers(fullMarkdown, decisionId);
  const courtTriggers = findCourtTriggers(fullMarkdown);
  const dateTriggers = findDateTriggers(fullMarkdown);
  const caseNumberTriggers = findCaseNumberTriggers(fullMarkdown);
  const biblioTriggers = findBiblioTriggers(fullMarkdown);

  // Combine all triggers
  const allTriggers = [
    ...ecliTriggers,
    ...courtTriggers,
    ...dateTriggers,
    ...caseNumberTriggers,
    ...biblioTriggers
  ];

  // Step 2: Cluster triggers into regions
  const clusters = clusterTriggers(allTriggers);

  // Step 3: Extract windows and create regions
  const regions: CitationRegion[] = clusters.map((cluster, index) => {
    const { windowText, windowStart } = extractWindow(fullMarkdown, cluster.centerPosition);

    // Find the primary trigger (first in cluster, by position)
    const primaryTrigger = cluster.triggers[0];

    return {
      regionId: index + 1,
      text: windowText,
      position: windowStart,
      triggerPosition: primaryTrigger.position,
      triggerType: determinePrimaryTriggerType(cluster.triggers),
      triggers: cluster.triggers,
      confidence: determineConfidence(cluster.triggers),
      potentialJurisdiction: determinePotentialJurisdiction(cluster.triggers)
    };
  });

  // Step 4: Calculate statistics
  const stats = {
    totalRegions: regions.length,
    byTriggerType: {
      ecli: regions.filter(r => r.triggerType === 'ECLI').length,
      courtKeyword: regions.filter(r => r.triggerType === 'COURT_KEYWORD').length,
      datePattern: regions.filter(r => r.triggerType === 'DATE_PATTERN').length,
      bibliographic: regions.filter(r => r.triggerType === 'BIBLIOGRAPHIC').length
    },
    byConfidence: {
      high: regions.filter(r => r.confidence === 'HIGH').length,
      medium: regions.filter(r => r.confidence === 'MEDIUM').length,
      low: regions.filter(r => r.confidence === 'LOW').length
    },
    totalTriggers: allTriggers.length
  };

  return {
    regions,
    stats
  };
}
