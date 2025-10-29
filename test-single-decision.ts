/**
 * Test single decision extraction for range handling verification
 */

import { DatabaseConfig } from './src/config/database.js';
import { OpenAIConcurrentClient } from './src/concurrent/OpenAIConcurrentClient.js';
import { executeTwoStageExtraction } from './src/jobs/extract-provisions-2a/two-stage-executor.js';

async function testSingleDecision() {
  const decisionId = 'ECLI:BE:COHSAV:2007:ARR.20070619.8';
  const language = 'NL';

  console.log(`\n🧪 Testing extraction for: ${decisionId} (${language})\n`);

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

  // Create OpenAI client
  const client = new OpenAIConcurrentClient({
    provider: 'openai',
    model: 'gpt-5-mini',
    maxCompletionTokens: 128000,
  });

  console.log('🚀 Running Stage 1: Agentic Snippet Creation...\n');

  // Import stage 1 prompt and run it manually to see snippets
  const { STAGE_1_AGENTIC_SNIPPETS_PROMPT } = await import('./src/jobs/extract-provisions-2a/stage1-prompt.js');
  const { AzureConfig } = await import('./src/config/azure.js');

  const stage1Prompt = STAGE_1_AGENTIC_SNIPPETS_PROMPT
    .replaceAll("{decisionId}", row.decision_id || "")
    .replaceAll("{proceduralLanguage}", row.language_metadata || "FR")
    .replaceAll("{fullText.markdown}", row.full_md || "");

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

  console.log('✅ Stage 1 complete\n');
  console.log('📋 STAGE 1 SNIPPETS:\n');
  console.log('='.repeat(80));
  console.log(snippets);
  console.log('='.repeat(80));
  console.log('\n');

  console.log('🚀 Running Stage 2: Parsing snippets into JSON...\n');

  const startTime = Date.now();
  const result = await executeTwoStageExtraction(row, client);
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`✅ Extraction completed in ${duration}s\n`);

  // Display results
  console.log(`📊 Results:\n`);
  console.log(`Total provisions extracted: ${result.citedProvisions.length}\n`);

  if (result.citedProvisions.length > 0) {
    console.log('📝 Provisions:\n');

    // Group by parent act
    const byParentAct = new Map<number, any[]>();
    for (const prov of result.citedProvisions) {
      const seq = prov.parentActSequence;
      if (!byParentAct.has(seq)) {
        byParentAct.set(seq, []);
      }
      byParentAct.get(seq)!.push(prov);
    }

    // Display by parent act
    for (const [seq, provisions] of byParentAct.entries()) {
      const first = provisions[0];
      console.log(`\n📚 Parent Act ${seq}: ${first.parentActName}`);
      console.log(`   Type: ${first.parentActType}`);
      console.log(`   Date: ${first.parentActDate || 'null'}`);
      console.log(`   Provisions (${provisions.length}):`);

      for (const prov of provisions) {
        console.log(`     - ${prov.provisionNumber} [key: ${prov.provisionNumberKey}]`);
      }
    }

    // Check for potential range issues
    console.log('\n\n🔍 Range Analysis:\n');

    // Look for sequential provision numbers (potential over-expansion)
    for (const [seq, provisions] of byParentAct.entries()) {
      const keys = provisions.map(p => p.provisionNumberKey);

      // Check for numeric sequences
      const numericKeys = keys.filter(k => /^\d+$/.test(k)).map(k => parseInt(k, 10)).sort((a, b) => a - b);

      if (numericKeys.length >= 3) {
        // Check for consecutive sequences
        for (let i = 0; i < numericKeys.length - 2; i++) {
          if (numericKeys[i + 1] === numericKeys[i] + 1 &&
              numericKeys[i + 2] === numericKeys[i] + 2) {
            console.log(`⚠️  WARNING: Found consecutive sequence in Parent Act ${seq}:`);
            console.log(`   Articles: ${numericKeys.slice(i, i + 3).join(', ')}`);
            console.log(`   This might indicate range over-expansion!`);
            console.log(`   Expected: Only start and end of ranges\n`);
            break;
          }
        }
      }
    }
  } else {
    console.log('❌ No provisions extracted (empty result)');
  }

  // Output full JSON for inspection
  console.log('\n\n📄 Full JSON Output:\n');
  console.log(JSON.stringify(result, null, 2));

  await DatabaseConfig.close();
}

testSingleDecision().catch((error) => {
  console.error('❌ Error:', error);
  DatabaseConfig.close();
  process.exit(1);
});
