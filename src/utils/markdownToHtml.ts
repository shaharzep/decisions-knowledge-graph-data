/**
 * Markdown to HTML Conversion for Block Generation
 *
 * Converts decision markdown to HTML using pandoc, then transforms HTML
 * into blocks array for block-based citation jobs (Agent 2D, Agent 5B).
 *
 * Architecture:
 * 1. Load markdown from decisions_md table
 * 2. Convert markdown → HTML5 using pandoc subprocess
 * 3. Transform HTML → blocks using existing htmlTransformer
 * 4. Cache results to avoid repeated conversions
 */

import { spawn } from 'child_process';
import { DatabaseConfig } from '../config/database.js';
import { transformDecisionHtml, Block } from './htmlTransformer.js';

/**
 * Result of markdown-to-blocks conversion
 */
export interface BlocksResult {
  blocks: Block[];
  blocksJson: string;
  transformedHtml: string;  // HTML with data-id attributes
}

/**
 * Cache for blocks to avoid repeated pandoc conversions
 * Key format: "decisionId|language"
 */
const blocksCache = new Map<string, BlocksResult>();

/**
 * Generate cache key from decision_id and language
 */
function getCacheKey(decisionId: string, language: string): string {
  return `${decisionId}|${language}`;
}

/**
 * Convert markdown to HTML5 using pandoc
 *
 * Uses pandoc flags:
 * - --from markdown: Input format
 * - --to html5: Output HTML5
 * - --no-highlight: Disable syntax highlighting (not needed for legal text)
 * - --mathml: Convert math to MathML (for any formulas in legal text)
 *
 * @param markdown - Markdown text to convert
 * @returns HTML5 string
 * @throws Error if pandoc conversion fails
 */
export async function convertMarkdownToHtml(markdown: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const pandoc = spawn('pandoc', [
      '--from', 'markdown',
      '--to', 'html5',
      '--no-highlight',
      '--mathml'
    ]);

    let html = '';
    let errorOutput = '';

    // Collect stdout (HTML output)
    pandoc.stdout.on('data', (data) => {
      html += data.toString();
    });

    // Collect stderr (error messages)
    pandoc.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });

    // Handle process completion
    pandoc.on('close', (code) => {
      if (code === 0) {
        resolve(html);
      } else {
        reject(new Error(
          `Pandoc conversion failed with exit code ${code}: ${errorOutput}`
        ));
      }
    });

    // Handle process errors (e.g., pandoc not found)
    pandoc.on('error', (error) => {
      reject(new Error(
        `Failed to spawn pandoc process: ${error.message}. ` +
        `Ensure pandoc is installed: brew install pandoc`
      ));
    });

    // Write markdown to pandoc's stdin
    pandoc.stdin.write(markdown);
    pandoc.stdin.end();
  });
}

/**
 * Load decision markdown from decisions_md table
 *
 * @param decisionId - ECLI identifier
 * @param language - Procedural language (FR or NL)
 * @returns Markdown text
 * @throws Error if markdown not found or empty
 */
export async function loadDecisionMarkdown(
  decisionId: string,
  language: string
): Promise<string> {
  const query = `
    SELECT dm.full_md
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

  try {
    const rows: any = await DatabaseConfig.executeReadOnlyQuery(query, [
      decisionId,
      language,
    ]);

    if (!rows || rows.length === 0) {
      throw new Error(
        `Markdown not found for decision: ${decisionId} (${language})`
      );
    }

    const fullMd = rows[0].full_md;

    if (!fullMd || fullMd.trim() === '') {
      throw new Error(
        `Markdown is empty for decision: ${decisionId} (${language})`
      );
    }

    return fullMd;
  } catch (error: any) {
    throw new Error(
      `Failed to load markdown for ${decisionId} (${language}): ${error.message}`
    );
  }
}

/**
 * Generate blocks array from decision markdown
 *
 * Complete pipeline:
 * 1. Load markdown from database
 * 2. Convert markdown → HTML using pandoc
 * 3. Transform HTML → blocks using htmlTransformer
 * 4. Return blocks array + JSON string
 * 5. Cache result for subsequent requests
 *
 * @param decisionId - ECLI identifier
 * @param language - Procedural language (FR or NL)
 * @returns Blocks array and JSON-stringified blocks
 * @throws Error if any step fails
 */
export async function generateBlocksFromMarkdown(
  decisionId: string,
  language: string
): Promise<BlocksResult> {
  const cacheKey = getCacheKey(decisionId, language);

  // Check cache first
  if (blocksCache.has(cacheKey)) {
    return blocksCache.get(cacheKey)!;
  }

  try {
    // Step 1: Load markdown from database
    const markdown = await loadDecisionMarkdown(decisionId, language);

    // Step 2: Convert markdown to HTML using pandoc
    const html = await convertMarkdownToHtml(markdown);

    // Step 3: Transform HTML to blocks
    const { blocks, transformedHtml } = transformDecisionHtml(decisionId, html);

    // Step 4: Prepare result
    const result: BlocksResult = {
      blocks,
      blocksJson: JSON.stringify(blocks, null, 2),
      transformedHtml
    };

    // Step 5: Cache the result
    blocksCache.set(cacheKey, result);

    return result;
  } catch (error: any) {
    throw new Error(
      `Failed to generate blocks from markdown for ${decisionId} (${language}): ${error.message}`
    );
  }
}

/**
 * Clear blocks cache
 *
 * Useful for testing or memory management
 */
export function clearBlocksCache(): void {
  blocksCache.clear();
}

/**
 * Get cache statistics
 *
 * @returns Cache size and entries
 */
export function getBlocksCacheStats(): {
  size: number;
  entries: string[];
} {
  return {
    size: blocksCache.size,
    entries: Array.from(blocksCache.keys()),
  };
}
