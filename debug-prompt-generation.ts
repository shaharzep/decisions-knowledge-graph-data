/**
 * Debug: Check what prompt is being generated for the problem decision
 */

import { DatabaseConfig } from './src/config/database.js';
import { extractProvisionContexts } from './src/utils/provisionContextExtractor.js';
import { PROVISIONS_2A_PROMPT } from './src/jobs/extract-provisions-2a/prompt.js';

async function debugPromptGeneration() {
  console.log('='.repeat(80));
  console.log('DEBUGGING PROMPT GENERATION');
  console.log('='.repeat(80));
  console.log();

  try {
    // Get the decision
    const query = `
      SELECT
        d.decision_id,
        d.language_metadata,
        dm.full_md
      FROM decisions1 d
      INNER JOIN decisions_md dm
        ON dm.decision_id = d.decision_id
        AND dm.language = d.language_metadata
      WHERE d.decision_id = $1
        AND d.language_metadata = $2
    `;

    const rows = await DatabaseConfig.executeReadOnlyQuery(query, [
      'ECLI:BE:COPRIV:2012:ARR.20120513.1',
      'FR'
    ]);

    const row = rows[0];

    // Step 1: Extract provision contexts (simulating preprocessRow)
    console.log('Step 1: Extracting provision contexts...');
    const provisionContexts = await extractProvisionContexts(
      row.decision_id,
      row.full_md
    );
    console.log(`✅ Found ${provisionContexts.total_provision_mentions} mentions`);
    console.log();

    // Step 2: Create the enriched row (simulating what preprocessRow does)
    const enrichedRow = {
      ...row,
      provision_contexts: provisionContexts
    };

    // Step 3: Generate the prompt (simulating promptTemplate)
    console.log('Step 2: Generating prompt template...');
    const contextsJson = JSON.stringify(enrichedRow.provision_contexts, null, 2);

    const finalPrompt = PROVISIONS_2A_PROMPT
      .replace("{decisionId}", enrichedRow.decision_id || "")
      .replace("{proceduralLanguage}", enrichedRow.language_metadata || "FR")
      .replace("{provisionContextsJson}", contextsJson);

    console.log('='.repeat(80));
    console.log('GENERATED PROMPT (first 2000 chars):');
    console.log('='.repeat(80));
    console.log(finalPrompt.substring(0, 2000));
    console.log();
    console.log('[... truncated ...]');
    console.log();
    console.log('='.repeat(80));
    console.log('PROMPT CONTAINS CONTEXTS CHECK:');
    console.log('='.repeat(80));

    // Check if contexts are actually in the prompt
    const hasDecisionId = finalPrompt.includes('ECLI:BE:COPRIV:2012:ARR.20120513.1');
    const hasContextsArray = finalPrompt.includes('"contexts"');
    const hasProvisionMarker = finalPrompt.includes('**[PROVISION:');
    const hasArticle29 = finalPrompt.includes('article]** 29');

    console.log(`✓ Contains decision ID: ${hasDecisionId}`);
    console.log(`✓ Contains contexts array: ${hasContextsArray}`);
    console.log(`✓ Contains provision markers: ${hasProvisionMarker}`);
    console.log(`✓ Contains sample (article 29): ${hasArticle29}`);
    console.log();

    // Check prompt length
    const promptLength = finalPrompt.length;
    const estimatedTokens = Math.ceil(promptLength / 4);
    console.log(`Prompt length: ${promptLength.toLocaleString()} chars (~${estimatedTokens.toLocaleString()} tokens)`);
    console.log();

    // Save full prompt to file for inspection
    const fs = await import('fs');
    const outputPath = '/tmp/debug-provision-prompt.txt';
    fs.writeFileSync(outputPath, finalPrompt, 'utf-8');
    console.log(`📝 Full prompt saved to: ${outputPath}`);
    console.log('   View with: cat /tmp/debug-provision-prompt.txt | less');
    console.log();

    // Check the contexts structure
    console.log('='.repeat(80));
    console.log('CONTEXTS STRUCTURE CHECK:');
    console.log('='.repeat(80));
    console.log(`Total contexts: ${provisionContexts.contexts.length}`);
    console.log();
    console.log('First 3 contexts:');
    provisionContexts.contexts.slice(0, 3).forEach((ctx, idx) => {
      console.log(`\n${idx + 1}. Snippet ${ctx.snippet_id}:`);
      console.log(`   Matched: "${ctx.matched_text}"`);
      console.log(`   Text: ${ctx.context_text.substring(0, 80)}...`);
    });
    console.log();

    // Check if placeholder was actually replaced
    console.log('='.repeat(80));
    console.log('PLACEHOLDER REPLACEMENT CHECK:');
    console.log('='.repeat(80));
    const hasUnreplacedPlaceholder = finalPrompt.includes('{provisionContextsJson}');
    console.log(`✗ Unreplaced {provisionContextsJson}: ${hasUnreplacedPlaceholder}`);

    if (hasUnreplacedPlaceholder) {
      console.log('⚠️  WARNING: Placeholder was not replaced!');
      console.log('   This means the contexts are NOT in the prompt.');
    } else {
      console.log('✓ Placeholder was replaced correctly');
    }
    console.log();

  } catch (error) {
    console.error('❌ Debug failed:', error);
    process.exit(1);
  } finally {
    await DatabaseConfig.close();
  }
}

debugPromptGeneration();
