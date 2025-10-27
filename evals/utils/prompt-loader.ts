/**
 * Judge Prompt Loader
 *
 * Utilities for loading and formatting LLM-as-a-judge prompts
 */

import fs from 'fs/promises';
import path from 'path';
import { GroundTruthData, GroundTruthSnippets } from '../types.js';

/**
 * Load a judge prompt from the judge-prompts directory
 *
 * @param filename - Filename of the markdown prompt (e.g., "llm-as-a-judge_STAGE 1.md")
 * @returns Content of the prompt file
 * @throws Error if file not found
 */
export async function loadJudgePrompt(filename: string): Promise<string> {
  const promptsDir = path.join(process.cwd(), 'evals', 'judge-prompts');
  const filePath = path.join(promptsDir, filename);

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return content;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(
        `Judge prompt file not found: ${filename}\n` +
        `Expected location: ${filePath}\n\n` +
        `Available prompts in evals/judge-prompts/:\n` +
        `  - llm-as-a-judge_STAGE 1.md\n` +
        `  - llm-as-a-judge_STAGE 2A.md\n` +
        `  - llm-as-a-judge_STAGE 2B.md\n` +
        `  - llm-as-a-judge_STAGE 2C.md\n` +
        `  - llm-as-a-judge_STAGE 3.md\n` +
        `  - llm-as-a-judge_STAGE 5.md\n` +
        `  - llm-as-a-judge_STAGE 6.md\n` +
        `  - llm-as-a-judge_RFTC_1_legalTeachings.md\n` +
        `  - llm-as-a-judge_RFTC_2_citedProvisions.md\n` +
        `  - llm-as-a-judge_RFTC_3_citedDecisions.md`
      );
    }
    throw error;
  }
}

/**
 * Check if prompt uses template-style placeholders
 *
 * Template-style prompts contain placeholders like {ground_truth_snippets} or {extracted_output}
 * Append-style prompts expect data to be appended at the end
 *
 * @param promptTemplate - The loaded judge prompt markdown content
 * @returns true if prompt uses template placeholders
 */
export function isTemplateStylePrompt(promptTemplate: string): boolean {
  return (
    promptTemplate.includes('{ground_truth_snippets}') ||
    promptTemplate.includes('{extracted_output}')
  );
}

/**
 * Format snippets as numbered list for prompt injection
 *
 * @param snippets - Array of provision context snippets
 * @returns Formatted string with numbered snippets
 */
export function formatSnippetsForPrompt(snippets: string[]): string {
  if (snippets.length === 0) {
    return '[No provision snippets found in source document]';
  }

  return snippets
    .map((snippet, idx) => `[${idx + 1}] ${snippet}`)
    .join('\n\n');
}

/**
 * Format a judge prompt with actual evaluation data
 *
 * Supports two formatting styles:
 * 1. Template-style: Replaces placeholders like {ground_truth_snippets}
 * 2. Append-style: Appends sections at the end (backward compatible)
 *
 * @param promptTemplate - The loaded judge prompt markdown content
 * @param decisionId - ECLI identifier
 * @param groundTruthData - Ground truth data (full text OR snippets)
 * @param extractedData - Extracted JSON object from the model
 * @param jobType - Optional job type for context
 * @returns Complete formatted prompt ready for GPT-5
 */
export function formatJudgePrompt(
  promptTemplate: string,
  decisionId: string,
  groundTruthData: GroundTruthData,
  extractedData: any,
  jobType?: string
): string {
  // Detect prompt style
  if (isTemplateStylePrompt(promptTemplate)) {
    // Template-style: Replace placeholders
    return formatTemplateStylePrompt(
      promptTemplate,
      decisionId,
      groundTruthData,
      extractedData
    );
  } else {
    // Append-style: Backward compatible (for Stage 1, etc.)
    return formatAppendStylePrompt(
      promptTemplate,
      decisionId,
      groundTruthData,
      extractedData
    );
  }
}

/**
 * Format template-style prompt by replacing placeholders
 *
 * @param promptTemplate - Template with placeholders
 * @param decisionId - ECLI identifier
 * @param groundTruthData - Ground truth data
 * @param extractedData - Extracted JSON
 * @returns Formatted prompt with placeholders replaced
 */
function formatTemplateStylePrompt(
  promptTemplate: string,
  decisionId: string,
  groundTruthData: GroundTruthData,
  extractedData: any
): string {
  let formatted = promptTemplate;

  // Replace {ground_truth_snippets}
  if (typeof groundTruthData === 'object' && groundTruthData.format === 'snippets') {
    const snippetsFormatted = formatSnippetsForPrompt(groundTruthData.snippets);
    formatted = formatted.replace('{ground_truth_snippets}', snippetsFormatted);
  } else {
    // Fallback: if full text provided but template expects snippets, wrap in code block
    formatted = formatted.replace(
      '{ground_truth_snippets}',
      `\`\`\`markdown\n${groundTruthData}\n\`\`\``
    );
  }

  // Replace {extracted_output}
  formatted = formatted.replace(
    '{extracted_output}',
    JSON.stringify(extractedData, null, 2)
  );

  // Replace {ecli}
  formatted = formatted.replace('{ecli}', decisionId);

  // Replace {proceduralLanguage}
  const language = extractedData.language || extractedData.language_metadata || 'FR';
  formatted = formatted.replace('{proceduralLanguage}', language);

  return formatted;
}

/**
 * Format append-style prompt (backward compatible with existing prompts)
 *
 * @param promptTemplate - Base prompt template
 * @param decisionId - ECLI identifier
 * @param groundTruthData - Ground truth data (should be full text for append style)
 * @param extractedData - Extracted JSON
 * @returns Formatted prompt with appended sections
 */
function formatAppendStylePrompt(
  promptTemplate: string,
  decisionId: string,
  groundTruthData: GroundTruthData,
  extractedData: any
): string {
  // For append style, ground truth should always be full text
  const sourceDocument = typeof groundTruthData === 'string'
    ? groundTruthData
    : groundTruthData.snippets.join('\n\n'); // Fallback: concatenate snippets

  return `${promptTemplate}

## DECISION ID
${decisionId}

## ORIGINAL SOURCE DOCUMENT
\`\`\`markdown
${sourceDocument}
\`\`\`

## EXTRACTED OUTPUT
\`\`\`json
${JSON.stringify(extractedData, null, 2)}
\`\`\`

Return your evaluation as valid JSON only.`;
}
