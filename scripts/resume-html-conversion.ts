/**
 * Resume HTML Conversion Job
 *
 * Identifies completed conversions and generates SQL to process only remaining decisions.
 */

import fs from 'fs';
import path from 'path';

/**
 * Get the latest conversion run directory
 */
function getLatestRunDir(): string | null {
  const baseDir = path.join(process.cwd(), 'full-data', 'convert-md-to-html');

  if (!fs.existsSync(baseDir)) {
    return null;
  }

  const timestamps = fs.readdirSync(baseDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(name))
    .sort()
    .reverse();

  return timestamps[0] ? path.join(baseDir, timestamps[0]) : null;
}

/**
 * Parse decision_id and language from filename
 * Format: ECLI_BE_COURT_YYYY_ID_LANG.json
 */
function parseFilename(filename: string): { decision_id: string; language: string } | null {
  const match = filename.match(/^(.+)_(FR|NL)\.json$/);
  if (!match) return null;

  const ecliPart = match[1].replace(/_/g, ':').replace(/:/g, ':', 4).replace(/_/g, '.');
  const language = match[2];

  return { decision_id: ecliPart, language };
}

/**
 * Load completed decisions from jsons directory
 */
function loadCompletedDecisions(runDir: string): Array<{ decision_id: string; language: string }> {
  const jsonsDir = path.join(runDir, 'jsons');

  if (!fs.existsSync(jsonsDir)) {
    console.error(`❌ jsons directory not found: ${jsonsDir}`);
    return [];
  }

  const files = fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'));
  const completed: Array<{ decision_id: string; language: string }> = [];

  for (const file of files) {
    const parsed = parseFilename(file);
    if (parsed) {
      completed.push(parsed);
    }
  }

  return completed;
}

/**
 * Main execution
 */
async function main() {
  console.log('🔍 Analyzing completed HTML conversions...\n');

  const runDir = getLatestRunDir();
  if (!runDir) {
    console.error('❌ No convert-md-to-html runs found');
    console.error('   Start a new conversion: npm run dev:highmem concurrent convert-md-to-html');
    process.exit(1);
  }

  console.log(`📁 Latest run: ${path.basename(runDir)}`);

  const completed = loadCompletedDecisions(runDir);
  console.log(`✅ Completed: ${completed.length.toLocaleString()} decisions`);

  // Calculate expected total
  const expectedTotal = 52963;
  const remaining = expectedTotal - completed.length;

  console.log(`⏳ Remaining: ${remaining.toLocaleString()} decisions\n`);

  if (remaining === 0) {
    console.log('🎉 All decisions have been converted!');
    process.exit(0);
  }

  // Generate SQL arrays for completed decisions
  const completedIds = completed.map(d => d.decision_id);
  const completedLanguages = completed.map(d => d.language);

  console.log('📝 SQL to exclude completed decisions:\n');
  console.log('Add this to the WHERE clause of convert-md-to-html job:\n');
  console.log('AND NOT (');
  console.log('  (d.decision_id, d.language_metadata) IN (');
  console.log('    SELECT unnest($3::text[]), unnest($4::text[])');
  console.log('  )');
  console.log(')\n');
  console.log('And add these to dbQueryParams:\n');
  console.log(`  [...existing params],`);
  console.log(`  [${completedIds.slice(0, 3).map(id => `'${id}'`).join(', ')}, ...], // ${completedIds.length} completed decision_ids`);
  console.log(`  [${completedLanguages.slice(0, 3).map(l => `'${l}'`).join(', ')}, ...], // ${completedLanguages.length} completed languages`);

  // Save to file for programmatic use
  const outputFile = path.join(process.cwd(), 'tmp-resume-data.json');
  fs.writeFileSync(
    outputFile,
    JSON.stringify({ decision_ids: completedIds, languages: completedLanguages }, null, 2)
  );
  console.log(`\n💾 Saved completed decisions to: ${outputFile}`);
  console.log(`\n▶️  To resume, update the job config and run:`);
  console.log(`   npm run dev:highmem concurrent convert-md-to-html`);
}

main();
