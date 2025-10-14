import { JobConfig } from '../JobConfig.js';

/**
 * EXAMPLE Job Configuration: Extract Parties
 *
 * This is an example showing how to configure a batch extraction job.
 * Copy this file and modify it for your specific extraction needs.
 *
 * Job: Extract party names and generate citation references from Belgian legal decisions
 */

const extractPartiesConfig: JobConfig = {
  id: 'extract-parties',

  description: 'Extract party names and citation references from Belgian legal decisions',

  /**
   * Database Query
   * Fetches decision data from PostgreSQL
   *
   * IMPORTANT: This must be a SELECT query (READ-ONLY enforced)
   */
  dbQuery: `
    SELECT
      id as decision_id,
      markdown_text,
      official_url,
      procedural_language
    FROM decisions
    WHERE status = $1
      AND markdown_text IS NOT NULL
    LIMIT $2
  `,

  dbQueryParams: ['pending_parties', 100],

  /**
   * Prompt Template
   * Generates the prompt for each database row
   */
  promptTemplate: (row) => {
    return `# MISSION
You are a legal citation specialist and party identifier for Belgian court decisions. Your tasks are to (1) identify and classify all ACTUAL PARTIES to the litigation (not their lawyers), and (2) generate a standardized citation reference.

# INPUT
- Decision ID: ${row.decision_id}
- Markdown Text: ${row.markdown_text}
- Official URL: ${row.official_url}
- Procedural Language: ${row.procedural_language}

# TASK 1: IDENTIFY PARTIES

## CRITICAL DISTINCTION: Parties vs. Legal Representatives

**YOU MUST ONLY IDENTIFY ACTUAL PARTIES, NOT THEIR LAWYERS OR REPRESENTATIVES.**

Extract each party's information:
- Complete legal name exactly as written
- Include legal form for entities (S.A., S.P.R.L., B.V., N.V., ASBL, VZW)
- Include courtesy titles for natural persons (Monsieur, Madame, Mevrouw, Mijnheer)

## Party Type Classification Rules

- **NATURAL_PERSON**: Individuals (e.g., "Monsieur Jean Dupont", "Madame Marie Janssens")
- **LEGAL_PERSON**: Companies, associations, foundations (must have legal form: S.A., ASBL, etc.)
- **PUBLIC_BODY**: State entities, government bodies (e.g., "État belge", "Commune d'Ixelles", "ONSS")

# TASK 2: GENERATE CITATION REFERENCE

Follow Bluebook format for Belgian decisions:
**[Court], [Date], [Case Number], [Publication Reference if available]**

### Court Abbreviations
- Cour de cassation → Cass.
- Cour d'appel de Bruxelles → C.A. Bruxelles
- Tribunal de première instance de Bruxelles → Trib. prem. inst. Bruxelles

### Date Format
- Use: DD month YYYY in the language of the decision
- French: "15 mars 2024", Dutch: "15 maart 2024"

# OUTPUT REQUIREMENTS
Return a JSON object:
{
  "parties": [
    {
      "id": "party001",
      "name": "[full party name - NEVER include lawyers]",
      "type": "NATURAL_PERSON|LEGAL_PERSON|PUBLIC_BODY"
    }
  ],
  "reference": {
    "citationReference": "[standardized citation]"
  },
  "metadata": {
    "totalParties": [integer],
    "citationComponents": {
      "court": "[court name]",
      "date": "[date]",
      "caseNumber": "[case number]"
    },
    "validationChecks": {
      "partyCountReasonable": true|false,
      "noLawyersInParties": true|false,
      "citationComplete": true|false
    }
  }
}`;
  },

  /**
   * Output JSON Schema
   * Used to validate the model's response
   */
  outputSchema: {
    type: 'object',
    required: ['parties', 'reference', 'metadata'],
    properties: {
      parties: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['id', 'name', 'type'],
          properties: {
            id: {
              type: 'string',
              pattern: '^party\\d{3}$',
            },
            name: {
              type: 'string',
              minLength: 2,
            },
            type: {
              type: 'string',
              enum: ['NATURAL_PERSON', 'LEGAL_PERSON', 'PUBLIC_BODY'],
            },
          },
        },
      },
      reference: {
        type: 'object',
        required: ['citationReference'],
        properties: {
          citationReference: {
            type: 'string',
            minLength: 10,
          },
        },
      },
      metadata: {
        type: 'object',
        required: ['totalParties', 'citationComponents', 'validationChecks'],
        properties: {
          totalParties: {
            type: 'integer',
            minimum: 1,
          },
          citationComponents: {
            type: 'object',
            required: ['court', 'date', 'caseNumber'],
            properties: {
              court: { type: 'string' },
              date: { type: 'string' },
              caseNumber: { type: 'string' },
            },
          },
          validationChecks: {
            type: 'object',
            required: [
              'partyCountReasonable',
              'noLawyersInParties',
              'citationComplete',
            ],
            properties: {
              partyCountReasonable: { type: 'boolean' },
              noLawyersInParties: { type: 'boolean' },
              citationComplete: { type: 'boolean' },
            },
          },
        },
      },
    },
  },

  /**
   * Azure Configuration
   */
  deploymentName: 'gpt-4o-2', // From your .env file
  maxTokens: 4000,
  temperature: 0.0, // Deterministic for extraction

  /**
   * Custom ID prefix (optional)
   * Default: job id + row index
   */
  customIdPrefix: 'parties',
};

export default extractPartiesConfig;
