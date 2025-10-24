import { JobConfig } from "../JobConfig.js";
import { COMPREHENSIVE_PROMPT } from "./prompt.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";

/**
 * Extract Comprehensive Job Configuration - Stage 1
 *
 * MONOLINGUAL EXTRACTION APPROACH
 *
 * Comprehensive extraction of all core case information in a single analysis:
 * - Decision metadata (ID, procedural language, court, date, case number)
 * - Parties (with roles and types)
 * - Legal issues
 * - Facts (verbatim in procedural language)
 * - Requests (per party, verbatim in procedural language)
 * - Arguments (per party with court treatment, verbatim in procedural language)
 * - Court order (dispositif, verbatim in procedural language)
 * - Outcome classification (in procedural language)
 * - Prior instances (if applicable)
 *
 * Key Design Principles:
 * - Content extracted in single procedural language (FR or NL)
 * - Translation handled separately in downstream workflow
 * - Enum values support both languages (FR and NL)
 * - Strict verbatim extraction requirements
 * - Language-specific court treatment and outcome enums
 *
 * Features:
 * - Processes decisions with full markdown text
 * - Tracks id for cross-job result merging
 * - Model outputs decisionId and procedureLanguage directly
 * - Comprehensive validation schema aligned with Stage 1 prompt
 */

