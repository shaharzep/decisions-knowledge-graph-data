import OpenAI from "openai";
import pLimit from "p-limit";
import { AzureConfig } from "../config/azure.js";
import { OpenAIConfig } from "../config/openai.js";
import { JobLogger } from "../utils/logger.js";

/**
 * Completion Settings for Responses API
 */
export interface CompletionSettings {
  model?: string;
  maxOutputTokens?: number;
  reasoningEffort?: "low" | "medium" | "high"; // remove 'minimal'
  verbosity?: "minimal" | "low" | "medium" | "high";
  temperature?: number;
  top_p?: number;
}

/**
 * OpenAI Concurrent Client Options
 */
export interface OpenAIConcurrentClientOptions {
  openaiProvider?: 'azure' | 'standard';
  model?: string;
  /**
   * Maximum concurrent API calls allowed.
   * For jobs with multiple LLM calls per row (e.g., customExecution),
   * this prevents rate limit errors by queuing excess calls.
   * Default: 100
   */
  maxConcurrentApiCalls?: number;
  /**
   * Maximum requests per second.
   * Adds delay between requests to prevent rate limit bursts.
   * Default: undefined (no rate limiting, only concurrency limiting)
   */
  requestsPerSecond?: number;
}

/**
 * OpenAI Concurrent Client
 *
 * Wrapper for OpenAI Responses API with structured outputs support.
 * Handles retry logic, rate limiting, and error handling for concurrent requests.
 */
export class OpenAIConcurrentClient {
  private client: OpenAI;
  private logger: JobLogger;
  private defaultDeployment: string;
  private apiLimiter: ReturnType<typeof pLimit>;
  private minDelayMs: number;
  private lastRequestTime: number = 0;
  private rateLimitMutex: Promise<void> = Promise.resolve();

  constructor(
    jobId: string,
    options?: OpenAIConcurrentClientOptions
  ) {
    const provider = options?.openaiProvider || 'azure';
    const model = options?.model;
    const maxConcurrentApiCalls = options?.maxConcurrentApiCalls ?? 200;
    const requestsPerSecond = options?.requestsPerSecond;

    // Initialize API call limiter to prevent rate limit floods
    this.apiLimiter = pLimit(maxConcurrentApiCalls);

    // Calculate minimum delay between requests (if rate limiting enabled)
    this.minDelayMs = requestsPerSecond ? Math.ceil(1000 / requestsPerSecond) : 0;

    if (provider === 'standard') {
      // Use standard OpenAI (api.openai.com)
      this.client = OpenAIConfig.getClient();
      this.defaultDeployment = model || OpenAIConfig.getModel();
      this.logger = new JobLogger(`OpenAI:${jobId}`);
    } else {
      // Use Azure OpenAI (default for backward compatibility)
      // Pass model to get model-specific client and deployment
      this.client = AzureConfig.getClient(model);
      this.defaultDeployment = AzureConfig.getDeployment(model);
      this.logger = new JobLogger(`AzureOpenAI:${jobId}:${model || 'default'}`);
    }

    // Log at INFO level so we can verify the actual values being used
    this.logger.info(`Client initialized`, {
      maxConcurrentApiCalls,
      requestsPerSecond: requestsPerSecond ?? 'unlimited',
      minDelayMs: this.minDelayMs
    });

    // Also log to console directly for visibility
    console.log(`\n🔧 OpenAI Client Config: maxConcurrentApiCalls=${maxConcurrentApiCalls}, requestsPerSecond=${requestsPerSecond ?? 'unlimited'}, minDelayMs=${this.minDelayMs}\n`);
  }

