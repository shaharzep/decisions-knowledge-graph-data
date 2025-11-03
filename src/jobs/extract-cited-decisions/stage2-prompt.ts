export const STAGE_2_PARSING_PROMPT = `## TASK
Parse enriched citation snippets into structured JSON. This is mechanical extraction - no interpretation, just parse what's in the snippet.

---

## INPUT

You receive:
1. **decisionId**: {decisionId} (reference only)
2. **proceduralLanguage**: {proceduralLanguage} (FR or NL)
3. **Agentic Snippets**: Text strings from Stage 1

{agenticSnippets}

---

## PARSING RULES

### Extract from metadata markers

Each snippet has this structure:
\`\`\`
SNIPPET N: [JURISDICTION] XX [COURT] name [DATE] date [CASE] number [ECLI] code — context text
\`\`\`

**Extract:**
- **courtJurisdictionCode**: Value from [JURISDICTION] → "BE", "EU", or "INT"
- **courtName**: Value from [COURT] → extract verbatim, no translation
- **date**: Value from [DATE] → use as-is if YYYY-MM-DD format, otherwise null
- **caseNumber**: Value from [CASE] → extract verbatim (includes decision numbers for administrative bodies)
- **ecli**: Value from [ECLI] → extract verbatim or null

### Classify treatment from context

Read the context after "—" and classify based on how the citation is used:

**FOLLOWED** - Court adopts the reasoning
- Indicators: "conformément à", "overeenkomstig", "selon la jurisprudence constante", "wordt bevestigd", "dans le même sens"

**DISTINGUISHED** - Court distinguishes this case
- Indicators: "à la différence de", "in tegenstelling tot", "contrairement à", "se distingue de", "verschilt van"

**OVERRULED** - Court rejects or departs from precedent
- Indicators: "revient sur", "wijkt af van", "écarte la jurisprudence", "infirme"

**CITED** - Simple reference without adopting or rejecting
- Indicators: "voir également", "zie ook", "cf.", or no clear adoption/rejection in context

**UNCERTAIN** - Cannot determine from context (use sparingly)

**Decision tree:**
1. Check for OVERRULED indicators → if found, treatment = "OVERRULED"
2. Check for DISTINGUISHED indicators → if found, treatment = "DISTINGUISHED"
3. Check for FOLLOWED indicators → if found, treatment = "FOLLOWED"
4. Check for simple reference indicators or no clear adoption → treatment = "CITED"
5. If genuinely ambiguous → treatment = "UNCERTAIN" (rare)

### Sequencing

Assign sequential numbers starting from 1: first citation = 1, second = 2, etc.

---

## OUTPUT SCHEMA

Return valid JSON only:

\`\`\`json
{
  "citedDecisions": [
    {
      "decisionId": null,
      "decisionSequence": 1,
      "courtJurisdictionCode": "BE|EU|INT",
      "courtName": "string (verbatim from [COURT])",
      "date": "YYYY-MM-DD or null",
      "caseNumber": "string or null",
      "ecli": "string or null",
      "treatment": "FOLLOWED|DISTINGUISHED|OVERRULED|CITED|UNCERTAIN"
    }
  ]
}
\`\`\`

---

## VALIDATION

Before outputting, verify:
- ✅ All dates are YYYY-MM-DD format or null (no partial dates like "2022-03")
- ✅ All jurisdiction codes are "BE", "EU", or "INT"
- ✅ All treatment values are one of the 5 valid options
- ✅ Sequences are 1, 2, 3... with no gaps
- ✅ courtName and caseNumber are verbatim from markers (no translation)

---

## EXAMPLE

**Input snippet:**
\`\`\`
SNIPPET 1: [JURISDICTION] BE [COURT] Hof van Cassatie [DATE] 2022-03-15 [CASE] C.21.0789.N [ECLI] ECLI:BE:CASS:2022:ARR.20220315.1N.4 — La Cour rappelle que, conformément à son arrêt du 15 mars 2022, l'obligation de justification objective doit être respectée dans tous les cas.
\`\`\`

**Output:**
\`\`\`json
{
  "citedDecisions": [
    {
      "decisionId": null,
      "decisionSequence": 1,
      "courtJurisdictionCode": "BE",
      "courtName": "Hof van Cassatie",
      "date": "2022-03-15",
      "caseNumber": "C.21.0789.N",
      "ecli": "ECLI:BE:CASS:2022:ARR.20220315.1N.4",
      "treatment": "FOLLOWED"
    }
  ]
}
\`\`\`

Reason: Context has "conformément à son arrêt" → FOLLOWED

---

## OUTPUT

Return only valid JSON. No markdown code fences, no explanation, no preamble.
`;