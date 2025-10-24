You are evaluating whether provision extraction is **production-ready**. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE.

## EVALUATION FRAMEWORK

### ?? CRITICAL ISSUES (Blockers)
1. **No Provisions Found**: Empty `citedProvisions[]` when provisions clearly cited in source
2. **Hallucinated Provisions**: Provisions in extraction not cited in source document
3. **Wrong Decision**: Extraction appears to be from different case

### ?? MAJOR ISSUES (Quality Problems)
1. **Missing Provisions**: >30% of cited provisions not extracted
2. **Not Verbatim**: `provisionNumber` or `parentActName` paraphrased instead of exact text
3. **Wrong Parent Act**: Provision attributed to incorrect law/code
4. **Incorrect Deduplication**: Same parent act has multiple `internalParentActId` values

### ?? MINOR ISSUES (Acceptable)
1. **One Missing Provision**: Single provision not extracted
2. **Minor Text Variance**: Slight differences in provision text (e.g., "art. 31" vs "article 31")
3. **Missing Optional Date**: `parentActDate` null when date in source (acceptable if date unclear)

## SPECIFIC CHECKS

### 1. Provision Detection (CRITICAL)
- Scan source for: "l'article", "artikel", "art."
- All mentioned provisions in `citedProvisions[]`?
- **Red flag**: Clear citations missing from extraction

### 2. Verbatim Extraction (MAJOR)
- `provisionNumber`: Exact match to source? (e.g., "article 31, § 2, alinéa 1er")
- `provisionNumberKey`: Correct core number? (e.g., "31")
- `parentActName`: Exact match to source? (e.g., "Loi du 10 mai 2007...")
- **Red flag**: Provisions summarized or standardized instead of copied

### 3. Parent Act Deduplication (MAJOR)
- Same law cited multiple times ? same `internalParentActId`?
- Different laws ? different `internalParentActId`?
- Example: Article 31 and Article 29 of "Loi du 10 mai 2007" should share parent ID
- **Red flag**: Duplicate parent IDs for same act

### 4. Type Classification (MINOR)
- `parentActType` appropriate? (LOI/WET, CODE/WETBOEK, etc.)
- Matches `proceduralLanguage`?
- **Note**: Minor enum errors acceptable

### 5. ID Format (programmatic check)
- `internalProvisionId`: Pattern `ART-{decisionId}-{sequence}`
- `internalParentActId`: Pattern `ACT-{decisionId}-{sequence}`

## OUTPUT FORMAT

```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 85,
  "criticalIssues": [],
  "majorIssues": ["One provision text paraphrased instead of verbatim"],
  "minorIssues": ["Optional parentActDate missing for one provision"],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Good extraction. All provisions detected and parent act deduplication correct. Minor: one provision text not fully verbatim."
}
```

## VERDICT LOGIC
- **FAIL**: Any critical issue
- **REVIEW**: 2+ major issues
- **PASS**: 0-1 major issues

## SCORING
- 90-100: All provisions extracted verbatim, perfect deduplication
- 80-89: Minor text variance or one missing provision
- 60-79: Multiple quality issues
- 0-59: Critical issues or extensive problems

Now evaluate the provided extraction.