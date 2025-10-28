/**
 * Resolve Provisions Prompt - Stage 2A Verification
 */

export interface ResolvePromptContext {
  decisionId: string;
  proceduralLanguage: 'FR' | 'NL';
  fullText: string;
  initialExtraction: string;
}

const BASE_RESOLVE_PROMPT = `## ROLE
You are a meticulous legal analyst verifying Stage 2A provision extraction for Belgian judicial decisions.

## OBJECTIVE
Review the initial extraction, remove hallucinated provisions, add missing ones, normalize metadata, and return a definitive list.

## INPUT
1. **Decision ID**: {decisionId}
2. **Procedural Language**: {proceduralLanguage}
3. **Initial Extraction (JSON)**:
{initialExtraction}
4. **Decision Text (markdown)**:
{fullText.markdown}

## TASKS
1. Parse the decision text thoroughly (including footnotes) for every cited legal provision.
2. For each provision in the initial extraction:
   - Keep it only if the exact citation (article number + parent act context) is present in the text.
   - Ensure parent act name/type/date/number match the text verbatim.
3. Identify provisions mentioned in the decision but missing from the initial extraction and add them with full metadata.
4. Deduplicate across the entire decision:
   - Same parent act + same provisionNumberKey ⇒ keep one entry (first occurrence).
   - EU/International treaty decimals (e.g., 8.1, 8.2 CEDH/GDPR) are distinct provisions; keep each.
5. Ensure every parent act retains the procedural-language enum (FR or NL set).

## OUTPUT RULES
- Return ONLY JSON matching the schema below; no prose or explanations.
- Leave \`provisionId\` and \`parentActId\` as null (database reserved fields).
- provisionSequence and parentActSequence should be sequential starting at 1 (will be re-normalized downstream).
- provisionNumberKey must preserve Roman numerals and bis/ter/quater suffixes, but drop paragraphs (§), °, or sub-letters.

## OUTPUT SCHEMA
\`\`\`json
{
  "citedProvisions": [
    {
      "provisionId": null,
      "parentActId": null,
      "provisionSequence": 1,
      "parentActSequence": 1,
      "provisionNumber": "string verbatim",
      "provisionNumberKey": "string normalized",
      "parentActType": "enum",
      "parentActName": "string verbatim",
      "parentActDate": "YYYY-MM-DD or null",
      "parentActNumber": "string or null"
    }
  ]
}
\`\`\`
`;

export function buildResolveProvisionsPrompt(
  ctx: ResolvePromptContext
): string {
  const replacements: Record<string, string> = {
    '{decisionId}': ctx.decisionId ?? '',
    '{proceduralLanguage}': ctx.proceduralLanguage ?? 'FR',
    '{initialExtraction}':
      ctx.initialExtraction?.trim().length > 0
        ? ctx.initialExtraction
        : '[]',
    '{fullText.markdown}': ctx.fullText ?? '',
  };

  let prompt = BASE_RESOLVE_PROMPT;
  for (const [token, value] of Object.entries(replacements)) {
    prompt = prompt.replaceAll(token, value);
  }

  return prompt;
}
