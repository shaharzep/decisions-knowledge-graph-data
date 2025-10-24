You are evaluating whether the summary is **production-ready**. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE.

## EVALUATION FRAMEWORK

### ?? CRITICAL ISSUES (Blockers)
1. **Hallucinated Content**: Summary describes events/reasoning not in source
2. **Wrong Decision**: Summary from different case
3. **Missing Outcome**: Summary doesn't state what court decided

### ?? MAJOR ISSUES (Quality Problems)
1. **Not Scannable**: Cannot understand case in 3-4 seconds of reading
2. **Missing Key Element**: Missing who/what/outcome/key point
3. **Wrong Language**: Summary not in `proceduralLanguage`
4. **Party Names**: Uses specific names instead of generic terms

### ?? MINOR ISSUES (Acceptable)
1. **Length**: Slightly outside 50-800 char range
2. **Sentence Count**: 1 or 5 sentences (prefer 2-4)
3. **Incomplete Context**: Minor details omitted

## SPECIFIC CHECKS

### 1. Accuracy Check (CRITICAL)
- Pick 2 facts from summary
- Verify both in source document
- **Red flag**: Cannot find summarized facts in source

### 2. Four Elements Test (MAJOR)
Summary must include:
1. **Who**: Parties (generic: "l'employeur", "de werknemer")
2. **What**: Core legal issue/dispute
3. **Outcome**: What court decided (granted/dismissed/remanded)
4. **Key Point**: Critical legal principle or finding

Missing ?2 elements = MAJOR issue
**Red flag**: "Court ruled on employment matter" (too vague)

### 3. Scannability (MAJOR)
Read summary for 3-4 seconds:
- Can you understand the case?
- Clear what happened and outcome?
- **Red flag**: Needs re-reading to understand

### 4. Generic Terms (MAJOR)
- NOT: "Jean Dupont", "Société BelgoCorp", "Brussels court"
- YES: "le demandeur", "la société", "le tribunal"
- **Red flag**: Party-specific names throughout

### 5. Format (MINOR)
- 2-4 sentences?
- ~60-100 words?
- Complete sentences (not bullet points)?
- Professional legal tone?

## OUTPUT FORMAT

```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 89,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [
    "Summary 820 characters (slightly over 800 max)",
    "Uses one party name instead of generic term"
  ],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Excellent summary. Scannable in 3-4 seconds. All four elements present (who/what/outcome/key point). Accurate to source. Minor: slightly over length limit."
}
```

## VERDICT LOGIC
- **FAIL**: Hallucination OR missing outcome
- **REVIEW**: Not scannable OR missing 2+ elements
- **PASS**: Scannable with all four elements

## SCORING
- 90-100: Perfect summary, all elements, scannable
- 80-89: Good summary with minor issues
- 60-79: Usable but missing elements or not scannable
- 0-59: Hallucination or unusable

## SCANNABILITY TEST
Read summary once (3-4 seconds):
- What's the case about? ___
- What did court decide? ___
- Why? ___

Can answer all three ? PASS. Cannot ? FAIL.

Now evaluate the provided extraction.