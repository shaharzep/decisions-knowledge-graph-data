import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

/**
 * OpenAI Configuration
 *
 * Manages connection to personal OpenAI account (not Azure)
 * Used specifically for GPT-5 calls for taxonomy pre-filtering
 *
 * IMPORTANT: This is separate from Azure OpenAI.
 * Azure is used for batch processing, OpenAI is used for pre-processing.
 */
export class OpenAIConfig {
  private static client: OpenAI | null = null;

  /**
   * Get required environment variables
   */
  static getConfig() {
    const apiKey = process.env.OPENAI_API_KEY;
    const organization = process.env.OPENAI_ORG_ID; // Optional

    if (!apiKey) {
      throw new Error(
        'Missing required OpenAI configuration. ' +
        'Please ensure OPENAI_API_KEY is set in .env'
      );
    }

    return {
      apiKey,
      organization,
    };
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

      console.log(`🔷 OpenAI client initialized (personal account)`);
      if (config.organization) {
        console.log(`   Organization: ${config.organization}`);
      }
    }

    return this.client;
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
