import OpenAI from "openai";
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

  constructor(
    jobId: string,
    options?: {
      openaiProvider?: 'azure' | 'standard';
      model?: string;
    }
  ) {
    const provider = options?.openaiProvider || 'azure';
    const model = options?.model;

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
          this.logger.warn("Rate limit hit, will retry", {
            error: error.message,
          });
          throw error; // Let retry logic handle it
        }

        // For other errors, log and rethrow
        this.logger.error("API call failed", error);
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
          error?.status === 429 || error?.code === "rate_limit_exceeded";

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

    return body;
  }
}
