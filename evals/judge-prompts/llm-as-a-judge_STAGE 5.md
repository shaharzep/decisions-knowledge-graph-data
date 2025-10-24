You are evaluating whether extracted teachings are **production-ready**. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE.

## EVALUATION FRAMEWORK

### ?? CRITICAL ISSUES (Blockers)
1. **Hallucinated Teaching**: Legal principle not in source document
2. **Wrong Decision**: Teaching from different case
3. **Not Generalizable**: All teachings case-specific (no reusable principles)
4. **Wrong Source Author**: `sourceAuthor` not "AI_GENERATED"

### ?? MAJOR ISSUES (Quality Problems)
1. **Factual Findings**: Teachings are case facts, not legal principles
2. **Mere Law Recitation**: Just quotes statute, no interpretation/application
3. **Missing Key Teaching**: Major legal principle in decision not extracted (>50% miss)
4. **Wrong Language**: Teaching text not in `proceduralLanguage`

### ?? MINOR ISSUES (Acceptable)
1. **One Missing Teaching**: Minor principle not extracted
2. **Party Names**: Generic terms preferred but specific names acceptable if needed for clarity
3. **Context Too Brief**: `relevantFactualContext` under 50 chars

## SPECIFIC CHECKS

### 1. Hallucination (CRITICAL)
- Pick teaching text, search for reasoning in source
- Court actually articulated this principle?
- **Red flag**: Teaching logic not in court's reasoning

### 2. Generalizability (CRITICAL)
Teaching should answer: "What legal principle can guide future cases?"
- NOT: "Company X fired Employee Y" (case fact)
- YES: "Termination notice must be proportional to relationship duration" (principle)
- **Red flag**: All teachings are factual summaries

### 3. Teaching vs Facts (MAJOR)
- **Teaching**: Interpretive rules, application standards, balancing tests
- **Not Teaching**: "Plaintiff was 58 years old", "Contract lasted 5 years"
- **Red flag**: Teachings read like case facts

### 4. Detection Quality (MAJOR)
Key legal principles in source:
- Check "Motifs", "En droit", "Overwegende dat" sections
- Main principles extracted?
- **Red flag**: Obvious interpretive principle missing

### 5. Relationships (MINOR)
- `relatedCitedProvisionsId`: Provisions teaching interprets?
- `relatedCitedDecisionsId`: Precedents teaching relies on?
- `relatedLegalIssuesId`: Must be empty [] (populated separately)
- **Note**: Can be empty if teaching doesn't reference provisions/decisions

## OUTPUT FORMAT

```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 87,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [
    "One teaching contains party name instead of generic term",
    "One key principle in reasoning section not extracted"
  ],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Good teaching extraction. Principles generalizable and accurately reflect court reasoning. Clear distinction between teachings and case facts. Minor: one missing principle."
}
```

## VERDICT LOGIC
- **FAIL**: Hallucination OR not generalizable OR wrong sourceAuthor
- **REVIEW**: >50% teachings are facts OR major principles missing
- **PASS**: Generalizable principles accurately extracted

## SCORING
- 90-100: All major principles extracted, fully generalizable
- 80-89: Minor omissions, mostly good principles
- 60-79: Some factual confusion or missing key teachings
- 0-59: Hallucination or not generalizable

## QUALITY TEST
Read each teaching and ask:
1. Is this a legal principle or a case fact?
2. Could this guide other similar cases?
3. Did the court actually say this?

All yes ? Good teaching. Any no ? Problem.

Now evaluate the provided extraction.