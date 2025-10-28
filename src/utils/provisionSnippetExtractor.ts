/**
 * Provision Snippet Extractor - TypeScript Implementation
 *
 * Pure TypeScript implementation of provision context extraction.
 * Based on N8N workflow logic with 3 specialized regex patterns for Belgian legal provisions.
 *
 * Extracts focused context windows around provision mentions, capturing:
 * - Article/artikel numbers with parent act context
 * - Treaty references (EVRM, TFUE, etc.)
 * - EU instruments (Verordening, Directive with numbers)
 */

/**
 * Extracted snippet with position metadata
 */
export interface SnippetCandidate {
  snippet: string;      // Normalized text snippet with provision context
  char_start: number;   // Start position of match in original text
  char_end: number;     // End position of match in original text
}

/**
 * Extract legal provision mentions with focused context windows.
 *
 * Uses 3 specialized regex patterns to capture Belgian/EU legal provisions:
 *
 * Pattern 1: Article + Source Context
 * - Matches: "article 1382 du Code civil", "artikel 174, §1 van de Grondwet"
 * - Captures article numbers, paragraphs (§, lid, alinéa), and parent act names
 * - Looks ahead up to 160 chars for legal source keywords
 *
 * Pattern 2: Treaty-Style References
 * - Matches: "artikel 6, §1 EVRM", "article 101(1) TFUE"
 * - Specialized for international treaty citations (EVRM, CEDH, TFUE, etc.)
 *
 * Pattern 3: EU Instruments
 * - Matches: "Verordening (EG) nr. 261/2004", "Directive 2004/38/EC"
 * - Captures EU regulations and directives with their official numbers
 *
 * @param fullText - Full decision text (markdown or plain text)
 * @param contextWindow - Number of characters to extract before/after match (default: 75)
 * @returns Array of unique snippet candidates with position metadata
 */
export function extractCandidateSnippets(
  fullText: string,
  contextWindow: number = 200
): SnippetCandidate[] {
  // Pattern 1: "article 1382 du Code civil", "artikel 6, §1 van de Grondwet"
  // Captures: article keyword + number + optional §/paragraph + parent act within 160 chars
  const patternArticleWithSource = /(?:(art\.?|artikel|articles?|artikelen?|article)\s*[0-9][0-9a-zA-Z./-°]*(?:\s*(?:§+|§|par(?:a|.)?graphe?|lid|alin[eé]a)\s*\d+)?(?:\s*,?\s*(?:§+|§|par(?:a|.)?graphe?|lid|alin[eé]a)\s*\d+)?(?:\s*(?:,|\bet\b|\ben\b)\s*[0-9][0-9a-zA-Z./-°]*(?:\s*(?:§+|§|par(?:a|.)?graphe?|lid|alin[eé]a)\s*\d+)?)*[^.\n]{0,160}?(Code|Wet|Loi|Grondwet|Constitution|C\.C\.|C\.P\.|C\.I\.C\.|C\.J\.|C\.Com\.|C\.\s*Const\.|B\.W\.|Sw\.|W\.?\s*Sv\.|Ger\.?\s*W\.|Gw\.|VenW\.|AR|A\.R\.|K\.B\.|KB|Koninklijk\s+besluit|Arr[êe]t|Arrêt[ée]?|Verordening|R[eè]glement|Regulation|Richtlijn|Directive|CEDH|EVRM|TFUE|TFEU|TUE|VWEU|WIB|Btw-Wetboek|loi\s+du\s+\d{1,2}\s+\w+\s+\d{4}|wet\s+van\s+\d{1,2}\s+\w+\s+\d{4}|loi\s+spéciale))/gmi; 
  
  // Pattern 2: "artikel 6, §1 EVRM", "article 101(1) TFUE"
  // Treaty/ECHR style references with explicit treaty acronym
  const patternTreaty = /(?:(art\.?|artikel|articles?|artikelen?|article)\s*[0-9][0-9a-zA-Z()./-]*(?:\s*,?\s*§\s*\d+)?\s*(CEDH|EVRM|TFUE|TFEU|TUE|VWEU))/gmi;

  // Pattern 3: "Verordening (EG) nr. 261/2004", "Directive 2004/38/EC"
  // EU instruments with official numbering
  const patternEUInstrument = /((Verordening|R[eè]glement|Regulation)[^.\n]{0,40}?(?:\((?:EU|UE|EG|CE|UE|EU|CE|EG)\))?[^.\n]{0,15}?(?:nr\.?|n°)?\s*\d{2,4}\/\d{2,4}|(Richtlijn|Directive)\s+\d{2,4}\/\d{2,4}\/[A-Z]{2,5})/gmi;

  const regexes = [patternArticleWithSource, patternTreaty, patternEUInstrument];

  const snippets: SnippetCandidate[] = [];

  // Execute each regex pattern
  for (const rgx of regexes) {
    let match: RegExpExecArray | null;

    while ((match = rgx.exec(fullText)) !== null) {
      const start = match.index;
      const end = rgx.lastIndex;

      // Calculate context window boundaries
      const left = Math.max(0, start - contextWindow);
      const right = Math.min(fullText.length, end + contextWindow);

      // Extract snippet with context
      let snippet = fullText.slice(left, right).trim();

      // Normalize whitespace (collapse multiple spaces/newlines to single space)
      snippet = snippet.replace(/\s+/g, ' ');

      if (snippet) {
        snippets.push({
          snippet,
          char_start: start,
          char_end: end,
        });
      }
    }
  }

  // Deduplicate by snippet text (keep first occurrence)
  const seen = new Set<string>();
  const unique: SnippetCandidate[] = [];

  for (const s of snippets) {
    if (!seen.has(s.snippet)) {
      seen.add(s.snippet);
      unique.push(s);
    }
  }

  return unique;
}

/**
 * Test the snippet extractor with Belgian legal text samples
 *
 * Useful for validation and debugging
 */
export function testSnippetExtractor(): void {
  const sampleFR = `
La Cour constate que l'article 31, § 2, alinéa 1er, de la loi du 10 mai 2007
tendant à lutter contre certaines formes de discrimination dispose que le Centre
peut agir en justice.

En application de l'article 1382 du Code civil, toute personne est responsable
du dommage qu'elle cause par sa faute.

Le tribunal rappelle les dispositions de l'article 6, §1 EVRM relatif au droit
à un procès équitable.

La Verordening (EG) nr. 261/2004 betreffende compensatie bij instapweigering
est applicable en l'espèce.
  `.trim();

  const sampleNL = `
Het hof verwijst naar artikel 174, §1 van de Grondwet en artikel 1322 van het
Burgerlijk Wetboek. De Richtlijn 2004/38/EG inzake vrij verkeer is van toepassing.
  `.trim();

  console.log('🧪 Testing Provision Snippet Extractor\n');

  // Test French
  console.log('📝 French Sample:');
  const resultsFR = extractCandidateSnippets(sampleFR, 75);
  console.log(`   Found ${resultsFR.length} unique snippets`);
  resultsFR.forEach((snippet, idx) => {
    console.log(`   [${idx + 1}] ${snippet.snippet.substring(0, 100)}...`);
  });

  console.log('\n📝 Dutch Sample:');
  const resultsNL = extractCandidateSnippets(sampleNL, 75);
  console.log(`   Found ${resultsNL.length} unique snippets`);
  resultsNL.forEach((snippet, idx) => {
    console.log(`   [${idx + 1}] ${snippet.snippet.substring(0, 100)}...`);
  });

  console.log('\n✅ Snippet extractor test complete');
}
