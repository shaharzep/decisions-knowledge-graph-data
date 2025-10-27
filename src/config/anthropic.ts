import Anthropic from '@anthropic-ai/sdk';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Anthropic Configuration
 *
 * Manages connection to Anthropic API
 * Used for concurrent processing with Claude models
 *
 * Models:
 * - claude-sonnet-4-5-20250929 (Sonnet 4.5 - Latest)
 * - claude-3-5-sonnet-20241022 (Sonnet 3.5)
 * - claude-opus-4-20250514 (Opus 4)
 */
export class AnthropicConfig {
  private static client: Anthropic | null = null;

  /**
   * Get required environment variables
   */
  static getConfig() {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    const model = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-5-20250929';

    if (!apiKey) {
      throw new Error(
        'Missing required Anthropic configuration. ' +
          'Please ensure ANTHROPIC_API_KEY is set in .env'
      );
    }

    return {
      apiKey,
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
   * Get or create Anthropic client
   */
  static getClient(): Anthropic {
    if (!this.client) {
      const config = this.getConfig();

      this.client = new Anthropic({
        apiKey: config.apiKey,
        timeout: 600000, // 10 minutes (600,000ms)
        maxRetries: 2, // Standard retry count
      });

      console.log('🟣 Anthropic client initialized');
      console.log(`   Default Model: ${config.model}`);
      console.log(`   Timeout: 600,000ms (10 minutes)`);
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
   * Validate Anthropic configuration without creating client
   */
  static validate(): boolean {
    try {
      this.getConfig();
      console.log('✅ Anthropic configuration valid');
      return true;
    } catch (error) {
      console.error('❌ Anthropic configuration invalid:', error);
      return false;
    }
  }
}
