/**
 * Provisions Extraction Prompt - P1 STAGE 2A ALT (Simplified Snippet-Based)
 *
 * Source: prompts-txts/P1_STAGE 2A_ALT.md
 * Updated: 2025-10-26
 *
 * SIMPLIFIED APPROACH:
 * - Works with simple text snippets (no highlighted markers)
 * - LLM does all extraction work from raw 250-char windows
 * - Outputs human-readable summary THEN JSON
 * - Uses simplified enum values (LAW, REGULATION, etc.)
 */

export const PROVISIONS_2A_PROMPT = `You are a legal document analyzer for Belgian and European law. Extract ALL unique legal provisions from the provided text and output both a human-readable summary and a structured JSON payload.

DECISION ID (ECLI): {decisionId}
LANGUAGE: {language}

INPUT TEXT:
{text_rows}

EXTRACTION INSTRUCTIONS:

1. ARTICLE IDENTIFICATION:
   - Extract every mention of "artikel", "article", "art." in both French and Dutch
   - Include complete article numbers (e.g., "101", "174", "327")
   - Capture ALL subdivisions: §, al., alinea, lid, °, bis, ter, etc.
   - Note references like "e.v." (en volgende / et suivants) meaning "and following"
   - Include historical references (e.g., "thans artikel X" = "now article X")

2. PARENT ACT IDENTIFICATION:
   - Act type: Use enum values → WET/LOI = LAW, KONINKLIJK_BESLUIT/ARRÊTÉ_ROYAL = REGULATION, DECREET/DÉCRET = DECREE, GRONDWET/CONSTITUTION = CONSTITUTION, etc.
   - Full act name in original language
   - Date in YYYY-MM-DD format (if mentioned in act title)
   - Act number if present (e.g., "2001022645")

3. PROVISION NUMBERING:
   - provisionNumber: Full text as cited (e.g., "artikel 174, §1, lid 5°")
   - provisionNumberKey: Extract primary numeric identifier only (e.g., "174")

4. INTERNAL ID GENERATION:
   - internalProvisionId: Format as "ART-{decisionId}-###" where ### is a 3-digit sequential number (001, 002, 003...)
   - internalParentActId: Format as "ACT-{decisionId}-###" where ### is a 3-digit sequential number (001, 002, 003...)
   - Each unique parent act gets one ACT ID, provisions under same act share that ACT ID
   - Provisions are numbered sequentially regardless of parent act

5. DEDUPLICATION:
   - Same article + same parent act = ONE entry (list all subdivision contexts)
   - Same article + different parent act = SEPARATE entries
   - Same article + different dates = SEPARATE entries

6. NULL VALUES:
   - provisionId: ALWAYS null (will be matched to database later)
   - parentActId: ALWAYS null (will be matched to database later)
   - parentActNumber: null if not mentioned in source text

OUTPUT FORMAT:

First, provide a HUMAN-READABLE SUMMARY for quick verification:

═══════════════════════════════════════════
EXTRACTED ARTICLES - HUMAN VERIFICATION
═══════════════════════════════════════════
Decision ID: {decisionId}

**[Parent Act Name 1]**
- Artikel X
- Artikel Y (subdivisions mentioned)

**[Parent Act Name 2]**
- Artikel Z

Total unique provisions: N
Total unique parent acts: M
═══════════════════════════════════════════

Then, provide the STRUCTURED JSON:

{
  "decisionId": "{decisionId}",
  "language": "{language}",
  "extractionMetadata": {
    "totalProvisionsExtracted": 0,
    "totalUniqueParentActs": 0,
    "extractionTimestamp": "2025-10-26T00:00:00Z"
  },
  "citedProvisions": [
    {
      "provisionId": null,
      "parentActId": null,
      "internalProvisionId": "ART-{decisionId}-001",
      "internalParentActId": "ACT-{decisionId}-001",
      "provisionNumber": "artikel 101",
      "provisionNumberKey": "101",
      "parentActType": "LAW",
      "parentActName": "gecoördineerde wetten van 14 juli 1994 betreffende...",
      "parentActDate": "1994-07-14",
      "parentActNumber": null
    }
  ]
}

PARENT ACT TYPE MAPPING:
- WET, LOI → "LAW"
- KONINKLIJK BESLUIT, ARRÊTÉ ROYAL, KB, AR → "REGULATION"
- DECREET, DÉCRET → "DECREE"
- ORDONNANTIE, ORDONNANCE → "ORDINANCE"
- GRONDWET, CONSTITUTION → "CONSTITUTION"
- VERDRAG, TRAITÉ → "TREATY"
- BURGERLIJK WETBOEK, CODE CIVIL, WETBOEK, CODE → "CODE"
- RICHTLIJN, DIRECTIVE → "DIRECTIVE"
- VERORDENING (EU), RÈGLEMENT (UE) → "EU_REGULATION"
- OTHER → "OTHER"

CRITICAL RULES:
1. provisionId and parentActId must ALWAYS be null
2. internalProvisionId must use format: ART-{full ECLI}-### (3 digits)
3. internalParentActId must use format: ACT-{full ECLI}-### (3 digits)
4. provisionNumberKey must be numeric string only (no "artikel", no subdivisions)
5. parentActDate must be YYYY-MM-DD format or null
6. All provisions citing same parent act must share same internalParentActId
7. Number internalParentActId sequentially as new acts are encountered (001, 002, 003...)
8. Number internalProvisionId sequentially for all provisions (001, 002, 003...)

Think step-by-step:
1. Scan text for all article mentions
2. For each, identify parent act context
3. Assign internalParentActId (new acts get new numbers, same acts reuse)
4. Assign internalProvisionId sequentially
5. Extract provisionNumberKey (numeric part only)
6. Map parent act type to enum
7. Format dates as YYYY-MM-DD
8. Output human summary first, then JSON

Provide both the human-readable summary AND the complete JSON.`;
