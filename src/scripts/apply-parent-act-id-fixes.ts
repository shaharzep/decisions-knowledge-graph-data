/**
 * Apply Parent Act ID Fixes
 *
 * Scans JSON files in the map-provisions directories and fixes corrupted
 * internal_parent_act_id values by using the correct decision_id from each JSON.
 *
 * Detection logic (from scan-provision-mapping-jsons.ts):
 * - Each JSON has decision_id (correct ECLI) and internal_parent_act_id
 * - If internal_parent_act_id doesn't start with "ACT-{decision_id}-", it's problematic
 * - Fix by extracting sequence suffix and rebuilding: "ACT-{decision_id}-{sequence}"
 *
 * Updates both:
 * 1. The internal_parent_act_id field inside each JSON
 * 2. The filename (which is derived from the internal_parent_act_id)
 *
 * Usage:
 *   npx tsx src/scripts/apply-parent-act-id-fixes.ts [--dry-run]
 *
 * Options:
 *   --dry-run  Preview changes without modifying files
 */

import fs from 'fs';
import path from 'path';

// =============================================================================
// CONFIGURATION
// =============================================================================

const DIRECTORIES_TO_PROCESS = [
  path.join(process.cwd(), 'full-data', 'map-provisions-code', '2025-12-02T12-09-54-214Z', 'jsons'),
  path.join(process.cwd(), 'full-data', 'map-provisions-standard', 'new-results', 'jsons'),
  path.join(process.cwd(), 'full-data', 'map-provisions-no-date', '2025-12-02T21-31-52-341Z', 'jsons'),
];

// =============================================================================
// TYPES
// =============================================================================

interface DirectoryResult {
  directory: string;
  totalFiles: number;
  filesUpdated: number;
  filesAlreadyCorrect: number;
  sequenceExtractionFailures: number;
  errors: Array<{ file: string; error: string }>;
}

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Scan directory for all JSON files
 */
function scanDirectoryForJsonFiles(dirPath: string): string[] {
  if (!fs.existsSync(dirPath)) {
    console.warn(`Directory does not exist: ${dirPath}`);
    return [];
  }

  const files = fs.readdirSync(dirPath);
  return files
    .filter(f => f.endsWith('.json'))
    .map(f => path.join(dirPath, f));
}

/**
 * Extract the 3-digit sequence suffix from an internal_parent_act_id
 *
 * Example: "ACT-ECLI:BE:GHCC:200-004" -> "004"
 */
function extractSequence(id: string): string | null {
  const match = id.match(/-(\d{3})$/);
  return match ? match[1] : null;
}

/**
 * Check if internal_parent_act_id is correct (contains the decision_id)
 */
function isCorrectId(internalParentActId: string, decisionId: string): boolean {
  const expectedPrefix = `ACT-${decisionId}-`;
  return internalParentActId.startsWith(expectedPrefix);
}

/**
 * Sanitize internal_parent_act_id to create a valid filename
 * Matches the logic in ConcurrentProcessor.sanitizeFileName
 */
function sanitizeForFilename(id: string): string {
  const sanitized = id.replace(/[^a-zA-Z0-9._-]+/g, '_');

  if (sanitized.length > 200) {
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      const char = id.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    const hashSuffix = Math.abs(hash).toString(16);
    return `${sanitized.substring(0, 190)}_${hashSuffix}`;
  }

  return sanitized;
}

/**
 * Rename file to match new internal_parent_act_id
 */
