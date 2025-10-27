/**
 * Provision Context Extractor - TypeScript Implementation
 *
 * Extracts provision snippets using pure TypeScript (no Python dependency).
 * Used in extract-provisions-2a preprocessing.
 *
 * Uses N8N-based extraction logic with 3 specialized regex patterns for
 * Belgian/EU legal provisions.
 */

import { extractCandidateSnippets } from './provisionSnippetExtractor.js';
import { logger } from './logger.js';

/**
 * Simplified provision snippet result
 */
export interface ProvisionSnippetsResult {
  decisionId: string;
  language: string;
  text_rows: string[];
}

/**
 * Extract provision snippets from markdown text using TypeScript
 *
 * Uses N8N-based extraction logic with 3 specialized regex patterns:
 * - Article + source context (e.g., "article 1382 du Code civil")
 * - Treaty references (e.g., "artikel 6, §1 EVRM")
 * - EU instruments (e.g., "Verordening (EG) nr. 261/2004")
 *
 * Extracts focused 75-char context windows around provision mentions.
 *
 * @param decisionId - Decision identifier (ECLI code)
 * @param markdownText - Full markdown text of the decision
 * @param language - Procedural language (FR or NL)
 * @returns Promise resolving to snippet result
 */
export async function extractProvisionContexts(
  decisionId: string,
  markdownText: string,
  language: string = 'FR'
): Promise<ProvisionSnippetsResult> {
  try {
    // Handle empty text
    if (!markdownText || markdownText.trim() === '') {
      logger.warn('Empty markdown text provided', { decisionId });
      return {
        decisionId,
        language,
        text_rows: [],
      };
    }

    // Extract snippets using TypeScript implementation
    const candidates = extractCandidateSnippets(markdownText, 75);

    // Convert to expected format (extract just the snippet strings)
    const text_rows = candidates.map(c => c.snippet);

    logger.debug('Provision snippets extracted', {
      decisionId,
      snippetCount: text_rows.length,
    });

    return {
      decisionId,
      language,
      text_rows,
    };
  } catch (error) {
    logger.error('Provision snippet extraction failed', {
      decisionId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw new Error(
      `Failed to extract provision snippets: ${error instanceof Error ? error.message : String(error)}`
    );
  }
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
