/**
 * Judge Prompt Loader
 *
 * Utilities for loading and formatting LLM-as-a-judge prompts
 */

import fs from 'fs/promises';
import path from 'path';

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
 * Format a judge prompt with actual evaluation data
 *
 * Appends the decision ID, source document, and extracted data to the prompt template.
 * This follows the same pattern as the original formatJudgePrompt() but accepts
 * the template as a parameter instead of hardcoding it.
 *
 * @param promptTemplate - The loaded judge prompt markdown content
 * @param decisionId - ECLI identifier
 * @param sourceDocument - Original markdown text of the decision
 * @param extractedData - Extracted JSON object from the model
 * @returns Complete formatted prompt ready for GPT-5
 */
export function formatJudgePrompt(
  promptTemplate: string,
  decisionId: string,
  sourceDocument: string,
  extractedData: any
): string {
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