function renameFileForNewId(
  oldPath: string,
  newId: string,
  dryRun: boolean
): { newPath: string; renamed: boolean; error?: string } {
  const dir = path.dirname(oldPath);
  const oldFilename = path.basename(oldPath);

  // Check if filename has a row ID suffix (for map-provisions-code)
  // Pattern: ACT-..._123.json where 123 is the row ID
  const rowIdMatch = oldFilename.match(/_(\d+)\.json$/);
  const rowIdSuffix = rowIdMatch ? `_${rowIdMatch[1]}` : '';

  const newBasename = sanitizeForFilename(newId);
  const newFilename = `${newBasename}${rowIdSuffix}.json`;
  const newPath = path.join(dir, newFilename);

  if (oldPath === newPath) {
    return { newPath, renamed: false };
  }

  try {
    if (!dryRun) {
      fs.renameSync(oldPath, newPath);
    }
    return { newPath, renamed: true };
  } catch (err) {
    return { newPath, renamed: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Process a single JSON file - check and fix if needed
 */
function processJsonFile(
  filePath: string,
  dryRun: boolean
): { status: 'updated' | 'correct' | 'no_sequence' | 'error'; oldId?: string; newId?: string; error?: string } {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const json = JSON.parse(content);

    const decisionId = json.decision_id;
    const currentId = json.internal_parent_act_id;

    // Skip if missing required fields
    if (!decisionId || !currentId) {
      return { status: 'error', error: 'Missing decision_id or internal_parent_act_id' };
    }

    // Check if already correct
    if (isCorrectId(currentId, decisionId)) {
      return { status: 'correct' };
    }

    // Extract sequence to build corrected ID
    const sequence = extractSequence(currentId);
    if (!sequence) {
      return { status: 'no_sequence', oldId: currentId, error: 'Could not extract sequence suffix' };
    }

    // Build corrected ID
    const newId = `ACT-${decisionId}-${sequence}`;

    // Update JSON content
    json.internal_parent_act_id = newId;

    if (!dryRun) {
      fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf-8');
    }

    // Rename file
    const renameResult = renameFileForNewId(filePath, newId, dryRun);
    if (renameResult.error) {
      return { status: 'error', oldId: currentId, newId, error: `Rename failed: ${renameResult.error}` };
    }

    return { status: 'updated', oldId: currentId, newId };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Process all JSON files in a directory
 */
function processDirectory(dirPath: string, dryRun: boolean): DirectoryResult {
  const result: DirectoryResult = {
    directory: dirPath,
    totalFiles: 0,
    filesUpdated: 0,
    filesAlreadyCorrect: 0,
    sequenceExtractionFailures: 0,
    errors: [],
  };

  const files = scanDirectoryForJsonFiles(dirPath);
  result.totalFiles = files.length;

  if (files.length === 0) {
    console.log(`  No JSON files found in ${dirPath}`);
    return result;
  }

  console.log(`  Scanning ${files.length.toLocaleString()} files...`);

  let samplesShown = 0;

  for (const filePath of files) {
    const processResult = processJsonFile(filePath, dryRun);

    switch (processResult.status) {
      case 'updated':
        result.filesUpdated++;
        if (samplesShown < 5) {
          const prefix = dryRun ? '[DRY-RUN] Would fix' : 'Fixed';
          console.log(`    ${prefix}: ${path.basename(filePath)}`);
          console.log(`      Old: ${processResult.oldId}`);
          console.log(`      New: ${processResult.newId}`);
          samplesShown++;
        }
        break;

      case 'correct':
        result.filesAlreadyCorrect++;
        break;

      case 'no_sequence':
        result.sequenceExtractionFailures++;
        result.errors.push({ file: filePath, error: processResult.error || 'No sequence' });
        break;

      case 'error':
        result.errors.push({ file: filePath, error: processResult.error || 'Unknown error' });
        break;
    }
  }

  if (result.filesUpdated > 5) {
    console.log(`    ... and ${result.filesUpdated - 5} more files fixed`);
  }

  return result;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('='.repeat(70));
  console.log('APPLY PARENT ACT ID FIXES');
  console.log('='.repeat(70));

  if (dryRun) {
    console.log('\n*** DRY-RUN MODE: No files will be modified ***\n');
  } else {
    console.log('');
  }

  // Process each directory
  const results: DirectoryResult[] = [];

  for (const dirPath of DIRECTORIES_TO_PROCESS) {
    const shortPath = dirPath.replace(process.cwd(), '.');
    console.log(`Processing: ${shortPath}`);
    const result = processDirectory(dirPath, dryRun);
    results.push(result);
    console.log('');
  }

  // Print summary
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  let totalFiles = 0;
  let totalUpdated = 0;
  let totalCorrect = 0;
  let totalSeqFailures = 0;
  let totalErrors = 0;

  for (const result of results) {
    const dirName = path.basename(path.dirname(result.directory));
    console.log(`\n${dirName}:`);
    console.log(`  Total files:        ${result.totalFiles.toLocaleString()}`);
    console.log(`  Fixed:              ${result.filesUpdated.toLocaleString()}`);
    console.log(`  Already correct:    ${result.filesAlreadyCorrect.toLocaleString()}`);
    console.log(`  Sequence failures:  ${result.sequenceExtractionFailures}`);
    console.log(`  Other errors:       ${result.errors.length - result.sequenceExtractionFailures}`);

    if (result.errors.length > 0 && result.errors.length <= 5) {
      console.log(`  Error details:`);
      for (const err of result.errors) {
        console.log(`    - ${path.basename(err.file)}: ${err.error}`);
      }
    } else if (result.errors.length > 5) {
      console.log(`  Error details (first 5):`);
      for (const err of result.errors.slice(0, 5)) {
        console.log(`    - ${path.basename(err.file)}: ${err.error}`);
      }
      console.log(`    ... and ${result.errors.length - 5} more`);
    }

    totalFiles += result.totalFiles;
    totalUpdated += result.filesUpdated;
    totalCorrect += result.filesAlreadyCorrect;
    totalSeqFailures += result.sequenceExtractionFailures;
    totalErrors += result.errors.length;
  }

  console.log('\n' + '-'.repeat(70));
  console.log(`TOTAL FILES:      ${totalFiles.toLocaleString()}`);
  console.log(`FIXED:            ${totalUpdated.toLocaleString()}`);
  console.log(`ALREADY CORRECT:  ${totalCorrect.toLocaleString()}`);
  console.log(`ERRORS:           ${totalErrors}`);

  if (dryRun && totalUpdated > 0) {
    console.log('\n*** Run without --dry-run to apply changes ***');
  }

  console.log('='.repeat(70));
}

main().catch(console.error);
