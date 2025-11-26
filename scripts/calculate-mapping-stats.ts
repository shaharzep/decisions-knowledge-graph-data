
import fs from 'fs';
import path from 'path';

const RESULTS_DIR = 'concurrent/results/map-provisions-standard';

async function calculateStats() {
  try {
    // Find latest results directory
    const models = fs.readdirSync(RESULTS_DIR);
    if (models.length === 0) throw new Error('No models found');
    
    // Assume latest timestamp in first model dir for simplicity, or iterate
    const modelDir = path.join(RESULTS_DIR, models[0]);
    const timestamps = fs.readdirSync(modelDir).sort().reverse();
    if (timestamps.length === 0) throw new Error('No results found');
    
    const latestDir = path.join(modelDir, timestamps[0]);
    const resultsPath = path.join(latestDir, 'successful-results.json');
    
    console.log(`Analyzing results from: ${resultsPath}\n`);
    
    const results = JSON.parse(fs.readFileSync(resultsPath, 'utf-8'));
    
    let totalProcessed = results.length;
    let totalMatchesFound = 0;
    let scoreDistribution = {
      '90-100': 0,
      '80-89': 0,
      '70-79': 0,
      '<70': 0
    };
    let matchCounts = {
      '0': 0,
      '1': 0,
      '2': 0,
      '3': 0
    };

    for (const row of results) {
      const matches = row.matches || [];
      matchCounts[String(Math.min(matches.length, 3)) as keyof typeof matchCounts]++;
      
      if (matches.length > 0) {
        totalMatchesFound++;
        // Analyze top match score
        const score = matches[0].score;
        if (score >= 90) scoreDistribution['90-100']++;
        else if (score >= 80) scoreDistribution['80-89']++;
        else if (score >= 70) scoreDistribution['70-79']++;
        else scoreDistribution['<70']++;
      }
    }

    console.log('--- MAPPING STATISTICS ---');
    console.log(`Total Decisions Processed: ${totalProcessed}`);
    console.log(`Decisions with at least one match: ${totalMatchesFound} (${((totalMatchesFound/totalProcessed)*100).toFixed(1)}%)`);
    
    console.log('\nMatches per Decision:');
    console.log(`0 matches: ${matchCounts['0']}`);
    console.log(`1 match:   ${matchCounts['1']}`);
    console.log(`2 matches: ${matchCounts['2']}`);
    console.log(`3 matches: ${matchCounts['3']}`);

    console.log('\nTop Match Score Distribution (for decisions with matches):');
    console.log(`90-100: ${scoreDistribution['90-100']}`);
    console.log(`80-89:  ${scoreDistribution['80-89']}`);
    console.log(`70-79:  ${scoreDistribution['70-79']}`);
    console.log(`<70:    ${scoreDistribution['<70']}`);

  } catch (error) {
    console.error('Error calculating stats:', error);
  }
}

calculateStats();
