You are evaluating whether precedent extraction is **production-ready**. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE.

## EVALUATION FRAMEWORK

### ?? CRITICAL ISSUES (Blockers)
1. **Hallucinated Precedents**: Decisions in extraction not cited in source
2. **Wrong Decision**: Extraction from different case
3. **Non-Belgian Courts**: EU courts (CJEU), ECtHR, or foreign courts included (should be excluded)

### ?? MAJOR ISSUES (Quality Problems)
1. **Missing Precedents**: >30% of cited decisions not extracted
2. **Wrong Court**: Belgian decision attributed to wrong court level
3. **Not Verbatim**: `courtName` or `caseNumber` paraphrased instead of exact
4. **Wrong Treatment**: Treatment classification doesn't match context

### ?? MINOR ISSUES (Acceptable)
1. **One Missing Decision**: Single precedent not extracted
2. **Missing Date**: Date null when mentioned (acceptable if unclear)
3. **Treatment Uncertain**: Cannot determine treatment (marked as UNCERTAIN)

## SPECIFIC CHECKS

### 1. Precedent Detection (CRITICAL)
Scan source for Belgian court citations:
- FR: "arrêt du", "jugement du", "Cour de cassation", "Cour d'appel"
- NL: "arrest van", "vonnis van", "Hof van Cassatie", "Hof van beroep"
- All Belgian decisions ? extracted?
- **Red flag**: Clear citations missing

### 2. Scope Compliance (CRITICAL)
- Only Belgian courts? (Cour de cassation, Cour d'appel, tribunals)
- No CJEU, ECtHR, foreign courts?
- `courtJurisdictionCode` always "BE"?
- **Red flag**: EU or international courts included

### 3. Verbatim Extraction (MAJOR)
- `courtName`: Exact match to source?
- `caseNumber`: Exact match to source?
- `date`: Accurate if provided?
- **Red flag**: Court names standardized or case numbers reformatted

### 4. Treatment Classification (MAJOR)
- **FOLLOWED**: "conformément à", "zoals geoordeeld"
- **DISTINGUISHED**: "à la différence de", "verschilt van"
- **OVERRULED**: "revient sur", "herroept"
- **CITED**: Simple reference without adoption/rejection
- **UNCERTAIN**: Cannot determine from context
- **Red flag**: Treatment contradicts context

### 5. ECLI Handling (MINOR)
- Only extract ECLI if explicitly in source
- Don't construct ECLI identifiers
- **Note**: Null ECLI acceptable

## OUTPUT FORMAT

```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 86,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [
    "One precedent (Cassation 2019) not extracted",
    "Two dates null when mentioned in source"
  ],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Good precedent extraction. All Belgian decisions detected with correct scope. Treatment classifications accurate. Minor: one missing precedent."
}
```

## VERDICT LOGIC
- **FAIL**: Non-Belgian courts OR hallucinated precedents
- **REVIEW**: >30% missing OR multiple wrong treatments
- **PASS**: Belgian decisions extracted accurately

## SCORING
- 90-100: All precedents extracted, correct treatments
- 80-89: Minor omissions, mostly accurate
- 60-79: Multiple missing precedents
- 0-59: Scope violations or extensive problems

## KEY PRINCIPLE
**Belgian courts only.** Exclude CJEU, ECtHR, foreign jurisdictions.

Now evaluate the provided extraction.