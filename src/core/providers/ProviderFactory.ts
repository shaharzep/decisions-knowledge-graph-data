import { BatchProvider } from './BatchProvider.js';
import { AzureBatchProvider } from './AzureBatchProvider.js';
import { OpenAIBatchProvider } from './OpenAIBatchProvider.js';

/**
 * Provider type
 */
export type ProviderType = 'azure' | 'openai';

/**
 * Provider Factory
 *
 * Creates appropriate batch provider based on configuration
 */
export class ProviderFactory {
  /**
   * Get default provider from environment variable
   *
   * @returns Default provider type (defaults to 'azure')
   */
  static getDefaultProvider(): ProviderType {
    const envProvider = 'openai';

    if (envProvider === 'openai') {
      return 'openai';
    }

    // Default to Azure
    return 'azure';
  }

  /**
   * Create batch provider instance
   *
   * @param providerType Provider type ('azure' or 'openai')
   * @param jobId Job identifier for logging
   * @returns BatchProvider implementation
   */
  static createProvider(
    providerType: ProviderType,
    jobId: string
  ): BatchProvider {
    switch (providerType) {
      case 'azure':
        console.log(`🔷 Using Azure OpenAI Batch API for job: ${jobId}`);
        return new AzureBatchProvider(jobId);

      case 'openai':
        console.log(`🟢 Using OpenAI Batch API for job: ${jobId}`);
        return new OpenAIBatchProvider(jobId);

      default:
        throw new Error(
          `Unknown provider type: ${providerType}. Valid options: 'azure', 'openai'`
        );
    }
  }

  /**
   * Validate provider configuration
   *
   * @param providerType Provider type to validate
   * @returns true if configuration is valid
   */
  static validateProvider(providerType: ProviderType): boolean {
    try {
      if (providerType === 'azure') {
        const { AzureConfig } = require('../../config/azure.js');
        return AzureConfig.validate();
      } else if (providerType === 'openai') {
        const { OpenAIConfig } = require('../../config/openai.js');
        return OpenAIConfig.validate();
      }
      return false;
    } catch (error) {
      console.error(`Failed to validate ${providerType} provider:`, error);
      return false;
    }
  }
}