  /**
   * Enforce rate limiting by waiting if necessary
   * Uses a mutex to ensure sequential timing even with concurrent calls
   */
  private async enforceRateLimit(): Promise<void> {
    if (this.minDelayMs === 0) return;

    // Chain onto the mutex to ensure sequential enforcement
    this.rateLimitMutex = this.rateLimitMutex.then(async () => {
      const now = Date.now();
      const elapsed = now - this.lastRequestTime;
      const waitTime = this.minDelayMs - elapsed;

      if (waitTime > 0) {
        this.logger.debug(`Rate limiting: waiting ${waitTime}ms`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }

      this.lastRequestTime = Date.now();
    });

    await this.rateLimitMutex;
  }

  /**
   * Make a Responses API request with structured outputs
   *
   * @param messages Chat messages (system + user)
   * @param responseFormat Response format configuration (json_schema)
   * @param settings Completion settings (model, tokens, reasoning)
   * @returns Transformed response matching expected format
   */
  async complete(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    responseFormat: any,
    settings: CompletionSettings
  ): Promise<any> {
    // Log current queue state for debugging
    // Queue through API limiter to control concurrent calls
    return this.apiLimiter(async () => {
      // Log when we acquire a slot
      this.logger.debug(`API slot acquired`, {
        activeCount: this.apiLimiter.activeCount,
        pendingCount: this.apiLimiter.pendingCount
      });

      // Enforce rate limiting before making the request
      await this.enforceRateLimit();

      return this.retryWithBackoff(async () => {
        try {
          const requestBody = this.buildRequestBody(
          messages,
          responseFormat,
          settings
        );

        const response: any = await this.client.responses.create(requestBody);

        let content = "";
        if (response.output_parsed) {
          content = JSON.stringify(response.output_parsed);
        } else if (response.output_text) {
          // SDK helper concatenates all text segments
          content = response.output_text;
        } else if (Array.isArray(response.output) && response.output.length) {
          // Fallback: stitch text pieces if helper is absent
          const pieces: string[] = [];
          for (const item of response.output) {
            if (Array.isArray(item.content)) {
              for (const c of item.content) {
                if (c?.type === "output_text" && typeof c.text === "string") {
                  pieces.push(c.text);
                }
              }
            }
          }
          content = pieces.join("");
        }

        return {
          choices: [
            {
              message: {
                content: content,
              },
              finish_reason: "stop", // Responses API doesn't expose finish_reason the same way
            },
          ],
          usage: response.usage
            ? {
                prompt_tokens: response.usage.input_tokens || 0,
                completion_tokens: response.usage.output_tokens || 0,
                total_tokens:
                  (response.usage.input_tokens || 0) +
                  (response.usage.output_tokens || 0),
              }
            : undefined,
        };
      } catch (error: any) {
        // Check if it's a rate limit error (429)
        if (error?.status === 429 || error?.code === "rate_limit_exceeded") {
          // Log detailed info about the rate limit for debugging
          this.logger.warn("Rate limit hit, will retry", {
            error: error.message,
            retryAfter: error?.headers?.['retry-after'],
            remainingRequests: error?.headers?.['x-ratelimit-remaining-requests'],
            remainingTokens: error?.headers?.['x-ratelimit-remaining-tokens'],
          });
          throw error; // Let retry logic handle it
        }

        // For other errors, log and rethrow
        this.logger.error("API call failed", error);
        throw error;
      }
      });
    });
  }

  /**
   * Retry with Retry-After header support
   *
   * Uses the Retry-After header from 429 responses when available,
   * falls back to exponential backoff otherwise.
   * Token limits refill over 60 seconds, so we need more retries.
   *
   * @param fn Function to retry
   * @param maxRetries Maximum number of retries (default 5 for rate limits)
   * @returns Result of function
   */
  private async retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 5
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error: any) {
        lastError = error;

        // Only retry on rate limit errors (429)
        const isRateLimitError =
          error?.status === 429 || error?.code === "rate_limit_exceeded";

        if (!isRateLimitError || attempt === maxRetries) {
          throw error;
        }

        // Try to extract Retry-After header (Azure OpenAI returns this)
        let waitSeconds: number;
        const retryAfter = error?.headers?.['retry-after'] ||
                          error?.response?.headers?.['retry-after'] ||
                          error?.error?.['retry-after'];

        if (retryAfter) {
          // Retry-After can be seconds (number) or HTTP date
          waitSeconds = parseInt(retryAfter, 10);
          if (isNaN(waitSeconds)) {
            // Might be an HTTP date, fall back to exponential backoff
            waitSeconds = Math.pow(2, attempt + 1) + Math.random() * 2;
          }
          this.logger.info(`Rate limit hit, using Retry-After header`, {
            retryAfter,
            waitSeconds,
            attempt: attempt + 1,
            maxRetries,
          });
        } else {
          // Fallback: exponential backoff starting at 2s, 4s, 8s, 16s, 32s
          waitSeconds = Math.pow(2, attempt + 1) + Math.random() * 2;
          this.logger.info(`Rate limit hit, using exponential backoff`, {
            waitSeconds: waitSeconds.toFixed(1),
            attempt: attempt + 1,
            maxRetries,
          });
        }

        // Cap wait time at 60 seconds (token window)
        waitSeconds = Math.min(waitSeconds, 60);

        console.log(`⏳ Rate limited - waiting ${waitSeconds.toFixed(1)}s before retry ${attempt + 1}/${maxRetries}`);
        await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      }
    }

    throw lastError || new Error("Retry failed");
  }

  /**
   * Build OpenAI Responses API request body
   *
   * @param messages Chat messages (will be transformed to input array)
   * @param responseFormat Response format (json_schema)
   * @param settings Completion settings
   * @returns Request body for OpenAI Responses API
   */
  private buildRequestBody(
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>,
    responseFormat: any,
    settings: CompletionSettings
  ): any {
    // Use type 'text' and field 'text'
    const input = messages.map((msg) => ({
      role: msg.role,
      content: [
        {
          type: "input_text",
          text: msg.content,
        },
      ],
    }));

    const isSchema = responseFormat?.type === "json_schema";
    const schemaName =
      responseFormat?.name ||
      responseFormat?.json_schema?.name ||
      "ComprehensiveExtraction";

    const textFormat = isSchema
      ? {
          type: "json_schema",
          name: schemaName, // required
          schema: responseFormat?.json_schema?.schema, // <-- move here
          strict: responseFormat?.json_schema?.strict ?? true, // <-- move here
        }
      : { type: "json_object" };

    const body: any = {
      model: this.defaultDeployment,
      input,
      text: {
        format: textFormat,
        ...(settings.verbosity ? { verbosity: settings.verbosity } : {}),
      },
    };

    if (settings.maxOutputTokens)
      body.max_output_tokens = settings.maxOutputTokens;
    if (settings.reasoningEffort)
      body.reasoning = { effort: settings.reasoningEffort };

    if (settings.verbosity) {
      body.text.verbosity = settings.verbosity;
    }

    // Add temperature and top_p if specified (optional, backward compatible)
    if (settings.temperature !== undefined)
      body.temperature = settings.temperature;
    if (settings.top_p !== undefined)
      body.top_p = settings.top_p;

    return body;
  }
}
