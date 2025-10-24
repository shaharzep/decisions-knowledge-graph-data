You are evaluating whether interpretative analysis is **production-ready**. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE.

## EVALUATION FRAMEWORK

### ?? CRITICAL ISSUES (Blockers)
1. **Hallucinated Interpretation**: Court reasoning not in source document
2. **Wrong Decision**: Interpretation from different case
3. **Mismatched IDs**: `internalProvisionId` doesn't match Stage 2A+2B input

### ?? MAJOR ISSUES (Quality Problems)
1. **Missing Interpretation**: Court clearly interprets provision but `provisionInterpretation` is null (>30% miss rate)
2. **Wrong Attribution**: Party arguments attributed as court interpretation
3. **Language Wrong**: Interpretation in wrong procedural language

### ?? MINOR ISSUES (Acceptable)
1. **Null When Available**: One provision has interpretable content but null (acceptable)
2. **Length Issues**: Slightly outside 100-1000 char range
3. **Minor Paraphrasing**: Court reasoning slightly reworded

## SPECIFIC CHECKS

### 1. Hallucination Check (CRITICAL)
- Pick 2-3 sentences from `provisionInterpretation`
- Can you find this reasoning in source?
- **Red flag**: Cannot locate interpretation in decision

### 2. Court vs Party Arguments (MAJOR)
- `provisionInterpretation` should reflect **court's reasoning**, not party arguments
- Look for: "La Cour interprète", "Het Hof oordeelt", "Il résulte de"
- **Red flag**: Sounds like party pleading, not judicial reasoning

### 3. Detection Quality (MAJOR)
For provisions with court reasoning:
- Interpretation captured in `provisionInterpretation`?
- Key legal principles extracted?
- **Red flag**: Clear interpretation in "Motifs"/"Overwegende dat" but null

### 4. Factual Context (MINOR)
- `relevantFactualContext`: Specific case facts linked to provision?
- Should be concise (50-500 chars)
- **Note**: Can be null if provision cited without factual application

### 5. Language & Length (MINOR)
- Interpretation in `proceduralLanguage`?
- 100-1000 chars for `provisionInterpretation`?
- 50-500 chars for `relevantFactualContext`?

## OUTPUT FORMAT

```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 82,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [
    "Two provisions missing interpretation when court reasoning available",
    "One interpretation 95 chars (slightly under 100 minimum)"
  ],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Good interpretative extraction. No hallucination. Court reasoning accurately captured for most provisions. Minor: some nulls where content available."
}
```

## VERDICT LOGIC
- **FAIL**: Any hallucination or wrong attribution
- **REVIEW**: >30% missing interpretations when available
- **PASS**: Court reasoning accurately captured

## SCORING
- 90-100: All interpretations accurate, complete, verbatim
- 80-89: Minor omissions or slight paraphrasing
- 60-79: Multiple missing interpretations
- 0-59: Hallucination or extensive problems

## KEY PRINCIPLE
**Court reasoning only.** Party arguments don't belong in `provisionInterpretation`.

Now evaluate the provided extraction.