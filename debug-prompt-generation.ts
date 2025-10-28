/**
 * Debug: Check what prompt is being generated for the problem decision
 */

import { DatabaseConfig } from './src/config/database.js';
import { extractCandidateSnippets } from './src/utils/provisionSnippetExtractor.js';
import { extractAbbreviations } from './src/utils/abbreviationExtractor.js';
import { buildProvisionsPrompt } from './src/jobs/extract-provisions-2a/prompt.js';

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
    console.log('Step 1: Extracting provision snippets...');
    const snippets = extractCandidateSnippets(row.full_md, 150);
    console.log(`✅ Found ${snippets.length} snippet candidates`);
    console.log();

    // Step 2: Extract abbreviations
    console.log('Step 2: Extracting abbreviations...');
    const abbreviations = extractAbbreviations(row.decision_id, row.full_md);
    console.log(`✅ Found ${abbreviations.length} abbreviations`);
    console.log();

    // Step 3: Create the enriched row (simulating what preprocessRow does)
    const enrichedRow = {
      ...row,
      provisionSnippets: snippets,
      abbreviations,
    };

    // Step 4: Generate the prompt (simulating promptTemplate)
    console.log('Step 3: Generating prompt template...');
    const formattedSnippets = snippets.length
      ? snippets
          .map(
            (snippet, index) =>
              `[${index + 1}] char ${snippet.char_start}-${snippet.char_end}: "${snippet.snippet}"`
          )
          .join('\n')
      : '(No snippets extracted - document may contain no provision citations)';

    const abbreviationGuide = abbreviations.length
      ? abbreviations
          .map((entry) => `- ${entry.abbreviation} ➝ ${entry.fullName}`)
          .join('\n')
      : '(No explicit abbreviations detected in earlier sections)';

    const finalPrompt = buildProvisionsPrompt({
      decisionId: enrichedRow.decision_id || '',
      proceduralLanguage:
        (enrichedRow.language_metadata || 'FR').toUpperCase() === 'NL' ? 'NL' : 'FR',
      fullText: enrichedRow.full_md || '',
      provisionSnippets: formattedSnippets,
      abbreviationGuide,
      sectionGuide: '(Debug run - section guide omitted)',
    });

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
    console.log(`Total snippets: ${snippets.length}`);
    console.log();
    console.log('First 3 snippets:');
    snippets.slice(0, 3).forEach((snippet, idx) => {
      console.log(`\n${idx + 1}. Char ${snippet.char_start}-${snippet.char_end}`);
      console.log(`   Snippet: ${snippet.snippet.substring(0, 80)}...`);
    });
    console.log();

    // Check if placeholder was actually replaced
    console.log('='.repeat(80));
    console.log('PLACEHOLDER REPLACEMENT CHECK:');
    console.log('='.repeat(80));
    const hasSnippetPlaceholder = finalPrompt.includes('{provisionSnippets}');
    console.log(`✗ Unreplaced {provisionSnippets}: ${hasSnippetPlaceholder}`);

    if (hasSnippetPlaceholder) {
      console.log('⚠️  WARNING: Snippet placeholder was not replaced!');
    } else {
      console.log('✓ Snippet placeholder was replaced correctly');
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
