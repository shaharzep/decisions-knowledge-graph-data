import Anthropic from '@anthropic-ai/sdk';
import { AnthropicConfig } from '../config/anthropic.js';
import { JobLogger } from '../utils/logger.js';

/**
 * Completion Settings for Claude
 */
export interface CompletionSettings {
  model?: string;
  maxOutputTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high'; // Ignored by Claude (for compatibility)
  verbosity?: 'minimal' | 'low' | 'medium' | 'high'; // Ignored by Claude (for compatibility)
  temperature?: number;
}

/**
 * Claude Concurrent Client
 *
 * Wrapper for Anthropic Messages API with structured outputs support.
 * Handles retry logic, rate limiting, and error handling for concurrent requests.
 */
export class ClaudeConcurrentClient {
  private client: Anthropic;
  private logger: JobLogger;
  private defaultModel: string;

  constructor(jobId: string) {
    this.client = AnthropicConfig.getClient();
    this.defaultModel = AnthropicConfig.getModel();
    this.logger = new JobLogger(`Claude:${jobId}`);
  }

  /**
   * Make a Messages API request with structured outputs
   *
   * @param messages Chat messages (system + user)
   * @param responseFormat Response format configuration (json_schema)
   * @param settings Completion settings (model, tokens, temperature)
   * @returns Normalized response matching OpenAI format
   */
  async complete(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    responseFormat: any,
    settings: CompletionSettings
  ): Promise<any> {
    return this.retryWithBackoff(async () => {
      try {
        const requestBody = this.buildRequestBody(
          messages,
          responseFormat,
          settings
        );

        const response = await this.client.messages.create({
          ...requestBody,
          stream: false, // Ensure we get a Message, not a Stream
        }) as Anthropic.Message;

        // Normalize response to match expected format
        return this.normalizeResponse(response);
      } catch (error: any) {
        // Check if it's a rate limit error (429)
        if (error?.status === 429 || error?.error?.type === 'rate_limit_error') {
          this.logger.warn('Rate limit hit, will retry', {
            error: error.message,
          });
          throw error; // Let retry logic handle it
        }

        // For other errors, log and rethrow
        this.logger.error('API call failed', error);
        throw error;
      }
    });
  }

  /**
   * Retry with exponential backoff
   *
   * @param fn Function to retry
   * @param maxRetries Maximum number of retries
   * @returns Result of function
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        // Only retry on rate limit errors (429)
        const isRateLimitError =
          error?.status === 429 || error?.error?.type === 'rate_limit_error';

        if (!isRateLimitError || attempt === maxRetries) {
          throw error;
        }

        // Exponential backoff: 2^attempt seconds
        const waitSeconds = Math.pow(2, attempt);
        this.logger.info(`Retry attempt ${attempt + 1}/${maxRetries}`, {
          waitSeconds,
        });

        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      }
    }

    throw lastError || new Error('Retry failed');
  }

  /**
   * Build Anthropic Messages API request body
   *
   * @param messages Chat messages (system extracted separately)
   * @param responseFormat Response format (json_schema)
   * @param settings Completion settings
   * @returns Request body for Anthropic Messages API
   */
  private buildRequestBody(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    responseFormat: any,
    settings: CompletionSettings
  ): Anthropic.MessageCreateParams {
    // Extract system message (Claude requires it separate)
    const systemMessage = messages.find((m) => m.role === 'system');
    const conversationMessages = messages.filter((m) => m.role !== 'system');

    // Build system prompt with JSON schema instructions
    let systemPrompt = systemMessage?.content || '';

    // Add JSON schema instructions if structured output requested
    if (responseFormat?.type === 'json_schema' && responseFormat?.json_schema?.schema) {
      const schema = responseFormat.json_schema.schema;
      systemPrompt += `\n\nYou must respond with valid JSON that matches this exact schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\`\n\nIMPORTANT: Return ONLY the JSON object, no markdown formatting, no code blocks, no explanations.`;
    } else if (responseFormat?.type === 'json_object') {
      systemPrompt += '\n\nYou must respond with valid JSON only. No markdown, no code blocks, no explanations.';
    }

    // Calculate safe max_tokens to avoid 10-minute timeout error
    // SDK throws error if: (60 * 60 * 1000 * maxTokens) / 128000 > 600000ms (10 minutes)
    // Solving: maxTokens < (600000 * 128000) / 3600000 = 21,333 tokens
    // We'll use 20,000 as a safe max to stay under the limit
    const requestedMaxTokens = settings.maxOutputTokens || 8192;
    const safeMaxTokens = Math.min(requestedMaxTokens, 20000);

    if (requestedMaxTokens > 20000) {
      this.logger.warn(`Max tokens reduced from ${requestedMaxTokens} to ${safeMaxTokens} to avoid timeout`);
    }

    const body: Anthropic.MessageCreateParams = {
      model: settings.model || this.defaultModel,
      max_tokens: safeMaxTokens,
      system: systemPrompt,
      messages: conversationMessages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
    };

    // Add temperature if specified (Claude supports 0-1)
    if (settings.temperature !== undefined) {
      body.temperature = settings.temperature;
    }

    return body;
  }

  /**
   * Normalize Anthropic response to match OpenAI format
   *
   * Converts Anthropic Message response to the format expected by ConcurrentRunner
   *
   * @param response Anthropic Message response
   * @returns Normalized response with choices and usage
   */
  private normalizeResponse(response: Anthropic.Message): any {
    // Extract text content from response
    let content = '';
    for (const block of response.content) {
      if (block.type === 'text') {
        content += block.text;
      }
    }

    return {
      choices: [
        {
          message: {
            content: content,
          },
          finish_reason: this.mapStopReason(response.stop_reason),
        },
      ],
      usage: {
        prompt_tokens: response.usage.input_tokens,
        completion_tokens: response.usage.output_tokens,
        total_tokens: response.usage.input_tokens + response.usage.output_tokens,
      },
    };
  }

  /**
   * Map Anthropic stop_reason to OpenAI finish_reason
   */
  private mapStopReason(stopReason: string | null): string {
    switch (stopReason) {
      case 'end_turn':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'stop_sequence':
        return 'stop';
      default:
        return 'stop';
    }
  }
}
