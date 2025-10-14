import fs from 'fs/promises';
import path from 'path';
import { createLogger } from '../../utils/logger.js';
import { PARENT_CATEGORIES } from './parentCategories.js';

const logger = createLogger('TaxonomyManager');

/**
 * Taxonomy Entry
 * Represents a single row from keywords_utu.csv
 */
export interface TaxonomyEntry {
  id: string;
  keywordsSequenceFr: string;
  keywordsSequenceNl: string;
  kuuSequence: string;
  sequenceLevel: string;
  idL1: string;
  keywordsFrL1: string;
  keywordsNlL1: string;
  idL2?: string;
  keywordsFrL2?: string;
  keywordsNlL2?: string;
  idL3?: string;
  keywordsFrL3?: string;
  keywordsNlL3?: string;
  idL4?: string;
  keywordsFrL4?: string;
  keywordsNlL4?: string;
  idL5?: string;
  keywordsFrL5?: string;
  keywordsNlL5?: string;
}

/**
 * Parent Category (L1)
 * Represents one of the 8 top-level legal categories
 */
export interface ParentCategory {
  id: string;
  nameFr: string;
  nameNl: string;
  descriptionFr: string;
  descriptionNl: string;
}

/**
 * Taxonomy Manager
 *
 * Loads and filters the Belgian legal taxonomy (keywords_utu.csv)
 * Provides methods to:
 * - Load full taxonomy into memory
 * - Get list of parent categories (L1)
 * - Filter taxonomy by selected parent categories
 * - Format for prompt injection
 */
export class TaxonomyManager {
  private static fullTaxonomy: TaxonomyEntry[] = [];
  private static parentCategories: ParentCategory[] = [];
  private static isLoaded = false;

  /**
   * Load taxonomy from CSV file
   * Should be called once at application startup
   */
  static async loadTaxonomy(): Promise<void> {
    if (this.isLoaded) {
      logger.info('Taxonomy already loaded');
      return;
    }

    logger.info('Loading taxonomy from keywords_utu.csv');

    try {
      const csvPath = path.join(process.cwd(), 'keywords_utu.csv');
      const content = await fs.readFile(csvPath, 'utf-8');
      const lines = content.trim().split('\n');

      // Skip header
      const dataLines = lines.slice(1);

      logger.info(`Parsing ${dataLines.length} taxonomy entries`);

      for (const line of dataLines) {
        const entry = this.parseCsvLine(line);
        if (entry) {
          this.fullTaxonomy.push(entry);

          // Collect L1 parent categories from hardcoded definitions
          if (entry.sequenceLevel === 'L1') {
            const existingParent = this.parentCategories.find(
              (p) => p.id === entry.idL1
            );

            if (!existingParent) {
              // Use hardcoded definitions from parentCategories.ts
              const definition = PARENT_CATEGORIES.find((p) => p.id === entry.idL1);

              if (definition) {
                this.parentCategories.push(definition);
              } else {
                // Fallback if definition not found
                logger.warn(`No definition found for parent category ${entry.idL1}`);
                this.parentCategories.push({
                  id: entry.idL1,
                  nameFr: entry.keywordsFrL1,
                  nameNl: entry.keywordsNlL1,
                  descriptionFr: entry.keywordsFrL1,
                  descriptionNl: entry.keywordsNlL1,
                });
              }
            }
          }
        }
      }

      this.isLoaded = true;

      logger.info('Taxonomy loaded successfully', {
        totalEntries: this.fullTaxonomy.length,
        parentCategories: this.parentCategories.length,
      });
    } catch (error) {
      logger.error('Failed to load taxonomy', error);
      throw error;
    }
  }

