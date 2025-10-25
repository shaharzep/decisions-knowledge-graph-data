/**
 * Experiment Naming Utilities
 *
 * Provides consistent experiment naming for Braintrust evaluations
 */

/**
 * Get today's date in YYYY-MM-DD format
 *
 * @returns Date string in YYYY-MM-DD format
 */
function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Generate experiment name for a job evaluation
 *
 * Format: {jobType}-{model}-{YYYY-MM-DD}
 *
 * Examples:
 * - extract-comprehensive-gpt-5-mini-2025-10-24
 * - enrich-provisions-gpt-5-mini-2025-10-24
 * - extract-cited-decisions-gpt-4o-mini-2025-10-24
 *
 * @param jobType - Job type being evaluated (e.g., "extract-comprehensive")
 * @param model - Model name used for extraction (e.g., "gpt-5-mini")
 * @returns Experiment name string
 */
export function generateExperimentName(jobType: string, model: string): string {
  const dateString = getTodayDateString();
  return `${jobType}-${model}-${dateString}`;
}

/**
 * Generate experiment name with optional suffix
 *
 * Format: {jobType}-{model}-{YYYY-MM-DD}-{suffix}
 *
 * Useful for running multiple experiments on the same day.
 *
 * Examples:
 * - extract-comprehensive-gpt-5-mini-2025-10-24-run1
 * - extract-comprehensive-gpt-5-mini-2025-10-24-baseline
 *
 * @param jobType - Job type being evaluated
 * @param model - Model name used for extraction
 * @param suffix - Optional suffix to append
 * @returns Experiment name string
 */
export function generateExperimentNameWithSuffix(
  jobType: string,
  model: string,
  suffix: string
): string {
  const baseName = generateExperimentName(jobType, model);
  return `${baseName}-${suffix}`;
}
