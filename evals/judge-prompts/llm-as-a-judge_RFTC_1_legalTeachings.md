You are evaluating whether citation extraction for legal teachings is **production-ready**. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE HTML.

## EVALUATION FRAMEWORK

### ?? CRITICAL ISSUES (Blockers)
1. **Fabricated Citations**: HTML in `relatedFullTextCitations[]` not in source
2. **Wrong Decision**: Citations from different document
3. **Empty Citations**: `relatedFullTextCitations[]` empty when teaching discussed in source
4. **HTML Mismatch**: Cannot use `.includes()` for string matching (modified HTML)

### ?? MAJOR ISSUES (Quality Problems)
1. **Missing Passages**: >40% of passages discussing teaching not extracted (fails deletion test)
2. **Incomplete Citations**: Partial paragraphs or cut-off sentences
3. **Irrelevant Content**: Citations don't actually discuss this teaching
4. **Wrong Relationships**: Provision/decision IDs referenced that aren't discussed in citation context

### ?? MINOR ISSUES (Acceptable)
1. **One Missing Passage**: Single paragraph about teaching not extracted
2. **Extra Citation**: One citation marginally relevant (acceptable)
3. **Missing Relationship**: Valid provision/decision not linked

## SPECIFIC CHECKS

### 1. String Matching Test (CRITICAL)
- Pick 2 citations from `relatedFullTextCitations[]`
- Search in `fullText.html` with `.includes()`
- Do they match character-for-character?
- **Red flag**: Cannot find citation string in HTML

### 2. Deletion Test (MAJOR)
Imagine removing all `relatedFullTextCitations` from HTML:
- Would this teaching completely disappear?
- Would all discussion of this principle vanish?
- **Red flag**: NO = missing significant passages

### 3. HTML Integrity (CRITICAL)
- Complete `<p>` tags (not fragments)?
- All HTML tags preserved (`<strong>`, `<em>`, attributes)?
- No modification of text/spacing?
- **Red flag**: HTML cleaned, tags removed, text altered

### 4. Relevance Check (MAJOR)
Each citation should:
- Articulate the teaching principle, OR
- Apply the teaching to facts, OR
- Explain reasoning behind teaching
- **Red flag**: Citation about different legal issue

### 5. Relationship Accuracy (MINOR)
- `relatedInternalProvisionsId`: Provisions discussed in citations?
- `relatedInternalDecisionsId`: Decisions discussed in citations?
- Only contextual relationships?
- **Note**: Empty arrays acceptable if no provisions/decisions mentioned

## OUTPUT FORMAT

```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 85,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [
    "One paragraph discussing teaching not extracted",
    "One provision relationship missing"
  ],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Good citation extraction. HTML preserved exactly for string matching. Deletion test passes (all teaching aspects captured). Minor: one missing paragraph."
}
```

## VERDICT LOGIC
- **FAIL**: Fabrication OR HTML mismatch OR empty when content exists
- **REVIEW**: >40% passages missing OR multiple irrelevant citations
- **PASS**: String matching works, deletion test passes

## SCORING
- 90-100: Complete extraction, perfect HTML preservation
- 80-89: Minor omissions, HTML intact
- 60-79: Incomplete but usable
- 0-59: String matching broken or extensive problems

## KEY TESTS
1. **String match**: Can use `.includes()` for UI highlighting?
2. **Deletion test**: Would removal eliminate teaching?
3. **Relevance**: Do citations actually discuss this teaching?

All yes ? PASS.

Now evaluate the provided extraction.