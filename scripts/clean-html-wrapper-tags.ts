/**
 * Clean HTML Wrapper Tags Script
 *
 * Removes <html>, <head>, and <body> wrapper tags from full_html field in JSON files.
 *
 * Usage:
 *   tsx scripts/clean-html-wrapper-tags.ts [directory]
 *
 * If no directory specified, processes both known convert-md-to-html output directories.
 *
 * Example:
 *   tsx scripts/clean-html-wrapper-tags.ts full-data/convert-md-to-html/2025-11-21T14-07-11-728Z
 */

import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';

/**
 * Strip HTML/HEAD/BODY wrapper tags from HTML content
 */
function stripWrapperTags(html: string): string {
  if (!html || html.trim() === '') {
    return html;
  }

  try {
    const $ = cheerio.load(html);
    const bodyContent = $('body').html();

    // If body tag exists, return its content; otherwise return original
    return bodyContent || html;
  } catch (error) {
    console.error('Error parsing HTML:', error);
    return html;
  }
}

/**
 * Clean a single JSON file
 */
function cleanJsonFile(filepath: string): boolean {
  try {
    const content = fs.readFileSync(filepath, 'utf-8');
    const data = JSON.parse(content);

    // Check if full_html field exists
    if (!data.full_html) {
      console.warn(`⚠️  No full_html field in ${path.basename(filepath)}, skipping`);
      return false;
    }

    // Check if wrapper tags exist
    if (!data.full_html.includes('<html') && !data.full_html.includes('<body')) {
      // Already clean
      return false;
    }

    // Strip wrapper tags
    const cleanedHtml = stripWrapperTags(data.full_html);
    data.full_html = cleanedHtml;

    // Write back to file
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error: any) {
    console.error(`❌ Failed to clean ${path.basename(filepath)}: ${error.message}`);
    return false;
  }
}

/**
 * Clean all JSON files in a directory
 */
function cleanDirectory(dirPath: string): void {
  const jsonsDir = path.join(dirPath, 'jsons');

  if (!fs.existsSync(jsonsDir)) {
    console.error(`❌ Directory not found: ${jsonsDir}`);
    return;
  }

  console.log(`\n📂 Processing directory: ${jsonsDir}`);

  const files = fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'));
  console.log(`   Found ${files.length.toLocaleString()} JSON files`);

  let cleaned = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const filepath = path.join(jsonsDir, file);

    try {
      const wasCleaned = cleanJsonFile(filepath);
      if (wasCleaned) {
        cleaned++;
      } else {
        skipped++;
      }
    } catch (error) {
      errors++;
    }

    // Progress update every 1000 files
    if ((i + 1) % 1000 === 0) {
      console.log(`   Progress: ${(i + 1).toLocaleString()}/${files.length.toLocaleString()} (${cleaned.toLocaleString()} cleaned, ${skipped.toLocaleString()} skipped)`);
    }
  }

  console.log(`\n✅ Completed: ${files.length.toLocaleString()} files processed`);
  console.log(`   - Cleaned: ${cleaned.toLocaleString()}`);
  console.log(`   - Skipped: ${skipped.toLocaleString()} (already clean or no full_html)`);
  if (errors > 0) {
    console.log(`   - Errors: ${errors.toLocaleString()}`);
  }
}

/**
 * Main execution
 */
function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Process specified directory
    const dirPath = path.resolve(args[0]);
    cleanDirectory(dirPath);
  } else {
    // Process both known directories
    const baseDir = path.join(process.cwd(), 'full-data', 'convert-md-to-html');
    const dirs = [
      '2025-11-21T14-07-11-728Z',
      '2025-11-21T17-16-08-387Z'
    ];

    console.log('🧹 Cleaning HTML wrapper tags from convert-md-to-html output directories\n');

    for (const dir of dirs) {
      const fullPath = path.join(baseDir, dir);
      if (fs.existsSync(fullPath)) {
        cleanDirectory(fullPath);
      } else {
        console.log(`⚠️  Directory not found: ${fullPath}`);
      }
    }
  }

  console.log('\n✨ Done!\n');
}

main();
