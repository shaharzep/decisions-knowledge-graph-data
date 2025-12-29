/**
 * Clean Classification JSONs In-Place
 *
 * Finds and converts uncleaned JSONs in jsons-clean directory to clean format.
 * Only transforms files that have the nested "classification" structure.
 */

import fs from 'fs';
import path from 'path';

interface SourceClassification {
  teaching_id: string;
  classification: {
    topic_set: string[];
    issue_type_set: string[];
  };
  confidence: {
    overall: number;
  };
}

interface CleanClassification {
  teaching_id: string;
  confidence: number;
  topic_set: string[];
  issue_type_set: string[];
}

function isUncleaned(data: any): boolean {
  return data.classification !== undefined;
}

function transformJson(data: SourceClassification): CleanClassification {
  return {
    teaching_id: data.teaching_id,
    confidence: data.confidence?.overall ?? 0,
    topic_set: data.classification?.topic_set ?? [],
    issue_type_set: data.classification?.issue_type_set ?? [],
  };
}

function main(): void {
  const targetDir = process.argv[2] || path.join(
    process.cwd(),
    'full-data',
    'classify-legal-issues',
    'jsons-clean'
  );

  if (!fs.existsSync(targetDir)) {
    console.error(`Directory not found: ${targetDir}`);
    process.exit(1);
  }

  console.log(`\n📋 Target: ${targetDir}\n`);

  const files = fs.readdirSync(targetDir).filter((f) => f.endsWith('.json'));
  console.log(`Scanning ${files.length} files...\n`);

  let scanned = 0;
  let converted = 0;
  let alreadyClean = 0;
  let errors = 0;
  const errorDetails: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    try {
      const filePath = path.join(targetDir, file);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

      scanned++;

      if (isUncleaned(data)) {
        // Convert to clean format
        const clean = transformJson(data);
        fs.writeFileSync(filePath, JSON.stringify(clean, null, 2));
        converted++;

        if (converted % 100 === 0) {
          console.log(`Progress: ${converted} converted`);
        }
      } else {
        alreadyClean++;
      }

      if (scanned % 20000 === 0) {
        console.log(`Scanned: ${scanned}/${files.length}`);
      }
    } catch (e: any) {
      errors++;
      errorDetails.push({ file, error: e.message });
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('IN-PLACE CLEANING COMPLETE');
  console.log('='.repeat(50));
  console.log(`Total files:   ${files.length}`);
  console.log(`Scanned:       ${scanned}`);
  console.log(`Converted:     ${converted}`);
  console.log(`Already clean: ${alreadyClean}`);
  console.log(`Errors:        ${errors}`);

  if (errorDetails.length > 0) {
    console.log(`\nErrors:`);
    for (const { file, error } of errorDetails.slice(0, 10)) {
      console.log(`  - ${file}: ${error}`);
    }
    if (errorDetails.length > 10) {
      console.log(`  ... and ${errorDetails.length - 10} more`);
    }
  }

  console.log(`\n✅ Done!\n`);
}

main();
