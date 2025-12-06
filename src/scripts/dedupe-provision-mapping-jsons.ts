/**
 * Deduplicate Provision Mapping JSONs
 *
 * After merging old (one file per internal_parent_act_id) and new (one file per row)
 * JSON files, this script identifies duplicates and deletes the old format files.
 *
 * Logic:
 * 1. Scan all JSONs in the target directory
 * 2. Group files by internal_parent_act_id (from JSON content)
 * 3. For groups with multiple files:
 *    - Old format: {internal_parent_act_id}.json (no _rowId suffix)
 *    - New format: {internal_parent_act_id}_{rowId}.json (has _rowId suffix)
 *    - Delete old format files, keep new format files
 *
 * Usage:
 *   npx tsx src/scripts/dedupe-provision-mapping-jsons.ts [--dry-run]
 *
 * Options:
 *   --dry-run    Show what would be deleted without actually deleting
 */

import fs from 'fs';
import path from 'path';

// =============================================================================
// CONFIG
// =============================================================================

const TARGET_DIR = '/Users/shaharzep/ontology/stage1-data-extraction/full-data/map-provisions-code/2025-12-02T12-09-54-214Z/jsons';

// =============================================================================
// TYPES
// =============================================================================

interface FileInfo {
  filename: string;
  filepath: string;
  internalParentActId: string;
  isNewFormat: boolean; // true if filename has _rowId suffix
}

interface DuplicateGroup {
  internalParentActId: string;
  oldFormatFiles: FileInfo[];
  newFormatFiles: FileInfo[];
}

// =============================================================================
// FUNCTIONS
// =============================================================================

/**
 * Check if filename is new format (has _rowId suffix)
 *
 * Old format: ACT-ECLI_BE_AHANT_1999_ARR.19990302.15-001.json
 * New format: ACT-ECLI_BE_AHANT_1999_ARR.19990302.15-001_11.json
 *
 * The _rowId is always at the end, right before .json
 */
function isNewFormatFilename(filename: string): boolean {
  // Remove .json extension
  const base = filename.replace(/\.json$/, '');
  // Check if it ends with _<digits>
  return /_\d+$/.test(base);
}

/**
 * Scan directory and build file info map
 */
function scanDirectory(dirPath: string): FileInfo[] {
  console.log(`Scanning directory: ${dirPath}`);

  const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.json'));
  console.log(`Found ${files.length.toLocaleString()} JSON files`);

  const fileInfos: FileInfo[] = [];
  let processed = 0;
  let errors = 0;

  for (const filename of files) {
    const filepath = path.join(dirPath, filename);

    try {
      const content = fs.readFileSync(filepath, 'utf-8');
      const data = JSON.parse(content);
      const internalParentActId = data.internal_parent_act_id;

      if (!internalParentActId) {
        console.warn(`Missing internal_parent_act_id in ${filename}`);
        errors++;
        continue;
      }

      fileInfos.push({
        filename,
        filepath,
        internalParentActId,
        isNewFormat: isNewFormatFilename(filename),
      });

      processed++;
      if (processed % 10000 === 0) {
        console.log(`  Processed ${processed.toLocaleString()} files...`);
      }
    } catch (e: any) {
      console.warn(`Error reading ${filename}: ${e.message}`);
      errors++;
    }
  }

  console.log(`Processed ${processed.toLocaleString()} files (${errors} errors)`);
  return fileInfos;
}

/**
 * Group files by internal_parent_act_id and identify duplicates
 */
