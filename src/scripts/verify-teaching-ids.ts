/**
 * Verify Teaching IDs Script
 *
 * Validates that all legal teachings in the full-data results have
 * valid and unique teaching_id values.
 */

import fs from 'fs';
import path from 'path';

interface Teaching {
  teachingId?: string;
  text?: string;
  [key: string]: unknown;
}

interface DecisionData {
  decision_id: string;
  legalTeachings?: Teaching[];
  [key: string]: unknown;
}

interface ValidationResult {
  totalDecisions: number;
  totalTeachings: number;
  validTeachingIds: number;
  missingTeachingIds: Array<{ decisionId: string; index: number; text?: string }>;
  emptyTeachingIds: Array<{ decisionId: string; index: number; text?: string }>;
  duplicateTeachingIds: Map<string, Array<{ decisionId: string; index: number }>>;
  teachingIdFormats: Map<string, number>;
}

function getLatestFullDataTimestamp(jobId: string): string | null {
  const resultsDir = path.join(process.cwd(), 'full-data', jobId);

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

function validateTeachingIds(): ValidationResult {
  const timestamp = getLatestFullDataTimestamp('extract-legal-teachings');

  if (!timestamp) {
    throw new Error('No extract-legal-teachings full-data results found.');
  }

  console.log(`\n📋 Validating teaching IDs from: ${timestamp}\n`);

  const jsonsDir = path.join(
    process.cwd(),
    'full-data',
    'extract-legal-teachings',
    timestamp,
    'jsons'
  );

  if (!fs.existsSync(jsonsDir)) {
    throw new Error(`Full-data jsons directory not found: ${jsonsDir}`);
  }

  const jsonFiles = fs.readdirSync(jsonsDir).filter((f) => f.endsWith('.json'));

  const result: ValidationResult = {
    totalDecisions: 0,
    totalTeachings: 0,
    validTeachingIds: 0,
    missingTeachingIds: [],
    emptyTeachingIds: [],
    duplicateTeachingIds: new Map(),
    teachingIdFormats: new Map(),
  };

  // Track all teaching IDs to find duplicates
  const allTeachingIds = new Map<string, Array<{ decisionId: string; index: number }>>();

  for (const filename of jsonFiles) {
    const filepath = path.join(jsonsDir, filename);
    try {
      const data: DecisionData = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      const decisionId = data.decision_id;
      const teachings = data.legalTeachings || [];

      result.totalDecisions++;

      teachings.forEach((teaching, index) => {
        result.totalTeachings++;

        if (teaching.teachingId === undefined || teaching.teachingId === null) {
          result.missingTeachingIds.push({
            decisionId,
            index,
            text: teaching.text?.substring(0, 100),
          });
        } else if (teaching.teachingId === '' || teaching.teachingId.trim() === '') {
          result.emptyTeachingIds.push({
            decisionId,
            index,
            text: teaching.text?.substring(0, 100),
          });
        } else {
          result.validTeachingIds++;

          // Track for duplicate detection
          const id = teaching.teachingId;
          if (!allTeachingIds.has(id)) {
            allTeachingIds.set(id, []);
          }
          allTeachingIds.get(id)!.push({ decisionId, index });

          // Track format patterns (e.g., "TEACH-001", "dec123-t1", etc.)
          const formatMatch = id.match(/^([A-Za-z]+[-_]?)/);
          const format = formatMatch ? formatMatch[1] : 'other';
          result.teachingIdFormats.set(format, (result.teachingIdFormats.get(format) || 0) + 1);
        }
      });
    } catch (error) {
      console.warn(`Failed to read ${filename}: ${error}`);
    }
  }

  // Find duplicates
  for (const [id, occurrences] of allTeachingIds) {
    if (occurrences.length > 1) {
      result.duplicateTeachingIds.set(id, occurrences);
    }
  }

  return result;
}

function printReport(result: ValidationResult): void {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                 TEACHING ID VALIDATION REPORT              ');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('📊 SUMMARY');
  console.log('───────────────────────────────────────────────────────────');
  console.log(`  Total decisions:        ${result.totalDecisions}`);
  console.log(`  Total teachings:        ${result.totalTeachings}`);
  console.log(`  Valid teaching IDs:     ${result.validTeachingIds}`);
  console.log(`  Missing teaching IDs:   ${result.missingTeachingIds.length}`);
  console.log(`  Empty teaching IDs:     ${result.emptyTeachingIds.length}`);
  console.log(`  Duplicate teaching IDs: ${result.duplicateTeachingIds.size}`);
  console.log('');

  // Uniqueness check
  const isUnique = result.duplicateTeachingIds.size === 0;
  const isComplete = result.missingTeachingIds.length === 0 && result.emptyTeachingIds.length === 0;

  if (isUnique && isComplete) {
    console.log('✅ ALL TEACHING IDs ARE VALID AND UNIQUE\n');
  } else {
    console.log('❌ VALIDATION FAILED\n');
  }

  // Show teaching ID format distribution
  if (result.teachingIdFormats.size > 0) {
    console.log('📋 TEACHING ID FORMAT DISTRIBUTION');
    console.log('───────────────────────────────────────────────────────────');
    const sortedFormats = [...result.teachingIdFormats.entries()].sort((a, b) => b[1] - a[1]);
    for (const [format, count] of sortedFormats) {
      console.log(`  ${format.padEnd(20)} ${count}`);
    }
    console.log('');
  }

  // Show sample teaching IDs
  console.log('📝 SAMPLE TEACHING IDs (first 5 unique)');
  console.log('───────────────────────────────────────────────────────────');
  const sampleIds = new Set<string>();
  const jsonsDir = path.join(
    process.cwd(),
    'full-data',
    'extract-legal-teachings',
    getLatestFullDataTimestamp('extract-legal-teachings')!,
    'jsons'
  );
  const jsonFiles = fs.readdirSync(jsonsDir).filter((f) => f.endsWith('.json'));

  outer: for (const filename of jsonFiles) {
    const data: DecisionData = JSON.parse(fs.readFileSync(path.join(jsonsDir, filename), 'utf-8'));
    for (const teaching of data.legalTeachings || []) {
      if (teaching.teachingId && sampleIds.size < 5) {
        sampleIds.add(teaching.teachingId);
        console.log(`  ${teaching.teachingId}`);
      }
      if (sampleIds.size >= 5) break outer;
    }
  }
  console.log('');

  // Show missing teaching IDs
  if (result.missingTeachingIds.length > 0) {
    console.log('⚠️  MISSING TEACHING IDs');
    console.log('───────────────────────────────────────────────────────────');
    const showCount = Math.min(10, result.missingTeachingIds.length);
    for (let i = 0; i < showCount; i++) {
      const item = result.missingTeachingIds[i];
      console.log(`  Decision: ${item.decisionId}, Index: ${item.index}`);
      if (item.text) {
        console.log(`    Text: "${item.text}..."`);
      }
    }
    if (result.missingTeachingIds.length > 10) {
      console.log(`  ... and ${result.missingTeachingIds.length - 10} more`);
    }
    console.log('');
  }

  // Show empty teaching IDs
  if (result.emptyTeachingIds.length > 0) {
    console.log('⚠️  EMPTY TEACHING IDs');
    console.log('───────────────────────────────────────────────────────────');
    const showCount = Math.min(10, result.emptyTeachingIds.length);
    for (let i = 0; i < showCount; i++) {
      const item = result.emptyTeachingIds[i];
      console.log(`  Decision: ${item.decisionId}, Index: ${item.index}`);
      if (item.text) {
        console.log(`    Text: "${item.text}..."`);
      }
    }
    if (result.emptyTeachingIds.length > 10) {
      console.log(`  ... and ${result.emptyTeachingIds.length - 10} more`);
    }
    console.log('');
  }

  // Show duplicate teaching IDs
  if (result.duplicateTeachingIds.size > 0) {
    console.log('⚠️  DUPLICATE TEACHING IDs');
    console.log('───────────────────────────────────────────────────────────');
    let shown = 0;
    for (const [id, occurrences] of result.duplicateTeachingIds) {
      if (shown >= 10) break;
      console.log(`  "${id}" appears ${occurrences.length} times:`);
      for (const occ of occurrences.slice(0, 3)) {
        console.log(`    - Decision: ${occ.decisionId}, Index: ${occ.index}`);
      }
      if (occurrences.length > 3) {
        console.log(`    ... and ${occurrences.length - 3} more occurrences`);
      }
      shown++;
    }
    if (result.duplicateTeachingIds.size > 10) {
      console.log(`  ... and ${result.duplicateTeachingIds.size - 10} more duplicate IDs`);
    }
    console.log('');
  }

  console.log('═══════════════════════════════════════════════════════════\n');
}

// Main execution
try {
  const result = validateTeachingIds();
  printReport(result);

  // Exit with error code if validation failed
  const isValid =
    result.duplicateTeachingIds.size === 0 &&
    result.missingTeachingIds.length === 0 &&
    result.emptyTeachingIds.length === 0;

  process.exit(isValid ? 0 : 1);
} catch (error) {
  console.error('Error:', error);
  process.exit(1);
}
