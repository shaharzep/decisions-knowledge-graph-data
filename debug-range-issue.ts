/**
 * Debug Script: Range Over-Expansion Investigation
 *
 * Tests a specific decision with range over-expansion issue to determine:
 * 1. What Stage 1 outputs (are intermediate articles in snippets?)
 * 2. What the source text actually contains (individual mentions vs range only?)
 * 3. Whether extraction is correct or truly over-expanding
 */

import { DatabaseConfig } from './src/config/database.js';
import { AzureConfig } from './src/config/azure.js';
import { STAGE_1_AGENTIC_SNIPPETS_PROMPT } from './src/jobs/extract-provisions-2a/stage1-prompt.js';

async function debugRangeIssue() {
  // Test the specific failing case: "artikelen 28 tot 41" with intermediate articles
  // Use command line args if provided, otherwise use default failing case
  const decisionId = process.argv[2] || 'ECLI:BE:AHGNT:2009:ARR.20090911.6';
  const language = process.argv[3] || 'NL';

  console.log(`\n🔍 DEBUGGING RANGE OVER-EXPANSION ISSUE\n`);
  console.log(`Decision: ${decisionId}`);
  console.log(`Language: ${language}\n`);
  console.log('='.repeat(80));

  // Load decision from database
  const query = `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      dm.full_md
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    WHERE d.decision_id = $1
      AND d.language_metadata = $2
    LIMIT 1
  `;

  const rows = await DatabaseConfig.executeReadOnlyQuery(query, [decisionId, language]);

  if (rows.length === 0) {
    console.error('❌ Decision not found in database');
    await DatabaseConfig.close();
    process.exit(1);
  }

  const row = rows[0];
  const sourceText = row.full_md || '';

  console.log(`\n📄 SOURCE TEXT ANALYSIS\n`);
  console.log(`Text length: ${sourceText.length} chars\n`);

  // STEP 1: Search for range citations in source
  console.log('🔎 STEP 1: Searching for RANGE citations\n');

  const rangePatterns = [
    /artikelen?\s+(\d+(?:bis|ter|quater)?)\s+(?:tot|tot en met|t\.e\.m\.|t\/m)\s+(\d+(?:bis|ter|quater)?)/gi,
    /articles?\s+(\d+(?:bis|ter|quater)?)\s+(?:à|au|jusqu'à)\s+(\d+(?:bis|ter|quater)?)/gi,
  ];

  const foundRanges: string[] = [];
  for (const pattern of rangePatterns) {
    const matches = sourceText.matchAll(pattern);
    for (const match of matches) {
      foundRanges.push(match[0]);
      console.log(`   Found range: "${match[0]}"`);
      console.log(`   Start: ${match[1]}, End: ${match[2]}\n`);
    }
  }

  if (foundRanges.length === 0) {
    console.log('   ⚠️  No range citations found\n');
  }

  // STEP 2: Search for individual article mentions (potential intermediate articles)
  console.log('🔎 STEP 2: Searching for INDIVIDUAL article mentions\n');

  // Look for specific articles that might be intermediate in ranges
  const intermediateArticles = ['28', '30', '31', '31bis', '32', '33', '33bis', '34ter', '41'];

  for (const article of intermediateArticles) {
    const pattern = new RegExp(`artikel\\s+${article}\\b(?!\\s+(?:tot|tot en met))`, 'gi');
    const matches = sourceText.matchAll(pattern);
    let count = 0;
    const contexts: string[] = [];

    for (const match of matches) {
      count++;
      if (count <= 3) { // Show first 3 contexts
        const start = Math.max(0, match.index! - 50);
        const end = Math.min(sourceText.length, match.index! + match[0].length + 100);
        contexts.push(sourceText.substring(start, end).replace(/\n/g, ' '));
      }
    }

    if (count > 0) {
      console.log(`   artikel ${article}: ${count} mention(s)`);
      contexts.forEach((ctx, i) => {
        console.log(`      [${i + 1}] ...${ctx}...`);
      });
      console.log('');
    }
  }

  // STEP 3: Run Stage 1 to see what snippets it creates
  console.log('='.repeat(80));
  console.log('\n🚀 STEP 3: Running Stage 1 to see generated snippets\n');

  const stage1Prompt = STAGE_1_AGENTIC_SNIPPETS_PROMPT
    .replaceAll("{decisionId}", row.decision_id || "")
    .replaceAll("{proceduralLanguage}", row.language_metadata || "NL")
    .replaceAll("{fullText.markdown}", sourceText);

  const openaiClient = AzureConfig.getClient();
  const deployment = AzureConfig.getDeployment();

  const stage1Response = await openaiClient.responses.create({
    model: deployment,
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: stage1Prompt,
          },
        ],
      },
    ],
    reasoning: {
      effort: "medium",
    },
  });

  let snippets = "";
  if (stage1Response.output_text) {
    snippets = stage1Response.output_text;
  } else if (Array.isArray(stage1Response.output)) {
    const pieces: string[] = [];
    for (const item of stage1Response.output) {
      if ('content' in item && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" && typeof c.text === "string") {
            pieces.push(c.text);
          }
        }
      }
    }
    snippets = pieces.join("");
  }

  // STEP 4: Analyze Stage 1 snippets
  console.log('📋 STAGE 1 SNIPPETS OUTPUT:\n');
  console.log('='.repeat(80));
  console.log(snippets);
  console.log('='.repeat(80));

  console.log('\n🔍 STEP 4: Analyzing snippets for range handling\n');

  // Count snippets
  const snippetLines = snippets.split('\n').filter(line => line.startsWith('SNIPPET'));
  console.log(`Total snippets: ${snippetLines.length}\n`);

  // Look for range markers
  const rangeSnippets = snippetLines.filter(line => line.includes('[RANGE]'));
  console.log(`Snippets with [RANGE] marker: ${rangeSnippets.length}`);
  rangeSnippets.forEach(snippet => {
    console.log(`   ${snippet.substring(0, 150)}...`);
  });
  console.log('');

  // Look for snippets containing intermediate articles
  console.log('Snippets containing intermediate articles (28-41):');
  for (const article of intermediateArticles) {
    const matching = snippetLines.filter(line => {
      const regex = new RegExp(`artikel\\s+${article}\\b`, 'i');
      return regex.test(line);
    });
    if (matching.length > 0) {
      console.log(`\n   artikel ${article}: ${matching.length} snippet(s)`);
      matching.forEach((snippet, i) => {
        // Check if it's from a range or individual mention
        const hasRange = snippet.includes('[RANGE]');
        const type = hasRange ? '[FROM RANGE]' : '[INDIVIDUAL]';
        console.log(`      ${type} ${snippet.substring(0, 150)}...`);
      });
    }
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n📊 DIAGNOSIS:\n');

  console.log('KEY QUESTIONS:');
  console.log('1. Does source contain "artikelen 28 tot 41"?');
  console.log('   → Check STEP 1 output above\n');

  console.log('2. Are intermediate articles (31, 31bis, 32, 33, 33bis, etc.) mentioned SEPARATELY in source?');
  console.log('   → Check STEP 2 output above\n');

  console.log('3. Did Stage 1 create separate snippets for intermediate articles?');
  console.log('   → Check STEP 4 output above\n');

  console.log('HYPOTHESIS:');
  console.log('If intermediate articles are mentioned SEPARATELY (not just in range),');
  console.log('then Stage 1 correctly creates snippets for them.');
  console.log('Stage 2 correctly parses all snippets.');
  console.log('Judge incorrectly flags this as "range over-expansion".');
  console.log('→ BUG IS IN JUDGE PROMPT (needs to check for individual mentions)\n');

  console.log('If intermediate articles are NOT mentioned separately,');
  console.log('and Stage 1 still creates snippets for them,');
  console.log('→ BUG IS IN STAGE 1 (incorrectly expanding ranges)\n');

  await DatabaseConfig.close();
}

debugRangeIssue().catch((error) => {
  console.error('❌ Error:', error);
  DatabaseConfig.close();
  process.exit(1);
});
