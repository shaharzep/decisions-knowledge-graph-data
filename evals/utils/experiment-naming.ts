/**
 * Experiment Naming Utilities
 *
 * Provides consistent experiment naming for Braintrust evaluations
 */

/**
 * Experiment Configuration (subset for naming)
 */
export interface ExperimentConfigForNaming {
  model: string;
  reasoningEffort?: 'low' | 'medium' | 'high';
  maxCompletionTokens?: number;
  verbosity?: 'minimal' | 'low' | 'medium' | 'high';
  temperature?: number;
}

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
 * Format token count for experiment name (e.g., 64000 -> "64k", 128000 -> "128k")
 */
function formatTokenCount(tokens: number | undefined): string {
  if (!tokens) return '';
  return `${Math.round(tokens / 1000)}k`;
}

/**
 * Generate enhanced experiment name with configuration parameters
 *
 * Format: {jobType}-{model}-{reasoningEffort}-{maxTokens}k-{YYYY-MM-DD}
 *
 * Examples:
 * - extract-comprehensive-gpt-5-mini-medium-128k-2025-10-24
 * - enrich-provisions-gpt-5-mini-low-64k-2025-10-24
 * - extract-provisions-2a-gpt-5-mini-low-64k-2025-10-25
 *
 * @param jobType - Job type being evaluated (e.g., "extract-comprehensive")
 * @param config - Experiment configuration with model settings
 * @returns Experiment name string
 */
export function generateEnhancedExperimentName(
  jobType: string,
  config: ExperimentConfigForNaming
): string {
  const dateString = getTodayDateString();
  const parts = [jobType, config.model];

  // Add reasoning effort if present (for reasoning models)
  if (config.reasoningEffort) {
    parts.push(config.reasoningEffort);
  }

  // Add max tokens if present
  if (config.maxCompletionTokens) {
    parts.push(formatTokenCount(config.maxCompletionTokens));
  }

  // Add verbosity if present and not default
  if (config.verbosity && config.verbosity !== 'low') {
    parts.push(`v-${config.verbosity}`);
  }

  // Add temperature if present and not default (for non-reasoning models)
  if (config.temperature !== undefined && config.temperature !== 0) {
    parts.push(`temp-${config.temperature}`);
  }

  // Add date
  parts.push(dateString);

  return parts.join('-');
}

/**
 * Generate experiment name for a job evaluation (legacy, simple format)
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
 * @deprecated Use generateEnhancedExperimentName for better experiment tracking
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
