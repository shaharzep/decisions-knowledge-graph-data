/**
 * OpenAI GPT-5 Client Configuration
 *
 * Client for calling GPT-5 as LLM judge with high reasoning effort
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

let openaiClient: OpenAI | null = null;

/**
 * Initialize OpenAI client for GPT-5
 */
export function initGPT5Client(): OpenAI {
  if (openaiClient) {
    return openaiClient;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not found in environment variables');
  }

  const config: any = {
    apiKey,
  };

  // Add organization ID if provided
  if (process.env.OPENAI_ORG_ID) {
    config.organization = process.env.OPENAI_ORG_ID;
  }

  openaiClient = new OpenAI(config);

  return openaiClient;
}

/**
 * Get or create OpenAI client
 */
export function getGPT5Client(): OpenAI {
  if (!openaiClient) {
    return initGPT5Client();
  }
  return openaiClient;
}

/**
 * Call GPT-5 with high reasoning effort for judge evaluation
 *
 * @param prompt - The full judge prompt with inputs
 * @returns Parsed evaluation result
 */
export async function callGPT5Judge(prompt: string): Promise<string> {
  const client = getGPT5Client();
  const timeoutMs = Number(process.env.EVAL_JUDGE_TIMEOUT_MS || '420000'); // default 7 minutes

  try {
    const response = (await Promise.race([
      client.chat.completions.create({
        model: 'gpt-5', // Use GPT-4o for now (GPT-5 not yet available via API)
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
        reasoning_effort: 'medium',
        max_completion_tokens: 16000,
        response_format: { type: 'json_object' },
      }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error(`GPT-5 judge call timed out after ${timeoutMs}ms`)),
          timeoutMs
        )
      ),
    ])) as Awaited<ReturnType<typeof client.chat.completions.create>>;

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response content from GPT-5');
    }

    return content;
  } catch (error: any) {
    // Enhanced error handling for OpenAI API
    if (error.response) {
      throw new Error(
        `OpenAI API error: ${error.response.status} - ${error.response.data?.error?.message || 'Unknown error'}`
      );
    }
    throw new Error(`Failed to call GPT-5: ${error.message}`);
  }
}

/**
 * Validate OpenAI configuration
 */
export function validateGPT5Config(): boolean {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    console.error('❌ OPENAI_API_KEY not found in .env');
    return false;
  }

  if (!apiKey.startsWith('sk-')) {
    console.error('❌ OPENAI_API_KEY appears to be invalid (should start with sk-)');
    return false;
  }

  console.log('✅ OpenAI GPT-5 configuration valid');
  return true;
}

/**
 * Reset client (useful for testing or config changes)
 */
export function resetGPT5Client(): void {
  openaiClient = null;
}
