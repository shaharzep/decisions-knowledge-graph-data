/**
 * Test Script: Stage 1 Agentic Snippet Creation
 *
 * Run this to see Stage 1 output before it goes to Stage 2
 *
 * Usage:
 *   npx tsx test-stage1.ts
 */

import { AzureConfig } from './src/config/azure.js';
import { DatabaseConfig } from './src/config/database.js';
import { STAGE_1_AGENTIC_SNIPPETS_PROMPT } from './src/jobs/extract-provisions-2a/stage1-prompt.js';

async function testStage1() {
  console.log('🧪 Testing Stage 1: Agentic Snippet Creation\n');

  // Test query: Get one decision
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
    WHERE d.decision_id = 'ECLI:BE:AHGNT:2009:ARR.20090911.6'
      AND d.language_metadata = 'NL'
    LIMIT 1
  `;

  console.log('📊 Loading test decision from database...');
  const rows = await DatabaseConfig.executeReadOnlyQuery(query, []);

  if (rows.length === 0) {
    console.error('❌ No decision found');
    process.exit(1);
  }

  const row = rows[0];
  console.log(`✅ Loaded: ${row.decision_id} (${row.language_metadata})`);
  console.log(`   Text length: ${row.full_md?.length || 0} chars\n`);

  // Fill Stage 1 prompt (use replaceAll for multiple occurrences)
  const prompt = STAGE_1_AGENTIC_SNIPPETS_PROMPT
    .replaceAll('{decisionId}', row.decision_id || '')
    .replaceAll('{proceduralLanguage}', row.language_metadata || 'FR')
    .replaceAll('{fullText.markdown}', row.full_md || '');

  // Test with MEDIUM reasoning (can change to 'low' or 'high' to compare)
  const reasoningEffort = 'medium';
  console.log(`🚀 Calling OpenAI Stage 1 (gpt-5-mini ${reasoningEffort.toUpperCase()} reasoning)...\n`);

  const openaiClient = AzureConfig.getClient();
  const deployment = AzureConfig.getDeployment();

  const startTime = Date.now();
  const response = await openaiClient.responses.create({
    model: deployment,
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: prompt,
          },
        ],
      },
    ],
    reasoning: {
      effort: reasoningEffort as 'low' | 'medium' | 'high',
    },
  });
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(1);
  console.log(`⏱️  Stage 1 completed in ${duration}s\n`);

  // Extract output
  let output = '';
  if (response.output_text) {
    output = response.output_text;
  } else if (Array.isArray(response.output)) {
    const pieces: string[] = [];
    for (const item of response.output) {
      if ('content' in item && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === 'output_text' && typeof c.text === 'string') {
            pieces.push(c.text);
          }
        }
      }
    }
    output = pieces.join('');
  }

  console.log('📝 STAGE 1 OUTPUT:\n');
  console.log('='.repeat(80));
  console.log(output);
  console.log('='.repeat(80));

  // Count snippets
  const snippetMatches = output.match(/SNIPPET \d+:/g);
  const count = snippetMatches ? snippetMatches.length : 0;
  console.log(`\n✅ Stage 1 created ${count} snippets`);

  // Show first 3 snippets as examples
  const lines = output.split('\n').filter(line => line.trim());
  console.log('\n📌 First 3 snippets:');
  let snippetCount = 0;
  for (const line of lines) {
    if (line.startsWith('SNIPPET')) {
      console.log(`\n${line.substring(0, 150)}${line.length > 150 ? '...' : ''}`);
      snippetCount++;
      if (snippetCount >= 3) break;
    }
  }

  await DatabaseConfig.close();
  console.log('\n✅ Test complete!');
}

testStage1().catch((error) => {
  console.error('❌ Error:', error);
  DatabaseConfig.close();
  process.exit(1);
});
