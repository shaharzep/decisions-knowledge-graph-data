/**
 * Load processed (decision_id, language) pairs for SQL exclusion
 *
 * Usage: import { loadProcessedIds } from './load-processed-ids.js'
 */

import fs from 'fs/promises';

export interface ProcessedIds {
  decisionIds: string[];
  languages: string[];
}

export async function loadProcessedIds(csvPath = '/tmp/processed-citations.csv'): Promise<ProcessedIds> {
  const content = await fs.readFile(csvPath, 'utf-8');
  const lines = content.trim().split('\n');

  const decisionIds: string[] = [];
  const languages: string[] = [];

  for (const line of lines) {
    const [decisionId, language] = line.split(',');
    if (decisionId && language) {
      decisionIds.push(decisionId);
      languages.push(language);
    }
  }

  return { decisionIds, languages };
}
