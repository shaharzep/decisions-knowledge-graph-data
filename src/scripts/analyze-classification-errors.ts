/**
 * Analyze Classification Errors
 *
 * Scans classify-legal-issues full-data output for:
 * 1. B codes leaked into topic_set (should only be in issue_type_set)
 * 2. Invalid/hallucinated topic codes
 * 3. Parent nodes used instead of leaf nodes
 */

import fs from 'fs';
import path from 'path';

// Valid ULIT v2.5.0 Topic codes (TREE A)
const VALID_TOPICS = new Set([
  // A0
  'A0.1', 'A0.2', 'A0.3', 'A0.4',
  // A1
  'A1.1', 'A1.2', 'A1.3', 'A1.4', 'A1.5',
  // A2
  'A2.1', 'A2.2', 'A2.3', 'A2.4', 'A2.5',
  // A3
  'A3.1', 'A3.2', 'A3.3', 'A3.4', 'A3.5', 'A3.6', 'A3.7',
  // A4
  'A4.1', 'A4.2', 'A4.3', 'A4.4', 'A4.5', 'A4.6', 'A4.7',
  'A4.8.1', 'A4.8.2.1', 'A4.8.2.2', 'A4.8.2.3', 'A4.8.2.4',
  'A4.8.3.1', 'A4.8.3.2.1', 'A4.8.3.2.2', 'A4.8.3.2.3', 'A4.8.3.2.4',
  'A4.8.3.3', 'A4.8.3.4', 'A4.8.4', 'A4.8.5', 'A4.8.6', 'A4.8.7', 'A4.8.8',
  // A5
  'A5.1', 'A5.2', 'A5.3', 'A5.4', 'A5.5', 'A5.6', 'A5.7',
  // A6
  'A6.1', 'A6.2', 'A6.3', 'A6.4', 'A6.5', 'A6.6', 'A6.7', 'A6.8', 'A6.9',
  // A7
  'A7.1', 'A7.2', 'A7.3', 'A7.4', 'A7.5', 'A7.6', 'A7.7',
  // A8
  'A8.1', 'A8.2', 'A8.3', 'A8.4', 'A8.5',
  // A9
  'A9.1', 'A9.2', 'A9.3', 'A9.4', 'A9.5', 'A9.6', 'A9.7', 'A9.8',
  // A10
  'A10.1', 'A10.2', 'A10.3',
  // A11
  'A11.1', 'A11.2', 'A11.3', 'A11.4', 'A11.5', 'A11.6', 'A11.7', 'A11.8',
  // A12
  'A12.1', 'A12.2', 'A12.3', 'A12.4', 'A12.5', 'A12.6', 'A12.7',
  // A13.1
  'A13.1.1', 'A13.1.2', 'A13.1.3', 'A13.1.4', 'A13.1.5', 'A13.1.6', 'A13.1.7', 'A13.1.8', 'A13.1.9',
  // A13.2
  'A13.2.1', 'A13.2.2', 'A13.2.3', 'A13.2.4', 'A13.2.5', 'A13.2.6', 'A13.2.7', 'A13.2.8', 'A13.2.9', 'A13.2.10',
  // A13.3
  'A13.3.1', 'A13.3.2', 'A13.3.3', 'A13.3.4', 'A13.3.5', 'A13.3.6', 'A13.3.7',
  // A13.4
  'A13.4.1', 'A13.4.2', 'A13.4.3', 'A13.4.4',
  // A13.5
  'A13.5.1', 'A13.5.2', 'A13.5.3', 'A13.5.4',
  // A13.6
  'A13.6.1', 'A13.6.2', 'A13.6.3', 'A13.6.4',
  // A13.7
  'A13.7.1', 'A13.7.2', 'A13.7.3', 'A13.7.4',
  // A13.8
  'A13.8.1', 'A13.8.2', 'A13.8.3', 'A13.8.4', 'A13.8.5',
  // A13.9
  'A13.9.1.1', 'A13.9.1.2', 'A13.9.1.3', 'A13.9.1.4',
  'A13.9.2.1', 'A13.9.2.2', 'A13.9.2.3', 'A13.9.2.4', 'A13.9.2.5',
  'A13.9.3.1', 'A13.9.3.2', 'A13.9.3.3',
  'A13.9.4.1', 'A13.9.4.2', 'A13.9.4.3',
  'A13.9.5.1', 'A13.9.5.2', 'A13.9.5.3',
  // A13.10, A13.11
  'A13.10', 'A13.11',
  // A14
  'A14.1', 'A14.2', 'A14.3', 'A14.4', 'A14.5',
  // A15
  'A15.1', 'A15.2', 'A15.3', 'A15.4', 'A15.5', 'A15.6', 'A15.7', 'A15.8', 'A15.9', 'A15.10',
  // A16
  'A16.1', 'A16.2', 'A16.3', 'A16.4', 'A16.5', 'A16.6', 'A16.7',
  // A17
  'A17.1', 'A17.2', 'A17.3', 'A17.4', 'A17.5',
  // A18
  'A18.1', 'A18.2', 'A18.3', 'A18.4', 'A18.5', 'A18.6', 'A18.7',
]);

