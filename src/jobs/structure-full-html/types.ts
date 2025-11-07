/**
 * Structure Full HTML Types
 *
 * Type definitions for HTML structuring job
 */

export interface DecisionMetadata {
  court_name: string;
  decision_type: string;
  rol_number: string;
  date: string;
  language: 'fr' | 'nl';
}

/**
 * Decision type mappings from ECLI codes to localized names
 */
export const DECISION_TYPE_MAPPINGS: Record<string, Record<string, string>> = {
  FR: {
    DEC: "Décision",
    ARR: "Arrêt",
    JUG: "Jugement",
    AVIS: "Avis",
    ORD: "Ordonnance",
    RECO: "Recommandation"
  },
  NL: {
    DEC: "Rechterlijke beslissing",
    ARR: "Arrest",
    JUG: "Vonnis",
    AVIS: "Advies",
    ORD: "Beschikking",
    RECO: "Aanbeveling"
  }
};

/**
 * Month names for date formatting
 */
export const MONTH_NAMES: Record<string, string[]> = {
  FR: ["janvier", "février", "mars", "avril", "mai", "juin",
       "juillet", "août", "septembre", "octobre", "novembre", "décembre"],
  NL: ["januari", "februari", "maart", "april", "mei", "juni",
       "juli", "augustus", "september", "oktober", "november", "december"]
};

/**
 * Constants for token estimation
 */
export const TOKEN_OVERHEAD_MULTIPLIER = 1.25;
export const CHARACTER_TO_TOKEN_RATIO = 4;
export const MAX_OUTPUT_TOKENS = 65535;
