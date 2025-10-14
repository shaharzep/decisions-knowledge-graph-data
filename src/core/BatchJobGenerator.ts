import fs from 'fs/promises';
import path from 'path';
import { DatabaseConfig } from '../config/database.js';
import { JobConfig, BatchRequestItem } from '../jobs/JobConfig.js';
import { JobLogger } from '../utils/logger.js';

/**
 * Batch Job Generator
 *
 * Generates JSONL files for Azure OpenAI Batch API from database queries
 */
export class BatchJobGenerator {
  private config: JobConfig;
  private logger: JobLogger;

  constructor(config: JobConfig) {
    this.config = config;
    this.logger = new JobLogger(`Generator:${config.id}`);
  }

  /**
   * Generate batch job JSONL file
   *
   * Process:
   * 1. Execute database query to fetch input data
   * 2. Preprocess rows (optional, via preprocessRow hook)
   * 3. Generate prompt for each row using promptTemplate
   * 4. Create batch request items in Azure format
   * 5. Write to JSONL file
   * 6. Save metadata mapping (optional, if rowMetadataFields configured)
   *
   * @returns Path to generated JSONL file, record count, and optional metadata file path
   */
  async generate(): Promise<{
    filePath: string;
    recordCount: number;
    metadataFilePath?: string;
  }> {
    this.logger.info('Starting batch job generation', {
      query: this.config.dbQuery,
      deployment: this.config.deploymentName,
    });

    try {
      // Step 1: Fetch data from database
      this.logger.debug('Executing database query');
      const rows = await DatabaseConfig.executeReadOnlyQuery(
        this.config.dbQuery,
        this.config.dbQueryParams || []
      );

      if (rows.length === 0) {
        throw new Error('Database query returned no rows');
      }

      this.logger.info(`Fetched ${rows.length} records from database`);

      // Step 2: Preprocess rows if hook is defined
      let processedRows = rows;
      if (this.config.preprocessRow) {
        this.logger.info('Preprocessing rows with custom hook');
        processedRows = await Promise.all(
          rows.map((row, index) => {
            this.logger.debug(`Preprocessing row ${index + 1}/${rows.length}`);
            return this.config.preprocessRow!(row);
          })
        );
        this.logger.info('Preprocessing completed');
      }

      // Step 3: Generate batch request items
      this.logger.debug('Generating batch request items');
      const batchItems = this.generateBatchItems(processedRows);

      // Step 4: Write to JSONL file
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `${this.config.id}-${timestamp}.jsonl`;
      const filePath = path.join(process.cwd(), 'input', filename);

      this.logger.debug('Writing JSONL file', { path: filePath });
      await this.writeJsonl(filePath, batchItems);

      this.logger.info('Batch job file generated successfully', {
        path: filePath,
        records: batchItems.length,
        sizeKB: Math.round((await fs.stat(filePath)).size / 1024),
      });

      // Step 5: Save metadata mapping if rowMetadataFields is configured
      let metadataFilePath: string | undefined;
      if (this.config.rowMetadataFields && this.config.rowMetadataFields.length > 0) {
        const metadataFilename = `${this.config.id}-${timestamp}-metadata.json`;
        metadataFilePath = path.join(process.cwd(), 'input', metadataFilename);

        await this.saveMetadataMapping(
          metadataFilePath,
          processedRows,
          batchItems
        );

        this.logger.info('Metadata mapping file generated', {
          path: metadataFilePath,
          fields: this.config.rowMetadataFields,
        });
      }

      return {
        filePath,
        recordCount: batchItems.length,
        metadataFilePath,
      };
    } catch (error) {
      this.logger.error('Failed to generate batch job', error);
      throw error;
    }
  }

  /**
   * Generate batch request items from database rows
   */
  private generateBatchItems(rows: any[]): BatchRequestItem[] {
    return rows.map((row, index) => {
      const customIdPrefix =
        this.config.customIdPrefix || this.config.id;
      const customId = `${customIdPrefix}-${String(index + 1).padStart(4, '0')}`;

      // Generate prompt using the template function
      const prompt = this.config.promptTemplate(row);

      // Create batch request item
      const item: BatchRequestItem = {
        custom_id: customId,
        method: 'POST',
        url: '/chat/completions',
        body: {
          model: this.config.deploymentName,
          messages: [
            {
              role: 'user',
              content: prompt,
            },
          ],
          response_format: { type: 'json_object' },
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature ?? 0.0,
        },
      };

      return item;
    });
  }