  /**
   * Parse a single CSV line into TaxonomyEntry
   */
  private static parseCsvLine(line: string): TaxonomyEntry | null {
    // Handle quoted values that might contain commas
    const fields: string[] = [];
    let currentField = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];

      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        fields.push(currentField.trim());
        currentField = '';
      } else {
        currentField += char;
      }
    }
    fields.push(currentField.trim()); // Last field

    if (fields.length < 8) {
      return null;
    }

    return {
      id: fields[0],
      keywordsSequenceFr: fields[1],
      keywordsSequenceNl: fields[2],
      kuuSequence: fields[3],
      sequenceLevel: fields[4],
      idL1: fields[5],
      keywordsFrL1: fields[6],
      keywordsNlL1: fields[7],
      idL2: fields[8] || undefined,
      keywordsFrL2: fields[9] || undefined,
      keywordsNlL2: fields[10] || undefined,
      idL3: fields[11] || undefined,
      keywordsFrL3: fields[12] || undefined,
      keywordsNlL3: fields[13] || undefined,
      idL4: fields[14] || undefined,
      keywordsFrL4: fields[15] || undefined,
      keywordsNlL4: fields[16] || undefined,
      idL5: fields[17] || undefined,
      keywordsFrL5: fields[18] || undefined,
      keywordsNlL5: fields[19] || undefined,
    };
  }

  /**
   * Get list of all parent categories (L1)
   * Returns array of 8 top-level legal categories
   */
  static getParentCategories(): ParentCategory[] {
    if (!this.isLoaded) {
      throw new Error('Taxonomy not loaded. Call loadTaxonomy() first.');
    }

    return this.parentCategories;
  }

  /**
   * Filter taxonomy by selected parent category IDs
   * Returns only entries that belong to the specified parents
   *
   * @param parentIds Array of parent category IDs (e.g., ["KUU2", "KUU4"])
   * @returns Filtered taxonomy entries
   */
  static filterByParents(parentIds: string[]): TaxonomyEntry[] {
    if (!this.isLoaded) {
      throw new Error('Taxonomy not loaded. Call loadTaxonomy() first.');
    }

    const filtered = this.fullTaxonomy.filter((entry) =>
      parentIds.includes(entry.idL1)
    );

    logger.info('Taxonomy filtered', {
      parentIds,
      originalSize: this.fullTaxonomy.length,
      filteredSize: filtered.length,
      reductionPercent: (
        (1 - filtered.length / this.fullTaxonomy.length) *
        100
      ).toFixed(1),
    });

    return filtered;
  }

  /**
   * Format filtered taxonomy for prompt injection
   * Creates a readable string representation with prominent IDs
   *
   * @param entries Filtered taxonomy entries
   * @param language 'fr' or 'nl'
   * @returns Formatted string for prompt
   */
  static formatForPrompt(
    entries: TaxonomyEntry[],
    language: 'fr' | 'nl' = 'fr'
  ): string {
    const lines: string[] = [];

    // Add header
    lines.push('# Legal Issues Taxonomy\n');
    lines.push(`Total entries: ${entries.length}\n`);
    lines.push('IMPORTANT: When selecting legal issues, you MUST return the exact ID shown in [brackets] for each entry.\n');

    // Group by parent category
    const byParent = new Map<string, TaxonomyEntry[]>();

    for (const entry of entries) {
      if (!byParent.has(entry.idL1)) {
        byParent.set(entry.idL1, []);
      }
      byParent.get(entry.idL1)!.push(entry);
    }

    // Format each parent category
    for (const [parentId, parentEntries] of byParent) {
      const parent = this.parentCategories.find((p) => p.id === parentId);
      if (!parent) continue;

      const parentName = language === 'fr' ? parent.nameFr : parent.nameNl;
      lines.push(`\n## ${parentName} (${parentId})`);
      lines.push(`Entries: ${parentEntries.length}\n`);

      // Format entries with prominent IDs in brackets at the start of each line
      for (const entry of parentEntries) {
        // Use language-specific keyword sequence
        const sequence =
          language === 'fr'
            ? entry.keywordsSequenceFr
            : entry.keywordsSequenceNl;

        // Format: [ID] Sequence
        // Example: [KUD2-15-8] DROIT CIVIL > Contrats > Résiliation
        lines.push(`[${entry.id}] ${sequence}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Get summary statistics
   */
  static getStats() {
    return {
      isLoaded: this.isLoaded,
      totalEntries: this.fullTaxonomy.length,
      parentCategories: this.parentCategories.length,
    };
  }
}
