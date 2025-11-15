/**
 * Judge Prompt Loader
 *
 * Utilities for loading and formatting LLM-as-a-judge prompts
 */

import fs from 'fs/promises';
import path from 'path';
import { GroundTruthData, GroundTruthSnippets, RFTCSourceData } from '../types.js';

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
    promptTemplate.includes('{extracted_output}') ||
    promptTemplate.includes('{transformedHtml}')  // RFTC template detection
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
 * Supports three formatting styles:
 * 1. RFTC-style: Replaces placeholders like {transformedHtml}, {legalTeachingsInput}
 * 2. Template-style: Replaces placeholders like {ground_truth_snippets}
 * 3. Append-style: Appends sections at the end (backward compatible)
 *
 * @param promptTemplate - The loaded judge prompt markdown content
 * @param decisionId - ECLI identifier
 * @param groundTruthData - Ground truth data (markdown, snippets, OR RFTC data)
 * @param extractedData - Extracted JSON object from the model
 * @param jobType - Optional job type for context
 * @param extractedReferences - Optional pre-extracted references for Agent 2B evaluation
 * @returns Complete formatted prompt ready for GPT-5
 */
export function formatJudgePrompt(
  promptTemplate: string,
  decisionId: string,
  groundTruthData: GroundTruthData | RFTCSourceData,
  extractedData: any,
  jobType?: string,
  extractedReferences?: any
): string {
  // Detect prompt style
  if (isTemplateStylePrompt(promptTemplate)) {
    // Template-style: Replace placeholders
    return formatTemplateStylePrompt(
      promptTemplate,
      decisionId,
      groundTruthData,
      extractedData,
      extractedReferences
    );
  } else {
    // Append-style: Backward compatible (for Stage 1, etc.)
    return formatAppendStylePrompt(
      promptTemplate,
      decisionId,
      groundTruthData,
      extractedData,
      extractedReferences
    );
  }
}

/**
 * Format template-style prompt by replacing placeholders
 *
 * @param promptTemplate - Template with placeholders
 * @param decisionId - ECLI identifier
 * @param groundTruthData - Ground truth data (can be markdown, snippets, or RFTC data)
 * @param extractedData - Extracted JSON
 * @param extractedReferences - Optional pre-extracted references (for Agent 2B)
 * @returns Formatted prompt with placeholders replaced
 */
function formatTemplateStylePrompt(
  promptTemplate: string,
  decisionId: string,
  groundTruthData: GroundTruthData | RFTCSourceData,
  extractedData: any,
  extractedReferences?: any
): string {
  let formatted = promptTemplate;

  // Check if RFTC data (has transformedHtml property)
  if (typeof groundTruthData === 'object' && 'transformedHtml' in groundTruthData) {
    // RFTC-style template
    const rftcData = groundTruthData as RFTCSourceData;

    formatted = formatted
      .replace('{blocks}', JSON.stringify(rftcData.blocks, null, 2))
      .replace('{transformedHtml}', rftcData.transformedHtml)
      .replace(
        '{legalTeachingsInput}',
        JSON.stringify(rftcData.dependencies.legalTeachingsInput, null, 2)
      )
      .replace(
        '{citedProvisions}',
        JSON.stringify(rftcData.dependencies.citedProvisions, null, 2)
      )
      .replace(
        '{citedDecisions}',
        JSON.stringify(rftcData.dependencies.citedDecisions, null, 2)
      );
  } else if (typeof groundTruthData === 'object' && groundTruthData.format === 'snippets') {
    // Snippet-style template
    const snippetsFormatted = formatSnippetsForPrompt(groundTruthData.snippets);
    formatted = formatted.replace('{ground_truth_snippets}', snippetsFormatted);
  } else {
    // Markdown-style template (fallback)
    formatted = formatted.replace(
      '{ground_truth_snippets}',
      `\`\`\`markdown\n${groundTruthData}\n\`\`\``
    );
  }

  // Common replacements
  formatted = formatted.replace(
    '{extracted_output}',
    JSON.stringify(extractedData, null, 2)
  );

  // Replace {extractedReferences} if provided (for Agent 2B evaluation)
  if (extractedReferences) {
    formatted = formatted.replace(
      '{extractedReferences}',
      JSON.stringify(extractedReferences, null, 2)
    );
  }

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
 * @param extractedReferences - Optional pre-extracted references (for Agent 2B)
 * @returns Formatted prompt with appended sections
 */
function formatAppendStylePrompt(
  promptTemplate: string,
  decisionId: string,
  groundTruthData: GroundTruthData,
  extractedData: any,
  extractedReferences?: any
): string {
  // For append style, ground truth should always be full text
  const sourceDocument = typeof groundTruthData === 'string'
    ? groundTruthData
    : (groundTruthData.snippets ? groundTruthData.snippets.join('\n\n') : JSON.stringify(groundTruthData, null, 2)); // Fallback: concatenate snippets or stringify

  let appendedContent = `${promptTemplate}

## DECISION ID
${decisionId}

## ORIGINAL SOURCE DOCUMENT
\`\`\`markdown
${sourceDocument}
\`\`\``;

  // Add extractedReferences if provided (for Agent 2B)
  if (extractedReferences) {
    appendedContent += `

## EXTRACTED REFERENCES (Pre-extracted via Regex)
\`\`\`json
${JSON.stringify(extractedReferences, null, 2)}
\`\`\``;
  }

  appendedContent += `

## EXTRACTED OUTPUT
\`\`\`json
${JSON.stringify(extractedData, null, 2)}
\`\`\`

Return your evaluation as valid JSON only.`;

  return appendedContent;
}
