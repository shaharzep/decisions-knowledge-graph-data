/**
 * Claude Judge Client Configuration
 *
 * Client for calling Claude Sonnet 4.5 as LLM judge
 * Non-thinking model for consistent, deterministic evaluations
 */

import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

let claudeJudgeClient: Anthropic | null = null;

/**
 * Initialize Claude client for judge evaluations
 */
export function initClaudeJudgeClient(): Anthropic {
  if (claudeJudgeClient) {
    return claudeJudgeClient;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not found in environment variables');
  }

  claudeJudgeClient = new Anthropic({
    apiKey,
    timeout: 600000, // 10 minutes (matches GPT-5 judge timeout)
    maxRetries: 2,
  });

  return claudeJudgeClient;
}

/**
 * Get or create Claude judge client
 */
export function getClaudeJudgeClient(): Anthropic {
  if (!claudeJudgeClient) {
    return initClaudeJudgeClient();
  }
  return claudeJudgeClient;
}

/**
 * Get the configured judge model name
 */
export function getClaudeJudgeModel(): string {
  return process.env.ANTHROPIC_JUDGE_MODEL || 'claude-sonnet-4-5-20250929';
}

/**
 * Call Claude Sonnet 4.5 for judge evaluation
 *
 * @param prompt - The full judge prompt with inputs
 * @returns JSON string response from Claude
 */
export async function callClaudeJudge(prompt: string): Promise<string> {
  const client = getClaudeJudgeClient();
  const model = getClaudeJudgeModel();

  try {
    const response = await client.messages.create({
      model,
      max_tokens: 16000, // Match GPT-5 judge capacity
      temperature: 0, // Deterministic for consistency
      // Claude doesn't have native JSON mode like OpenAI, so we use system prompt
      system: 'You are an expert legal extraction quality evaluator. You must respond with valid JSON only. No markdown, no code blocks, no explanations.',
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    });

    // Extract text content from response
    let content = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      }
    }

    if (!content) {
      throw new Error('No response content from Claude');
    }

    return content;
  } catch (error: any) {
    // Enhanced error handling for Anthropic API
    if (error.status === 429 || error.error?.type === 'rate_limit_error') {
      throw new Error(
        `Anthropic API rate limit exceeded. Consider reducing concurrency or adding delays between requests.`
      );
    }

    if (error.status) {
      throw new Error(
        `Anthropic API error: ${error.status} - ${error.error?.message || error.message}`
      );
    }

    throw new Error(`Failed to call Claude judge: ${error.message}`);
  }
}

/**
 * Validate Claude judge configuration
 */
export function validateClaudeJudgeConfig(): boolean {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    console.error('❌ ANTHROPIC_API_KEY not found in .env');
    return false;
  }

  if (!apiKey.startsWith('sk-ant-')) {
    console.error('❌ ANTHROPIC_API_KEY appears to be invalid (should start with sk-ant-)');
    return false;
  }

  console.log('✅ Claude judge configuration valid');
  return true;
}

/**
 * Reset client (useful for testing or config changes)
 */
export function resetClaudeJudgeClient(): void {
  claudeJudgeClient = null;
}
