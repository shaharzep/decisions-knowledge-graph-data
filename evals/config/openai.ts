/**
 * Azure OpenAI GPT-4.1 Client Configuration
 *
 * Client for calling GPT-4.1 as LLM judge (deterministic model)
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

let azureJudgeClient: OpenAI | null = null;

/**
 * Get Azure GPT-4.1 configuration from environment variables
 */
function getAzureJudgeConfig() {
  const endpoint = process.env.AZURE_GPT4_1_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_GPT4_1_OPENAI_API_KEY;
  const deployment = process.env.AZURE_GPT4_1_OPENAI_DEPLOYMENT;
  const apiVersion = process.env.AZURE_GPT4_1_API_VERSION || '2024-12-01-preview';

  if (!endpoint || !apiKey || !deployment) {
    throw new Error(
      'Missing required Azure OpenAI GPT-4.1 configuration. ' +
      'Please ensure AZURE_GPT4_1_OPENAI_ENDPOINT, AZURE_GPT4_1_OPENAI_API_KEY, and AZURE_GPT4_1_OPENAI_DEPLOYMENT are set in .env'
    );
  }

  return {
    endpoint,
    apiKey,
    deployment,
    apiVersion,
  };
}

/**
 * Initialize Azure OpenAI client for GPT-4.1 judge
 */
export function initAzureJudgeClient(): OpenAI {
  if (azureJudgeClient) {
    return azureJudgeClient;
  }

  const config = getAzureJudgeConfig();

  azureJudgeClient = new OpenAI({
    apiKey: config.apiKey,
    baseURL: `${config.endpoint}/openai/deployments/${config.deployment}`,
    defaultQuery: { 'api-version': config.apiVersion },
    defaultHeaders: { 'api-key': config.apiKey },
  });

  console.log(`🔷 Azure OpenAI Judge client initialized: ${config.endpoint}`);
  console.log(`   Deployment: ${config.deployment}`);
  console.log(`   API Version: ${config.apiVersion}`);

  return azureJudgeClient;
}

/**
 * Get or create Azure OpenAI judge client
 */
export function getAzureJudgeClient(): OpenAI {
  if (!azureJudgeClient) {
    return initAzureJudgeClient();
  }
  return azureJudgeClient;
}

/**
 * Get the deployment name for the judge
 */
export function getJudgeDeployment(): string {
  return getAzureJudgeConfig().deployment;
}

/**
 * Call Azure OpenAI GPT-4.1 for judge evaluation
 *
 * @param prompt - The full judge prompt with inputs
 * @returns Parsed evaluation result
 */
export async function callAzureJudge(prompt: string): Promise<string> {
  const client = getAzureJudgeClient();
  const deployment = getJudgeDeployment();

  try {
    const response = await client.chat.completions.create({
      model: deployment, // Use Azure deployment name
      messages: [
        {
          role: 'system',
          content: 'You are an expert legal extraction quality evaluator. You must respond with valid JSON only. No markdown, no code blocks, no explanations.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      max_completion_tokens: 16000,
      temperature: 0, // Deterministic for consistency
      response_format: { type: 'json_object' }, // Request JSON output
    });

    const content = response.choices[0]?.message?.content;

    if (!content) {
      throw new Error('No response content from Azure GPT-4.1 judge');
    }

    return content;
  } catch (error: any) {
    // Enhanced error handling for Azure OpenAI API
    if (error.response) {
      throw new Error(
        `Azure OpenAI API error: ${error.response.status} - ${error.response.data?.error?.message || 'Unknown error'}`
      );
    }
    throw new Error(`Failed to call Azure GPT-4.1 judge: ${error.message}`);
  }
}

/**
 * Validate Azure OpenAI GPT-4.1 judge configuration
 */
export function validateAzureJudgeConfig(): boolean {
  try {
    const config = getAzureJudgeConfig();

    if (!config.endpoint.includes('azure.com') && !config.endpoint.includes('cognitiveservices.azure.com')) {
      console.error('❌ AZURE_GPT4_1_OPENAI_ENDPOINT appears to be invalid (should be an Azure endpoint)');
      return false;
    }

    console.log('✅ Azure OpenAI GPT-4.1 judge configuration valid');
    console.log(`   Endpoint: ${config.endpoint}`);
    console.log(`   Deployment: ${config.deployment}`);
    return true;
  } catch (error: any) {
    console.error(`❌ Azure OpenAI GPT-4.1 judge configuration invalid: ${error.message}`);
    return false;
  }
}

/**
 * Reset client (useful for testing or config changes)
 */
export function resetAzureJudgeClient(): void {
  // Force reload environment variables
  dotenv.config({ override: true });
  azureJudgeClient = null;
}
