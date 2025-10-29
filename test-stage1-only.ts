/**
 * Test Stage 1 ONLY to see what snippets are being created
 */

import { DatabaseConfig } from './src/config/database.js';
import { AzureConfig } from './src/config/azure.js';
import { STAGE_1_AGENTIC_SNIPPETS_PROMPT } from './src/jobs/extract-provisions-2a/stage1-prompt.js';

async function testStage1Only() {
  const decisionId = 'ECLI:BE:COHSAV:2007:ARR.20070619.8';
  const language = 'NL';

  console.log(`\n🧪 Testing Stage 1 ONLY for: ${decisionId} (${language})\n`);

  // Query to get the decision
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
  console.log(`✅ Loaded decision from database`);
  console.log(`   Text length: ${row.full_md?.length || 0} chars\n`);

  // Fill Stage 1 prompt
  const stage1Prompt = STAGE_1_AGENTIC_SNIPPETS_PROMPT
    .replaceAll("{decisionId}", row.decision_id || "")
    .replaceAll("{proceduralLanguage}", row.language_metadata || "FR")
    .replaceAll("{fullText.markdown}", row.full_md || "");

  console.log('🚀 Running Stage 1 (agentic snippet creation)...\n');

  const openaiClient = AzureConfig.getClient();
  const deployment = AzureConfig.getDeployment();

  const startTime = Date.now();
  const response = await openaiClient.responses.create({
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
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`✅ Stage 1 completed in ${duration}s\n`);

  // Extract output
  let output = "";
  if (response.output_text) {
    output = response.output_text;
  } else if (Array.isArray(response.output)) {
    const pieces: string[] = [];
    for (const item of response.output) {
      if ('content' in item && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" && typeof c.text === "string") {
            pieces.push(c.text);
          }
        }
      }
    }
    output = pieces.join("");
  }

  console.log('📝 STAGE 1 OUTPUT (Agentic Snippets):\n');
  console.log('='.repeat(80));
  console.log(output);
  console.log('='.repeat(80));

  // Analyze snippets
  const snippetMatches = output.match(/SNIPPET \d+:/g);
  const count = snippetMatches ? snippetMatches.length : 0;
  console.log(`\n✅ Stage 1 created ${count} snippets\n`);

  // Check for [RANGE] markers
  const rangeMatches = output.match(/\[RANGE\]/g);
  const rangeCount = rangeMatches ? rangeMatches.length : 0;
  console.log(`🔍 Found ${rangeCount} [RANGE] markers\n`);

  if (rangeCount > 0) {
    console.log('📋 Snippets with [RANGE] markers:\n');
    const lines = output.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes('[RANGE]')) {
        // Show the full snippet (might span multiple lines)
        let snippetText = lines[i];
        // Look back to find SNIPPET N: line
        for (let j = i - 1; j >= Math.max(0, i - 5); j--) {
          if (lines[j].match(/SNIPPET \d+:/)) {
            console.log(`${lines[j]}`);
            break;
          }
        }
        console.log(`${snippetText}\n`);
      }
    }
  }

  // Check for [LIST] markers
  const listMatches = output.match(/\[LIST\]/g);
  const listCount = listMatches ? listMatches.length : 0;
  console.log(`🔍 Found ${listCount} [LIST] markers\n`);

  await DatabaseConfig.close();
}

testStage1Only().catch((error) => {
  console.error('❌ Error:', error);
  DatabaseConfig.close();
  process.exit(1);
});
