You are evaluating whether enrichment metadata extraction is **production-ready**. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE.

## PRELIMINARY CHECK: Does Source Contain Enrichment?

**BEFORE evaluating extraction quality, scan the source document for enrichment signals:**

### Enrichment Signals to Look For:
- **ELI identifiers**: "eli/be/", "eli/eu/", "ELI:"
- **CELEX numbers**: 8-character codes like "32016R0679" or explicit "CELEX:" tags
- **Justel URLs**: "ejustice.just.fgov.be"
- **EUR-Lex URLs**: "eur-lex.europa.eu"
- **Formal citations**: "M.B.,", "B.S.,", "J.O.,", "numac:", "P.B.,"
- **Official publication references**: Page numbers with gazette references

### If NO Enrichment Signals Found:

**This is an enrichment-free document** (common for court decisions without footnotes/citations)
```json
{
  "verdict": "PASS",
  "score": 100,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "PROCEED",
  "confidence": "HIGH",
  "summary": "Source document contains no enrichment metadata (ELI, CELEX, URLs, or formal citations). Extraction correctly returned null values for all enrichment fields. This is expected for many court decisions."
}
```

**STOP evaluation here. Do NOT penalize for missing enrichment that doesn't exist in source.**

### If Enrichment Signals Found:

**Proceed with full evaluation below** to verify all found enrichment was correctly extracted.

---

## EVALUATION FRAMEWORK (Only When Enrichment Exists)

### ⛔ CRITICAL ISSUES (Blockers)
1. **Fabricated Identifiers**: ELI, CELEX, or URLs in extraction not present in source
2. **Wrong Decision Data**: Enrichment from different case

### ⚠️ MAJOR ISSUES (Quality Problems)
1. **Missed Identifiers**: ELI/CELEX/URL clearly in source but not extracted (>30% miss rate)
2. **Wrong Level**: Provision-level identifier assigned to parent (or vice versa)
3. **Invalid Format**: ELI/CELEX doesn't match standard format

### ℹ️ MINOR ISSUES (Acceptable)
1. **One Missed Identifier**: Single ELI/URL not extracted when in source
2. **Partial Extraction**: Some enrichment missing (acceptable if not explicit in source)

## SPECIFIC CHECKS

### 1. No Fabrication (CRITICAL)
- Every `provisionEli`, `parentActEli`, `parentActCelex` must be in source
- Every URL must be in source
- **Red flag**: Cannot find identifier/URL anywhere in document

### 2. Detection Completeness (MAJOR)
For each enrichment signal found in source, verify it was extracted:
- **ELI**: "ELI:", "eli/be/", "eli/eu/"
- **CELEX**: 8-character codes (32016R0679, 32000L0078)
- **Justel URLs**: "ejustice.just.fgov.be"
- **EUR-Lex URLs**: "eur-lex.europa.eu"
- **Citations**: Footnotes with "M.B.", "B.S.", "J.O.", "numac:"

All found → extracted?
**Red flag**: Clear identifiers in source but null in extraction

### 3. Provision vs Parent Level (MAJOR)
- **Provision-level**: Contains `/art_` or `#Art.` → goes in `provisionEli`/`provisionUrlJustel`/`provisionUrlEurlex`
- **Parent-level**: No article reference → goes in `parentActEli`/`parentActUrlJustel`/`parentActUrlEurlex`
- **Red flag**: Level mismatch (provision URL in parent field)

### 4. Format Validation (MAJOR)
- **ELI**: Looks like `eli/be/loi/2007/05/10/2007202032` or `eli/eu/reg/2016/679/oj`
- **CELEX**: Exactly 8 characters, format: `[1-digit][4-digits][letter][4-digits]`
- **CELEX only for EU**: Belgian laws should not have CELEX
- **Red flag**: Malformed identifiers

### 5. Citation Reference (MINOR)
- `citationReference`: Formal citation from footnotes?
- Format: "Loi du X, M.B., date, page" or "Directive X, J.O., L number, date"
- **Note**: Can be null if not in source

## OUTPUT FORMAT
```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 88,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": ["One ELI in footnote not extracted"],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "enrichmentPresent": true,
  "summary": "Good enrichment. No fabrication detected. All explicit identifiers extracted with correct level distinction."
}
```

## VERDICT LOGIC
- **PASS**: All explicit identifiers extracted correctly OR no enrichment in source
- **FAIL**: Any fabricated identifier
- **REVIEW**: >30% identifiers missed OR multiple level mismatches

## SCORING (Only When Enrichment Present)
- **100**: Perfect extraction - all found enrichment extracted correctly
- **90-99**: Minor omissions (1-2 missed identifiers from source)
- **80-89**: Some omissions but mostly accurate
- **70-79**: Multiple missing identifiers (>30% miss rate)
- **60-69**: Extensive missing identifiers (>50% miss rate)
- **0-59**: Fabrication or critical errors

**Special Case - No Enrichment in Source**: Always score 100

## KEY PRINCIPLES
1. **Better to have null than fabricate.** Missing enrichment is acceptable; invented enrichment is not.
2. **Not all decisions have enrichment.** Court decisions without footnotes/citations are valid and should score 100 when extraction correctly returns nulls.
3. **Only evaluate what exists.** Don't penalize for not extracting metadata that isn't in the source.

Now evaluate the provided extraction.