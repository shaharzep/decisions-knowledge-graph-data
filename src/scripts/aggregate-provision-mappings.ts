/**
 * Aggregate Provision Mappings Script
 *
 * Merges JSON results from 3 provision mapping jobs into a single folder
 * with simplified output containing only:
 * - internal_parent_act_id
 * - document_number (from top match by score)
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

interface SourceConfig {
  name: string;
  path: string;
}

const SOURCES: SourceConfig[] = [
  {
    name: 'map-provisions-standard',
    path: 'full-data/map-provisions-standard/new-results/jsons'
  },
  {
    name: 'map-provisions-code',
    path: 'full-data/map-provisions-code/2025-12-02T12-09-54-214Z/jsons'
  },
  {
    name: 'map-provisions-no-date',
    path: 'full-data/map-provisions-no-date/2025-12-02T21-31-52-341Z/jsons'
  }
];

const OUTPUT_DIR = 'full-data/provision-mappings-aggregated/jsons';

// =============================================================================
// TYPES
// =============================================================================

interface Match {
  document_number: string;
  score: number;
  [key: string]: any;
}

interface SourceJson {
  internal_parent_act_id: string;
  matches?: Match[];
  [key: string]: any;
}

interface SimplifiedOutput {
  internal_parent_act_id: string;
  document_number: string;
  score: number;
}

interface AggregationStats {
  totalFiles: number;
  written: number;
  skippedEmpty: number;
  skippedLowScore: number;
  errors: number;
  bySource: Record<string, { total: number; written: number }>;
}

// =============================================================================
// CORE FUNCTIONS
// =============================================================================

/**
 * Get the top match by score from matches array
 * Returns null if no matches or all matches below MIN_SCORE
 */
function getTopMatch(matches: Match[] | undefined): { document_number: string; score: number } | null {
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
    document_number: top.document_number,
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
      internal_parent_act_id: data.internal_parent_act_id,
      document_number: topMatch.document_number,
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
 * Aggregate all provision mappings from sources into output directory
 */
async function aggregateProvisionMappings(): Promise<AggregationStats> {
  const stats: AggregationStats = {
    totalFiles: 0,
    written: 0,
    skippedEmpty: 0,
    skippedLowScore: 0,
    errors: 0,
    bySource: {}
  };

  // Ensure output directory exists
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  for (const source of SOURCES) {
    console.log(`\nProcessing: ${source.name}`);
    console.log(`  Source: ${source.path}`);

    const sourceStats = { total: 0, written: 0 };

    try {
      const files = await fs.readdir(source.path);
      const jsonFiles = files.filter(f => f.endsWith('.json'));

      console.log(`  Files found: ${jsonFiles.length}`);

      let processed = 0;
      for (const file of jsonFiles) {
        const inputPath = path.join(source.path, file);
        const outputPath = path.join(OUTPUT_DIR, file);

        const result = await processJsonFile(inputPath, outputPath);

        stats.totalFiles++;
        sourceStats.total++;

        switch (result) {
          case 'written':
            stats.written++;
            sourceStats.written++;
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
          console.log(`  Progress: ${processed}/${jsonFiles.length} (${sourceStats.written} written)`);
        }
      }

      console.log(`  Completed: ${sourceStats.written}/${sourceStats.total} written`);
    } catch (error) {
      console.error(`Error reading source ${source.name}:`, error);
    }

    stats.bySource[source.name] = sourceStats;
  }

  return stats;
}

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('='.repeat(60));
  console.log('Provision Mappings Aggregation');
  console.log('='.repeat(60));
  console.log(`Minimum score threshold: ${MIN_SCORE}`);
  console.log(`Output directory: ${OUTPUT_DIR}`);

  const startTime = Date.now();
  const stats = await aggregateProvisionMappings();
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

  console.log('\nBy source:');
  for (const [name, s] of Object.entries(stats.bySource)) {
    console.log(`  ${name}: ${s.written.toLocaleString()}/${s.total.toLocaleString()} written`);
  }

  console.log(`\nOutput: ${OUTPUT_DIR}`);
}

main().catch(console.error);
