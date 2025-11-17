/**
 * Enrich Provision Citations Schema - Agent 2D (Stage 4) - BLOCK-BASED
 *
 * Enriches cited provisions with block-based citations for UI highlighting.
 * Maps simple relationships between provisions and decisions cited in same reasoning blocks.
 *
 * SIMPLIFIED ARCHITECTURE (Stage 4):
 * - Focus on court's reasoning blocks only (exclude party arguments and Vu/Gelet op)
 * - Simple citation objects: blockId + relevantSnippet only (no complex metadata)
 * - Simple relationship arrays: provision/decision IDs (no co-occurrence counts or sources)
 * - MANDATORY self-reference: First element of relatedInternalProvisionsId must be provision's own ID
 * - Simple metadata with section distribution tracking
 *
 * Output Structure:
 * - citedProvisions: Array of provisions with simple block citations and relationship arrays
 * - metadata: Basic statistics and section distribution
 */

export const enrichProvisionCitationsSchema = {
  type: "object",
  required: ["citedProvisions", "metadata"],
  additionalProperties: false,
  properties: {
    citedProvisions: {
      type: "array",
      minItems: 0,
      description: "Array of enriched provisions with block citations and relationships (can be 0 if no provisions in input)",
      items: {
        type: "object",
        required: [
          "internalProvisionId",
          "citations",
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
          citations: {
            type: "array",
            minItems: 0,
            description: "Array of block citations where provision appears in court's reasoning (can be 0 if provision not substantively discussed)",
            items: {
              type: "object",
              required: [
                "blockId",
                "relevantSnippet"
              ],
              additionalProperties: false,
              properties: {
                blockId: {
                  type: "string",
                  pattern: "^ECLI:[A-Z]{2}:[A-Z0-9]+:\\d{4}:[A-Z0-9.]+:block-\\d{3}$",
                  description: "Block ID in format: ECLI:BE:COURT:YYYY:IDENTIFIER:block-NNN"
                },
                relevantSnippet: {
                  type: "string",
                  minLength: 1,
                  description: "Excerpt from block's plainText showing why it's relevant (no strict length limit, extract what's meaningful)"
                }
              }
            }
          },
          relatedInternalProvisionsId: {
            type: "array",
            minItems: 1,
            description: "CRITICAL: First element MUST be provision's own ID (self-reference). Then other provisions discussed in same blocks. Deduplicated.",
            items: {
              type: "string",
              pattern: "^ART-[a-zA-Z0-9:.]+-\\d{3}$"
            }
          },
          relatedInternalDecisionsId: {
            type: "array",
            minItems: 0,
            description: "Decision IDs discussed in same blocks as this provision. Can be empty. Deduplicated.",
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
        "relationshipStatistics",
        "sectionDistribution",
        "extractionNotes"
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
            "provisionsWithNoCitations"
          ],
          additionalProperties: false,
          properties: {
            totalCitations: {
              type: "integer",
              minimum: 0,
              description: "Total citations extracted across all provisions"
            },
            avgCitationsPerProvision: {
              type: "number",
              minimum: 0,
              description: "Average number of citations per provision"
            },
            provisionsWithNoCitations: {
              type: "integer",
              minimum: 0,
              description: "Count of provisions with zero citations (correct if provision only in Vu/Gelet op or party arguments)"
            }
          }
        },
        relationshipStatistics: {
          type: "object",
          required: [
            "avgProvisionsPerProvision",
            "avgDecisionsPerProvision"
          ],
          additionalProperties: false,
          properties: {
            avgProvisionsPerProvision: {
              type: "number",
              minimum: 1.0,
              description: "Average related provisions per provision (MUST be >= 1.0 due to mandatory self-reference)"
            },
            avgDecisionsPerProvision: {
              type: "number",
              minimum: 0,
              description: "Average related decisions per provision"
            }
          }
        },
        sectionDistribution: {
          type: "object",
          required: [
            "reasoningBlocks",
            "partyArgumentBlocks",
            "vuGeletOpBlocks",
            "factsBlocks",
            "judgmentBlocks"
          ],
          additionalProperties: false,
          properties: {
            reasoningBlocks: {
              type: "integer",
              minimum: 0,
              description: "Count of citations from court's reasoning sections"
            },
            partyArgumentBlocks: {
              type: "integer",
              minimum: 0,
              description: "Count of citations from party argument sections (should be 0 - party arguments must be excluded)"
            },
            vuGeletOpBlocks: {
              type: "integer",
              minimum: 0,
              description: "Count of citations from Vu/Gelet op sections (should be 0 or very low - formal citations should generally be excluded)"
            },
            factsBlocks: {
              type: "integer",
              minimum: 0,
              description: "Count of citations from factual background sections"
            },
            judgmentBlocks: {
              type: "integer",
              minimum: 0,
              description: "Count of citations from judgment/operative sections"
            }
          }
        },
        extractionNotes: {
          type: "array",
          description: "Optional notes about extraction quality or issues",
          items: {
            type: "string"
          }
        }
      }
    }
  }
};

export const SCHEMA_NAME = "enrich_provision_citations_v2";
