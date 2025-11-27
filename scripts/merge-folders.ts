import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function mergeFolders() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: npx tsx scripts/merge-folders.ts <target-dir> <source-dir-1> <source-dir-2> ...');
    process.exit(1);
  }

  const targetDir = args[0];
  const sourceDirs = args.slice(1);

  console.log(`Target Directory: ${targetDir}`);
  console.log(`Source Directories:`, sourceDirs);

  // Create target structure
  const targetJsonsDir = path.join(targetDir, 'jsons');
  await fs.mkdir(targetJsonsDir, { recursive: true });

  let totalCopied = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const sourceDir of sourceDirs) {
    const sourceJsonsDir = path.join(sourceDir, 'jsons');
    console.log(`\nProcessing source: ${sourceJsonsDir}`);

    try {
      await fs.access(sourceJsonsDir);
    } catch {
      console.warn(`  Skipping: Directory not found or inaccessible: ${sourceJsonsDir}`);
      continue;
    }

    const files = await fs.readdir(sourceJsonsDir);
    console.log(`  Found ${files.length} files.`);

    for (const file of files) {
      if (!file.endsWith('.json')) continue;

      const sourcePath = path.join(sourceJsonsDir, file);
      const targetPath = path.join(targetJsonsDir, file);

      try {
        // Check if file exists in target
        try {
          await fs.access(targetPath);
          // File exists - skip (assuming immutable data) or overwrite?
          // Let's skip for speed, but maybe log it.
          // totalSkipped++;
          // continue;
          
          // Actually, let's overwrite to be safe (in case of re-runs with fixes)
          // But reading/writing is slow. 
          // If the user is merging "resumed" runs, they should be disjoint sets mostly.
          // Let's check size/mtime? No, just overwrite.
        } catch {
          // File doesn't exist, proceed to copy
        }

        await fs.copyFile(sourcePath, targetPath);
        totalCopied++;
        
        if (totalCopied % 1000 === 0) {
          process.stdout.write(`\r  Copied ${totalCopied} files...`);
        }
      } catch (err) {
        console.error(`  Error copying ${file}:`, err);
        totalErrors++;
      }
    }
  }

  console.log('\n\nMerge Completed!');
  console.log(`Total Copied: ${totalCopied}`);
  console.log(`Total Skipped: ${totalSkipped}`); // We are overwriting, so skipped is 0 unless we change logic
  console.log(`Total Errors: ${totalErrors}`);
  console.log(`Output Location: ${targetJsonsDir}`);
}

mergeFolders().catch(console.error);
