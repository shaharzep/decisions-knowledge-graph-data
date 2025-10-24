You are evaluating whether citation extraction for precedents is **production-ready**. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE HTML.

## EVALUATION FRAMEWORK

### ?? CRITICAL ISSUES (Blockers)
1. **Fabricated Citations**: HTML not in source
2. **Wrong Decision**: Citations from different document
3. **Empty Citations**: `relatedFullTextCitations[]` empty when precedent discussed in source
4. **HTML Mismatch**: Cannot use `.includes()` for string matching

### ?? MAJOR ISSUES (Quality Problems)
1. **Missing Treatment**: >40% of precedent discussion not extracted (fails deletion test)
2. **No Self-Reference**: `relatedInternalDecisionsId` doesn't include decision's own ID
3. **Incomplete Citations**: Partial treatment (only citation, missing how court uses precedent)
4. **Wrong Precedent**: Citations about different decision

### ?? MINOR ISSUES (Acceptable)
1. **One Missing Citation**: Single mention not extracted
2. **Extra Citation**: One citation marginally relevant
3. **Missing Relationship**: Valid provision/decision not linked

## SPECIFIC CHECKS

### 1. String Matching Test (CRITICAL)
- Pick 2 citations from `relatedFullTextCitations[]`
- Search in `fullText.html` with `.includes()`
- Exact match?
- **Red flag**: Cannot find citation string

### 2. Deletion Test (MAJOR)
Remove all `relatedFullTextCitations`:
- Would this precedent never be mentioned?
- Would entire discussion disappear?
- **Red flag**: NO = missed passages

### 3. Self-Reference Check (MAJOR)
- `relatedInternalDecisionsId[0]` = this decision's own ID?
- **Red flag**: Own ID missing

### 4. Complete Treatment (MAJOR)
For each precedent, extract:
- Citation (date, case number), AND
- How court uses it (follows/distinguishes/overrules), AND
- Application to case facts
- **Red flag**: Only citation extracted, missing treatment

### 5. Detection Coverage (MAJOR)
Scan HTML for precedent references:
- By date: "arrêt du [date]", "arrest van [datum]"
- By case number: "[RG/C number]"
- By ECLI: "ECLI:BE:..."
- Indirect: "l'arrêt précité", "dit arrest"
- All references ? citations?
- **Red flag**: Multiple references missing

## OUTPUT FORMAT

```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 86,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [
    "One indirect reference ('ledit arrêt') not extracted",
    "One related decision not linked in relationships"
  ],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Good citation extraction. Complete treatment captured (citation + how used + application). Self-reference present. HTML exact. Minor: one indirect reference missed."
}
```

## VERDICT LOGIC
- **FAIL**: Fabrication OR HTML mismatch OR no self-reference
- **REVIEW**: >40% discussion missing OR incomplete treatment
- **PASS**: String matching works, treatment complete, self-reference present

## SCORING
- 90-100: Complete extraction with full treatment, perfect HTML
- 80-89: Minor omissions, mostly complete
- 60-79: Usable but incomplete treatment
- 0-59: Critical failures

## TREATMENT TEST
For each precedent, can you see from citations:
1. That court cited this precedent?
2. How court used it (follow/distinguish)?
3. Application to case facts?

All yes ? Complete treatment. Missing 2-3 ? Incomplete.

## CRITICAL CHECK
**Self-reference**: `relatedInternalDecisionsId` MUST include this decision's own `internalDecisionId`.

Now evaluate the provided extraction.