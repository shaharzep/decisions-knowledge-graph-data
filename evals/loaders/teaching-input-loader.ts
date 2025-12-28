/**
 * Teaching Input Loader
 *
 * Loads teaching inputs from extract-legal-teachings full-data results.
 * Used by classify-legal-issues evaluation to get the original teaching
 * that was classified.
 */

import fs from 'fs';
import path from 'path';

/**
 * Teaching input structure (subset of fields needed for evaluation)
 */
export interface TeachingInput {
  teachingId: string;
  text: string;
  courtVerbatim?: string;
  factualTrigger?: string;
  principleType?: string;
  relatedCitedProvisions?: Array<{
    parentActName: string;
    provisionNumber: string;
  }>;
  decisionId: string;
  language: string;
}

/**
 * Get the latest extract-legal-teachings full-data timestamp
 *
 * @returns Latest timestamp string, or null if none found
 */
export function getLatestTeachingsTimestamp(): string | null {
  const resultsDir = path.join(process.cwd(), 'full-data', 'extract-legal-teachings');

  if (!fs.existsSync(resultsDir)) {
    return null;
  }

  const timestamps = fs
    .readdirSync(resultsDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.test(name))
    .sort()
    .reverse();

  return timestamps[0] || null;
}

/**
 * Load teaching inputs for a list of teaching IDs
 *
 * Scans the extract-legal-teachings full-data jsons directory and
 * returns a Map of teaching_id -> TeachingInput for the requested IDs.
 *
 * @param teachingIds - Array of teaching IDs to load
 * @param timestamp - Optional specific timestamp, or use latest
 * @returns Map of teaching_id to TeachingInput
 */
export async function loadTeachingInputs(
  teachingIds: string[],
  timestamp?: string
): Promise<Map<string, TeachingInput>> {
  const ts = timestamp || getLatestTeachingsTimestamp();

  if (!ts) {
    throw new Error(
      'No extract-legal-teachings full-data results found.\n\n' +
      'Please run extract-legal-teachings first:\n' +
      '  npm run dev concurrent extract-legal-teachings'
    );
  }

  const jsonsDir = path.join(
    process.cwd(),
    'full-data',
    'extract-legal-teachings',
    ts,
    'jsons'
  );

  if (!fs.existsSync(jsonsDir)) {
    throw new Error(
      `Full-data jsons directory not found: ${jsonsDir}\n\n` +
      'Please run extract-legal-teachings first.'
    );
  }

  console.log(`📚 Loading teaching inputs from: ${ts}`);

  // Create a Set for fast lookup of requested teaching IDs
  const requestedIds = new Set(teachingIds);
  const teachingMap = new Map<string, TeachingInput>();

  // Scan all JSON files in the directory
  const jsonFiles = fs.readdirSync(jsonsDir).filter((f) => f.endsWith('.json'));

  for (const filename of jsonFiles) {
    const filepath = path.join(jsonsDir, filename);

    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      const decisionId = data.decision_id;
      const language = data.language || data.language_metadata;
      const teachings = data.legalTeachings || [];

      for (const teaching of teachings) {
        const teachingId = teaching.teachingId;

        // Only include if this teaching was requested
        if (requestedIds.has(teachingId)) {
          teachingMap.set(teachingId, {
            teachingId: teaching.teachingId,
            text: teaching.text,
            courtVerbatim: teaching.courtVerbatim,
            factualTrigger: teaching.factualTrigger,
            principleType: teaching.principleType,
            relatedCitedProvisions: teaching.relatedCitedProvisionsId?.map((id: string) => ({
              parentActName: id,
              provisionNumber: '',
            })),
            decisionId,
            language,
          });
        }
      }

      // Early exit if we've found all requested teachings
      if (teachingMap.size === requestedIds.size) {
        break;
      }
    } catch (error) {
      console.warn(`Failed to read ${filename}: ${error}`);
    }
  }

  console.log(`✅ Loaded ${teachingMap.size}/${teachingIds.length} teaching inputs`);

  // Log any missing teachings
  const missing = teachingIds.filter((id) => !teachingMap.has(id));
  if (missing.length > 0) {
    console.warn(`⚠️  Missing ${missing.length} teaching inputs:`);
    missing.slice(0, 5).forEach((id) => console.warn(`   - ${id}`));
    if (missing.length > 5) {
      console.warn(`   ... and ${missing.length - 5} more`);
    }
  }

  return teachingMap;
}

/**
 * Get all available teaching IDs from full-data
 *
 * Useful for validation and debugging.
 *
 * @param timestamp - Optional specific timestamp, or use latest
 * @returns Array of all teaching IDs
 */
export function getAllTeachingIds(timestamp?: string): string[] {
  const ts = timestamp || getLatestTeachingsTimestamp();

  if (!ts) {
    return [];
  }

  const jsonsDir = path.join(
    process.cwd(),
    'full-data',
    'extract-legal-teachings',
    ts,
    'jsons'
  );

  if (!fs.existsSync(jsonsDir)) {
    return [];
  }

  const teachingIds: string[] = [];
  const jsonFiles = fs.readdirSync(jsonsDir).filter((f) => f.endsWith('.json'));

  for (const filename of jsonFiles) {
    const filepath = path.join(jsonsDir, filename);

    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      const teachings = data.legalTeachings || [];

      for (const teaching of teachings) {
        if (teaching.teachingId) {
          teachingIds.push(teaching.teachingId);
        }
      }
    } catch (error) {
      // Skip files that fail to parse
    }
  }

  return teachingIds;
}
