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
 * Check if prompt is for map-cited-decisions job
 *
 * These prompts use specific placeholders for citation mapping evaluation
 *
 * @param promptTemplate - The loaded judge prompt markdown content
 * @returns true if this is a map-cited-decisions prompt
 */
export function isMapCitedDecisionsPrompt(promptTemplate: string): boolean {
  return (
    promptTemplate.includes('{citedCourtName}') &&
    promptTemplate.includes('{modelOutput}') &&
    promptTemplate.includes('{candidatesList}')
  );
}

/**
 * Check if prompt is for classify-legal-issues job
 *
 * These prompts use ${TEACHING_INPUT} and ${CLASSIFICATION_OUTPUT} placeholders
 * for evaluating ULIT taxonomy classification of legal teachings.
 *
 * @param promptTemplate - The loaded judge prompt markdown content
 * @returns true if this is a classify-legal-issues prompt
 */
export function isClassifyLegalIssuesPrompt(promptTemplate: string): boolean {
  return (
    promptTemplate.includes('${TEACHING_INPUT}') &&
    promptTemplate.includes('${CLASSIFICATION_OUTPUT}')
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
 * Supports four formatting styles:
 * 1. Map-cited-decisions: Replaces placeholders like {citedCourtName}, {modelOutput}, {candidatesList}
 * 2. RFTC-style: Replaces placeholders like {transformedHtml}, {legalTeachingsInput}
 * 3. Template-style: Replaces placeholders like {ground_truth_snippets}
 * 4. Append-style: Appends sections at the end (backward compatible)
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
  extractedReferences?: any,
  teachingInput?: any
): string {
  // Detect prompt style - check most specific styles first
  if (isClassifyLegalIssuesPrompt(promptTemplate)) {
    // Classify-legal-issues style: uses teachingInput and extractedData
    return formatClassifyLegalIssuesPrompt(promptTemplate, teachingInput, extractedData);
  } else if (isMapCitedDecisionsPrompt(promptTemplate)) {
    // Map-cited-decisions style: uses extractedData as both input context and output
    return formatMapCitedDecisionsPrompt(promptTemplate, extractedData);
  } else if (isTemplateStylePrompt(promptTemplate)) {
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

/**
 * Format map-cited-decisions prompt
 *
 * This job evaluates mapping quality, where input context is embedded in the extraction result.
 * Replaces placeholders: {citedCourtName}, {citedDate}, {citedCaseNumber}, {citedEcli},
 * {citationSnippet}, {snippetMatchType}, {candidateCount}, {candidatesList},
 * {modelOutput}, {groundTruth}
 *
 * @param promptTemplate - Template with map-cited-decisions placeholders
 * @param extractedData - Full extraction result containing both input context and model output
 * @returns Formatted prompt with all placeholders replaced
 */
function formatMapCitedDecisionsPrompt(
  promptTemplate: string,
  extractedData: any
): string {
  let formatted = promptTemplate;

  // Extract input context from the extraction result
  const citedCourtName = extractedData.cited_court_name || 'N/A';
  const citedDate = extractedData.cited_date || 'N/A';
  const citedCaseNumber = extractedData.cited_case_number || 'N/A';
  const citedEcli = extractedData.cited_ecli || 'N/A';
  const citationSnippet = extractedData.citation_snippet || '[No snippet available]';
  const snippetMatchType = extractedData.snippet_match_type || 'UNKNOWN';
  const candidates = extractedData.candidates || [];
  const teachingTexts = extractedData.teaching_texts || [];

  // IMPORTANT: candidate_count may be different from candidates.length
  // In fast-path cases, candidates array is not preserved but candidate_count is
  const candidateCount = extractedData.candidate_count ?? candidates.length;

  // Format candidates list with fast-path context
  let candidatesList: string;
  if (candidates.length > 0) {
    candidatesList = formatCandidatesForJudge(candidates);
  } else if (candidateCount > 0) {
    // Fast-path case: we know there were candidates but they weren't preserved
    candidatesList = `[FAST-PATH: ${candidateCount} candidate(s) found during preprocessing but not preserved in output.\n` +
      `The match was determined via fast-path logic (ECLI exact match or single candidate).\n` +
      `Judge should evaluate based on the match reasoning and cited identifiers.]`;
  } else {
    candidatesList = '[No candidates available]';
  }

  // Extract model output (matches and no_match_reason)
  const modelOutput = {
    matches: extractedData.matches || [],
    no_match_reason: extractedData.no_match_reason || null,
  };

  // Ground truth: Build context for the judge based on available signals
  let groundTruth = '';

  // Fast-path detection
  const isFastPath = candidateCount > 0 && candidates.length === 0;
  if (isFastPath) {
    groundTruth += `**FAST-PATH CASE**: This match was determined without LLM (preprocessing logic). `;
    groundTruth += `candidate_count=${candidateCount} but candidates array not preserved. `;
  }

  if (citedEcli && citedEcli !== 'N/A') {
    groundTruth += `Cited ECLI: ${citedEcli} - if model matched this exactly, it's correct. `;
  }
  if (citedCaseNumber && citedCaseNumber !== 'N/A') {
    groundTruth += `Cited case number: ${citedCaseNumber} - compare against matched decision's identifiers. `;
  }

  // Context based on candidate count
  if (candidateCount === 0) {
    groundTruth += `No candidates found - correct behavior is no_match with appropriate reason. `;
  } else if (candidateCount === 1) {
    groundTruth += `Single candidate scenario - high confidence match is appropriate if identifiers align. `;
  } else {
    groundTruth += `Multiple candidates (${candidateCount}) - verify LLM selected the best match. `;
  }

  if (!groundTruth) {
    groundTruth = 'No explicit ground truth provided.';
  }

  // Replace all placeholders
  formatted = formatted
    .replace(/\{citedCourtName\}/g, citedCourtName)
    .replace(/\{citedDate\}/g, citedDate)
    .replace(/\{citedCaseNumber\}/g, citedCaseNumber)
    .replace(/\{citedEcli\}/g, citedEcli)
    .replace(/\{citationSnippet\}/g, citationSnippet)
    .replace(/\{snippetMatchType\}/g, snippetMatchType)
    .replace(/\{candidateCount\}/g, String(candidateCount))
    .replace(/\{candidatesList\}/g, candidatesList)
    .replace(/\{modelOutput\}/g, JSON.stringify(modelOutput, null, 2))
    .replace(/\{groundTruth\}/g, groundTruth);

  return formatted;
}

/**
 * Format candidates array for judge prompt
 *
 * Produces a numbered list with key information for each candidate.
 *
 * @param candidates - Array of candidate decision objects
 * @returns Formatted string for prompt injection
 */
function formatCandidatesForJudge(candidates: any[]): string {
  if (!candidates || candidates.length === 0) {
    return '[No candidates available]';
  }

  return candidates.map((c, idx) => {
    const parts: string[] = [];
    parts.push(`${idx + 1}. [${c.decision_id || 'UNKNOWN'}]`);

    if (c.court_name || c.court_name_fr || c.court_name_nl) {
      parts.push(`   Court: ${c.court_name || c.court_name_fr || c.court_name_nl}`);
    }
    if (c.decision_date) {
      parts.push(`   Date: ${c.decision_date}`);
    }
    if (c.decision_type_fr || c.decision_type_nl) {
      parts.push(`   Type: ${c.decision_type_fr || c.decision_type_nl}`);
    }
    if (c.rol_number) {
      parts.push(`   Case Number (rol_number): ${c.rol_number}`);
    }

    // Include teaching texts (truncated)
    if (c.teaching_texts && c.teaching_texts.length > 0) {
      const teachings = c.teaching_texts.slice(0, 3).map((t: string, i: number) => {
        const truncated = t.length > 250 ? t.substring(0, 250) + '...' : t;
        return `     ${i + 1}. ${truncated}`;
      });
      parts.push(`   Legal Teachings:\n${teachings.join('\n')}`);
    }

    // Include summaries (truncated)
    if (c.summaries && c.summaries.length > 0) {
      const summaries = c.summaries.slice(0, 2).map((s: string, i: number) => {
        const truncated = s.length > 200 ? s.substring(0, 200) + '...' : s;
        return `     ${i + 1}. ${truncated}`;
      });
      parts.push(`   Summaries:\n${summaries.join('\n')}`);
    }

    return parts.join('\n');
  }).join('\n\n');
}

/**
 * Format classify-legal-issues prompt
 *
 * This job evaluates ULIT taxonomy classification of legal teachings.
 * Replaces placeholders: ${TEACHING_INPUT}, ${CLASSIFICATION_OUTPUT}
 *
 * @param promptTemplate - Template with classify-legal-issues placeholders
 * @param teachingInput - The original teaching being classified
 * @param classificationOutput - The system's classification result
 * @returns Formatted prompt with all placeholders replaced
 */
function formatClassifyLegalIssuesPrompt(
  promptTemplate: string,
  teachingInput: any,
  classificationOutput: any
): string {
  let formatted = promptTemplate;

  // Format teaching input as JSON
  const teachingInputJson = teachingInput
    ? JSON.stringify(teachingInput, null, 2)
    : '[Teaching input not available]';

  // Format classification output as JSON
  const classificationOutputJson = classificationOutput
    ? JSON.stringify(classificationOutput, null, 2)
    : '[Classification output not available]';

  // Replace placeholders (note: using ${ } syntax, not { } syntax)
  formatted = formatted
    .replace(/\$\{TEACHING_INPUT\}/g, teachingInputJson)
    .replace(/\$\{CLASSIFICATION_OUTPUT\}/g, classificationOutputJson);

  return formatted;
}
