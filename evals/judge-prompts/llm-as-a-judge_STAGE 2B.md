You are evaluating whether enrichment metadata extraction is **production-ready**. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE.

## EVALUATION FRAMEWORK

### ?? CRITICAL ISSUES (Blockers)
1. **Fabricated Identifiers**: ELI, CELEX, or URLs in extraction not present in source
2. **Wrong Decision Data**: Enrichment from different case

### ?? MAJOR ISSUES (Quality Problems)
1. **Missed Identifiers**: ELI/CELEX/URL clearly in source but not extracted (>30% miss rate)
2. **Wrong Level**: Provision-level identifier assigned to parent (or vice versa)
3. **Invalid Format**: ELI/CELEX doesn't match standard format

### ?? MINOR ISSUES (Acceptable)
1. **One Missed Identifier**: Single ELI/URL not extracted when in source
2. **Partial Extraction**: Some enrichment missing (acceptable if not explicit in source)

## SPECIFIC CHECKS

### 1. No Fabrication (CRITICAL)
- Every `provisionEli`, `parentActEli`, `parentActCelex` must be in source
- Every URL must be in source
- **Red flag**: Cannot find identifier/URL anywhere in document

### 2. Detection Completeness (MAJOR)
Look for these patterns in source:
- **ELI**: "ELI:", "eli/be/", "eli/eu/"
- **CELEX**: 8-character codes (32016R0679)
- **Justel URLs**: "ejustice.just.fgov.be"
- **EUR-Lex URLs**: "eur-lex.europa.eu"
- **Citations**: Footnotes with "M.B.", "J.O.", "numac:"

All found ? extracted?
**Red flag**: Clear identifiers in source but null in extraction

### 3. Provision vs Parent Level (MAJOR)
- **Provision-level**: Contains `/art_` or `#Art.` ? goes in `provisionEli`/`provisionUrlJustel`/`provisionUrlEurlex`
- **Parent-level**: No article reference ? goes in `parentActEli`/`parentActUrlJustel`/`parentActUrlEurlex`
- **Red flag**: Level mismatch (provision URL in parent field)

### 4. Format Validation (MAJOR)
- **ELI**: Looks like `eli/be/loi/2007/05/10/2007202032` or similar
- **CELEX**: Exactly 8 characters, alphanumeric
- **CELEX only for EU**: Belgian laws should not have CELEX
- **Red flag**: Malformed identifiers

### 5. Citation Reference (MINOR)
- `citationReference`: Formal citation from footnotes?
- Format: "Loi du X, M.B., date, page"
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
  "summary": "Good enrichment. No fabrication detected. All explicit identifiers extracted with correct level distinction."
}
```

## VERDICT LOGIC
- **FAIL**: Any fabricated identifier
- **REVIEW**: >30% identifiers missed OR multiple level mismatches
- **PASS**: All explicit identifiers extracted correctly

## SCORING
- 90-100: All identifiers extracted, correct levels, no fabrication
- 80-89: Minor omissions, mostly accurate
- 60-79: Multiple missing identifiers
- 0-59: Fabrication or extensive problems

## KEY PRINCIPLE
**Better to have null than fabricate.** Missing enrichment is acceptable; invented enrichment is not.

Now evaluate the provided extraction.