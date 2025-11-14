/**
 * Enrich Provision Citations Schema - Agent 2D (Stage 2)
 *
 * Enriches cited provisions with exact HTML citations for UI highlighting.
 * Maps relationships between provisions and decisions cited in same context.
 *
 * Output Structure:
 * - citedProvisions: Array of provisions with HTML citations and relationship mappings
 * - metadata: Statistics about citations and relationships
 *
 * CRITICAL: Every provision MUST include self-reference as first element in relatedInternalProvisionsId
 */

export const enrichProvisionCitationsSchema = {
  type: "object",
  required: ["citedProvisions", "metadata"],
  additionalProperties: false,
  properties: {
    citedProvisions: {
      type: "array",
      minItems: 0,
      description: "Array of enriched provisions with citations and relationships (can be 0 if no provisions in input)",
      items: {
        type: "object",
        required: [
          "internalProvisionId",
          "relatedFullTextCitations",
          "relatedInternalProvisionsId",
          "relatedInternalDecisionsId"
        ],
        additionalProperties: false,
        properties: {
          internalProvisionId: {
            type: "string",
            pattern: "^ART-[a-zA-Z0-9:.]+-\\d{3}$",
            description: "Provision ID from Agent 2C - must match exactly"
          },
          relatedFullTextCitations: {
            type: "array",
            minItems: 1,
            description: "Exact HTML strings from fullText.html where provision is cited, interpreted, or applied",
            items: {
              type: "string",
              minLength: 10,
              description: "Complete HTML paragraph with all tags preserved"
            }
          },
          relatedInternalProvisionsId: {
            type: "array",
            minItems: 1,
            description: "Provision IDs discussed in same context - MUST include self-reference as first element",
            items: {
              type: "string",
              pattern: "^ART-[a-zA-Z0-9:.]+-\\d{3}$"
            }
          },
          relatedInternalDecisionsId: {
            type: "array",
            description: "Decision IDs cited when interpreting this provision (can be empty)",
            items: {
              type: "string",
              pattern: "^DEC-[a-zA-Z0-9:.]+-\\d{3}$"
            }
          }
        }
      }
    },
    metadata: {
      type: "object",
      required: [
        "totalProvisions",
        "citationStatistics",
        "relationshipStatistics"
      ],
      additionalProperties: false,
      properties: {
        totalProvisions: {
          type: "integer",
          minimum: 0,
          description: "Total provisions processed"
        },
        citationStatistics: {
          type: "object",
          required: [
            "totalCitations",
            "avgCitationsPerProvision",
            "provisionsWithMinimalCitations",
            "provisionsWithNoCitations"
          ],
          additionalProperties: false,
          properties: {
            totalCitations: {
              type: "integer",
              minimum: 0,
              description: "Total HTML citations extracted across all provisions"
            },
            avgCitationsPerProvision: {
              type: "number",
              minimum: 0,
              description: "Average number of citations per provision"
            },
            provisionsWithMinimalCitations: {
              type: "integer",
              minimum: 0,
              description: "Count of provisions with 1-2 citations (may need review)"
            },
            provisionsWithNoCitations: {
              type: "integer",
              minimum: 0,
              description: "Count of provisions with 0 citations (error condition)"
            }
          }
        },
        relationshipStatistics: {
          type: "object",
          required: [
            "avgProvisionsPerProvision",
            "avgDecisionsPerProvision",
            "provisionsWithNoRelationships"
          ],
          additionalProperties: false,
          properties: {
            avgProvisionsPerProvision: {
              type: "number",
              minimum: 1.0,
              description: "Average provisions per provision (minimum 1.0 due to self-reference)"
            },
            avgDecisionsPerProvision: {
              type: "number",
              minimum: 0,
              description: "Average decisions per provision"
            },
            provisionsWithNoRelationships: {
              type: "integer",
              minimum: 0,
              description: "Count of provisions with only self-reference (no other relationships)"
            }
          }
        }
      }
    }
  }
};

export const SCHEMA_NAME = "enrich_provision_citations_v1";
