import { JobConfig } from "../JobConfig.js";
import { TestSetLoader } from "../../utils/testSetLoader.js";
import { extractCandidateSnippets } from "../../utils/provisionSnippetExtractor.js";
import { extractAbbreviations } from "../../utils/abbreviationExtractor.js";
import { sanitiseCitedProvisions } from "../../utils/provisionAggregator.js";
import { buildResolveProvisionsPrompt } from "./prompt.js";

function formatInitialExtraction(
  citedProvisions: any[] | undefined
): string {
  if (!citedProvisions || citedProvisions.length === 0) {
    return '[]';
  }
  return JSON.stringify(citedProvisions, null, 2);
}

const TEST_SET_PATH =
  process.env.PROVISIONS_TEST_SET || "evals/test-sets/comprehensive-197.csv";

const config: JobConfig = {
  id: "resolve-provisions-2a",

  description:
    "Validate and finalize cited provisions by comparing Stage 2A extraction against the decision text.",

  dependencies: [
    {
      jobId: "extract-provisions-2a",
      alias: "initialExtraction",
      required: true,
      source: "concurrent",
      transform: (dependency: any) => ({
        initialCitedProvisions: dependency.citedProvisions ?? [],
        initialExtractionJson: formatInitialExtraction(
          dependency.citedProvisions ?? []
        ),
      }),
    },
  ],

  dbQuery: `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      dm.full_md
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
    const testSet = await TestSetLoader.loadTestSet(
      TEST_SET_PATH
    );
    const summary = TestSetLoader.getSummary(testSet);
    console.log(
      `📊 Resolve Provisions test set: ${summary.total} decisions`
    );
    console.log(`   Languages: ${JSON.stringify(summary.byLanguage)}`);

    const params = TestSetLoader.toQueryParams(testSet);
    return [params.decisionIds, params.languages];
  })(),

  preprocessRow: async (row: any) => {
    const fullText = row.full_md || "";
    const snippets = extractCandidateSnippets(fullText, 150);
    const abbreviations = extractAbbreviations(row.decision_id, fullText);

    return {
      ...row,
      provisionSnippets: snippets,
      abbreviations,
      abbreviationGuide: abbreviations
        .map((entry) => `- ${entry.abbreviation} ➝ ${entry.fullName}`)
        .join("\n"),
    };
  },

  rowMetadataFields: [
    "id",
    "decision_id",
    "language_metadata",
    "abbreviationGuide",
  ],

  promptTemplate: (row) => {
    const initialJson =
      row.initialExtraction?.initialExtractionJson ??
      formatInitialExtraction([]);

    return buildResolveProvisionsPrompt({
      decisionId: row.decision_id || "",
      proceduralLanguage:
        (row.language_metadata || "FR").toUpperCase() === "NL" ? "NL" : "FR",
      fullText: row.full_md || "",
      initialExtraction: initialJson,
    });
  },

  outputSchema: {
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
            provisionId: { type: ["null"] },
            parentActId: { type: ["null"] },
            provisionSequence: { type: "integer" },
            parentActSequence: { type: "integer" },
            provisionNumber: { type: "string" },
            provisionNumberKey: { type: "string" },
            parentActType: { type: "string" },
            parentActName: { type: "string" },
            parentActDate: { type: ["string", "null"] },
            parentActNumber: { type: ["string", "null"] },
          },
        },
      },
    },
  },

  outputSchemaName: "resolve_provision_extraction",

  provider: "openai",
  model: "gpt-5-mini",
  maxCompletionTokens: 128000,
  reasoningEffort: "medium",
  verbosity: "low",

  customIdPrefix: "resolve-provisions-2a",

  postProcessRow: (row, result) => {
    const decisionId = row.decision_id;
    if (!decisionId) {
      throw new Error("decision_id is required for ID construction");
    }

    if (!result.citedProvisions || !Array.isArray(result.citedProvisions)) {
      result.citedProvisions = [];
      return result;
    }

    result.citedProvisions = sanitiseCitedProvisions(result.citedProvisions, {
      decisionId,
      language: row.language_metadata,
      abbreviations: row.abbreviations,
    });

    return result;
  },
};

export default config;