const config: JobConfig = {
  id: "extract-comprehensive",

  description:
    "Extract all core case information: parties, court metadata, legal issues, facts, requests, arguments with court treatment, court orders, outcome, and prior instances (monolingual)",

  /**
   * Database Query
   *
   * Uses test set to select specific decisions for evaluation.
   * Joins decisions1 with decisions_md to get full markdown text.
   *
   * The query uses unnest() to join with the test set arrays:
   * - $1: array of decision_ids
   * - $2: array of languages (same order as decision_ids)
   *
   * This ensures we only process the exact decisions specified in the test set.
   */
  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      dm.full_md
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    INNER JOIN unnest($1::text[], $2::text[]) AS test_set(decision_id, language)
      ON d.decision_id = test_set.decision_id
      AND d.language_metadata = test_set.language
    WHERE dm.full_md IS NOT NULL
      AND dm.full_md != ''
  `,

  /**
   * Database Query Parameters
   *
   * Loaded from CSV test set file at runtime.
   * The parameters are:
   * - $1: array of decision_ids from test set
   * - $2: array of languages from test set (matching order)
   */
  dbQueryParams: await (async () => {
    const testSet = await TestSetLoader.loadTestSet(
      "evals/test-sets/comprehensive-197.csv"
    );
    const summary = TestSetLoader.getSummary(testSet);
    console.log(`📊 Test set summary: ${summary.total} decisions`);
    console.log(`   Languages: ${JSON.stringify(summary.byLanguage)}`);

    // Show distribution by length category
    const byLength: Record<string, number> = {};
    testSet.forEach((entry) => {
      if (entry.length_category) {
        byLength[entry.length_category] = (byLength[entry.length_category] || 0) + 1;
      }
    });
    console.log(`   Length distribution: ${JSON.stringify(byLength)}`);

    // Show top courts
    const byCourt: Record<string, number> = {};
    testSet.forEach((entry) => {
      if (entry.court_ecli_code) {
        byCourt[entry.court_ecli_code] = (byCourt[entry.court_ecli_code] || 0) + 1;
      }
    });
    const topCourts = Object.entries(byCourt)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([code, count]) => `${code}:${count}`)
      .join(', ');
    console.log(`   Top 5 courts: ${topCourts}`);

    const params = TestSetLoader.toQueryParams(testSet);
    return [params.decisionIds, params.languages];
  })(),

  /**
   * Preprocess Row
   *
   * Enrich database rows with metadata from CSV test set.
   * This ensures all CSV metadata fields are available for tracking.
   */
  preprocessRow: await (async () => {
    // Load test set once and create lookup map
    const testSet = await TestSetLoader.loadTestSet(
      "evals/test-sets/comprehensive-197.csv"
    );

    // Create map for fast lookup: key = decision_id + language
    const testSetMap = new Map<string, any>();
    testSet.forEach((entry) => {
      const key = `${entry.decision_id}|${entry.language}`;
      testSetMap.set(key, entry);
    });

    // Return preprocessor function
    return async (row: any) => {
      const key = `${row.decision_id}|${row.language_metadata}`;
      const testSetEntry = testSetMap.get(key);

      if (testSetEntry) {
        // Merge CSV metadata into database row
        return {
          ...row,
          decision_type_ecli_code: testSetEntry.decision_type_ecli_code,
          decision_type_name: testSetEntry.decision_type_name,
          court_ecli_code: testSetEntry.court_ecli_code,
          court_name: testSetEntry.court_name,
          courtcategory: testSetEntry.courtcategory,
          decision_date: testSetEntry.decision_date,
          md_length: testSetEntry.md_length,
          length_category: testSetEntry.length_category,
        };
      }

      return row; // Return unchanged if not found in test set
    };
  })(),

  /**
   * Row Metadata Fields
   *
   * Track all metadata from CSV test set for Braintrust evaluation.
   * These fields will be merged into each extraction result, enabling:
   * - Filtering by language, court, decision type, length
   * - Performance analysis by category
   * - Identifying which types work well vs poorly
   */
  rowMetadataFields: [
    "id",                        // Database serial ID
    "decision_id",               // ECLI code
    "language_metadata",         // FR or NL
    "decision_type_ecli_code",   // ARR, ORD, RECO, etc. (from CSV)
    "decision_type_name",        // Arrêt, Arrest, Beschikking, etc. (from CSV)
    "court_ecli_code",           // CASS, GBAPD, COPRIV, etc. (from CSV)
    "court_name",                // Full court name (from CSV)
    "courtcategory",             // Court category (from CSV)
    "decision_date",             // YYYY-MM-DD (from CSV)
    "md_length",                 // Character count (from CSV)
    "length_category",           // short, medium, long, very_long (from CSV)
  ],

  /**
   * Prompt Template
   *
   * Replaces template variables in COMPREHENSIVE_PROMPT with actual data.
   * New template syntax: {decisionId}, {fullText.markdown}, {proceduralLanguage}
   */
  promptTemplate: (row) => {
    return COMPREHENSIVE_PROMPT.replace(
      "{decisionId}",
      row.decision_id || ""
    )
      .replace("{fullText.markdown}", row.full_md || "")
      .replace("{proceduralLanguage}", row.language_metadata || "FR");
  },

  /**
   * Output JSON Schema - Updated Structure
   *
   * MONOLINGUAL SCHEMA
   * - All text fields in single procedural language
   * - Enum values support both FR and NL
   * - Flexible extraction (verbatim when practical, synthesis when necessary)
   * - courtOrder remains strictly verbatim
   *
   * KEY CHANGES FROM PREVIOUS VERSION:
   * - facts: array → single string
   * - requests[].request → requests[].requests
   * - parties[].role → parties[].proceduralRole
   * - DEFENDANT → DEFENDEUR (French)
   * - currentInstance nesting for facts/requests/arguments/courtOrder/outcome
   * - decisionId/proceduralLanguage removed (added via metadata)
   */
  outputSchema: {
    type: "object",
    required: [
      "reference",
      "parties",
      "currentInstance",
    ],
    additionalProperties: false,
    properties: {
      // ========================================
      // CITATION REFERENCE (top level)
      // ========================================
      reference: {
        type: "object",
        required: ["citationReference"],
        additionalProperties: false,
        properties: {
          citationReference: {
            type: "string",
            minLength: 10,
            description: "Formal bibliographic citation reference for the decision",
          },
        },
      },

      // ========================================
      // PARTIES (top level)
      // ========================================
      parties: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["id", "name", "proceduralRole", "type"],
          additionalProperties: false,
          properties: {
            id: {
              type: "string",
              pattern: "^PARTY-[a-zA-Z0-9:.]+-\\d{3}$",
              description: "Party ID format: PARTY-{decisionId}-001",
            },
            name: {
              type: "string",
              minLength: 2,
              maxLength: 200,
              description: "Party name (expand initials when determinable)",
            },
            type: {
              type: "string",
              enum: [
                "NATURAL_PERSON",
                "LEGAL_ENTITY",
                "PUBLIC_AUTHORITY",
                "DE_FACTO_ASSOCIATION",
                "OTHER",
                "UNCLEAR",
              ],
              description: "Type of party (including de facto associations)",
            },
            proceduralRole: {
              type: "string",
              enum: [
                // French - General / First Instance Roles
                "DEMANDEUR",
                "DEFENDEUR",
                "PLAIGNANT",
                "PARTIE_INTERVENANTE",
                "TIERS_OPPOSANT",
                // French - Appeal Roles
                "APPELANT",
                "INTIME",
                // French - Cassation Roles
                "DEMANDEUR_EN_CASSATION",
                "DEFENDEUR_EN_CASSATION",
                // French - Criminal & Specific Roles
                "MINISTERE_PUBLIC",
                "PARTIE_CIVILE",
                "PREVENU",
                "PARTIE_CIVILEMENT_RESPONSABLE",
                "AUTRE",
                // Dutch - General / First Instance Roles
                "EISER",
                "VERWEERDER",
                "KLAGER",
                "TUSSENKOMENDE_PARTIJ",
                "DERDE_VERZETTENDE",
                // Dutch - Appeal Roles
                "APPELLANT",
                "GEÏNTIMEERDE",
                // Dutch - Cassation Roles
                "EISER_IN_CASSATIE",
                "VERWEERDER_IN_CASSATIE",
                // Dutch - Criminal & Specific Roles
                "OPENBAAR_MINISTERIE",
                "BURGERLIJKE_PARTIJ",
                "BEKLAAGDE",
                "BURGERLIJK_AANSPRAKELIJKE_PARTIJ",
                "ANDERE",
              ],
              description:
                "Procedural role (comprehensive language-specific enum with underscores, covering all court levels)",
            },
          },
        },
      },

      // ========================================
      // CURRENT INSTANCE (nested object)
      // ========================================
      currentInstance: {
        type: "object",
        required: ["facts", "requests", "arguments", "courtOrder", "outcome"],
        additionalProperties: false,
        properties: {
          // ========================================
          // FACTS (single string, synthesis allowed)
          // ========================================
          facts: {
            type: "string",
            minLength: 100,
            description: "Complete factual narrative as single continuous text (verbatim when practical, synthesis when necessary)",
          },

          // ========================================
          // REQUESTS (field name is plural!) - OPTIONAL
          // ========================================
          requests: {
            type: "array",
            description: "Optional: only extract if explicitly mentioned in decision. Can be empty array for short decisions.",
            items: {
              type: "object",
              required: ["partyId", "requests"],
              additionalProperties: false,
              properties: {
                partyId: {
                  type: "string",
                  pattern: "^PARTY-[a-zA-Z0-9:.]+-\\d{3}$",
                  description: "Reference to parties[].id",
                },
                requests: {
                  type: "string",
                  minLength: 50,
                  maxLength: 1000,
                  description:
                    "Party's request (50-1000 chars, verbatim when clear, synthesis when scattered)",
                },
              },
            },
          },

          // ========================================
          // ARGUMENTS (synthesis allowed) - OPTIONAL
          // ========================================
          arguments: {
            type: "array",
            description: "Optional: only extract if explicitly mentioned in decision. Can be empty array for short decisions.",
            items: {
              type: "object",
              required: ["partyId", "argument", "treatment"],
              additionalProperties: false,
              properties: {
                partyId: {
                  type: "string",
                  pattern: "^PARTY-[a-zA-Z0-9:.]+-\\d{3}$",
                  description: "Reference to parties[].id",
                },
                argument: {
                  type: "string",
                  minLength: 200,
                  maxLength: 2000,
                  description:
                    "Legal argument (200-2000 chars, consolidate multi-paragraph arguments when necessary)",
                },
                treatment: {
                  type: "string",
                  enum: [
                    // French values
                    "ACCEPTE",
                    "PARTIELLEMENT_ACCEPTE",
                    "REJETE",
                    "RECEVABLE",
                    "IRRECEVABLE",
                    "SANS_OBJET",
                    "NON_TRAITE",
                    "INCERTAIN",
                    // Dutch values
                    "AANVAARD",
                    "GEDEELTELIJK_AANVAARD",
                    "VERWORPEN",
                    "ONTVANKELIJK",
                    "NIET-ONTVANKELIJK",
                    "ZONDER_VOORWERP",
                    "NIET_BEHANDELD",
                    "ONZEKER",
                  ],
                  description:
                    "How the court treated this argument (language-specific enum with underscores)",
                },
              },
            },
          },

          // ========================================
          // COURT ORDER (VERBATIM REQUIRED)
          // ========================================
          courtOrder: {
            type: "string",
            minLength: 50,
            description:
              "Verbatim extraction of dispositif/operative part (MUST be exact, no synthesis, no paraphrasing)",
          },

          // ========================================
          // OUTCOME (classification)
          // ========================================
          outcome: {
            type: "string",
            enum: [
              // French - General Substantive Outcomes
              "FONDE",
              "NON_FONDE",
              "RECEVABILITE",
              "IRRECEVABILITE",
              "REJET",
              "CONDAMNATION",
              "ACQUITTEMENT",
              // French - Appellate Outcomes
              "CONFIRMATION",
              "CONFIRMATION_PARTIELLE",
              "REFORMATION",
              "ANNULATION",
              "ANNULATION_PARTIELLE",
              // French - Cassation Outcomes
              "CASSATION",
              "CASSATION_PARTIELLE",
              "RENVOI",
              // French - Procedural & Other Outcomes
              "DECHEANCE",
              "DESSAISISSEMENT",
              "DESISTEMENT",
              "RETRAIT",
              "SUSPENSION",
              "RADIATION",
              "NON_LIEU_A_STATUER",
              "REVOCATION",
              "AUTRE",
              // Dutch - General Substantive Outcomes
              "GEGROND",
              "ONGEGROND",
              "ONTVANKELIJKHEID",
              "NIET_ONTVANKELIJKHEID",
              "AFWIJZING",
              "VEROORDELING",
              "VRIJSPRAAK",
              // Dutch - Appellate Outcomes
              "BEVESTIGING",
              "GEDEELTELIJKE_BEVESTIGING",
              "HERVORMING",
              "VERNIETIGING",
              "GEDEELTELIJKE_VERNIETIGING",
              // Dutch - Cassation Outcomes
              "CASSATIE",
              "GEDEELTELIJKE_CASSATIE",
              "VERWIJZING",
              // Dutch - Procedural & Other Outcomes
              "VERVAL",
              "ONTZEGGING_VAN_RECHTSMACHT",
              "AFSTAND",
              "INTREKKING",
              "SCHORSING",
              "DOORHALING",
              "GEEN_AANLEIDING_TOT_UITSPRAAK",
              "HERROEPING",
              "ANDERE",
            ],
            description:
              "Final decision classification (comprehensive language-specific enum with underscores, covering all court levels and outcome types)",
          },
        },
      },
    },
  },

  /**
   * Schema name for structured outputs
   */
  outputSchemaName: "comprehensive_extraction",

  /**
   * Provider and Model Configuration
   */
  provider: "openai", // Use OpenAI Batch API
  model: "gpt-5-mini", // GPT-5 Mini with reasoning
  maxCompletionTokens: 128000,
  reasoningEffort: "medium", // Medium reasoning effort
  verbosity: "low", // Low verbosity (valid values: low, medium, high)

  /**
   * Custom ID prefix
   */
  customIdPrefix: "comprehensive",
};

export default config;
