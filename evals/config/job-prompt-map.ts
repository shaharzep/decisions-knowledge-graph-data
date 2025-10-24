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

  // Stage 2: Provisions (uncomment when ready)
  // 'extract-provisions-fr': 'llm-as-a-judge_STAGE 2A.md',
  // 'extract-provisions-nl': 'llm-as-a-judge_STAGE 2B.md',
  // 'extract-provisions-interpretation': 'llm-as-a-judge_STAGE 2C.md',

  // Stage 3 (uncomment when ready)
  'extract-cited-decisions': 'llm-as-a-judge_STAGE 3.md',

  // Stage 5 (uncomment when ready)
  // 'extract-stage5': 'llm-as-a-judge_STAGE 5.md',

  // Stage 6 (uncomment when ready)
  // 'extract-stage6': 'llm-as-a-judge_STAGE 6.md',

  // RFTC: Citations (uncomment when ready)
  // 'extract-legal-teachings': 'llm-as-a-judge_RFTC_1_legalTeachings.md',
  // 'extract-cited-provisions': 'llm-as-a-judge_RFTC_2_citedProvisions.md',
  // 'extract-cited-decisions': 'llm-as-a-judge_RFTC_3_citedDecisions.md',
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
