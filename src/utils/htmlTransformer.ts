/**
 * HTML Transformer for Block-Based Citations
 *
 * Transforms decision HTML by adding stable data-id attributes to all content blocks.
 * Generates block metadata for LLM reference (plain text, element type).
 *
 * Used by Agent 5B (enrich-teaching-citations) to enable block-based citations
 * instead of fragile HTML string matching.
 */

import * as cheerio from 'cheerio';

/**
 * Block metadata for LLM reference
 */
export interface Block {
  blockId: string;      // Format: "ECLI:BE:COURT:YYYY:ID:block-NNN"
  plainText: string;    // Clean text without HTML tags
  elementType: string;  // HTML tag name (p, h2, blockquote, etc.)
  charCount: number;    // Character count of plain text
}

/**
 * Result of HTML transformation
 */
export interface TransformResult {
  transformedHtml: string;  // HTML with data-id attributes added
  blocks: Block[];          // Array of block metadata
  totalBlocks: number;      // Total number of blocks identified
}

/**
 * Content HTML elements to transform into blocks.
 *
 * CRITICAL: Only includes leaf/content elements, NOT containers.
 *
 * Why no containers (div, section, article, footer, header)?
 * - Container plainText = concatenation of child elements
 * - Creates duplicate text in blocks array
 * - Confuses LLM (same text appears multiple times)
 * - Poor UX (highlighting container = highlighting all children, including irrelevant ones)
 *
 * Belgian decisions use semantic HTML where actual content is in <p>, <h2>, etc.
 * Containers are organizational wrappers only.
 *
 * Multi-paragraph teachings: LLM returns multiple block IDs for precise highlighting.
 */
const BLOCK_SELECTORS = [
  'p',                                    // Paragraphs - PRIMARY content element
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',    // Headings
  'blockquote',                           // Quoted text (legal provisions)
  'li',                                   // List items
  'td', 'th'                              // Table cells (may contain reasoning)
].join(', ');

/**
 * Generate block ID in standardized format
 *
 * @param decisionId - ECLI identifier (e.g., "ECLI:BE:CASS:2024:ARR.20240101.1")
 * @param sequence - Sequential block number (1-999)
 * @returns Block ID (e.g., "ECLI:BE:CASS:2024:ARR.20240101.1:block-017")
 */
function generateBlockId(decisionId: string, sequence: number): string {
  const paddedSequence = String(sequence).padStart(3, '0');
  return `${decisionId}:block-${paddedSequence}`;
}

/**
 * Extract metadata from HTML element
 *
 * @param $el - Cheerio element
 * @param blockId - Generated block ID
 * @returns Block metadata object
 */
function extractBlockMetadata($el: cheerio.Cheerio<any>, blockId: string): Block {
  const plainText = $el.text().trim();
  const elementType = $el.prop('tagName')?.toLowerCase() || 'unknown';

  return {
    blockId,
    plainText,
    elementType,
    charCount: plainText.length
  };
}

/**
 * Transform decision HTML by adding data-id attributes to all content blocks
 *
 * This function:
 * 1. Parses HTML with Cheerio
 * 2. Selects all generic content elements (p, h1-h6, blockquote, etc.)
 * 3. Skips empty elements (no text content)
 * 4. Numbers blocks sequentially starting from 1
 * 5. Adds data-id attribute to each element
 * 6. Extracts plain text metadata for LLM reference
 *
 * @param decisionId - ECLI identifier
 * @param htmlContent - Original HTML content
 * @returns Transformed HTML with data-id attributes + blocks array
 *
 * @example
 * const result = transformDecisionHtml(
 *   "ECLI:BE:CASS:2024:ARR.001",
 *   "<p>Court reasoning...</p>"
 * );
 * // result.transformedHtml = '<p data-id="ECLI:BE:CASS:2024:ARR.001:block-001">Court reasoning...</p>'
 * // result.blocks = [{ blockId: "...:block-001", plainText: "Court reasoning...", ... }]
 */
export function transformDecisionHtml(
  decisionId: string,
  htmlContent: string
): TransformResult {
  // Parse HTML
  const $ = cheerio.load(htmlContent);

  const blocks: Block[] = [];
  let sequence = 0;

  // Select all generic content elements
  $(BLOCK_SELECTORS).each((_, element) => {
    const $el = $(element);
    const plainText = $el.text().trim();

    // Skip empty elements
    if (!plainText || plainText.length === 0) {
      return;
    }

    // Generate block ID
    sequence++;
    const blockId = generateBlockId(decisionId, sequence);

    // Add data-id attribute to HTML element
    $el.attr('data-id', blockId);

    // Build block metadata
    const block = extractBlockMetadata($el, blockId);
    blocks.push(block);
  });

  return {
    transformedHtml: $('body').html() || $.html(),
    blocks,
    totalBlocks: blocks.length
  };
}

/**
 * Extract blocks from HTML that already has data-id attributes
 *
 * This function is used when HTML has been pre-transformed (e.g., from decision_fulltext1.full_html).
 * Unlike transformDecisionHtml, this function:
 * 1. Does NOT add new data-id attributes
 * 2. Reads existing data-id attributes from HTML
 * 3. Extracts block metadata only
 *
 * @param transformedHtml - HTML with existing data-id attributes
 * @returns Array of block metadata
 *
 * @example
 * const blocks = extractBlocksFromTransformedHtml(
 *   '<p data-id="ECLI:BE:CASS:2024:ARR.001:block-001">Court reasoning...</p>'
 * );
 * // blocks = [{ blockId: "...:block-001", plainText: "Court reasoning...", ... }]
 */
export function extractBlocksFromTransformedHtml(transformedHtml: string): Block[] {
  const $ = cheerio.load(transformedHtml);
  const blocks: Block[] = [];

  // Select all elements with data-id attribute
  $('[data-id]').each((_, element) => {
    const $el = $(element);
    const blockId = $el.attr('data-id');
    const plainText = $el.text().trim();

    // Skip elements without valid data-id or empty text
    if (!blockId || !plainText || plainText.length === 0) {
      return;
    }

    // Build block metadata using existing blockId
    const block = extractBlockMetadata($el, blockId);
    blocks.push(block);
  });

  return blocks;
}
