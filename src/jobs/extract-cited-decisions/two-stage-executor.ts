/**
 * Two-Stage Cited Decisions Extraction Executor
 *
 * Orchestrates Stage 1 (agentic snippet creation) and Stage 2 (deterministic parsing)
 * for the extract-cited-decisions job.
 *
 * Stage 1: gpt-5-mini MEDIUM reasoning → plain text snippets
 * Stage 2: gpt-5-mini MEDIUM reasoning → structured JSON
 */

import { OpenAIConcurrentClient } from "../../concurrent/OpenAIConcurrentClient.js";
import { AzureConfig } from "../../config/azure.js";
import { extractJsonFromResponse } from "../../utils/validators.js";
import { STAGE_1_AGENTIC_SNIPPETS_PROMPT } from "./stage1-prompt.js";
import { STAGE_2_PARSING_PROMPT } from "./stage2-prompt.js";

/**
 * Execute two-stage cited decisions extraction
 *
 * @param row Database row with decision data
 * @param client OpenAI concurrent client
 * @returns Parsed citedDecisions array
 */
export async function executeTwoStageExtraction(
  row: any,
  client: OpenAIConcurrentClient
): Promise<{ citedDecisions: any[] }> {
  // Fill Stage 1 prompt with decision data
  // Use replaceAll() to handle multiple occurrences of placeholders
  const stage1Prompt = STAGE_1_AGENTIC_SNIPPETS_PROMPT
    .replaceAll("{decisionId}", row.decision_id || "")
    .replaceAll("{proceduralLanguage}", row.language_metadata || "FR")
    .replaceAll("{fullText.markdown}", row.full_md || "");

  // Stage 1: Call OpenAI SDK directly for plain text output
  // NOTE: We don't use the passed 'client' here because:
  //   - OpenAIConcurrentClient.complete() requires responseFormat (json_schema/json_object)
  //   - Stage 1 needs plain text output (no structured format)
  //   - Direct SDK call is simplest for this use case
  // TODO: If this needs to support non-Azure providers, add provider detection
  const openaiClient = AzureConfig.getClient();
  const deployment = AzureConfig.getDeployment();

  const stage1Response = await openaiClient.responses.create({
    model: deployment,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: stage1Prompt,
          },
        ],
      },
    ],
    reasoning: {
      effort: "medium", // MEDIUM reasoning - Stage 1 is systematic scanning + synthesis
    },
  });

  // Extract snippets from Stage 1 response
  // Pass raw output directly to Stage 2 (no parsing/formatting)
  let snippets = "";
  if (stage1Response.output_text) {
    snippets = stage1Response.output_text;
  } else if (Array.isArray(stage1Response.output)) {
    // Fallback: stitch text pieces
    const pieces: string[] = [];
    for (const item of stage1Response.output) {
      if ('content' in item && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" && typeof c.text === "string") {
            pieces.push(c.text);
          }
        }
      }
    }
    snippets = pieces.join("");
  }

  const trimmedSnippets = snippets.trim();

  if (
    trimmedSnippets === "" ||
    trimmedSnippets === "NO_SNIPPETS_FOUND" ||
    trimmedSnippets === "NO_SNIPPETS_FOUND."
  ) {
    return { citedDecisions: [] };
  }

  // Fill Stage 2 prompt with snippets from Stage 1
  // Use replaceAll() to handle multiple occurrences of placeholders
  const stage2Prompt = STAGE_2_PARSING_PROMPT
    .replaceAll("{decisionId}", row.decision_id || "")
    .replaceAll("{proceduralLanguage}", row.language_metadata || "FR")
    .replaceAll("{agenticSnippets}", snippets);

  // Stage 2: Use client's complete() with JSON schema
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
                ],
                additionalProperties: false,
                properties: {
                  decisionId: { type: "null" },
                  decisionSequence: { type: "integer", minimum: 1, maximum: 9999 },
                  courtJurisdictionCode: { type: "string", enum: ["BE"] },
                  courtName: { type: "string", minLength: 10, maxLength: 200 },
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
                      { type: "string", pattern: "^ECLI:BE:[A-Z]+:\\d{4}:.*$" },
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
                },
              },
            },
          },
        },
        strict: true,
      },
    },
    {
      reasoningEffort: "medium", // MEDIUM reasoning - Stage 2 does treatment classification (complex)
      maxOutputTokens: 64000,
    }
  );

  // Parse Stage 2 response using existing helper
  // (Resilient to code-block wrapping)
  const content = stage2Response.choices[0]?.message?.content || "{}";
  const result = extractJsonFromResponse(content);

  return result;
}
