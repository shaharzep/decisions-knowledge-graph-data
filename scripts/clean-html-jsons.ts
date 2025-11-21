/**
 * Clean HTML Conversion JSONs
 *
 * Removes metadata fields from convert-md-to-html output files,
 * keeping only: decision_id, language, full_html
 *
 * Usage:
 *   npm run clean:html-jsons [timestamp]
 *
 * If no timestamp provided, uses latest run.
 */

import fs from 'fs';
import path from 'path';

/**
 * Get latest timestamp directory for a job
 */
function getLatestTimestamp(jobId: string): string | null {
  const jobDir = path.join(process.cwd(), 'full-data', jobId);

  if (!fs.existsSync(jobDir)) {
    return null;
  }

  const timestamps = fs.readdirSync(jobDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(name))
    .sort()
    .reverse();

  return timestamps[0] || null;
}

/**
 * Clean a single JSON file
 */
function cleanJsonFile(filepath: string): void {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const data = JSON.parse(content);

    // Extract only the 3 required fields
    const cleaned = {
      decision_id: data.decision_id,
      language: data.language,
      full_html: data.full_html
    };

    // Write back with nice formatting
    fs.writeFileSync(filepath, JSON.stringify(cleaned, null, 2), 'utf-8');
  } catch (error: any) {
    console.error(`❌ Failed to clean ${path.basename(filepath)}: ${error.message}`);
    throw error;
  }
}

/**
 * Clean all JSON files in a directory
 */
function cleanDirectory(jsonsDir: string): void {
  if (!fs.existsSync(jsonsDir)) {
    throw new Error(`Directory not found: ${jsonsDir}`);
  }

  const files = fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'));

  if (files.length === 0) {
    console.log('⚠️  No JSON files found in directory');
    return;
  }

  console.log(`📁 Found ${files.length.toLocaleString()} JSON files`);
  console.log(`🧹 Cleaning files (keeping only decision_id, language, full_html)...\n`);

  let cleaned = 0;
  let failed = 0;

  for (let i = 0; i < files.length; i++) {
    const filepath = path.join(jsonsDir, files[i]);

    try {
      cleanJsonFile(filepath);
      cleaned++;

      // Progress indicator every 1000 files
      if ((i + 1) % 1000 === 0) {
        console.log(`Progress: ${(i + 1).toLocaleString()}/${files.length.toLocaleString()} cleaned`);
      }
    } catch (error) {
      failed++;
    }
  }

  console.log(`\n✅ Cleaning complete!`);
  console.log(`   Cleaned: ${cleaned.toLocaleString()} files`);
  if (failed > 0) {
    console.log(`   Failed: ${failed} files`);
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);
  const timestamp = args[0] || getLatestTimestamp('convert-md-to-html');

  if (!timestamp) {
    console.error('❌ No convert-md-to-html runs found in full-data directory');
    console.error('   Run the conversion first: npm run dev concurrent convert-md-to-html');
    process.exit(1);
  }

  const jsonsDir = path.join(
    process.cwd(),
    'full-data',
    'convert-md-to-html',
    timestamp,
    'jsons'
  );

  console.log(`🎯 Cleaning convert-md-to-html results`);
  console.log(`   Timestamp: ${timestamp}`);
  console.log(`   Directory: ${jsonsDir}\n`);

  try {
    cleanDirectory(jsonsDir);
  } catch (error: any) {
    console.error(`\n❌ Cleaning failed: ${error.message}`);
    process.exit(1);
  }
}

main();