// Valid ULIT v2.5.0 Issue Type codes (TREE B)
const VALID_ISSUE_TYPES = new Set([
  'B0', 'B1', 'B2', 'B3', 'B4', 'B5',
  'B6', 'B7', 'B8', 'B9',
  'B10', 'B11',
  'B12', 'B13', 'B14', 'B15', 'B16',
  'B17', 'B18', 'B19',
  'B20', 'B20.1', 'B20.2', 'B20.3', 'B20.4',
  'B21', 'B22', 'B23', 'B24',
]);

// Parent nodes that shouldn't be used (should use leaf nodes instead)
const PARENT_NODES = new Set([
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9',
  'A10', 'A11', 'A12', 'A13', 'A14', 'A15', 'A16', 'A17', 'A18',
  'A4.8', 'A4.8.2', 'A4.8.3', 'A4.8.3.2',
  'A13.1', 'A13.2', 'A13.3', 'A13.4', 'A13.5', 'A13.6', 'A13.7', 'A13.8', 'A13.9',
  'A13.9.1', 'A13.9.2', 'A13.9.3', 'A13.9.4', 'A13.9.5',
]);

// @ts-expect-error unused but kept for future use
function getLatestFullDataTimestamp(jobId: string): string | null {
  const resultsDir = path.join(process.cwd(), 'full-data', jobId);
  if (!fs.existsSync(resultsDir)) return null;

  const timestamps = fs.readdirSync(resultsDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/.test(name))
    .sort()
    .reverse();

  return timestamps[0] || null;
}

interface ErrorRecord {
  teachingId: string;
  errorType: 'B_IN_TOPICS' | 'INVALID_TOPIC' | 'PARENT_NODE' | 'A_IN_ISSUES' | 'INVALID_ISSUE';
  code: string;
  field: 'topic_set' | 'issue_type_set';
}

