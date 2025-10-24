import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Azure OpenAI Configuration
 *
 * Manages connection to Azure OpenAI Batch API
 */
export class AzureConfig {
  private static client: OpenAI | null = null;

  /**
   * Get required environment variables
   */
  static getConfig() {
    const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
    const apiKey = process.env.AZURE_OPENAI_API_KEY;
    const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;
    const requiredApiVersion = '2025-03-01-preview';
    let apiVersion = requiredApiVersion;

    if (process.env.AZURE_API_VERSION && process.env.AZURE_API_VERSION !== requiredApiVersion) {
      console.warn(
        `⚠️  AZURE_API_VERSION '${process.env.AZURE_API_VERSION}' overridden with '${requiredApiVersion}' ` +
        'to satisfy Azure Responses API requirements.'
      );
    }

    if (!endpoint || !apiKey || !deployment) {
      throw new Error(
        'Missing required Azure OpenAI configuration. ' +
        'Please ensure AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, and AZURE_OPENAI_DEPLOYMENT are set in .env'
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
   * Reset cached client (useful when environment variables change)
   */
  static resetClient(): void {
    // Force reload environment variables
    dotenv.config({ override: true });
    this.client = null;
  }

  /**
   * Get or create Azure OpenAI client
   */
  static getClient(): OpenAI {
    if (!this.client) {
      const config = this.getConfig();

      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: `${config.endpoint}/openai`,
        defaultQuery: { 'api-version': config.apiVersion },
        defaultHeaders: { 'api-key': config.apiKey },
      });

      console.log(`🔷 Azure OpenAI client initialized: ${config.endpoint}`);
      console.log(`   Deployment: ${config.deployment}`);
      console.log(`   API Version: ${config.apiVersion}`);
    }

    return this.client;
  }

  /**
   * Get the deployment name for chat completions
   */
  static getDeployment(): string {
    return this.getConfig().deployment;
  }

  /**
   * Validate Azure configuration without creating client
   */
  static validate(): boolean {
    try {
      this.getConfig();
      console.log('✅ Azure OpenAI configuration valid');
      return true;
    } catch (error) {
      console.error('❌ Azure OpenAI configuration invalid:', error);
      return false;
    }
  }
}
