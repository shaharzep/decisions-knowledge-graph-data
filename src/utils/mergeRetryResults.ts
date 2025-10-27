import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

/**
 * Copy statistics for merge operation
 */
interface CopyStats {
  copied: number;      // Files successfully copied
  skipped: number;     // Files skipped (duplicates)
  failed: number;      // Files that failed to copy
}

/**
 * Complete merge statistics
 */
interface MergeStats {
  beforeCount: number;     // JSON count before merge
  afterCount: number;      // JSON count after merge
  filesAdded: number;      // Net new files added
  duplicatesFound: number; // Duplicates detected
  copyStats: CopyStats;    // Detailed copy statistics
}

/**
 * Count JSON files in directory
 *
 * Counts all .json files in the jsons/ subdirectory.
 *
 * @param baseDir Base directory containing jsons/ subdirectory
 * @returns Total count of .json files
 */
async function countJsonFiles(baseDir: string): Promise<number> {
  const jsonsDir = path.join(baseDir, 'jsons');

  try {
    const files = await fs.readdir(jsonsDir);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    return jsonFiles.length;
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Directory not found: ${jsonsDir}`);
    }
    throw error;
  }
}

/**
 * List all JSON filenames in directory
 *
 * Returns array of filenames (not full paths) for duplicate detection.
 *
 * @param baseDir Base directory containing jsons/ subdirectory
 * @returns Array of .json filenames
 */
async function listJsonFiles(baseDir: string): Promise<string[]> {
  const jsonsDir = path.join(baseDir, 'jsons');

  try {
    const files = await fs.readdir(jsonsDir);
    return files.filter(f => f.endsWith('.json'));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      throw new Error(`Directory not found: ${jsonsDir}`);
    }
    throw error;
  }
}

/**
 * Detect duplicate filenames between source and destination
 *
 * Compares filename arrays and returns files that exist in both.
 *
 * @param sourceFiles Array of source filenames
 * @param destFiles Array of destination filenames
 * @returns Array of duplicate filenames
 */
function detectDuplicates(sourceFiles: string[], destFiles: string[]): string[] {
  const destSet = new Set(destFiles);
  return sourceFiles.filter(f => destSet.has(f));
}

/**
 * Copy retry JSONs to original directory
 *
 * Copies files from retry jsons/ to original jsons/, skipping duplicates.
 * Returns detailed statistics about copy operation.
 *
 * @param sourceDir Retry base directory
 * @param destDir Original base directory
 * @param skipDuplicates Whether to skip existing files (default: true)
 * @returns Copy statistics
 */
async function copyRetryJsons(
  sourceDir: string,
  destDir: string,
  skipDuplicates: boolean = true
): Promise<CopyStats> {
  const sourceJsonsDir = path.join(sourceDir, 'jsons');
  const destJsonsDir = path.join(destDir, 'jsons');

  const stats: CopyStats = {
    copied: 0,
    skipped: 0,
    failed: 0,
  };

  // Get list of files to copy
  const sourceFiles = await listJsonFiles(sourceDir);
  const destFiles = skipDuplicates ? await listJsonFiles(destDir) : [];
  const destSet = new Set(destFiles);

  // Copy each file
  for (const filename of sourceFiles) {
    const sourcePath = path.join(sourceJsonsDir, filename);
    const destPath = path.join(destJsonsDir, filename);

    // Skip if duplicate
    if (skipDuplicates && destSet.has(filename)) {
      stats.skipped++;
      continue;
    }

    // Copy file
    try {
      await fs.copyFile(sourcePath, destPath);
      stats.copied++;
    } catch (error) {
      logger.error(`Failed to copy ${filename}:`, error);
      stats.failed++;
    }
  }

  return stats;
}

/**
 * Display merge report in terminal
 *
 * Formats and displays comprehensive merge statistics with
 * before/after counts, files added, and copy details.
 *
 * @param jobId Job identifier
 * @param originalTimestamp Original run timestamp
 * @param retryTimestamp Retry run timestamp
 * @param stats Complete merge statistics
 */
function displayMergeReport(
  jobId: string,
  originalTimestamp: string,
  retryTimestamp: string,
  stats: MergeStats
): void {
  console.log('\n🔄 Merging retry results into original run\n');

  console.log('📊 Job:', jobId);
  console.log(`   Original: ${originalTimestamp}`);
  console.log(`   Retry:    ${retryTimestamp}`);
  console.log('');

  console.log('📊 Before merge:');
  console.log(`   Original JSONs: ${stats.beforeCount.toLocaleString()}`);
  console.log('');

  console.log('🔍 Duplicate detection:');
  console.log(`   Retry JSONs: ${(stats.copyStats.copied + stats.copyStats.skipped).toLocaleString()}`);
  console.log(`   Duplicates found: ${stats.duplicatesFound.toLocaleString()}`);
  console.log(`   Files to copy: ${stats.copyStats.copied.toLocaleString()}`);
  console.log('');

  console.log('✅ Copy complete!');
  console.log(`   Copied: ${stats.copyStats.copied.toLocaleString()} files`);
  console.log(`   Skipped: ${stats.copyStats.skipped.toLocaleString()} duplicates`);
  if (stats.copyStats.failed > 0) {
    console.log(`   Failed: ${stats.copyStats.failed.toLocaleString()} errors`);
  }
  console.log('');

  console.log('📊 After merge:');
  console.log(`   Original JSONs: ${stats.afterCount.toLocaleString()}`);
  console.log(`   Files added: ${stats.filesAdded.toLocaleString()}`);
  console.log('');

  if (stats.copyStats.failed > 0) {
    console.log('⚠️  Some files failed to copy. Check logs for details.');
    console.log('');
  }

  console.log('✅ Merge completed successfully!\n');
}

/**
 * Merge retry results into original run
 *
 * Main orchestrator function that coordinates the entire merge process:
 * 1. Validates paths exist
 * 2. Counts JSONs before merge
 * 3. Detects duplicates
 * 4. Copies retry JSONs to original
 * 5. Counts JSONs after merge
 * 6. Displays comprehensive report
 *
 * @param jobId Job identifier (e.g., 'extract-comprehensive')
 * @param originalTimestamp Original run timestamp
 * @param retryTimestamp Retry run timestamp
 */
export async function mergeRetryResults(
  jobId: string,
  originalTimestamp: string,
  retryTimestamp: string
): Promise<void> {
  // Build directory paths
  const baseDir = path.join(process.cwd(), 'full-data', jobId);
  const originalDir = path.join(baseDir, originalTimestamp);
  const retryDir = path.join(baseDir, retryTimestamp);

  // Validate paths exist
  try {
    await fs.access(originalDir);
    await fs.access(retryDir);
    await fs.access(path.join(originalDir, 'jsons'));
    await fs.access(path.join(retryDir, 'jsons'));
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      console.error('\n❌ Error: Directory not found\n');
      console.error('Expected structure:');
      console.error(`  ${originalDir}/jsons/`);
      console.error(`  ${retryDir}/jsons/`);
      console.error('');
      throw new Error('Required directories not found');
    }
    throw error;
  }

  // Count before merge
  const beforeCount = await countJsonFiles(originalDir);

  // Detect duplicates
  const sourceFiles = await listJsonFiles(retryDir);
  const destFiles = await listJsonFiles(originalDir);
  const duplicates = detectDuplicates(sourceFiles, destFiles);

  // Copy files (skipDuplicates = false to OVERRIDE existing files)
  const copyStats = await copyRetryJsons(retryDir, originalDir, true);

  // Count after merge
  const afterCount = await countJsonFiles(originalDir);

  // Calculate statistics
  const stats: MergeStats = {
    beforeCount,
    afterCount,
    filesAdded: afterCount - beforeCount,
    duplicatesFound: duplicates.length,
    copyStats,
  };

  // Display report
  displayMergeReport(jobId, originalTimestamp, retryTimestamp, stats);
}
