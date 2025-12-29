/**
 * Merge classifications by teaching_id
 *
 * Properly merges rerun results into original by matching teaching_id field,
 * not by filename.
 */

import fs from 'fs';
import path from 'path';

const ORIGINAL_DIR = process.argv[2];
const RERUN_DIR = process.argv[3];

if (!ORIGINAL_DIR || !RERUN_DIR) {
  console.error('Usage: npx tsx src/scripts/merge-by-teaching-id.ts <original_jsons_dir> <rerun_jsons_dir>');
  process.exit(1);
}

if (!fs.existsSync(ORIGINAL_DIR)) {
  console.error(`Original directory not found: ${ORIGINAL_DIR}`);
  process.exit(1);
}

if (!fs.existsSync(RERUN_DIR)) {
  console.error(`Rerun directory not found: ${RERUN_DIR}`);
  process.exit(1);
}

console.log(`\nOriginal: ${ORIGINAL_DIR}`);
console.log(`Rerun:    ${RERUN_DIR}\n`);

// Step 1: Build map of teaching_id -> filename from original
console.log('Building teaching_id -> filename map from original...');
const teachingIdToFilename: Map<string, string> = new Map();

const originalFiles = fs.readdirSync(ORIGINAL_DIR).filter(f => f.endsWith('.json'));
console.log(`Found ${originalFiles.length} files in original\n`);

for (const filename of originalFiles) {
  try {
    const filepath = path.join(ORIGINAL_DIR, filename);
    const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
    const teachingId = data.teaching_id;
    if (teachingId) {
      teachingIdToFilename.set(teachingId, filename);
    }
  } catch (e) {
    // Skip unreadable files
  }
}

console.log(`Mapped ${teachingIdToFilename.size} teaching IDs\n`);

// Step 2: Process rerun files and merge by teaching_id
console.log('Processing rerun files...');
const rerunFiles = fs.readdirSync(RERUN_DIR).filter(f => f.endsWith('.json'));
console.log(`Found ${rerunFiles.length} files in rerun\n`);

let merged = 0;
let notFound = 0;
let errors = 0;
const notFoundIds: string[] = [];

for (const rerunFilename of rerunFiles) {
  try {
    const rerunPath = path.join(RERUN_DIR, rerunFilename);
    const rerunData = JSON.parse(fs.readFileSync(rerunPath, 'utf-8'));
    const teachingId = rerunData.teaching_id;

    if (!teachingId) {
      console.warn(`No teaching_id in ${rerunFilename}`);
      errors++;
      continue;
    }

    const originalFilename = teachingIdToFilename.get(teachingId);
    if (!originalFilename) {
      notFound++;
      notFoundIds.push(teachingId);
      continue;
    }

    // Overwrite the original file with the rerun data
    const originalPath = path.join(ORIGINAL_DIR, originalFilename);
    fs.writeFileSync(originalPath, JSON.stringify(rerunData, null, 2));
    merged++;

    if (merged % 100 === 0) {
      console.log(`Progress: ${merged} merged`);
    }
  } catch (e: any) {
    console.error(`Error processing ${rerunFilename}: ${e.message}`);
    errors++;
  }
}

console.log('\n' + '='.repeat(50));
console.log('MERGE COMPLETE');
console.log('='.repeat(50));
console.log(`Merged:    ${merged}`);
console.log(`Not found: ${notFound}`);
console.log(`Errors:    ${errors}`);

if (notFoundIds.length > 0 && notFoundIds.length <= 20) {
  console.log('\nTeaching IDs not found in original:');
  notFoundIds.forEach(id => console.log(`  - ${id}`));
}
