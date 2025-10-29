/**
 * Two-Stage Provision Extraction Executor
 *
 * Orchestrates Stage 1 (agentic snippet creation) and Stage 2 (deterministic parsing)
 * for the extract-provisions-2a job.
 *
 * Stage 1: gpt-5-mini HIGH reasoning → plain text snippets
 * Stage 2: gpt-5-mini LOW reasoning → structured JSON
 */

import { OpenAIConcurrentClient } from "../../concurrent/OpenAIConcurrentClient.js";
import { AzureConfig } from "../../config/azure.js";
import { extractJsonFromResponse } from "../../utils/validators.js";
import { STAGE_1_AGENTIC_SNIPPETS_PROMPT } from "./stage1-prompt.js";
import { STAGE_2_PARSING_PROMPT } from "./stage2-prompt.js";

/**
 * Execute two-stage provision extraction
 *
 * @param row Database row with decision data
 * @param client OpenAI concurrent client
 * @returns Parsed citedProvisions array
 */
export async function executeTwoStageExtraction(
  row: any,
  client: OpenAIConcurrentClient
): Promise<{ citedProvisions: any[] }> {
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
      effort: "medium", // MEDIUM reasoning - Stage 1 is extraction, not deep reasoning
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
    return { citedProvisions: [] };
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
        name: "provision_extraction",
        schema: {
          type: "object",
          required: ["citedProvisions"],
          additionalProperties: false,
          properties: {
            citedProvisions: {
              type: "array",
              items: {
                type: "object",
                required: [
                  "provisionId",
                  "parentActId",
                  "provisionSequence",
                  "parentActSequence",
                  "provisionNumber",
                  "provisionNumberKey",
                  "parentActType",
                  "parentActName",
                  "parentActDate",
                  "parentActNumber",
                ],
                additionalProperties: false,
                properties: {
                  provisionId: { type: "null" },
                  parentActId: { type: "null" },
                  provisionSequence: { type: "integer", minimum: 1 },
                  parentActSequence: { type: "integer", minimum: 1 },
                  provisionNumber: { type: "string", minLength: 3 },
                  provisionNumberKey: { type: "string", minLength: 1 },
                  parentActType: { type: "string" },
                  parentActName: { type: "string", minLength: 5 },
                  parentActDate: {
                    anyOf: [
                      { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
                      { type: "null" },
                    ],
                  },
                  parentActNumber: {
                    anyOf: [{ type: "string" }, { type: "null" }],
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
      reasoningEffort: "medium", // MEDIUM reasoning - Stage 2 does complex normalization, not just parsing
      maxOutputTokens: 64000,
    }
  );

  // Parse Stage 2 response using existing helper
  // (Resilient to code-block wrapping)
  const content = stage2Response.choices[0]?.message?.content || "{}";
  const result = extractJsonFromResponse(content);

  return result;
}
