/**
 * Two-Stage Citation Extraction Executor
 *
 * NEW ARCHITECTURE: "Regex finds regions + LLM extracts everything"
 *
 * Stage 1: Regex → Detect 1200-char regions where citations likely exist
 * Stage 2: LLM → Extract ALL structured fields from each region
 *
 * This approach:
 * - Reduces regex complexity (just detection, not parsing)
 * - Lets LLM handle complex date/case number parsing
 * - Provides more context (1200 chars vs 400 chars)
 * - Better for cases where citation info spans multiple sentences
 */

import { OpenAIConcurrentClient } from "../../concurrent/OpenAIConcurrentClient.js";
import { extractJsonFromResponse } from "../../utils/validators.js";
import { detectCitationRegions, CitationRegion } from "./regex-extractor.js";
import { STAGE_2_PARSING_PROMPT } from "./stage2-prompt.js";

/**
 * Format citation regions for Stage 2 LLM
 *
 * Converts CitationRegion[] to formatted text for LLM prompt.
 * Each region includes: 1200-char text window, trigger metadata, confidence hints.
 *
 * @param regions Array of citation regions from regex detection
 * @returns Formatted text for Stage 2 prompt
 */
function formatRegionsForStage2(regions: CitationRegion[]): string {
  if (regions.length === 0) {
    return "NO_REGIONS_FOUND";
  }

  const formattedRegions = regions.map(region => {
    // Format trigger list
    const triggerList = region.triggers.map(t =>
      `${t.type}: "${t.text}" @pos ${t.position}`
    ).join(', ');

    // Build region description
    return `
REGION ${region.regionId}:
- Trigger Type: ${region.triggerType}
- Confidence: ${region.confidence}
- Potential Jurisdiction: ${region.potentialJurisdiction || 'UNKNOWN'}
- Triggers Found: ${triggerList}
- Text Window (1200 chars):

${region.text}

---`;
  });

  return formattedRegions.join('\n\n');
}

/**
 * Execute two-stage cited decisions extraction
 *
 * NEW ARCHITECTURE:
 * Stage 1: Regex detects regions where citations likely exist (1200-char windows)
 * Stage 2: LLM extracts ALL fields from each region (court, date, case number, ECLI, treatment)
 *
 * @param row Database row with decision data
 * @param client OpenAI concurrent client
 * @returns Parsed citedDecisions array
 */
export async function executeTwoStageExtraction(
  row: any,
  client: OpenAIConcurrentClient
): Promise<{ citedDecisions: any[] }> {
  // Stage 1: Regex detection - find text regions containing potential citations
  const { regions, stats } = detectCitationRegions(
    row.full_md || "",
    row.decision_id || ""
  );

  // If no regions found, return empty array
  if (regions.length === 0) {
    return { citedDecisions: [] };
  }

  // Format citation regions for Stage 2 LLM
  const formattedRegions = formatRegionsForStage2(regions);

  // Fill Stage 2 prompt with citation regions
  // Use replaceAll() to handle multiple occurrences of placeholders
  const stage2Prompt = STAGE_2_PARSING_PROMPT
    .replaceAll("{decisionId}", row.decision_id || "")
    .replaceAll("{proceduralLanguage}", row.language_metadata || "FR")
    .replaceAll("{citationRegions}", formattedRegions)
    .replaceAll("{regionCount}", String(regions.length))
    .replaceAll("{triggerStats}", JSON.stringify(stats, null, 2));

  // Stage 2: LLM extraction - parse all fields from regions
  // (This path is already optimized in OpenAIConcurrentClient)
  const stage2Response = await client.complete(
    [
      {
        role: "user",
        content: stage2Prompt,
      },
    ],
    {
      type: "json_schema",
      json_schema: {
        name: "cited_decisions_extraction",
        schema: {
          type: "object",
          required: ["citedDecisions"],
          additionalProperties: false,
          properties: {
            citedDecisions: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "decisionId",
                  "decisionSequence",
                  "courtJurisdictionCode",
                  "courtName",
                  "date",
                  "caseNumber",
                  "ecli",
                  "treatment",
                  "type",
                ],
                additionalProperties: false,
                properties: {
                  decisionId: { type: "null" },
                  decisionSequence: { type: "integer", minimum: 1, maximum: 9999 },
                  courtJurisdictionCode: { type: "string", enum: ["BE", "EU", "INT"] },
                  courtName: { type: "string", minLength: 3, maxLength: 200 },
                  date: {
                    anyOf: [
                      { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                      { type: "null" },
                    ],
                  },
                  caseNumber: {
                    anyOf: [
                      { type: "string", minLength: 3, maxLength: 100 },
                      { type: "null" }
                    ],
                  },
                  ecli: {
                    anyOf: [
                      { type: "string", pattern: "^ECLI:[A-Z]{2}:[A-Z0-9]+:\\d{4}:.*$" },
                      { type: "null" },
                    ],
                  },
                  treatment: {
                    type: "string",
                    enum: [
                      "FOLLOWED",
                      "DISTINGUISHED",
                      "OVERRULED",
                      "CITED",
                      "UNCERTAIN",
                    ],
                  },
                  type: {
                    type: "string",
                    enum: ["PRECEDENT", "PROCEDURAL"],
                  },
                },
              },
            },
          },
        },
        strict: true,
      },
    },
    {
      reasoningEffort: "high", // MEDIUM reasoning - LLM does full extraction + treatment + type classification
      maxOutputTokens: 64000,
    }
  );

  // Parse Stage 2 response using existing helper
  // (Resilient to code-block wrapping)
  const content = stage2Response.choices[0]?.message?.content || "{}";
  const result = extractJsonFromResponse(content);

  return result;
}
