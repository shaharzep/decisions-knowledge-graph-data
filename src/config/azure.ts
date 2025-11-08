import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Model-specific environment variable prefixes
 */
const MODEL_ENV_PREFIX_MAP: Record<string, string> = {
  'gpt-4.1': 'AZURE_GPT4_1_',
  'gpt-4.1-mini': 'AZURE_GPT4_1_MINI_',
  'gpt-5-mini': 'AZURE_',
  'gpt-5': 'AZURE_',
};

/**
 * Azure OpenAI Configuration
 *
 * Manages connection to Azure OpenAI Batch API with support for model-specific deployments
 */
export class AzureConfig {
  private static clients: Map<string, OpenAI> = new Map();

  /**
   * Get environment variable prefix for a model
   */
  private static getEnvPrefix(model?: string): string {
    if (!model) return 'AZURE_';
    return MODEL_ENV_PREFIX_MAP[model] || 'AZURE_';
  }

  /**
   * Get required environment variables for a specific model
   */
  static getConfig(model?: string) {
    const prefix = this.getEnvPrefix(model);

    const endpoint = process.env[`${prefix}OPENAI_ENDPOINT`];
    const apiKey = process.env[`${prefix}OPENAI_API_KEY`];
    const deployment = process.env[`${prefix}OPENAI_DEPLOYMENT`];
    const envApiVersion = process.env[`${prefix}API_VERSION`];

    // Responses API requires 2025-03-01-preview or later
    const requiredApiVersion = '2025-03-01-preview';

    // Warn if environment variable specifies older version
    if (envApiVersion && envApiVersion !== requiredApiVersion) {
      console.warn(
        `⚠️  ${prefix}API_VERSION '${envApiVersion}' will be overridden with '${requiredApiVersion}' ` +
        'to satisfy Azure Responses API requirements.'
      );
    }

    if (!endpoint || !apiKey || !deployment) {
      throw new Error(
        `Missing required Azure OpenAI configuration for ${model || 'default'}. ` +
        `Please ensure ${prefix}OPENAI_ENDPOINT, ${prefix}OPENAI_API_KEY, and ${prefix}OPENAI_DEPLOYMENT are set in .env`
      );
    }

    return {
      endpoint,
      apiKey,
      deployment,
      apiVersion: requiredApiVersion,
    };
  }

  /**
   * Reset cached clients (useful when environment variables change)
   */
  static resetClient(model?: string): void {
    // Force reload environment variables
    dotenv.config({ override: true });

    if (model) {
      this.clients.delete(model);
    } else {
      this.clients.clear();
    }
  }

  /**
   * Get or create Azure OpenAI client for a specific model
   */
  static getClient(model?: string): OpenAI {
    const cacheKey = model || 'default';

    if (!this.clients.has(cacheKey)) {
      const config = this.getConfig(model);

      const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: `${config.endpoint}/openai`,
        defaultQuery: { 'api-version': config.apiVersion },
        defaultHeaders: { 'api-key': config.apiKey },
      });

      this.clients.set(cacheKey, client);

      console.log(`🔷 Azure OpenAI client initialized for ${model || 'default'}`);
      console.log(`   Endpoint: ${config.endpoint}`);
      console.log(`   Deployment: ${config.deployment}`);
      console.log(`   API Version: ${config.apiVersion}`);
    }

    return this.clients.get(cacheKey)!;
  }

  /**
   * Get the deployment name for a specific model
   */
  static getDeployment(model?: string): string {
    return this.getConfig(model).deployment;
  }

  /**
   * Validate Azure configuration for a specific model without creating client
   */
  static validate(model?: string): boolean {
    try {
      this.getConfig(model);
      console.log(`✅ Azure OpenAI configuration valid for ${model || 'default'}`);
      return true;
    } catch (error) {
      console.error(`❌ Azure OpenAI configuration invalid for ${model || 'default'}:`, error);
      return false;
    }
  }
}
