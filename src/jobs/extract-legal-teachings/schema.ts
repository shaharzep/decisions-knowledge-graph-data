/**
 * Output JSON Schema for extract-legal-teachings (Agent 5)
 *
 * Extracted to a separate file to avoid module-level side effects in config.ts.
 * This is the exact same schema used in config.ts outputSchema.
 */

export const EXTRACT_LEGAL_TEACHINGS_SCHEMA = {
  type: "object",
  required: ["legalTeachings", "metadata"],
  additionalProperties: false,
  properties: {
    legalTeachings: {
      type: "array",
      minItems: 0,
      description: "Array of extracted legal principles (can be 0 for routine decisions)",
      items: {
        type: "object",
        required: [
          "teachingId",
          "text",
          "courtVerbatim",
          "courtVerbatimLanguage",
          "factualTrigger",
          "relevantFactualContext",
          "principleType",
          "legalArea",
          "hierarchicalRelationships",
          "precedentialWeight",
          "relatedLegalIssuesId",
          "relatedCitedProvisionsId",
          "relatedCitedDecisionsId",
          "sourceAuthor",
        ],
        additionalProperties: false,
        properties: {
          teachingId: {
            type: "string",
            pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$",
            description: "Teaching ID: TEACH-{decisionId}-{sequence}",
          },
          text: {
            type: "string",
            minLength: 100,
            maxLength: 1000,
            description: "Generalized principle (100-1000 chars, procedural language)",
          },
          courtVerbatim: {
            type: "string",
            minLength: 100,
            maxLength: 2000,
            description: "Court's exact words from reasoning section (100-2000 chars)",
          },
          courtVerbatimLanguage: {
            type: "string",
            enum: ["FR", "NL"],
            description: "Language of verbatim quote",
          },
          factualTrigger: {
            type: "string",
            minLength: 50,
            maxLength: 300,
            description: "Abstract conditions when principle applies (50-300 chars)",
          },
          relevantFactualContext: {
            type: "string",
            minLength: 50,
            maxLength: 500,
            description: "Specific facts of this case (50-500 chars)",
          },
          principleType: {
            type: "string",
            enum: [
              "INTERPRETATION_RULE",
              "APPLICATION_STANDARD",
              "LEGAL_TEST",
              "BURDEN_PROOF",
              "BALANCING_TEST",
              "PROCEDURAL_RULE",
              "REMEDIAL_PRINCIPLE",
            ],
            description: "Type of legal principle",
          },
          legalArea: {
            type: "string",
            enum: [
              "DISCRIMINATION_LAW",
              "DATA_PROTECTION",
              "EMPLOYMENT_LAW",
              "CONTRACT_LAW",
              "CIVIL_LIABILITY",
              "ADMINISTRATIVE_LAW",
              "PROCEDURAL_LAW",
              "COMPETITION_LAW",
              "INTELLECTUAL_PROPERTY",
              "FAMILY_LAW",
              "OTHER",
            ],
            description: "Primary legal area",
          },
          hierarchicalRelationships: {
            type: "object",
            required: [
              "refinesParentPrinciple",
              "refinedByChildPrinciples",
              "exceptionToPrinciple",
              "exceptedByPrinciples",
              "conflictsWith",
            ],
            additionalProperties: false,
            properties: {
              refinesParentPrinciple: {
                anyOf: [
                  { type: "string", pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$" },
                  { type: "null" },
                ],
                description: "Parent principle ID (if this is child) or null",
              },
              refinedByChildPrinciples: {
                type: "array",
                items: { type: "string", pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$" },
                description: "Child principle IDs (if this is parent)",
              },
              exceptionToPrinciple: {
                anyOf: [
                  { type: "string", pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$" },
                  { type: "null" },
                ],
                description: "Rule principle ID (if this is exception) or null",
              },
              exceptedByPrinciples: {
                type: "array",
                items: { type: "string", pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$" },
                description: "Exception principle IDs (if this is rule)",
              },
              conflictsWith: {
                type: "array",
                items: { type: "string", pattern: "^TEACH-[a-zA-Z0-9:.]+-\\d{3}$" },
                description: "Conflicting principle IDs (rare)",
              },
            },
          },
          precedentialWeight: {
            type: "object",
            required: [
              "courtLevel",
              "binding",
              "clarity",
              "novelPrinciple",
              "confirmsExistingDoctrine",
              "distinguishesPriorCase",
            ],
            additionalProperties: false,
            properties: {
              courtLevel: {
                type: "string",
                enum: ["CASSATION", "APPEAL", "FIRST_INSTANCE"],
                description: "Court hierarchical level (extracted from markdown)",
              },
              binding: {
                type: "boolean",
                description: "Whether principle is binding",
              },
              clarity: {
                type: "string",
                enum: ["EXPLICIT", "IMPLICIT"],
                description: "Whether principle is explicitly stated or derivable from reasoning",
              },
              novelPrinciple: {
                type: "boolean",
                description: "Whether court articulates new principle",
              },
              confirmsExistingDoctrine: {
                type: "boolean",
                description: "Whether court explicitly follows prior precedent",
              },
              distinguishesPriorCase: {
                type: "boolean",
                description: "Whether court qualifies earlier precedent",
              },
            },
          },
          relatedLegalIssuesId: {
            type: "array",
            maxItems: 0,
            items: { type: "string" },
            description: "MUST be empty array (populated by separate workflow)",
          },
          relatedCitedProvisionsId: {
            type: "array",
            items: { type: "string", pattern: "^ART-[a-zA-Z0-9:.]+-\\d{3}$" },
            description: "Provision IDs from Agent 2C (use internalProvisionId)",
          },
          relatedCitedDecisionsId: {
            type: "array",
            items: { type: "string", pattern: "^DEC-[a-zA-Z0-9:.]+-\\d{3}$" },
            description: "Decision IDs from Agent 3 (use internalDecisionId)",
          },
          sourceAuthor: {
            type: "string",
            enum: ["AI_GENERATED"],
            description: "MUST be AI_GENERATED",
          },
        },
      },
    },
    metadata: {
      type: "object",
      required: [
        "totalTeachings",
        "extractedCourtLevel",
        "courtLevelConfidence",
        "teachingTypes",
        "hierarchicalRelationships",
        "courtLevelDistribution",
        "validationChecks",
      ],
      additionalProperties: false,
      properties: {
        totalTeachings: {
          type: "integer",
          minimum: 0,
          description: "Total teachings extracted (can be 0 for routine decisions)",
        },
        extractedCourtLevel: {
          type: "string",
          enum: ["CASSATION", "APPEAL", "FIRST_INSTANCE"],
          description: "Court level detected from markdown",
        },
        courtLevelConfidence: {
          type: "string",
          enum: ["HIGH", "MEDIUM", "LOW"],
          description: "Confidence in court level detection",
        },
        teachingTypes: {
          type: "object",
          required: [
            "interpretive",
            "application",
            "balancing",
            "procedural",
            "remedial",
            "legal_test",
            "burden_proof",
          ],
          additionalProperties: false,
          properties: {
            interpretive: { type: "integer", minimum: 0 },
            application: { type: "integer", minimum: 0 },
            balancing: { type: "integer", minimum: 0 },
            procedural: { type: "integer", minimum: 0 },
            remedial: { type: "integer", minimum: 0 },
            legal_test: { type: "integer", minimum: 0 },
            burden_proof: { type: "integer", minimum: 0 },
          },
        },
        hierarchicalRelationships: {
          type: "object",
          required: ["parentChildPairs", "ruleExceptionPairs", "conflicts"],
          additionalProperties: false,
          properties: {
            parentChildPairs: { type: "integer", minimum: 0 },
            ruleExceptionPairs: { type: "integer", minimum: 0 },
            conflicts: { type: "integer", minimum: 0 },
          },
        },
        courtLevelDistribution: {
          type: "object",
          required: ["cassation", "appeal", "first_instance"],
          additionalProperties: false,
          properties: {
            cassation: { type: "integer", minimum: 0 },
            appeal: { type: "integer", minimum: 0 },
            first_instance: { type: "integer", minimum: 0 },
          },
        },
        validationChecks: {
          type: "object",
          required: [
            "allTeachingsHaveSourceAuthor",
            "sourceAuthorCorrect",
            "teachingCountReasonable",
            "allTeachingsHaveContext",
            "allTeachingsHaveVerbatim",
            "legalIssuesEmptyAsExpected",
            "allProvisionIdsValid",
            "allDecisionIdsValid",
            "allHierarchyReferencesValid",
            "courtLevelDetected",
          ],
          additionalProperties: false,
          properties: {
            allTeachingsHaveSourceAuthor: { type: "boolean" },
            sourceAuthorCorrect: { type: "boolean" },
            teachingCountReasonable: { type: "boolean" },
            allTeachingsHaveContext: { type: "boolean" },
            allTeachingsHaveVerbatim: { type: "boolean" },
            legalIssuesEmptyAsExpected: { type: "boolean" },
            allProvisionIdsValid: { type: "boolean" },
            allDecisionIdsValid: { type: "boolean" },
            allHierarchyReferencesValid: { type: "boolean" },
            courtLevelDetected: { type: "boolean" },
          },
        },
      },
    },
  },
} as const;

export const EXTRACT_LEGAL_TEACHINGS_SCHEMA_NAME = "legal_teachings_extraction_v2";