async function analyzeClassificationErrors() {
  // Allow specifying directory via command line arg, default to jsons-clean
  let jsonsDir = process.argv[2];

  if (!jsonsDir) {
    // Default to jsons-clean directory
    jsonsDir = path.join(process.cwd(), 'full-data', 'classify-legal-issues', 'jsons-clean');
  }

  if (!fs.existsSync(jsonsDir)) {
    console.error(`JSONs directory not found: ${jsonsDir}`);
    process.exit(1);
  }

  console.log(`\n📋 Analyzing classifications in: ${jsonsDir}\n`);

  const jsonFiles = fs.readdirSync(jsonsDir).filter(f => f.endsWith('.json'));
  console.log(`Found ${jsonFiles.length} classification files to analyze\n`);

  const errors: ErrorRecord[] = [];
  const errorsByType: Record<string, number> = {
    'B_IN_TOPICS': 0,
    'INVALID_TOPIC': 0,
    'PARENT_NODE': 0,
    'A_IN_ISSUES': 0,
    'INVALID_ISSUE': 0,
  };
  const invalidCodes: Record<string, number> = {};

  let totalFiles = 0;
  let filesWithErrors = 0;

  for (const filename of jsonFiles) {
    const filepath = path.join(jsonsDir, filename);
    try {
      const data = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      totalFiles++;

      const teachingId = data.teaching_id || filename.replace('.json', '');
      // Support both formats: uncleaned (nested) and clean (root level)
      const topicSet: string[] = data.classification?.topic_set || data.topic_set || [];
      const issueTypeSet: string[] = data.classification?.issue_type_set || data.issue_type_set || [];

      let hasError = false;

      // Check topic_set for errors
      for (const topic of topicSet) {
        // Check for B codes in topic_set
        if (topic.startsWith('B')) {
          errors.push({ teachingId, errorType: 'B_IN_TOPICS', code: topic, field: 'topic_set' });
          errorsByType['B_IN_TOPICS']++;
          invalidCodes[topic] = (invalidCodes[topic] || 0) + 1;
          hasError = true;
        }
        // Check for parent nodes
        else if (PARENT_NODES.has(topic)) {
          errors.push({ teachingId, errorType: 'PARENT_NODE', code: topic, field: 'topic_set' });
          errorsByType['PARENT_NODE']++;
          invalidCodes[topic] = (invalidCodes[topic] || 0) + 1;
          hasError = true;
        }
        // Check for invalid/hallucinated codes
        else if (!VALID_TOPICS.has(topic)) {
          errors.push({ teachingId, errorType: 'INVALID_TOPIC', code: topic, field: 'topic_set' });
          errorsByType['INVALID_TOPIC']++;
          invalidCodes[topic] = (invalidCodes[topic] || 0) + 1;
          hasError = true;
        }
      }

      // Check issue_type_set for errors
      for (const issueType of issueTypeSet) {
        // Check for A codes in issue_type_set
        if (issueType.startsWith('A')) {
          errors.push({ teachingId, errorType: 'A_IN_ISSUES', code: issueType, field: 'issue_type_set' });
          errorsByType['A_IN_ISSUES']++;
          invalidCodes[issueType] = (invalidCodes[issueType] || 0) + 1;
          hasError = true;
        }
        // Check for invalid issue types
        else if (!VALID_ISSUE_TYPES.has(issueType)) {
          errors.push({ teachingId, errorType: 'INVALID_ISSUE', code: issueType, field: 'issue_type_set' });
          errorsByType['INVALID_ISSUE']++;
          invalidCodes[issueType] = (invalidCodes[issueType] || 0) + 1;
          hasError = true;
        }
      }

      if (hasError) filesWithErrors++;
    } catch (error) {
      console.warn(`Failed to read ${filename}: ${error}`);
    }
  }

  // Print summary
  console.log('=' .repeat(80));
  console.log('CLASSIFICATION ERROR ANALYSIS');
  console.log('=' .repeat(80));
  console.log(`\nTotal files analyzed: ${totalFiles}`);
  console.log(`Files with errors: ${filesWithErrors} (${(filesWithErrors / totalFiles * 100).toFixed(2)}%)`);
  console.log(`Total errors: ${errors.length}`);

  console.log('\n--- Errors by Type ---');
  console.log(`B codes in topic_set:     ${errorsByType['B_IN_TOPICS']}`);
  console.log(`Invalid/hallucinated A:   ${errorsByType['INVALID_TOPIC']}`);
  console.log(`Parent nodes used:        ${errorsByType['PARENT_NODE']}`);
  console.log(`A codes in issue_type_set:${errorsByType['A_IN_ISSUES']}`);
  console.log(`Invalid issue types:      ${errorsByType['INVALID_ISSUE']}`);

  console.log('\n--- Invalid Codes Distribution ---');
  const sortedCodes = Object.entries(invalidCodes)
    .sort((a, b) => b[1] - a[1]);

  for (const [code, count] of sortedCodes) {
    const errorType = code.startsWith('B') ? 'B_IN_TOPICS' :
      PARENT_NODES.has(code) ? 'PARENT' :
      code.startsWith('A') ? 'INVALID_A' : 'OTHER';
    console.log(`  ${code.padEnd(20)} ${String(count).padStart(6)}  (${errorType})`);
  }

  // Write detailed errors to file
  const outputPath = path.join(jsonsDir, '..', 'classification-errors.json');
  fs.writeFileSync(outputPath, JSON.stringify({
    directory: jsonsDir,
    summary: {
      totalFiles,
      filesWithErrors,
      totalErrors: errors.length,
      errorsByType,
    },
    invalidCodesDistribution: sortedCodes,
    errors: errors.slice(0, 1000), // First 1000 errors for reference
  }, null, 2));

  console.log(`\n📄 Detailed errors written to: ${outputPath}`);

  // List sample teaching IDs for each error type
  console.log('\n--- Sample Teaching IDs by Error Type ---');
  const samplesByType: Record<string, string[]> = {};
  for (const error of errors) {
    if (!samplesByType[error.errorType]) {
      samplesByType[error.errorType] = [];
    }
    if (samplesByType[error.errorType].length < 5) {
      samplesByType[error.errorType].push(`${error.teachingId} (${error.code})`);
    }
  }

  for (const [errorType, samples] of Object.entries(samplesByType)) {
    console.log(`\n${errorType}:`);
    for (const sample of samples) {
      console.log(`  - ${sample}`);
    }
  }
}

analyzeClassificationErrors().catch(console.error);