  /**
   * Write array of objects to JSONL file
   * Each object is written as a single line of JSON
   */
  private async writeJsonl(
    filePath: string,
    items: BatchRequestItem[]
  ): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Convert to JSONL format (one JSON object per line)
    const jsonlContent = items.map((item) => JSON.stringify(item)).join('\n');

    // Write file
    await fs.writeFile(filePath, jsonlContent, 'utf-8');
  }

  /**
   * Save metadata mapping file
   *
   * Creates a JSON file mapping custom_id to row metadata fields.
   * Used by ResultProcessor to merge metadata into final output.
   *
   * @param filePath Path to save metadata mapping
   * @param rows Database rows (after preprocessing)
   * @param batchItems Batch request items with custom_ids
   */
  private async saveMetadataMapping(
    filePath: string,
    rows: any[],
    batchItems: BatchRequestItem[]
  ): Promise<void> {
    if (!this.config.rowMetadataFields || this.config.rowMetadataFields.length === 0) {
      return;
    }

    // Create mapping: custom_id -> metadata object
    const mapping: Record<string, any> = {};

    for (let i = 0; i < batchItems.length; i++) {
      const customId = batchItems[i].custom_id;
      const row = rows[i];

      // Extract specified fields from row
      const metadata: Record<string, any> = {};
      const fields: string[] = this.config.rowMetadataFields;
      for (const fieldName of fields) {
        // Special handling for language_metadata -> language
        const outputFieldName: string =
          fieldName === 'language_metadata' ? 'language' : fieldName;
        metadata[outputFieldName] = row[fieldName];
      }

      mapping[customId] = metadata;
    }

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write mapping file (pretty-printed for readability)
    await fs.writeFile(filePath, JSON.stringify(mapping, null, 2), 'utf-8');

    this.logger.debug('Metadata mapping saved', {
      path: filePath,
      recordCount: Object.keys(mapping).length,
    });
  }

  /**
   * Validate generated file
   * Checks that file exists and is valid JSONL
   */
  async validateFile(filePath: string): Promise<boolean> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      // Verify each line is valid JSON
      for (let i = 0; i < lines.length; i++) {
        try {
          JSON.parse(lines[i]);
        } catch (error) {
          this.logger.error(`Invalid JSON at line ${i + 1}`, error);
          return false;
        }
      }

      this.logger.info('File validation successful', {
        path: filePath,
        lines: lines.length,
      });

      return true;
    } catch (error) {
      this.logger.error('File validation failed', error);
      return false;
    }
  }

  /**
   * Get estimated cost for the batch
   * Based on token counts (approximate)
   */
  async estimateCost(
    filePath: string
  ): Promise<{
    estimatedPromptTokens: number;
    estimatedCostUSD: number;
  }> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.trim().split('\n');

      let totalPromptChars = 0;

      for (const line of lines) {
        const item = JSON.parse(line) as BatchRequestItem;
        const promptContent = item.body.messages
          .map((m) => m.content)
          .join(' ');
        totalPromptChars += promptContent.length;
      }

      // Rough estimate: 1 token ≈ 4 characters
      const estimatedPromptTokens = Math.ceil(totalPromptChars / 4);

      // Azure Batch API is 50% off standard pricing
      // GPT-4o: ~$2.50 per 1M input tokens (standard), so $1.25 for batch
      const costPerMillionTokens = 1.25;
      const estimatedCostUSD =
        (estimatedPromptTokens / 1_000_000) * costPerMillionTokens;

      this.logger.info('Cost estimation', {
        records: lines.length,
        estimatedPromptTokens,
        estimatedCostUSD: `$${estimatedCostUSD.toFixed(2)}`,
      });

      return {
        estimatedPromptTokens,
        estimatedCostUSD,
      };
    } catch (error) {
      this.logger.error('Cost estimation failed', error);
      throw error;
    }
  }
}
