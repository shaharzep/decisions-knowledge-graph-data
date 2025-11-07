import { JobConfig } from "../JobConfig.js";
import { CLEAN_MARKDOWN_PROMPT } from "./prompt.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";

const config: JobConfig = {
  id: "clean-decision-markdown",

  description:
    "Clean decision markdown by converting LaTeX constructs, footnote numbering, and math notation into plain markdown using GPT-4.1-mini.",

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
      limit 10
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
    return CLEAN_MARKDOWN_PROMPT
      .replace("{decisionId}", row.decision_id || "")
      .replace("{proceduralLanguage}", row.language_metadata || "FR")
      .replace("{fullText.markdown}", row.full_md || "");
  },

  outputSchema: {
    type: "object",
    required: ["cleanedMarkdown"],
    additionalProperties: false,
    properties: {
      cleanedMarkdown: {
        type: "string",
        minLength: 20,
        maxLength: 800000,
        description: "Markdown for the decision with LaTeX removed and footnotes renumbered sequentially.",
      },
    },
  },

  outputSchemaName: "clean_markdown_output",

  provider: "openai",
  openaiProvider: "azure",
  model: "gpt-4.1-mini",
  maxCompletionTokens: 8192,
  temperature: 0,

  concurrencyLimit: 200,
  useFullDataPipeline: false,
  customIdPrefix: "clean-markdown",
};

export default config;
