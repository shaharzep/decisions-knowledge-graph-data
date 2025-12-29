/**
 * Clean Classification JSONs for S3 Upload
 *
 * Transforms the full classification JSONs into a minimal format:
 * {
 *   teaching_id: string,
 *   confidence: number,
 *   topic_set: string[],
 *   issue_type_set: string[]
 * }
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

function getLatestFullDataTimestamp(jobId: string): string | null {
  const resultsDir = path.join(process.cwd(), 'full-data', jobId);

  if (!fs.existsSync(resultsDir)) {
    return null;
  }

  const timestamps = fs
    .readdirSync(resultsDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.test(name))
    .sort()
    .reverse();

  return timestamps[0] || null;
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
  const timestamp = getLatestFullDataTimestamp('classify-legal-issues');

  if (!timestamp) {
    console.error('No classify-legal-issues full-data results found');
    process.exit(1);
  }

  const sourceDir = path.join(
    process.cwd(),
    'full-data',
    'classify-legal-issues',
    timestamp,
    'jsons'
  );

  const targetDir = path.join(
    process.cwd(),
    'full-data',
    'classify-legal-issues',
    timestamp,
    'jsons-clean'
  );

  console.log(`\n📋 Source: ${sourceDir}`);
  console.log(`📋 Target: ${targetDir}\n`);

  // Create target directory
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith('.json'));
  console.log(`Processing ${files.length} files...\n`);

  let processed = 0;
  let errors = 0;
  const errorDetails: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    try {
      const sourcePath = path.join(sourceDir, file);
      const targetPath = path.join(targetDir, file);

      const data: SourceClassification = JSON.parse(fs.readFileSync(sourcePath, 'utf-8'));
      const clean = transformJson(data);

      fs.writeFileSync(targetPath, JSON.stringify(clean, null, 2));
      processed++;

      if (processed % 10000 === 0) {
        console.log(`Progress: ${processed}/${files.length}`);
      }
    } catch (e: any) {
      errors++;
      errorDetails.push({ file, error: e.message });
    }
  }

  console.log(`\n${'='.repeat(50)}`);
  console.log('TRANSFORMATION COMPLETE');
  console.log('='.repeat(50));
  console.log(`Total files:     ${files.length}`);
  console.log(`Processed:       ${processed}`);
  console.log(`Errors:          ${errors}`);
  console.log(`Output:          ${targetDir}`);

  if (errorDetails.length > 0) {
    console.log(`\nErrors:`);
    for (const { file, error } of errorDetails.slice(0, 10)) {
      console.log(`  - ${file}: ${error}`);
    }
    if (errorDetails.length > 10) {
      console.log(`  ... and ${errorDetails.length - 10} more`);
    }
  }

  // Verify a sample
  console.log(`\n${'='.repeat(50)}`);
  console.log('SAMPLE VERIFICATION');
  console.log('='.repeat(50));

  const sampleFiles = files.slice(0, 3);
  for (const file of sampleFiles) {
    const targetPath = path.join(targetDir, file);
    if (fs.existsSync(targetPath)) {
      const clean: CleanClassification = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));
      console.log(`\n${file}:`);
      console.log(`  teaching_id:    ${clean.teaching_id}`);
      console.log(`  confidence:     ${clean.confidence}`);
      console.log(`  topic_set:      [${clean.topic_set.join(', ')}]`);
      console.log(`  issue_type_set: [${clean.issue_type_set.join(', ')}]`);
    }
  }

  // Validate structure of all files
  console.log(`\n${'='.repeat(50)}`);
  console.log('STRUCTURE VALIDATION');
  console.log('='.repeat(50));

  let validCount = 0;
  let invalidCount = 0;
  const invalidFiles: string[] = [];

  for (const file of files) {
    const targetPath = path.join(targetDir, file);
    if (fs.existsSync(targetPath)) {
      try {
        const clean: CleanClassification = JSON.parse(fs.readFileSync(targetPath, 'utf-8'));

        const isValid =
          typeof clean.teaching_id === 'string' &&
          typeof clean.confidence === 'number' &&
          Array.isArray(clean.topic_set) &&
          Array.isArray(clean.issue_type_set) &&
          Object.keys(clean).length === 4;

        if (isValid) {
          validCount++;
        } else {
          invalidCount++;
          invalidFiles.push(file);
        }
      } catch {
        invalidCount++;
        invalidFiles.push(file);
      }
    }
  }

  console.log(`Valid files:   ${validCount}`);
  console.log(`Invalid files: ${invalidCount}`);

  if (invalidFiles.length > 0) {
    console.log(`\nInvalid files:`);
    for (const file of invalidFiles.slice(0, 10)) {
      console.log(`  - ${file}`);
    }
  }

  console.log(`\n✅ Done!\n`);
}

main();
