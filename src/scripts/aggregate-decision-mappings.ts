/**
 * Aggregate Decision Mappings Script
 *
 * Merges JSON results from map-cited-decisions job into a single folder
 * with simplified output containing only:
 * - internal_decision_id
 * - ecli (from top match's decision_id)
 * - score (from top match)
 *
 * Filters:
 * - Only includes matches with score >= 80
 * - Skips files with empty matches or no qualifying matches
 */

import fs from 'fs/promises';
import path from 'path';

// =============================================================================
// CONFIGURATION
// =============================================================================

const MIN_SCORE = 80;

const SOURCE_PATH = 'full-data/map-cited-decisions/2025-12-04T22-23-20-074Z/jsons';
const OUTPUT_DIR = 'full-data/decision-mappings-aggregated/jsons';

// =============================================================================
// TYPES
// =============================================================================

interface Match {
  decision_id: string;
  score: number;
  [key: string]: any;
}

interface SourceJson {
  internal_decision_id: string;
  matches?: Match[];
  [key: string]: any;
}

interface SimplifiedOutput {
  internal_decision_id: string;
  ecli: string;
  score: number;
}

interface AggregationStats {
  totalFiles: number;
  written: number;
  skippedEmpty: number;
  skippedLowScore: number;
  errors: number;
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Get the top match by score from matches array
 * Returns null if no matches or all matches below MIN_SCORE
 */
function getTopMatch(matches: Match[] | undefined): { decision_id: string; score: number } | null {
  if (!matches || matches.length === 0) {
    return null;
  }

  // Sort by score descending to ensure we get the highest
  const sorted = [...matches].sort((a, b) => (b.score || 0) - (a.score || 0));
  const top = sorted[0];

  if (!top || (top.score || 0) < MIN_SCORE) {
    return null;
  }

  return {
    decision_id: top.decision_id,
    score: top.score
  };
}

/**
 * Process a single JSON file
 * Returns: 'written' | 'skipped_empty' | 'skipped_low_score' | 'error'
 */
async function processJsonFile(
  inputPath: string,
  outputPath: string
): Promise<'written' | 'skipped_empty' | 'skipped_low_score' | 'error'> {
  try {
    const content = await fs.readFile(inputPath, 'utf-8');
    const data: SourceJson = JSON.parse(content);

    const matches = data.matches;

    // Skip if no matches array or empty
    if (!matches || matches.length === 0) {
      return 'skipped_empty';
    }

    // Get top match (sorted by score, filtered by MIN_SCORE)
    const topMatch = getTopMatch(matches);

    if (!topMatch) {
      return 'skipped_low_score';
    }

    // Build simplified output
    const output: SimplifiedOutput = {
      internal_decision_id: data.internal_decision_id,
      ecli: topMatch.decision_id,
      score: topMatch.score
    };

    // Write output file
    await fs.writeFile(outputPath, JSON.stringify(output, null, 2));

    return 'written';
  } catch (error) {
    console.error(`Error processing ${inputPath}:`, error);
    return 'error';
  }
}

/**
 * Aggregate all decision mappings from source into output directory
 */
async function aggregateDecisionMappings(): Promise<AggregationStats> {
  const stats: AggregationStats = {
    totalFiles: 0,
    written: 0,
    skippedEmpty: 0,
    skippedLowScore: 0,
    errors: 0
  };

  // Ensure output directory exists
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`\nProcessing: map-cited-decisions`);
  console.log(`  Source: ${SOURCE_PATH}`);

  try {
    const files = await fs.readdir(SOURCE_PATH);
    const jsonFiles = files.filter(f => f.endsWith('.json'));

    console.log(`  Files found: ${jsonFiles.length}`);

    let processed = 0;
    for (const file of jsonFiles) {
      const inputPath = path.join(SOURCE_PATH, file);
      const outputPath = path.join(OUTPUT_DIR, file);

      const result = await processJsonFile(inputPath, outputPath);

      stats.totalFiles++;

      switch (result) {
        case 'written':
          stats.written++;
          break;
        case 'skipped_empty':
          stats.skippedEmpty++;
          break;
        case 'skipped_low_score':
          stats.skippedLowScore++;
          break;
        case 'error':
          stats.errors++;
          break;
      }

      processed++;
      if (processed % 10000 === 0) {
        console.log(`  Progress: ${processed}/${jsonFiles.length} (${stats.written} written)`);
      }
    }

    console.log(`  Completed: ${stats.written}/${stats.totalFiles} written`);
  } catch (error) {
    console.error(`Error reading source:`, error);
  }

  return stats;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('Decision Mappings Aggregation');
  console.log('='.repeat(60));
  console.log(`Minimum score threshold: ${MIN_SCORE}`);
  console.log(`Source: ${SOURCE_PATH}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);

  const startTime = Date.now();
  const stats = await aggregateDecisionMappings();
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log(`Total files processed: ${stats.totalFiles.toLocaleString()}`);
  console.log(`Written (score >= ${MIN_SCORE}): ${stats.written.toLocaleString()}`);
  console.log(`Skipped (empty matches): ${stats.skippedEmpty.toLocaleString()}`);
  console.log(`Skipped (score < ${MIN_SCORE}): ${stats.skippedLowScore.toLocaleString()}`);
  console.log(`Errors: ${stats.errors}`);
  console.log(`Time: ${elapsed}s`);

  console.log(`\nOutput: ${OUTPUT_DIR}`);
}

main().catch(console.error);
