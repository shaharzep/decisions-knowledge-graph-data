import fs from 'fs/promises';
import path from 'path';

/**
 * Test Set Entry
 * Represents a single decision in a test set with metadata
 */
export interface TestSetEntry {
  decision_id: string;
  language: string;
  // Optional metadata fields for evaluation and filtering
  decision_type_ecli_code?: string;
  decision_type_name?: string;
  court_ecli_code?: string;
  court_name?: string;
  courtcategory?: string;
  decision_date?: string;
  md_length?: number;
  length_category?: string;
  [key: string]: any; // Allow additional metadata fields
}

/**
 * Test Set Loader
 *
 * Utilities for loading predefined sets of decisions for testing/evaluation
 */
export class TestSetLoader {
  /**
   * Load a test set from JSON or CSV file
   *
   * @param filePath Path to the test set file (relative to project root or absolute)
   * @returns Array of test set entries
   */
  static async loadTestSet(filePath: string): Promise<TestSetEntry[]> {
    try {
      // Resolve path relative to project root if not absolute
      const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(process.cwd(), filePath);

      const ext = path.extname(resolvedPath).toLowerCase();
      let testSet: TestSetEntry[];

      if (ext === '.json') {
        testSet = await this.loadFromJSON(resolvedPath);
      } else if (ext === '.csv') {
        testSet = await this.loadFromCSV(resolvedPath);
      } else {
        throw new Error(
          `Unsupported file format: ${ext}. Use .json or .csv`
        );
      }

      console.log(`✅ Loaded test set: ${testSet.length} decisions from ${filePath}`);

      return testSet;
    } catch (error) {
      console.error(`❌ Failed to load test set from ${filePath}:`, error);
      throw error;
    }
  }

  /**
   * Load test set from JSON file
   */
  private static async loadFromJSON(filePath: string): Promise<TestSetEntry[]> {
    const content = await fs.readFile(filePath, 'utf-8');
    const testSet = JSON.parse(content);

    // Validate format
    if (!Array.isArray(testSet)) {
      throw new Error('JSON test set file must contain an array');
    }

    // Validate each entry
    testSet.forEach((entry, index) => {
      if (!entry.decision_id || !entry.language) {
        throw new Error(
          `Invalid entry at index ${index}: must have 'decision_id' and 'language' fields`
        );
      }
    });

    return testSet;
  }

  /**
   * Load test set from CSV file
   *
   * Expected CSV format with header row:
   * decision_id,language_metadata,decision_type_ecli_code,decision_type_name,...
   *
   * The 'language_metadata' column is mapped to 'language' field.
   */
  private static async loadFromCSV(filePath: string): Promise<TestSetEntry[]> {
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.trim().split('\n');

    if (lines.length < 2) {
      throw new Error('CSV file must have at least a header row and one data row');
    }

    // Parse header
    const header = lines[0].split(',').map((h) => h.trim());

    // Validate required columns
    if (!header.includes('decision_id')) {
      throw new Error('CSV must have a "decision_id" column');
    }
    if (!header.includes('language_metadata') && !header.includes('language')) {
      throw new Error('CSV must have a "language_metadata" or "language" column');
    }

    // Find language column name
    const languageCol = header.includes('language_metadata')
      ? 'language_metadata'
      : 'language';

    // Parse data rows
    const testSet: TestSetEntry[] = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue; // Skip empty lines

      const values = line.split(',').map((v) => v.trim());

      if (values.length !== header.length) {
        console.warn(`Warning: Row ${i + 1} has ${values.length} values but header has ${header.length} columns. Skipping.`);
        continue;
      }

      // Build entry object
      const entry: any = {};

      header.forEach((col, idx) => {
        const value = values[idx];

        // Map language_metadata to language
        if (col === languageCol) {
          entry.language = value;
        }

        // Parse numeric fields
        if (col === 'md_length') {
          entry[col] = value ? parseInt(value, 10) : undefined;
        } else {
          // Store all other fields as-is
          entry[col] = value || undefined;
        }
      });

      // Validate required fields
      if (!entry.decision_id || !entry.language) {
        throw new Error(
          `Invalid entry at row ${i + 1}: missing decision_id or language`
        );
      }

      testSet.push(entry);
    }

    return testSet;
  }

  /**
   * Convert test set to query parameters for PostgreSQL
   *
   * Returns two arrays: decision IDs and languages, which can be used with unnest()
   *
   * @param testSet Array of test set entries
   * @returns Object with decisionIds and languages arrays
   */
  static toQueryParams(testSet: TestSetEntry[]): {
    decisionIds: string[];
    languages: string[];
  } {
    return {
      decisionIds: testSet.map((entry) => entry.decision_id),
      languages: testSet.map((entry) => entry.language),
    };
  }

  /**
   * Get test set summary statistics
   *
   * @param testSet Array of test set entries
   * @returns Summary object with counts by language
   */
  static getSummary(testSet: TestSetEntry[]): {
    total: number;
    byLanguage: Record<string, number>;
  } {
    const byLanguage: Record<string, number> = {};

    testSet.forEach((entry) => {
      byLanguage[entry.language] = (byLanguage[entry.language] || 0) + 1;
    });

    return {
      total: testSet.length,
      byLanguage,
    };
  }
}
