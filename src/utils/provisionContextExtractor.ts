/**
 * Provision Context Extractor - TypeScript Wrapper (Simplified)
 *
 * Calls Python script to extract simple text snippets around provision mentions.
 * Used in extract-provisions-2a preprocessing (ALT approach).
 */

import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Simplified provision snippet result
 */
export interface ProvisionSnippetsResult {
  decisionId: string;
  language: string;
  text_rows: string[];
}

/**
 * Extract provision snippets from markdown text by calling Python script
 *
 * Simplified approach: extracts 250-char windows around provision keywords,
 * no highlighting, no quality stats, no pronominal filtering.
 * LLM does all the extraction work from raw snippets.
 *
 * @param decisionId - Decision identifier (ECLI code)
 * @param markdownText - Full markdown text of the decision
 * @param language - Procedural language (FR or NL)
 * @returns Promise resolving to simplified snippet result
 */
export async function extractProvisionContexts(
  decisionId: string,
  markdownText: string,
  language: string = 'FR'
): Promise<ProvisionSnippetsResult> {
  // Construct path to Python script
  const scriptPath = path.resolve(
    __dirname,
    '../../scripts/extract-provision-contexts.py'
  );

  // Prepare input data
  const inputData = {
    decision_id: decisionId,
    markdown_text: markdownText,
    language: language,
  };

  return new Promise((resolve, reject) => {
    // Spawn Python process
    const python = spawn('python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdoutData = '';
    let stderrData = '';

    // Collect stdout
    python.stdout.on('data', (data) => {
      stdoutData += data.toString();
    });

    // Collect stderr
    python.stderr.on('data', (data) => {
      stderrData += data.toString();
    });

    // Handle process completion
    python.on('close', (code) => {
      if (code !== 0) {
        // Process failed
        let errorMessage = 'Python script failed';
        try {
          const errorObj = JSON.parse(stderrData);
          errorMessage = `${errorObj.type}: ${errorObj.error}`;
        } catch {
          errorMessage = stderrData || 'Unknown error';
        }

        logger.error('Provision snippet extraction failed', {
          decisionId,
          exitCode: code,
          error: errorMessage,
        });

        reject(new Error(errorMessage));
        return;
      }

      // Parse output
      try {
        const result: ProvisionSnippetsResult = JSON.parse(stdoutData);
        resolve(result);
      } catch (error) {
        logger.error('Failed to parse Python script output', {
          decisionId,
          error: error instanceof Error ? error.message : String(error),
        });
        reject(new Error(`Failed to parse output: ${error}`));
      }
    });

    // Handle process errors
    python.on('error', (error) => {
      logger.error('Failed to spawn Python process', {
        decisionId,
        error: error.message,
        scriptPath,
      });
      reject(
        new Error(
          `Failed to spawn Python process: ${error.message}. ` +
          `Make sure Python 3 is installed and available in PATH.`
        )
      );
    });

    // Write input data to stdin
    try {
      python.stdin.write(JSON.stringify(inputData));
      python.stdin.end();
    } catch (error) {
      logger.error('Failed to write to Python stdin', {
        decisionId,
        error: error instanceof Error ? error.message : String(error),
      });
      reject(new Error(`Failed to write input: ${error}`));
    }
  });
}

/**
 * Test the provision snippet extractor with a sample text
 *
 * Useful for debugging and validation
 */
export async function testProvisionExtractor(): Promise<void> {
  const sampleText = `
La Cour constate que l'article 31, § 2, de la loi du 10 mai 2007 tendant à lutter
contre certaines formes de discrimination dispose que le Centre peut agir en justice.

En application de l'article 1382 du Code civil, toute personne est responsable du
dommage qu'elle cause par sa faute.

Le tribunal rappelle que l'article 1412 établit une présomption.
  `.trim();

  try {
    const result = await extractProvisionContexts(
      'TEST-DECISION-001',
      sampleText,
      'FR'
    );

    console.log('✅ Provision extractor test successful:');
    console.log(`   Found ${result.text_rows.length} snippet(s)`);
    console.log('\n   Snippets:');
    result.text_rows.forEach((snippet, idx) => {
      console.log(`   ${idx + 1}. ${snippet.substring(0, 80)}...`);
    });
  } catch (error) {
    console.error('❌ Provision extractor test failed:', error);
    throw error;
  }
}
