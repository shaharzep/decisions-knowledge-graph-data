You are evaluating whether citation extraction for provisions is **production-ready**. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE HTML.

## EVALUATION FRAMEWORK

### ?? CRITICAL ISSUES (Blockers)
1. **Fabricated Citations**: HTML not in source
2. **Wrong Decision**: Citations from different document
3. **Empty Citations**: `relatedFullTextCitations[]` empty when provision cited in source
4. **HTML Mismatch**: Cannot use `.includes()` for string matching

### ?? MAJOR ISSUES (Quality Problems)
1. **Missing Citations**: >40% of provision mentions not extracted (fails deletion test)
2. **No Self-Reference**: `relatedInternalProvisionsId` doesn't include provision's own ID
3. **Incomplete Citations**: Partial paragraphs or cut-off text
4. **Wrong Provision**: Citations about different article/provision

### ?? MINOR ISSUES (Acceptable)
1. **One Missing Citation**: Single mention not extracted
2. **Extra Citation**: One citation marginally relevant
3. **Missing Relationship**: Valid provision/decision not linked

## SPECIFIC CHECKS

### 1. String Matching Test (CRITICAL)
- Pick 2 citations from `relatedFullTextCitations[]`
- Search in `fullText.html` with `.includes()`
- Character-for-character match?
- **Red flag**: Cannot find citation in HTML

### 2. Deletion Test (MAJOR)
Remove all `relatedFullTextCitations` from HTML:
- Would this provision never be mentioned?
- Would all references disappear?
- **Red flag**: NO = missed mentions

### 3. Self-Reference Check (MAJOR)
- `relatedInternalProvisionsId[0]` = this provision's own ID?
- Provision always relates to itself?
- **Red flag**: Own ID missing from relationships

### 4. Complete Extraction (MAJOR)
Scan HTML for provision mentions:
- "l'article 31", "artikel 31"
- "cette disposition", "deze bepaling"
- "ledit article", "voornoemde artikel"
- All instances ? citations?
- **Red flag**: Clear mentions missing

### 5. Context Quality (MINOR)
Each citation should show:
- Provision cited, AND/OR
- Court interprets provision, AND/OR
- Court applies provision to facts
- **Note**: Context around citation acceptable

## OUTPUT FORMAT

```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 88,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": ["One mention in footnote not extracted"],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Excellent citation extraction. All main provision mentions captured. Self-reference present. HTML preserved exactly. Minor: one footnote reference missing."
}
```

## VERDICT LOGIC
- **FAIL**: Fabrication OR HTML mismatch OR no self-reference
- **REVIEW**: >40% mentions missing OR wrong provision
- **PASS**: String matching works, deletion test passes, self-reference present

## SCORING
- 90-100: Complete extraction, self-reference, perfect HTML
- 80-89: Minor omissions, mostly complete
- 60-79: Usable but incomplete
- 0-59: Critical failures

## CRITICAL CHECK
**Self-reference**: `relatedInternalProvisionsId` MUST include this provision's own `internalProvisionId`. This is non-negotiable.

Now evaluate the provided extraction.