function findDuplicates(fileInfos: FileInfo[]): DuplicateGroup[] {
  console.log('\nGrouping by internal_parent_act_id...');

  // Group by internal_parent_act_id
  const groups = new Map<string, FileInfo[]>();

  for (const info of fileInfos) {
    const existing = groups.get(info.internalParentActId) || [];
    existing.push(info);
    groups.set(info.internalParentActId, existing);
  }

  console.log(`Found ${groups.size.toLocaleString()} unique internal_parent_act_ids`);

  // Find groups with duplicates (mix of old and new format)
  const duplicateGroups: DuplicateGroup[] = [];

  for (const [id, files] of groups) {
    const oldFormat = files.filter(f => !f.isNewFormat);
    const newFormat = files.filter(f => f.isNewFormat);

    // Only consider it a duplicate if we have BOTH old and new format files
    if (oldFormat.length > 0 && newFormat.length > 0) {
      duplicateGroups.push({
        internalParentActId: id,
        oldFormatFiles: oldFormat,
        newFormatFiles: newFormat,
      });
    }
  }

  console.log(`Found ${duplicateGroups.length.toLocaleString()} groups with duplicates (old + new format)`);
  return duplicateGroups;
}

/**
 * Delete old format files from duplicate groups
 */
function deleteOldFormatFiles(duplicateGroups: DuplicateGroup[], dryRun: boolean): number {
  let totalDeleted = 0;

  for (const group of duplicateGroups) {
    for (const oldFile of group.oldFormatFiles) {
      if (dryRun) {
        console.log(`[DRY RUN] Would delete: ${oldFile.filename}`);
        totalDeleted++;
      } else {
        try {
          fs.unlinkSync(oldFile.filepath);
          totalDeleted++;
        } catch (e: any) {
          console.error(`Failed to delete ${oldFile.filename}: ${e.message}`);
        }
      }
    }
  }

  return totalDeleted;
}

// =============================================================================
// MAIN
// =============================================================================

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  console.log('='.repeat(70));
  console.log('DEDUPLICATE PROVISION MAPPING JSONS');
  console.log('='.repeat(70));
  console.log(`\nMode: ${dryRun ? 'DRY RUN (no deletions)' : 'LIVE (will delete files)'}`);
  console.log(`Target: ${TARGET_DIR}\n`);

  // Step 1: Scan directory
  const fileInfos = scanDirectory(TARGET_DIR);

  if (fileInfos.length === 0) {
    console.log('No files found. Exiting.');
    return;
  }

  // Step 2: Find duplicates
  const duplicateGroups = findDuplicates(fileInfos);

  if (duplicateGroups.length === 0) {
    console.log('\nNo duplicates found. Nothing to delete.');
    return;
  }

  // Step 3: Report
  const totalOldToDelete = duplicateGroups.reduce((sum, g) => sum + g.oldFormatFiles.length, 0);
  const totalNewToKeep = duplicateGroups.reduce((sum, g) => sum + g.newFormatFiles.length, 0);

  console.log('\n## SUMMARY\n');
  console.log(`Duplicate groups:        ${duplicateGroups.length.toLocaleString()}`);
  console.log(`Old format files to DELETE: ${totalOldToDelete.toLocaleString()}`);
  console.log(`New format files to KEEP:   ${totalNewToKeep.toLocaleString()}`);

  // Show samples
  console.log('\n## SAMPLES (first 10 groups)\n');
  for (const group of duplicateGroups.slice(0, 10)) {
    console.log(`ID: ${group.internalParentActId}`);
    console.log(`  DELETE (old): ${group.oldFormatFiles.map(f => f.filename).join(', ')}`);
    console.log(`  KEEP (new):   ${group.newFormatFiles.map(f => f.filename).join(', ')}`);
    console.log('');
  }

  if (duplicateGroups.length > 10) {
    console.log(`  ... and ${duplicateGroups.length - 10} more groups\n`);
  }

  // Step 4: Delete (or dry run)
  if (dryRun) {
    console.log('\n## DRY RUN - No files deleted\n');
    console.log('Run without --dry-run to actually delete files.');
  } else {
    console.log('\n## DELETING OLD FORMAT FILES...\n');
    const deleted = deleteOldFormatFiles(duplicateGroups, false);
    console.log(`\nDeleted ${deleted.toLocaleString()} files.`);
  }

  console.log('\n' + '='.repeat(70));
}

main();
