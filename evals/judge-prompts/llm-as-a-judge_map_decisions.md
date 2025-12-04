You are an expert legal evaluator assessing the quality of an automated citation mapping system. Your task is to judge whether the system correctly identified the matching court decision from a list of candidates.

## TASK
Evaluate the **Model Output** against the **Ground Truth** (when available) and the **Input Context**. Assess correctness, confidence calibration, and reasoning quality.

---

## INPUT CONTEXT

### Cited Decision Reference (what we're trying to match)
- **Court Name**: \`{citedCourtName}\`
- **Date**: \`{citedDate}\`
- **Case Number**: \`{citedCaseNumber}\`
- **ECLI**: \`{citedEcli}\`

### Citation Snippet (where citation appears in source text)
\`\`\`
{citationSnippet}
\`\`\`
(Snippet match type: {snippetMatchType})

### Candidate Decisions ({candidateCount} candidates)
{candidatesList}

---

## MODEL OUTPUT (what we're evaluating)

\`\`\`json
{modelOutput}
\`\`\`

---

## GROUND TRUTH (when available)

{groundTruth}

---

## EVALUATION CRITERIA

### 1. MATCH CORRECTNESS
Assess whether the model identified the correct decision.

**Scoring:**
- **CORRECT**: Model's top match is the correct decision
- **PARTIALLY_CORRECT**: Correct decision is in matches but not ranked first
- **INCORRECT**: Model matched to wrong decision
- **FALSE_POSITIVE**: Model returned match(es) when it should have returned no_match
- **FALSE_NEGATIVE**: Model returned no_match when a valid match existed
- **CORRECT_NO_MATCH**: Model correctly returned no_match when no valid candidate existed

**Verification Methods:**
1. **ECLI Match**: If cited ECLI exists and matches a candidate exactly → that candidate is ground truth
2. **Case Number Match**: If cited case number matches a candidate's rol_number exactly → strong ground truth signal
3. **Single Candidate**: If only one candidate exists after filtering → likely correct (verify court/context alignment)
4. **Context Judgment**: When no definitive signal, assess if model's reasoning logically leads to the match

### 2. CONFIDENCE CALIBRATION
Assess whether the confidence/score is appropriate for the evidence strength.

**Scoring:**
- **WELL_CALIBRATED**: Confidence appropriately reflects evidence strength
- **OVERCONFIDENT**: Confidence too high for available evidence (e.g., 95% on context-only match)
- **UNDERCONFIDENT**: Confidence too low despite strong evidence (e.g., 60% on exact case number match)

**Calibration Guidelines:**
| Evidence | Expected Confidence |
|----------|---------------------|
| Exact ECLI match | 95-100 |
| Exact case number match | 90-100 |
| Fuzzy case number match | 80-95 |
| Single candidate + context support | 80-95 |
| Context-only match (strong) | 70-85 |
| Context-only match (moderate) | 55-70 |
| Ambiguous, multiple plausible candidates | 40-60 |
| Weak match / low confidence appropriate | 20-40 |

### 3. REASONING QUALITY
Assess the explanation provided for the match.

**Scoring (1-5):**
- **5 - Excellent**: Reasoning is thorough, cites specific evidence (case numbers, context quotes, legal concepts), explains why alternatives were rejected
- **4 - Good**: Reasoning is clear and cites relevant evidence, minor gaps
- **3 - Adequate**: Reasoning is understandable but lacks specificity or misses key evidence
- **2 - Poor**: Reasoning is vague, circular, or doesn't justify the confidence level
- **1 - Very Poor**: Reasoning is missing, contradictory, or factually incorrect

**Quality Indicators:**
- Does it mention case number comparison (when available)?
- Does it reference specific context from snippet or summaries?
- Does it explain why other candidates were rejected (when multiple exist)?
- Is the reasoning consistent with the confidence score?
- Does it note language considerations (FR/NL) when relevant?

### 4. ERROR ANALYSIS
Identify specific errors in the model output.

**Error Types:**
- **CASE_NUMBER_IGNORED**: Model ignored matching case numbers
- **CASE_NUMBER_FALSE_MATCH**: Model claimed case number match that doesn't exist
- **CONTEXT_MISREAD**: Model misinterpreted the citation snippet or summaries
- **WRONG_COURT_TYPE**: Model matched to wrong court type (e.g., first instance vs appeal)
- **ECLI_MISMATCH_IGNORED**: Model ignored ECLI structure inconsistencies
- **LANGUAGE_CONFUSION**: Model treated FR/NL difference as mismatch
- **OVERFIT_TO_KEYWORDS**: Model matched on superficial keyword overlap without semantic understanding
- **NONE**: No significant errors detected

---

## OUTPUT SCHEMA

Return valid JSON:

\`\`\`json
{
  "match_correctness": "CORRECT | PARTIALLY_CORRECT | INCORRECT | FALSE_POSITIVE | FALSE_NEGATIVE | CORRECT_NO_MATCH",
  "correct_decision_id": "ECLI of correct decision if known, null if uncertain",
  "confidence_calibration": "WELL_CALIBRATED | OVERCONFIDENT | UNDERCONFIDENT",
  "expected_confidence_range": [min, max],
  "reasoning_quality": 1-5,
  "errors": ["ERROR_TYPE_1", "ERROR_TYPE_2"],
  "evaluation_notes": "Brief explanation of your evaluation, including what evidence you used to assess correctness",
  "improvement_suggestions": "Specific suggestions for how the model could have done better (null if CORRECT + WELL_CALIBRATED + reasoning >= 4)"
}
\`\`\`

---

## EVALUATION PROCESS

### Step 1: Determine Ground Truth
1. Check if cited ECLI matches any candidate → definitive ground truth
2. Check if cited case number matches any candidate's rol_number → strong ground truth
3. If single candidate after filtering → likely ground truth (verify context)
4. Otherwise → use context and reasoning to assess plausibility

### Step 2: Assess Match Correctness
- Compare model's top match against determined ground truth
- If no ground truth determinable, assess if model's choice is the most reasonable given evidence

### Step 3: Evaluate Confidence Calibration
- Given the evidence available, is the confidence score in the expected range?
- Be strict: exact matches should be 90+, context-only should rarely exceed 85

### Step 4: Score Reasoning Quality
- Read the model's reasoning carefully
- Check for specific evidence citations
- Verify claims against actual input data

### Step 5: Identify Errors
- List any specific mistakes the model made
- Focus on actionable errors that could be fixed

---

## EXAMPLES

### Example 1: Perfect Match
**Cited**: C.17.0234.F
**Candidate 1 rol_number**: C.17.0234.F
**Model Output**: Match to Candidate 1, confidence 0.98, reasoning mentions exact case number match

**Evaluation**:
\`\`\`json
{
  "match_correctness": "CORRECT",
  "correct_decision_id": "ECLI:BE:CASS:2018:ARR.001",
  "confidence_calibration": "WELL_CALIBRATED",
  "expected_confidence_range": [95, 100],
  "reasoning_quality": 5,
  "errors": ["NONE"],
  "evaluation_notes": "Model correctly identified exact case number match and assigned appropriate high confidence.",
  "improvement_suggestions": null
}
\`\`\`

### Example 2: Overconfident Context Match
**Cited**: No case number provided
**Candidates**: 3 candidates, all with null rol_numbers
**Model Output**: Match to Candidate 2, confidence 0.92, reasoning mentions "strong context alignment"

**Evaluation**:
\`\`\`json
{
  "match_correctness": "CORRECT",
  "correct_decision_id": "ECLI:BE:CABRL:2020:ARR.002",
  "confidence_calibration": "OVERCONFIDENT",
  "expected_confidence_range": [65, 80],
  "reasoning_quality": 3,
  "errors": ["NONE"],
  "evaluation_notes": "Model's match appears correct based on context, but 92% confidence is too high for a context-only match with multiple candidates. Should be 70-80% range.",
  "improvement_suggestions": "Reduce confidence for context-only matches. With no case number and multiple candidates, confidence should rarely exceed 80% regardless of context strength."
}
\`\`\`

### Example 3: Missed Case Number Match
**Cited**: 2019/AB/456
**Candidate 1 rol_number**: 2019/AB/456
**Candidate 2 rol_number**: null (but model matched here based on context)
**Model Output**: Match to Candidate 2, confidence 0.75

**Evaluation**:
\`\`\`json
{
  "match_correctness": "INCORRECT",
  "correct_decision_id": "ECLI:BE:TTBRL:2019:JUD.001",
  "confidence_calibration": "OVERCONFIDENT",
  "expected_confidence_range": [0, 30],
  "reasoning_quality": 2,
  "errors": ["CASE_NUMBER_IGNORED"],
  "evaluation_notes": "Model matched to Candidate 2 despite Candidate 1 having exact case number match. This is a critical error - case number matching takes priority over context.",
  "improvement_suggestions": "Always compare cited case number against all candidate rol_numbers FIRST. Exact or fuzzy matches should take precedence over context-based reasoning."
}
\`\`\`

### Example 4: Correct No-Match
**Cited**: Arbeidsrechtbank te Gent, case 2020/AR/123
**Candidates**: All from Hof van Cassatie, no matching case numbers
**Model Output**: no_match_reason: "Court type mismatch and no case number alignment"

**Evaluation**:
\`\`\`json
{
  "match_correctness": "CORRECT_NO_MATCH",
  "correct_decision_id": null,
  "confidence_calibration": "WELL_CALIBRATED",
  "expected_confidence_range": [0, 20],
  "reasoning_quality": 5,
  "errors": ["NONE"],
  "evaluation_notes": "Model correctly identified that no valid match exists. Cited is first-instance labor court, all candidates are Cassation court - fundamental mismatch.",
  "improvement_suggestions": null
}
\`\`\`

### Example 5: False Negative
**Cited**: Cour de cassation, 15 mars 2018
**Candidate 1**: Hof van Cassatie (Dutch name for same court), matching date, relevant summary
**Model Output**: no_match_reason: "No matching court found"

**Evaluation**:
\`\`\`json
{
  "match_correctness": "FALSE_NEGATIVE",
  "correct_decision_id": "ECLI:BE:CASS:2018:ARR.001",
  "confidence_calibration": "UNDERCONFIDENT",
  "expected_confidence_range": [75, 90],
  "reasoning_quality": 1,
  "errors": ["LANGUAGE_CONFUSION"],
  "evaluation_notes": "Model failed to recognize that 'Cour de cassation' (FR) and 'Hof van Cassatie' (NL) are the same court. This is a critical error for Belgian legal citation matching.",
  "improvement_suggestions": "Model must treat FR/NL court name variations as equivalent. Cour de cassation = Hof van Cassatie, Cour d'appel = Hof van Beroep, etc."
}
\`\`\`

---

## CRITICAL EVALUATION PRINCIPLES

1. **Case number match is near-definitive**: If cited case number matches a candidate's rol_number, that's almost certainly the correct match. Mark as INCORRECT if model chose differently.

2. **ECLI match is definitive**: If cited ECLI matches a candidate, that IS the correct match, no exceptions.

3. **Context-only matches have confidence ceiling**: Even strong context matches should rarely exceed 85% confidence when no case number evidence exists.

4. **FR/NL equivalence is mandatory knowledge**: Model should never treat language differences as mismatches. Penalize severely if this occurs.

5. **Absence of evidence ≠ evidence of absence**: Missing rol_numbers don't indicate wrong candidate - many older decisions lack them.

6. **Be fair but strict**: Evaluate based on what the model reasonably could have determined from the input, but hold it to high standards on obvious signals like case number matches.

---

## FINAL CHECKLIST

Before outputting your evaluation:
1. ☐ Identified ground truth (ECLI match, case number match, or reasoned assessment)
2. ☐ Compared model's match against ground truth
3. ☐ Verified confidence is appropriate for evidence strength
4. ☐ Read and assessed reasoning quality
5. ☐ Identified all errors
6. ☐ Provided actionable improvement suggestions (if applicable)
7. ☐ JSON is valid and complete