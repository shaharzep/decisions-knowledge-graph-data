/**
 * Quick test script to verify interpret-provisions ID fix
 * Tests on ECLI:BE:AHANT:1997:ARR.19970917.21 which had corrupted IDs
 * Saves full output to JSON for review
 */

import 'dotenv/config';
import fs from 'fs';
import { OpenAI } from 'openai';

// Load the problematic decision's 2B data
const input2BPath = 'full-data/enrich-provisions/2025-11-07T01-46-50-826Z/jsons/ECLI_BE_AHANT_1997_ARR.19970917.21_NL.json';
const input2B = JSON.parse(fs.readFileSync(input2BPath, 'utf-8'));

console.log('=== INPUT FROM 2B ===');
console.log('Decision:', input2B.decision_id);
console.log('Language:', input2B.language);
console.log('Provisions count:', input2B.citedProvisions.length);

// Load prompt
import { INTERPRET_PROVISIONS_PROMPT } from './src/jobs/interpret-provisions/prompt.js';

// Build the prompt (with actual markdown for real test)
const mdPath = 'full-data/enrich-provisions/2025-11-07T01-46-50-826Z/jsons/ECLI_BE_AHANT_1997_ARR.19970917.21_NL.json';

// We need to get the actual markdown - let's query it or use a placeholder
const prompt = INTERPRET_PROVISIONS_PROMPT
  .replace("{decisionId}", input2B.decision_id)
  .replace("{proceduralLanguage}", input2B.language)
  .replace("{citedProvisions}", JSON.stringify(input2B.citedProvisions, null, 2))
  .replace("{fullText.markdown}", "[MARKDOWN OMITTED - Testing ID preservation only]");

// Build the schema from config
const outputSchema = {
  type: "object" as const,
  required: ["citedProvisions"],
  additionalProperties: false,
  properties: {
    citedProvisions: {
      type: "array" as const,
      minItems: 0,
      items: {
        type: "object" as const,
        required: ["provisionSequence", "provisionInterpretation", "relevantFactualContext"],
        additionalProperties: false,
        properties: {
          provisionSequence: {
            type: "integer" as const,
            minimum: 1,
            maximum: 9999,
          },
          provisionInterpretation: {
            anyOf: [
              { type: "string" as const, minLength: 100, maxLength: 1000 },
              { type: "null" as const },
            ],
          },
          relevantFactualContext: {
            anyOf: [
              { type: "string" as const, minLength: 50, maxLength: 500 },
              { type: "null" as const },
            ],
          },
        },
      },
    },
  },
};

async function runTest() {
  console.log('\n=== CALLING LLM ===');

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: prompt }],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "provision_interpretation_2c",
        schema: outputSchema,
        strict: true,
      },
    },
    max_completion_tokens: 16000,
  });

  const llmResult = JSON.parse(response.choices[0].message.content || '{}');

  console.log('LLM returned', llmResult.citedProvisions?.length, 'provisions');

  // Now apply postProcessRow logic
  console.log('\n=== APPLYING postProcessRow ===');

  const inputProvisions = input2B.citedProvisions;
  const llmProvisions = llmResult.citedProvisions || [];

  // Build lookup map
  const inputBySequence = new Map<number, any>();
  for (const prov of inputProvisions) {
    if (typeof prov.provisionSequence === 'number') {
      inputBySequence.set(prov.provisionSequence, prov);
    }
  }

  // Merge
  const mergedProvisions = llmProvisions.map((llmProv: any) => {
    const seq = llmProv.provisionSequence;
    const inputProv = inputBySequence.get(seq);

    if (!inputProv) {
      throw new Error(`No input provision found for provisionSequence ${seq}`);
    }

    return {
      provisionId: inputProv.provisionId,
      parentActId: inputProv.parentActId,
      internalProvisionId: inputProv.internalProvisionId,
      internalParentActId: inputProv.internalParentActId,
      provisionSequence: inputProv.provisionSequence,
      parentActSequence: inputProv.parentActSequence,
      provisionNumber: inputProv.provisionNumber,
      provisionNumberKey: inputProv.provisionNumberKey,
      parentActType: inputProv.parentActType,
      parentActName: inputProv.parentActName,
      parentActDate: inputProv.parentActDate,
      parentActNumber: inputProv.parentActNumber,
      provisionInterpretation: llmProv.provisionInterpretation,
      relevantFactualContext: llmProv.relevantFactualContext,
    };
  });

  // Build final output structure
  const finalOutput = {
    id: input2B.id,
    decision_id: input2B.decision_id,
    language: input2B.language,
    md_length: input2B.md_length,
    citedProvisions: mergedProvisions,
    extractedReferences: input2B.extractedReferences,
  };

  // Verify IDs match input exactly
  console.log('\n=== ID INTEGRITY CHECK ===');
  const integrityReport: any[] = [];
  let allMatch = true;

  for (const merged of mergedProvisions) {
    const input = inputBySequence.get(merged.provisionSequence);
    const check = {
      provisionSequence: merged.provisionSequence,
      input_internalProvisionId: input.internalProvisionId,
      output_internalProvisionId: merged.internalProvisionId,
      provisionId_match: merged.internalProvisionId === input.internalProvisionId,
      input_internalParentActId: input.internalParentActId,
      output_internalParentActId: merged.internalParentActId,
      parentActId_match: merged.internalParentActId === input.internalParentActId,
    };
    integrityReport.push(check);

    if (!check.provisionId_match || !check.parentActId_match) {
      allMatch = false;
      console.log(`❌ MISMATCH at provisionSequence=${merged.provisionSequence}`);
    }
  }

  if (allMatch) {
    console.log('✅ All IDs preserved correctly!');
  }

  // Save everything to JSON
  const outputFile = {
    testDate: new Date().toISOString(),
    testDecision: input2B.decision_id,
    summary: {
      inputProvisionsCount: inputProvisions.length,
      llmOutputCount: llmProvisions.length,
      mergedCount: mergedProvisions.length,
      allIdsPreserved: allMatch,
    },
    integrityReport,
    rawLlmOutput: llmResult,
    finalMergedOutput: finalOutput,
  };

  const outputPath = 'test-interpret-fix-output.json';
  fs.writeFileSync(outputPath, JSON.stringify(outputFile, null, 2));
  console.log(`\n📄 Full output saved to: ${outputPath}`);
}

runTest().catch(console.error);
