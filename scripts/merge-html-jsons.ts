/**
 * Merge HTML JSONs Script
 *
 * Merges JSON files from multiple convert-md-to-html output directories into a single merged directory.
 *
 * Usage:
 *   tsx scripts/merge-html-jsons.ts
 *
 * This script will:
 * - Create a new 'merged' directory under full-data/convert-md-to-html/
 * - Copy all JSON files from both timestamp directories
 * - Check for any filename conflicts
 * - Generate a summary
 */

import fs from 'fs';
import path from 'path';

/**
 * Copy a file from source to destination
 */
function copyFile(src: string, dest: string): void {
  fs.copyFileSync(src, dest);
}

/**
 * Merge JSON files from source directories into destination
 */
function mergeJsonDirectories(sourceDirs: string[], destDir: string): void {
  // Create destination directory structure
  const jsonsDir = path.join(destDir, 'jsons');
  if (!fs.existsSync(jsonsDir)) {
    fs.mkdirSync(jsonsDir, { recursive: true });
  }

  console.log(`📂 Created merged directory: ${destDir}\n`);

  let totalCopied = 0;
  const conflicts: string[] = [];
  const copiedFiles = new Set<string>();

  // Process each source directory
  for (let i = 0; i < sourceDirs.length; i++) {
    const sourceDir = sourceDirs[i];
    const sourceJsonsDir = path.join(sourceDir, 'jsons');

    if (!fs.existsSync(sourceJsonsDir)) {
      console.warn(`⚠️  Source directory not found: ${sourceJsonsDir}`);
      continue;
    }

    console.log(`📁 Processing: ${path.basename(sourceDir)}`);

    const files = fs.readdirSync(sourceJsonsDir).filter(f => f.endsWith('.json'));
    console.log(`   Found ${files.length.toLocaleString()} JSON files`);

    let copied = 0;
    for (const file of files) {
      const srcPath = path.join(sourceJsonsDir, file);
      const destPath = path.join(jsonsDir, file);

      // Check for conflicts
      if (copiedFiles.has(file)) {
        conflicts.push(file);
        console.warn(`   ⚠️  Conflict detected: ${file} (skipping duplicate)`);
        continue;
      }

      copyFile(srcPath, destPath);
      copiedFiles.add(file);
      copied++;

      // Progress update every 5000 files
      if (copied % 5000 === 0) {
        console.log(`   Progress: ${copied.toLocaleString()}/${files.length.toLocaleString()}`);
      }
    }

    totalCopied += copied;
    console.log(`   ✅ Copied ${copied.toLocaleString()} files\n`);
  }

  console.log(`\n✨ Merge completed!`);
  console.log(`   Total files merged: ${totalCopied.toLocaleString()}`);

  if (conflicts.length > 0) {
    console.log(`   ⚠️  Conflicts found: ${conflicts.length}`);
    console.log(`   Conflicting files were skipped (first instance kept)`);
  } else {
    console.log(`   ✅ No conflicts detected`);
  }
}

/**
 * Main execution
 */
function main() {
  const baseDir = path.join(process.cwd(), 'full-data', 'convert-md-to-html');

  const sourceDirs = [
    path.join(baseDir, '2025-11-21T14-07-11-728Z'),
    path.join(baseDir, '2025-11-21T17-16-08-387Z')
  ];

  const destDir = path.join(baseDir, 'merged');

  console.log('🔄 Merging convert-md-to-html JSON directories\n');
  console.log(`Source directories:`);
  sourceDirs.forEach(dir => console.log(`  - ${path.basename(dir)}`));
  console.log(`\nDestination: merged/\n`);

  mergeJsonDirectories(sourceDirs, destDir);

  console.log('\n✅ Done!\n');
}

main();
