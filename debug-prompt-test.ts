/**
 * Debug Script: Generate Prompt for Specific Decision
 *
 * Creates a text file showing what prompt would be sent to Claude
 * without actually calling the API.
 *
 * Usage:
 *   tsx debug-prompt-test.ts <job-type> <decision-id> <language>
 *
 * Example:
 *   tsx debug-prompt-test.ts extract-provisions-2a ECLI:BE:EABRL:2002:DEC.20021209.4 NL
 */

import fs from 'fs/promises';
import path from 'path';
import { DatabaseConfig } from './src/config/database.js';

/**
 * Load job configuration dynamically
 */
async function loadJobConfig(jobType: string): Promise<any> {
  try {
    const configPath = `./src/jobs/configs/${jobType}.js`;
    const module = await import(configPath);
    return module.default || module;
  } catch (error: any) {
    throw new Error(`Failed to load job config: ${error.message}`);
  }
}

/**
 * Generate prompt for a specific decision
 */
async function generatePromptForDecision(
  jobType: string,
  decisionId: string,
  language: string
): Promise<string> {
  console.log(`\n🔍 Loading job config: ${jobType}`);
  const config = await loadJobConfig(jobType);

  console.log(`\n📚 Fetching decision from database...`);
  console.log(`   Decision ID: ${decisionId}`);
  console.log(`   Language: ${language}`);

  // Execute the job's database query with specific decision ID
  // We'll need to modify the query to target this specific decision
  const query = `
    SELECT
      d.id,
      d.decision_id,
      d.language_metadata,
      d.decision_type_ecli_code,
      d.court_ecli_code,
      d.decision_date,
      dm.full_md,
      LENGTH(dm.full_md) as md_length
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    WHERE d.decision_id = $1
      AND d.language_metadata = $2
      AND dm.full_md IS NOT NULL
      AND dm.full_md != ''
    LIMIT 1
  `;

  const rows: any = await DatabaseConfig.executeReadOnlyQuery(query, [
    decisionId,
    language,
  ]);

  if (!rows || rows.length === 0) {
    throw new Error(
      `Decision not found: ${decisionId} (${language})\n` +
      `Make sure the decision exists in the database with full_md content.`
    );
  }

  const row = rows[0];
  console.log(`✅ Decision found (${row.md_length} characters)`);

  // Apply preprocessing if defined in config
  let processedRow = row;
  if (config.preprocessRow) {
    console.log(`\n⚙️  Applying preprocessRow function...`);
    processedRow = await config.preprocessRow(row);
    console.log(`✅ Preprocessing complete`);
  }

  // Show extracted provision snippets (if available)
  if (processedRow.provision_snippets) {
    console.log(`\n📦 Provision snippets extracted:`);
    console.log(`   Total snippets: ${processedRow.provision_snippets.text_rows?.length || 0}`);
    if (processedRow.provision_snippets.text_rows?.length > 0) {
      console.log(`   First 3 snippets:`);
      processedRow.provision_snippets.text_rows.slice(0, 3).forEach((snippet: string, idx: number) => {
        console.log(`   ${idx + 1}. ${snippet.substring(0, 80)}...`);
      });
    } else {
      console.log(`   ⚠️  WARNING: No provision snippets found in this decision!`);
      console.log(`      The Python extractor didn't detect any provision keywords.`);
    }
  }

  // Generate prompt using the job's promptTemplate
  console.log(`\n📝 Generating prompt...`);
  const prompt = config.promptTemplate(processedRow);
  console.log(`✅ Prompt generated (${prompt.length} characters)`);

  return prompt;
}

/**
 * Save prompt to file
 */
async function savePromptToFile(
  prompt: string,
  jobType: string,
  decisionId: string,
  language: string
): Promise<string> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safeDecisionId = decisionId.replace(/:/g, '_');
  const filename = `prompt_${jobType}_${safeDecisionId}_${language}_${timestamp}.txt`;
  const filepath = path.join(process.cwd(), 'debug-inputs', filename);

  // Ensure debug-inputs directory exists
  await fs.mkdir(path.dirname(filepath), { recursive: true });

  // Create formatted output
  const output = `
════════════════════════════════════════════════════════════════════════════════
DEBUG PROMPT GENERATION
════════════════════════════════════════════════════════════════════════════════

Job Type:     ${jobType}
Decision ID:  ${decisionId}
Language:     ${language}
Generated:    ${new Date().toISOString()}
Prompt Size:  ${prompt.length} characters

════════════════════════════════════════════════════════════════════════════════
PROMPT CONTENT
════════════════════════════════════════════════════════════════════════════════

${prompt}

════════════════════════════════════════════════════════════════════════════════
END OF PROMPT
════════════════════════════════════════════════════════════════════════════════
`.trim();

  await fs.writeFile(filepath, output, 'utf-8');

  return filepath;
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.error(`
❌ Invalid arguments

Usage:
  tsx debug-prompt-test.ts <job-type> <decision-id> <language>

Example:
  tsx debug-prompt-test.ts extract-provisions-2a ECLI:BE:EABRL:2002:DEC.20021209.4 NL

Available job types:
  - extract-comprehensive
  - extract-provisions-2a
  - extract-cited-decisions
  - enrich-provisions
  - interpret-provisions
    `);
    process.exit(1);
  }

  const [jobType, decisionId, language] = args;

  try {
    console.log(`\n🚀 Debug Prompt Generation`);
    console.log(`════════════════════════════════════════════════════════════════`);

    // Generate prompt
    const prompt = await generatePromptForDecision(jobType, decisionId, language);

    // Save to file
    const filepath = await savePromptToFile(prompt, jobType, decisionId, language);

    console.log(`\n✅ Prompt saved successfully!`);
    console.log(`\n📄 File location:`);
    console.log(`   ${filepath}`);
    console.log(`\n💡 Review the prompt before running the full extraction.`);
    console.log(`\n✨ Done!\n`);

    // Close database connection
    await DatabaseConfig.close();
  } catch (error) {
    console.error(`\n❌ Error:`, error instanceof Error ? error.message : String(error));
    await DatabaseConfig.close();
    process.exit(1);
  }
}

main();
