/**
 * Enrich Teaching Citations Schema - Agent 5B (Stage 2)
 *
 * Enriches legal teachings from Agent 5A with exact HTML citations for UI highlighting.
 * Validates that claimed provision/decision relationships exist in extracted text.
 *
 * Output Structure:
 * - legalTeachings: Array of teachings with HTML citations and validation results
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
      description: "Array of enriched teachings with citations (can be 0 if no teachings in input)",
      items: {
        type: "object",
        required: [
          "teachingId",
          "relatedFullTextCitations",
          "relationshipValidation"
        ],
        additionalProperties: false,
        properties: {
          teachingId: {
            type: "string",
            pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$",
            description: "Teaching ID from Agent 5A - must match exactly"
          },
          relatedFullTextCitations: {
            type: "array",
            minItems: 1,
            description: "Exact HTML strings from fullText.html where teaching is discussed",
            items: {
              type: "string",
              minLength: 10,
              description: "Complete HTML paragraph with all tags preserved"
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
                description: "Count of provisions found in citations"
              },
              provisionsNotFoundInCitations: {
                type: "array",
                items: { type: "string" },
                description: "Provision IDs claimed but not found in citations"
              },
              decisionsValidated: {
                type: "integer",
                minimum: 0,
                description: "Count of decisions found in citations"
              },
              decisionsNotFoundInCitations: {
                type: "array",
                items: { type: "string" },
                description: "Decision IDs claimed but not found in citations"
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
              description: "Total HTML citations extracted across all teachings"
            },
            avgCitationsPerTeaching: {
              type: "number",
              minimum: 0,
              description: "Average number of citations per teaching"
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
              description: "Total provisions found in citations across all teachings"
            },
            totalProvisionsNotFound: {
              type: "integer",
              minimum: 0,
              description: "Total provisions claimed but not found in citations"
            },
            totalDecisionsValidated: {
              type: "integer",
              minimum: 0,
              description: "Total decisions found in citations across all teachings"
            },
            totalDecisionsNotFound: {
              type: "integer",
              minimum: 0,
              description: "Total decisions claimed but not found in citations"
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

export const SCHEMA_NAME = "enrich_teaching_citations_v1";
