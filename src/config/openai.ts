import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * OpenAI Configuration
 *
 * Manages connection to standard OpenAI API
 * Used for:
 * - Batch processing via OpenAI Batch API
 * - Pre-processing calls (e.g., taxonomy filtering)
 *
 * IMPORTANT: This is separate from Azure OpenAI.
 */
export class OpenAIConfig {
  private static client: OpenAI | null = null;

  /**
   * Get required environment variables
   */
  static getConfig() {
    const apiKey = process.env.OPENAI_API_KEY;
    const organization = process.env.OPENAI_ORG_ID; // Optional
    const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

    if (!apiKey) {
      throw new Error(
        'Missing required OpenAI configuration. ' +
          'Please ensure OPENAI_API_KEY is set in .env'
      );
    }

    return {
      apiKey,
      organization,
      model,
    };
  }

  /**
   * Reset cached client (useful when environment variables change)
   */
  static resetClient(): void {
    dotenv.config({ override: true });
    this.client = null;
  }

  /**
   * Get or create OpenAI client
   */
  static getClient(): OpenAI {
    if (!this.client) {
      const config = this.getConfig();

      this.client = new OpenAI({
        apiKey: config.apiKey,
        organization: config.organization,
      });

      console.log('🟢 OpenAI client initialized');
      console.log(`   Default Model: ${config.model}`);
      if (config.organization) {
        console.log(`   Organization: ${config.organization}`);
      }
    }

    return this.client;
  }

  /**
   * Get the default model name
   */
  static getModel(): string {
    return this.getConfig().model;
  }

  /**
   * Validate OpenAI configuration without creating client
   */
  static validate(): boolean {
    try {
      this.getConfig();
      console.log('✅ OpenAI configuration valid');
      return true;
    } catch (error) {
      console.error('❌ OpenAI configuration invalid:', error);
      return false;
    }
  }
}
