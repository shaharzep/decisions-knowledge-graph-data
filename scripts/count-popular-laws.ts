/**
 * Count how many provisions in decision_cited_provisions match popular laws
 * and show UNMAPPED laws that could be added
 */

import { DatabaseConfig } from '../src/config/database.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  // Load popular laws JSON
  const popularLawsPath = join(__dirname, '../src/jobs/map-provisions-no-date/popular-laws.json');
  const popularLaws: Record<string, string> = JSON.parse(readFileSync(popularLawsPath, 'utf-8'));

  // Get all law name variations (keys), lowercase for case-insensitive matching
  const lawNamesSet = new Set(Object.keys(popularLaws).map(name => name.toLowerCase().trim()));

  console.log(`\n📊 Finding UNMAPPED popular laws in decision_cited_provisions\n`);
  console.log(`Currently mapped law name variations: ${lawNamesSet.size}`);
  console.log(`Unique document numbers mapped: ${new Set(Object.values(popularLaws)).size}\n`);

  // Query: Get top 500 law names by count (with count > 1)
  const top500Query = `
    SELECT parent_act_name, parent_act_type, COUNT(*) AS occurrences
    FROM decision_cited_provisions
    WHERE parent_act_name IS NOT NULL
      AND parent_act_date IS NULL
      AND parent_act_type <> 'CODE'
      AND parent_act_type <> 'WETBOEK'
      AND parent_act_type <> 'GRONDWET'
      AND parent_act_type <> 'CONSTITUTION'
      AND parent_act_type NOT LIKE 'EU%'
      AND parent_act_type NOT LIKE '%_UE'
    GROUP BY parent_act_name, parent_act_type
    HAVING COUNT(*) > 1
    ORDER BY occurrences DESC
    LIMIT 500
  `;

  // Query: Total sum of top 500
  const totalTop500Query = `
    SELECT SUM(occurrences) AS total_occurrences_top_500
    FROM (
      SELECT parent_act_name, parent_act_type, COUNT(*) AS occurrences
      FROM decision_cited_provisions
      WHERE parent_act_name IS NOT NULL
        AND parent_act_date IS NULL
        AND parent_act_type <> 'CODE'
        AND parent_act_type <> 'WETBOEK'
        AND parent_act_type <> 'GRONDWET'
        AND parent_act_type <> 'CONSTITUTION'
        AND parent_act_type NOT LIKE 'EU%'
        AND parent_act_type NOT LIKE '%_UE'
      GROUP BY parent_act_name, parent_act_type
      HAVING COUNT(*) > 1
      ORDER BY occurrences DESC
      LIMIT 500
    ) AS top500
  `;

  try {
    const top500 = await DatabaseConfig.executeReadOnlyQuery(top500Query, []);
    const [totalTop500Result] = await DatabaseConfig.executeReadOnlyQuery(totalTop500Query, []);
    const totalTop500 = parseInt(totalTop500Result.total_occurrences_top_500, 10);

    // Separate into mapped and unmapped
    const mapped: any[] = [];
    const unmapped: any[] = [];

    for (const row of top500) {
      const normalized = row.parent_act_name.toLowerCase().trim();
      if (lawNamesSet.has(normalized)) {
        mapped.push(row);
      } else {
        unmapped.push(row);
      }
    }

    const mappedCount = mapped.reduce((sum, r) => sum + parseInt(r.occurrences, 10), 0);
    const unmappedCount = unmapped.reduce((sum, r) => sum + parseInt(r.occurrences, 10), 0);

    console.log(`═══════════════════════════════════════════════════════════`);
    console.log(`SUMMARY (Top 500 laws with count > 1)`);
    console.log(`═══════════════════════════════════════════════════════════`);
    console.log(`Total provisions in top 500:     ${totalTop500.toLocaleString()}`);
    console.log(`Already mapped:                  ${mappedCount.toLocaleString()} (${mapped.length} law names)`);
    console.log(`NOT YET MAPPED:                  ${unmappedCount.toLocaleString()} (${unmapped.length} law names)`);
    console.log(`Current coverage of top 500:     ${((mappedCount / totalTop500) * 100).toFixed(2)}%`);
    console.log(`═══════════════════════════════════════════════════════════\n`);

    console.log(`UNMAPPED LAWS (sorted by count) - Add these to popular-laws.json:\n`);
    console.log(`${'#'.padStart(4)} | ${'Count'.padStart(6)} | ${'Type'.padEnd(20)} | Law Name`);
    console.log(`${'─'.repeat(4)} | ${'─'.repeat(6)} | ${'─'.repeat(20)} | ${'─'.repeat(80)}`);

    for (let i = 0; i < unmapped.length; i++) {
      const row = unmapped[i];
      const name = row.parent_act_name.length > 80
        ? row.parent_act_name.substring(0, 77) + '...'
        : row.parent_act_name;
      console.log(`${String(i + 1).padStart(4)} | ${String(row.occurrences).padStart(6)} | ${row.parent_act_type.padEnd(20)} | ${name}`);
    }

    // Output as JSON for easy copy-paste
    console.log(`\n\n═══════════════════════════════════════════════════════════`);
    console.log(`JSON FORMAT (copy-paste ready) - Top 50 unmapped:`);
    console.log(`═══════════════════════════════════════════════════════════\n`);

    for (const row of unmapped.slice(0, 50)) {
      // Escape quotes in the name
      const escapedName = row.parent_act_name.replace(/"/g, '\\"');
      console.log(`  "${escapedName}": "DOCUMENT_NUMBER_HERE",`);
    }

  } catch (error) {
    console.error('Query failed:', error);
  } finally {
    await DatabaseConfig.close();
  }
}

main();
