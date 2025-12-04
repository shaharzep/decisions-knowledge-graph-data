/**
 * Job-to-Judge-Prompt Mapping
 *
 * Maps extraction job types to their corresponding LLM-as-a-judge prompt files.
 *
 * ## How to Add a New Job Eval
 *
 * When you create a new extraction job and want to evaluate it:
 * 1. Add one line here: `'job-type': 'prompt-filename.md'`
 * 2. Run: `npm run eval run job-type`
 *
 * That's it!
 *
 * ## Example
 * ```typescript
 * 'extract-provisions-fr': 'llm-as-a-judge_STAGE 2A.md',
 * ```
 */

export const JOB_PROMPT_MAP: Record<string, string> = {
  // Stage 1: Comprehensive extraction (parties, facts, arguments, court order)
  'extract-comprehensive': 'llm-as-a-judge_STAGE 1.md',

  // Stage 2A: Provisions essential metadata (Agent 2A)
  'extract-provisions-2a': 'llm-as-a-judge_STAGE 2A.md',

  // Stage 2B: Enrich provisions with additional details (Agent 2B)
  'enrich-provisions': 'llm-as-a-judge_STAGE 2B.md',
  
  // Stage 2C: Provisions interpretation (uncomment when ready)
  'interpret-provisions': 'llm-as-a-judge_STAGE 2C.md',
  
  // Stage 3: Cited decisions extraction
  'extract-cited-decisions': 'llm-as-a-judge_STAGE 3.md',

  // Stage 4: Keywords extraction
  'extract-keywords': 'llm-as-a-judge_STAGE 4_keywords.md',

  // Agent 6: Micro-summary extraction
  'extract-micro-summary': 'llm-as-a-judge_MICRO-SUMMARY.md',

  // HTML Structure Conversion: Markdown to structured HTML
  'structure-full-html': 'llm-as-a-judge_structure-html.md',

  // Markdown cleaning prior to HTML conversion
  'clean-decision-markdown': 'llm-as-a-judge_clean-markdown.md',

  // Stage 5: Legal teachings extraction
  'extract-legal-teachings': 'llm-as-a-judge_STAGE 5.md',

  // Stage 6 (uncomment when ready)
  // 'extract-stage6': 'llm-as-a-judge_STAGE 6.md',

  // RFTC Stage 2: Citation enrichment (Agent 2D, 5B)
  'enrich-teaching-citations': 'llm-as-a-judge_RFTC_1_legalTeachings.md',
  'enrich-provision-citations': 'llm-as-a-judge_RFTC_2_citedProvisions.md',
  // 'enrich-decision-citations': 'llm-as-a-judge_RFTC_3_citedDecisions.md',

  // Stage 2: Standard Provision Mapping
  'map-provisions-standard': 'llm-as-a-judge_MAP_STANDARD.md',

  // Stage 2: Code/Constitution Provision Mapping
  'map-provisions-code': 'llm-as-a-judge_MAP_CODE.md',

  // Stage 2: No-Date Provision Mapping (provisions without date)
  'map-provisions-no-date': 'llm-as-a-judge_MAP_NO_DATE.md',

  // Stage 3: Cited Decision Mapping (map citations to database decisions)
  'map-cited-decisions': 'llm-as-a-judge_map_decisions.md',
};

/**
 * Get judge prompt filename for a job type
 *
 * @param jobType - Extraction job type (e.g., "extract-comprehensive")
 * @returns Filename of judge prompt markdown file
 * @throws Error if job type not configured
 */
export function getJudgePromptFile(jobType: string): string {
  const promptFile = JOB_PROMPT_MAP[jobType];

  if (!promptFile) {
    const available = Object.keys(JOB_PROMPT_MAP).join('\n  - ');
    throw new Error(
      `No eval configured for job type: ${jobType}\n\n` +
      `Available job types:\n  - ${available}\n\n` +
      `To add eval for this job:\n` +
      `  1. Edit: evals/config/job-prompt-map.ts\n` +
      `  2. Add: '${jobType}': 'llm-as-a-judge_XXX.md'\n` +
      `  3. Run: npm run eval run ${jobType}`
    );
  }

  return promptFile;
}

/**
 * Get all configured job types
 *
 * @returns Array of job types that have eval configured
 */
export function getConfiguredJobTypes(): string[] {
  return Object.keys(JOB_PROMPT_MAP);
}

/**
 * Check if a job type has eval configured
 *
 * @param jobType - Job type to check
 * @returns true if eval is configured
 */
export function hasEvalConfigured(jobType: string): boolean {
  return jobType in JOB_PROMPT_MAP;
}
