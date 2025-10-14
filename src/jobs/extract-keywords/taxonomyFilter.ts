import { OpenAIConfig } from '../../config/openai.js';
import { ParentCategory } from './taxonomy.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('TaxonomyFilterService');

/**
 * Taxonomy Filter Service
 *
 * Uses GPT-4o (via OpenAI API) to analyze legal decisions
 * and select exactly 4 most relevant parent legal categories from the taxonomy.
 *
 * This reduces the taxonomy size from 500k tokens to ~120-160k tokens per request.
 */
export class TaxonomyFilterService {
  /**
   * Extract representative text from decision for classification
   * Uses smart sampling: beginning + middle + end for better context
   *
   * @param fullText Full decision text
   * @param maxChars Maximum characters to extract (default: 4000)
   * @returns Sampled text with better coverage of the decision
   */
  private static extractClassificationText(
    fullText: string,
    maxChars: number = 4000
  ): string {
    // If short enough, use full text
    if (fullText.length <= maxChars) {
      return fullText;
    }

    // Smart sampling: beginning + middle + end
    // This captures procedural context, substantive reasoning, and conclusion
    const chunkSize = Math.floor(maxChars / 3);

    // First chunk: beginning (procedural context)
    const start = fullText.substring(0, chunkSize);

    // Middle chunk: substantive reasoning
    const middleStart = Math.floor(fullText.length / 2) - Math.floor(chunkSize / 2);
    const middle = fullText.substring(middleStart, middleStart + chunkSize);

    // End chunk: conclusion and decision
    const end = fullText.substring(fullText.length - chunkSize);

    return `${start}\n\n[...]\n\n${middle}\n\n[...]\n\n${end}`;
  }
  /**
   * Select relevant parent categories for a legal decision
   *
   * Uses GPT-4o to analyze a snippet of the decision and determine
   * exactly 4 most relevant legal categories.
   *
   * @param decisionText Text from the decision (smart sampled to 4000 chars: start + middle + end)
   * @param parentCategories List of all 8 parent categories
   * @returns Array of exactly 4 selected parent category IDs
   */
  static async selectRelevantCategories(
    decisionText: string,
    parentCategories: ParentCategory[]
  ): Promise<string[]> {
    logger.info('Selecting relevant taxonomy categories via GPT-4o');

    try {
      const client = OpenAIConfig.getClient();

      // Use smart text sampling (4000 chars: beginning + middle + end)
      const textSnippet = this.extractClassificationText(decisionText, 4000);

      // Format parent categories for prompt
      const categoriesList = parentCategories
        .map(
          (cat) =>
            `- ${cat.id}: ${cat.nameFr} / ${cat.nameNl}\n  ${cat.descriptionFr}`
        )
        .join('\n\n');

      // Call GPT-4o to select categories
      const response = await client.chat.completions.create({
        model: 'gpt-4o',
        messages: [
          {
            role: 'system',
            content:
              'You are a Belgian legal taxonomy expert. Your task is to classify legal decisions into the correct top-level categories based on the PRIMARY legal issues addressed in the substantive ruling.',
          },
          {
            role: 'user',
            content: `# Task
Analyze this Belgian legal decision and select EXACTLY 4 top-level legal categories.

# Available Categories
${categoriesList}

# Decision Text
${textSnippet}

# Classification Rules
1. You MUST select EXACTLY 4 categories - no more, no less
2. Choose categories based on the SUBSTANTIVE legal issues DECIDED by the court, not just mentioned in passing
3. Focus on what the court actually ruled on, not preliminary or procedural matters unless procedure is the main dispute
4. Procedural issues (KUU1 - Judicial Law) should ONLY be selected if procedure or jurisdiction is the PRIMARY subject of the dispute
5. For disputes between businesses/professionals, prefer KUU4 (Commercial Law) over KUU2 (Civil Law)
6. For employer-employee disputes, KUU5 (Social Law) is the primary category
7. Select the 4 most relevant categories in order of importance (primary issues first)
8. Consider both the legal questions posed AND the court's substantive reasoning and holdings

# Category Priority Guidelines
- Business-to-business contracts → KUU4 primary
- Individual-to-individual contracts → KUU2 primary
- Employment matters → KUU5 primary
- Tax disputes → KUU6 primary
- Public authority actions → KUU7 primary
- Criminal offenses → KUU3 primary
- Jurisdictional/procedural disputes → KUU1 primary (only if main issue)
- Cross-border/EU law issues → KUU8 (as secondary category if relevant)

# Correct Classification Examples
- Contract dispute between two companies → KUU4, KUU2, KUU1, KUU7 (commercial, civil, procedure, administrative aspects)
- Employment termination case → KUU5, KUU2, KUU1, KUU7 (social, civil, procedure, administrative)
- Tax assessment challenge → KUU6, KUU7, KUU1, KUU2 (fiscal, administrative, procedure, civil)
- Criminal fraud with civil party damages → KUU3, KUU2, KUU1, KUU6 (criminal, civil, procedure, fiscal if relevant)
- Public procurement dispute → KUU7, KUU4, KUU1, KUU2 (administrative, commercial, procedure, civil)

# Output Format
Return ONLY valid JSON with this structure:
{"categoryIds": ["KUU4", "KUU2", "KUU1", "KUU7"], "confidence": "high", "reasoning": "Contract dispute between companies involving commercial, civil, procedural, and administrative law aspects"}

Confidence levels:
- "high": Clear primary legal issues identified in the substantive ruling
- "medium": Some ambiguity in classification or limited excerpt
- "low": Difficult to determine from excerpt or unclear primary issues

Include brief reasoning (1 sentence) explaining your category selection.`,
          },
        ],
        temperature: 0.1, // Low temperature for consistent classification
        max_tokens: 200,
        response_format: { type: 'json_object' },
      });

      // Parse response
      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from GPT-4o');
      }

      const parsed = JSON.parse(content);
      const selectedIds = parsed.categoryIds || [];
      const confidence = parsed.confidence || 'unknown';
      const reasoning = parsed.reasoning || 'No reasoning provided';

      // Validate that we have an array
      if (!Array.isArray(selectedIds)) {
        logger.error('Response is not an array', {
          received: typeof selectedIds,
          confidence,
          reasoning,
        });
        throw new Error('Invalid response format: categoryIds must be an array');
      }

      // Validate that exactly 4 categories were selected
      if (selectedIds.length !== 4) {
        logger.error('Must select exactly 4 categories', {
          received: selectedIds.length,
          selectedIds,
          confidence,
          reasoning,
        });
        throw new Error(`Expected exactly 4 categories, got ${selectedIds.length}`);
      }

      // Validate that IDs match the pattern KUU[1-8] and exist in parent categories
      const validIds = selectedIds.filter((id) => {
        // Check format: KUU followed by a digit 1-8
        const isValidFormat = /^KUU[1-8]$/.test(id);
        // Check that it exists in parent categories
        const existsInCategories = parentCategories.some((cat) => cat.id === id);

        if (!isValidFormat || !existsInCategories) {
          logger.warn('Invalid category ID format or not found', { id });
          return false;
        }
        return true;
      });

      if (validIds.length !== 4) {
        logger.error('Some category IDs were invalid', {
          received: selectedIds,
          valid: validIds,
          confidence,
          reasoning,
        });
        throw new Error(`Expected 4 valid categories, got ${validIds.length}`);
      }

      logger.info('Categories selected successfully', {
        selected: validIds,
        count: validIds.length,
        selectedNames: validIds.map(
          (id) => parentCategories.find((cat) => cat.id === id)?.nameFr
        ),
        confidence,
        reasoning,
      });

      return validIds;
    } catch (error) {
      logger.error('Failed to select categories via GPT-4o', error);
      throw error; // Re-throw to let caller handle the error
    }
  }

  /**
   * Batch select categories for multiple decisions
   * Processes in parallel with rate limiting
   *
   * @param decisions Array of { id, text } objects
   * @param parentCategories List of parent categories
   * @param concurrency Max parallel requests (default: 5)
   * @returns Map of decision ID to selected category IDs
   */
  static async selectRelevantCategoriesBatch(
    decisions: Array<{ id: string; text: string }>,
    parentCategories: ParentCategory[],
    concurrency: number = 5
  ): Promise<Map<string, string[]>> {
    logger.info(`Batch selecting categories for ${decisions.length} decisions`, {
      concurrency,
    });

    const results = new Map<string, string[]>();
    const queue = [...decisions];

    // Process in batches to respect rate limits
    while (queue.length > 0) {
      const batch = queue.splice(0, concurrency);

      const batchResults = await Promise.all(
        batch.map(async (decision) => {
          try {
            const categoryIds = await this.selectRelevantCategories(
              decision.text,
              parentCategories
            );
            return { id: decision.id, categoryIds, success: true };
          } catch (error) {
            logger.error(
              `Failed to process decision ${decision.id}`,
              error
            );
            return { id: decision.id, categoryIds: [], success: false }; // Mark as failed
          }
        })
      );

      // Store only successful results
      const successCount = batchResults.filter(r => r.success).length;
      const failureCount = batchResults.filter(r => !r.success).length;

      for (const result of batchResults) {
        if (result.success && result.categoryIds.length > 0) {
          results.set(result.id, result.categoryIds);
        }
      }

      logger.info(`Processed batch: ${batch.length} decisions`, {
        successful: successCount,
        failed: failureCount,
        remaining: queue.length,
      });

      // Rate limiting: wait between batches
      if (queue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000)); // 1 second delay
      }
    }

    const totalFailed = decisions.length - results.size;

    logger.info('Batch category selection completed', {
      total: decisions.length,
      successful: results.size,
      failed: totalFailed,
    });

    return results;
  }
}