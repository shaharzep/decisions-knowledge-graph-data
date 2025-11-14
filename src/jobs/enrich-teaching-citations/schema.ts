/**
 * Enrich Teaching Citations Schema - Agent 5B (Stage 2) - BLOCK-BASED
 *
 * Enriches legal teachings from Agent 5A with block-based citations for UI highlighting.
 * Validates that claimed provision/decision relationships exist in extracted blocks.
 *
 * NEW ARCHITECTURE:
 * - Returns block IDs instead of HTML strings (resilient to HTML changes)
 * - Includes relevantSnippet for debugging/validation
 * - Validates relationships against block plain text
 *
 * Output Structure:
 * - legalTeachings: Array of teachings with block citations (blockId + snippet)
 * - metadata: Statistics about citations and relationship validation
 */

export const enrichTeachingCitationsSchema = {
  type: "object",
  required: ["legalTeachings", "metadata"],
  additionalProperties: false,
  properties: {
    legalTeachings: {
      type: "array",
      minItems: 0,
      description: "Array of enriched teachings with block citations (can be 0 if no teachings in input)",
      items: {
        type: "object",
        required: [
          "teachingId",
          "citations",
          "relationshipValidation"
        ],
        additionalProperties: false,
        properties: {
          teachingId: {
            type: "string",
            pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$",
            description: "Teaching ID from Agent 5A - must match exactly"
          },
          citations: {
            type: "array",
            minItems: 1,
            description: "Array of block citations where this teaching is discussed",
            items: {
              type: "object",
              required: ["blockId", "relevantSnippet"],
              additionalProperties: false,
              properties: {
                blockId: {
                  type: "string",
                  pattern: "^ECLI:[A-Z]{2}:[A-Z0-9]+:\\d{4}:[A-Z0-9.]+:block-\\d{3}$",
                  description: "Block ID in format: ECLI:BE:COURT:YYYY:IDENTIFIER:block-NNN"
                },
                relevantSnippet: {
                  type: "string",
                  minLength: 50,
                  maxLength: 500,
                  description: "50-500 character excerpt from block's plainText showing why it's relevant to this teaching (for debugging/validation)"
                }
              }
            }
          },
          relationshipValidation: {
            type: "object",
            required: [
              "provisionsValidated",
              "provisionsNotFoundInCitations",
              "decisionsValidated",
              "decisionsNotFoundInCitations"
            ],
            additionalProperties: false,
            properties: {
              provisionsValidated: {
                type: "integer",
                minimum: 0,
                description: "Count of provisions found in block plain text"
              },
              provisionsNotFoundInCitations: {
                type: "array",
                items: { type: "string" },
                description: "Provision IDs claimed but not found in block plain text"
              },
              decisionsValidated: {
                type: "integer",
                minimum: 0,
                description: "Count of decisions found in block plain text"
              },
              decisionsNotFoundInCitations: {
                type: "array",
                items: { type: "string" },
                description: "Decision IDs claimed but not found in block plain text"
              }
            }
          }
        }
      }
    },
    metadata: {
      type: "object",
      required: [
        "totalTeachings",
        "citationStatistics",
        "validationSummary",
        "extractionNotes"
      ],
      additionalProperties: false,
      properties: {
        totalTeachings: {
          type: "integer",
          minimum: 0,
          description: "Total teachings processed"
        },
        citationStatistics: {
          type: "object",
          required: [
            "totalCitations",
            "avgCitationsPerTeaching",
            "teachingsWithMinimalCitations",
            "teachingsWithNoCitations"
          ],
          additionalProperties: false,
          properties: {
            totalCitations: {
              type: "integer",
              minimum: 0,
              description: "Total block citations extracted across all teachings"
            },
            avgCitationsPerTeaching: {
              type: "number",
              minimum: 0,
              description: "Average number of block citations per teaching"
            },
            teachingsWithMinimalCitations: {
              type: "integer",
              minimum: 0,
              description: "Count of teachings with 1-2 citations (may need review)"
            },
            teachingsWithNoCitations: {
              type: "integer",
              minimum: 0,
              description: "Count of teachings with 0 citations (error condition)"
            }
          }
        },
        validationSummary: {
          type: "object",
          required: [
            "totalProvisionsValidated",
            "totalProvisionsNotFound",
            "totalDecisionsValidated",
            "totalDecisionsNotFound"
          ],
          additionalProperties: false,
          properties: {
            totalProvisionsValidated: {
              type: "integer",
              minimum: 0,
              description: "Total provisions found in block plain text across all teachings"
            },
            totalProvisionsNotFound: {
              type: "integer",
              minimum: 0,
              description: "Total provisions claimed but not found in block plain text"
            },
            totalDecisionsValidated: {
              type: "integer",
              minimum: 0,
              description: "Total decisions found in block plain text across all teachings"
            },
            totalDecisionsNotFound: {
              type: "integer",
              minimum: 0,
              description: "Total decisions claimed but not found in block plain text"
            }
          }
        },
        extractionNotes: {
          type: "array",
          items: { type: "string" },
          description: "Optional notes about extraction process"
        }
      }
    }
  }
};

export const SCHEMA_NAME = "enrich_teaching_citations_v2";
