import { JobConfig } from "../JobConfig.js";
import { CLEAN_MARKDOWN_PROMPT } from "./prompt.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";
import { extractJsonFromResponse } from "../../utils/validators.js";

const config: JobConfig = {
  id: "clean-decision-markdown",

  description:
    "Fix broken footnote syntax ([^0] → [^1], [^2], ...) and convert text tables to markdown using GPT-4.1-mini with temperature=0 for deterministic output.",

  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      d.decision_type_ecli_code,
      d.court_ecli_code,
      d.decision_date,
      dm.full_md,
      LENGTH(dm.full_md) as md_length
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

  dbQueryParams: await (async () => {
    const testSet = await TestSetLoader.loadTestSet('evals/test-sets/comprehensive-197.csv');
    const summary = TestSetLoader.getSummary(testSet);
    console.log(`📊 Clean Markdown test set: ${summary.total} decisions`);
    console.log(`   Languages: ${JSON.stringify(summary.byLanguage)}`);

    const params = TestSetLoader.toQueryParams(testSet);
    return [params.decisionIds, params.languages];
  })(),

  preprocessRow: async (row: any) => {
    let length_category = "unknown";
    if (row.md_length) {
      if (row.md_length < 10000) length_category = "short";
      else if (row.md_length < 30000) length_category = "medium";
      else if (row.md_length < 60000) length_category = "long";
      else length_category = "very_long";
    }

    return {
      ...row,
      length_category,
    };
  },

  rowMetadataFields: [
    "id",
    "decision_id",
    "language_metadata",
    "decision_type_ecli_code",
    "court_ecli_code",
    "decision_date",
    "md_length",
    "length_category",
  ],

  promptTemplate: (row) => {
    return CLEAN_MARKDOWN_PROMPT.replace("${markdown}", row.full_md || "");
  },

  outputSchema: {
    type: "object",
    required: ["cleanedMarkdown"],
    additionalProperties: false,
    properties: {
      cleanedMarkdown: {
        type: "string",
        minLength: 20,
        maxLength: 2000000,
        description: "Markdown with fixed footnote syntax and converted tables. If skipped, contains original markdown.",
      },
      skipped: {
        type: "boolean",
        description: "True if document was too long and processing was skipped",
      },
      skipReason: {
        type: "string",
        description: "Reason for skipping (e.g., document too long)",
      },
      originalLength: {
        type: "number",
        description: "Character length of original markdown (if skipped)",
      },
    },
  },

  outputSchemaName: "clean_markdown_output",

  /**
   * Custom Execution - Skip very long documents
   *
   * For documents > 120k characters (~30k tokens), skip API call and return original markdown.
   * This prevents truncation since output length ≈ input length for footnote fixing.
   *
   * Token math:
   * - Max output tokens: 32,000
   * - Prompt + schema overhead: ~2,000 tokens
   * - Available for markdown: ~30,000 tokens
   * - Character estimate: 30k tokens × 4 chars/token = 120k chars
   */
  customExecution: async (row, client) => {
    const MAX_SAFE_LENGTH = 120000; // ~30k tokens

    // If document is too long, skip processing and return original
    if (row.md_length && row.md_length > MAX_SAFE_LENGTH) {
      return {
        cleanedMarkdown: row.full_md,
        skipped: true,
        skipReason: `Document too long (${row.md_length} chars, limit ${MAX_SAFE_LENGTH})`,
        originalLength: row.md_length,
      };
    }

    // Normal processing for documents within safe length
    const prompt = CLEAN_MARKDOWN_PROMPT.replace("${markdown}", row.full_md || "");

    const response = await client.complete(
      [
        {
          role: "system",
          content: "Return ONLY valid JSON matching the schema. Put the RAW Markdown (no code fences, no commentary, no manual escaping) in cleanedMarkdown. Do not add extra fields.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      {
        type: "json_schema",
        json_schema: {
          name: "clean_markdown_output",
          schema: {
            type: "object",
            required: ["cleanedMarkdown"],
            additionalProperties: false,
            properties: {
              cleanedMarkdown: {
                type: "string",
                minLength: 20,
                maxLength: 2000000,
                description: "Markdown with fixed footnote syntax and converted tables",
              },
            },
          },
          strict: true,
        },
      },
      {
        model: "gpt-4.1-mini",
        maxOutputTokens: 32000,
        temperature: 0,
        top_p: 1,
      }
    );

    // CRITICAL: Check finish_reason BEFORE parsing (research finding!)
    const finishReason = response.choices[0]?.finish_reason;
    const message = response.choices[0]?.message;

    // Handle model refusals (e.g., "I'm sorry, I cannot...")
    if (finishReason === 'refusal' || (message as any)?.refusal) {
      const refusalMessage = (message as any)?.refusal || 'Model refused to process';
      console.warn(`Model refused to process decision, returning original: ${refusalMessage}`);
      return {
        cleanedMarkdown: row.full_md,
        skipped: true,
        skipReason: `Model refusal: ${refusalMessage}`,
        originalLength: row.md_length,
      };
    }

    // Handle truncated responses (hit token limit mid-output)
    if (finishReason === 'length') {
      console.warn(`Response truncated (hit token limit), returning original`);
      return {
        cleanedMarkdown: row.full_md,
        skipped: true,
        skipReason: `Response truncated - hit ${32000} token limit`,
        originalLength: row.md_length,
      };
    }

    const content = message?.content || "{}";

    // Now safe to parse (we've filtered out refusals and truncations)
    try {
      const parsed = extractJsonFromResponse(content);

      // Validate that we got a cleanedMarkdown field
      if (!parsed.cleanedMarkdown || typeof parsed.cleanedMarkdown !== 'string') {
        throw new Error('Invalid response: missing cleanedMarkdown field');
      }

      return parsed;
    } catch (parseError) {
      // Final fallback for any other parsing errors
      console.warn(`Failed to parse valid response, returning original: ${parseError instanceof Error ? parseError.message : String(parseError)}`);
      return {
        cleanedMarkdown: row.full_md,
        skipped: true,
        skipReason: `JSON parse error: ${parseError instanceof Error ? parseError.message : 'unknown'}`,
        originalLength: row.md_length,
      };
    }
  },

  provider: "openai",
  openaiProvider: "azure",
  model: "gpt-4.1-mini",
  maxCompletionTokens: 32000,
  temperature: 0,
  top_p: 1,

  concurrencyLimit: 200,
  useFullDataPipeline: false,
  customIdPrefix: "clean-markdown",
};

export default config;
