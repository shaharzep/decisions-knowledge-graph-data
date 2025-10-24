import Ajv, { ValidateFunction, ErrorObject } from 'ajv';

/**
 * JSON Schema Validator
 *
 * Validates output from Azure OpenAI Batch API against expected schemas
 */

const ajv = new Ajv({
  allErrors: true,
  verbose: true,
  strict: false, // Allow additional properties
});

/**
 * Validation Result
 */
export interface ValidationResult {
  valid: boolean;
  errors?: ErrorObject[];
  data?: any;
}

/**
 * Validator class for JSON schema validation
 */
export class SchemaValidator {
  private validators: Map<string, ValidateFunction> = new Map();

  /**
   * Compile and cache a schema validator
   * @param schemaId Unique identifier for the schema
   * @param schema JSON schema object
   */
  compileSchema(schemaId: string, schema: object): ValidateFunction {
    if (this.validators.has(schemaId)) {
      return this.validators.get(schemaId)!;
    }

    const validator = ajv.compile(schema);
    this.validators.set(schemaId, validator);
    return validator;
  }

  /**
   * Validate data against a schema
   * @param schemaId Schema identifier (must be compiled first)
   * @param data Data to validate
   * @returns Validation result
   */
  validate(schemaId: string, data: any): ValidationResult {
    const validator = this.validators.get(schemaId);

    if (!validator) {
      throw new Error(
        `Schema '${schemaId}' not found. Call compileSchema() first.`
      );
    }

    const valid = validator(data);

    return {
      valid: valid as boolean,
      errors: validator.errors || undefined,
      data: valid ? data : undefined,
    };
  }

  /**
   * Validate data against a schema (one-time use)
   * @param schema JSON schema object
   * @param data Data to validate
   * @returns Validation result
   */
  validateOnce(schema: object, data: any): ValidationResult {
    const validator = ajv.compile(schema);
    const valid = validator(data);

    return {
      valid: valid as boolean,
      errors: validator.errors || undefined,
      data: valid ? data : undefined,
    };
  }

  /**
   * Format validation errors as a readable string
   * @param errors AJV error objects
   * @returns Formatted error message
   */
  formatErrors(errors?: ErrorObject[]): string {
    if (!errors || errors.length === 0) {
      return 'No errors';
    }

    return errors
      .map((error) => {
        const path = error.instancePath || 'root';
        const message = error.message || 'validation failed';
        const params = JSON.stringify(error.params);
        return `  • ${path}: ${message} ${params}`;
      })
      .join('\n');
  }

  /**
   * Clear all cached validators
   */
  clearCache() {
    this.validators.clear();
  }
}

/**
 * Global validator instance
 */
export const validator = new SchemaValidator();

/**
 * Validate batch response item structure
 * Ensures the response from Azure matches expected format
 */
export function validateBatchResponseItem(item: any): ValidationResult {
  const schema = {
    type: 'object',
    required: ['custom_id', 'response'],
    properties: {
      custom_id: { type: 'string' },
      response: {
        type: 'object',
        required: ['status_code', 'body'],
        properties: {
          status_code: { type: 'number' },
          request_id: { type: 'string' },
          body: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              object: { type: 'string' },
              created: { type: 'number' },
              model: { type: 'string' },
              choices: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    index: { type: 'number' },
                    message: {
                      type: 'object',
                      properties: {
                        role: { type: 'string' },
                        content: { type: 'string' },
                      },
                      required: ['role', 'content'],
                    },
                    finish_reason: { type: 'string' },
                  },
                  required: ['message'],
                },
              },
              usage: {
                type: 'object',
                properties: {
                  prompt_tokens: { type: 'number' },
                  completion_tokens: { type: 'number' },
                  total_tokens: { type: 'number' },
                },
              },
            },
          },
        },
      },
      error: {
        type: ['object', 'null'],
        properties: {
          message: { type: 'string' },
          type: { type: 'string' },
          code: { type: 'string' },
        },
      },
    },
  };

  return validator.validateOnce(schema, item);
}

/**
 * Extract and parse JSON content from model response
 * Handles cases where model returns markdown code blocks
 */
export function extractJsonFromResponse(content: string): any {
  // Safety check: refuse to parse extremely large content (likely malformed)
  const MAX_CONTENT_LENGTH = 100000; // 100KB should be more than enough for valid JSON
  if (content.length > MAX_CONTENT_LENGTH) {
    throw new Error(
      `Response content too large (${content.length} chars, max ${MAX_CONTENT_LENGTH}). Likely truncated/malformed.`
    );
  }

  // Try direct JSON parse first
  try {
    return JSON.parse(content);
  } catch {
    // Try to extract JSON from markdown code blocks
    const jsonBlockMatch = content.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonBlockMatch) {
      try {
        return JSON.parse(jsonBlockMatch[1]);
      } catch {
        // Fall through to other attempts
      }
    }

    // Try to extract any JSON object (up to first complete object)
    const jsonMatch = content.match(/\{[\s\S]*?\}/);
    if (jsonMatch && jsonMatch[0].length < MAX_CONTENT_LENGTH) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Fall through
      }
    }

    throw new Error('Could not extract valid JSON from response content');
  }
}
