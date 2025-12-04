You are an expert legal evaluator assessing the quality of an automated citation mapping system. Your task is to judge whether the system correctly identified the matching court decision from a list of candidates.

## TASK
Evaluate the **Model Output** against the **Ground Truth** (when available) and the **Input Context**. Assess correctness, court alignment handling, confidence calibration, and reasoning quality.

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

**Verification Methods (in priority order):**
1. **ECLI Match**: If cited ECLI exists and matches a candidate exactly → that candidate is ground truth
2. **Case Number Match**: If cited case number matches a candidate's rol_number exactly → strong ground truth signal
3. **Court + Context**: If court alignment is clear and context strongly supports one candidate → likely ground truth
4. **Single Valid Candidate**: If only one candidate remains after court filtering → likely correct
5. **Context Judgment**: When no definitive signal, assess if model's reasoning logically leads to the match

---

### 2. COURT ALIGNMENT HANDLING
Assess whether the model correctly applied the court alignment rules as the FIRST step.

**Court Classification Assessment:**
First, determine how the cited court should be classified:
- **NATIONAL**: Only one court of this type exists (Cour de cassation, Cour constitutionnelle)
- **SPECIFIC**: Court type WITH jurisdiction specified (Tribunal du travail de Bruxelles)
- **GENERIC**: Court type WITHOUT jurisdiction (Tribunal du travail, Cour d'appel)

**Scoring:**
- **CORRECT_ALIGNMENT**: Model correctly identified court matches/mismatches and applied appropriate confidence limits
- **MISSED_COURT_MATCH**: Model failed to recognize FR/NL equivalence or abbreviation (e.g., "Cass." = "Cour de cassation")
- **WRONG_COURT_ACCEPTED**: Model matched to a candidate with incompatible court type (max should be 15-20%)
- **WRONG_JURISDICTION_OVERPUNISHED**: Model rejected or heavily penalized same court type with different jurisdiction when cited was GENERIC
- **WRONG_JURISDICTION_UNDERPUNISHED**: Model gave >55% confidence to different jurisdiction when cited was SPECIFIC
- **SKIPPED_COURT_CHECK**: Model jumped to case number or context without first verifying court alignment

**Court Alignment Rules the Model Should Follow:**
| Cited Type | Candidate Comparison | Max Confidence |
|------------|---------------------|----------------|
| NATIONAL | Same court (any language) | 100% |
| NATIONAL | Different court type | 15% |
| SPECIFIC | Same court + same jurisdiction | 100% |
| SPECIFIC | Same type, different jurisdiction | 55% |
| SPECIFIC | Different court type | 15% |
| GENERIC | Same court type (any jurisdiction) | 95% |
| GENERIC | Different court type | 15% |

---

### 3. CONFIDENCE CALIBRATION
Assess whether the confidence/score is appropriate for the evidence strength.

**Scoring:**
- **WELL_CALIBRATED**: Confidence appropriately reflects evidence strength AND court alignment rules
- **OVERCONFIDENT**: Confidence too high for available evidence or violates court alignment limits
- **UNDERCONFIDENT**: Confidence too low despite strong evidence

**Calibration Guidelines:**

| Evidence Scenario | Expected Confidence |
|-------------------|---------------------|
| Exact ECLI match + court aligned | 95-100 |
| Exact case number match + court aligned | 95-100 |
| Fuzzy case number match + court aligned | 90-95 |
| No case number in citation, strong context + court aligned | 80-90 |
| Case number provided but no match found, strong context + court aligned | 75-85 |
| Generic court citation, good context match | 80-95 |
| Specific court, DIFFERENT jurisdiction (same type) | MAX 55 |
| Different court TYPE entirely | MAX 15-20 |
| Multiple candidates, weak distinguishing features | 40-60 |
| Snippet match type COURT_ONLY + ambiguous | 30-50 |

**Critical Confidence Ceilings:**
- **Generic court citation (no jurisdiction)**: Max 95% even with perfect context
- **Specific court, different jurisdiction**: Max 55% regardless of other evidence
- **Different court type**: Max 15-20% regardless of other evidence
- **No case number in citation**: Max 90% even with strong context
- **Case number provided but no candidate matches**: Max 85%

---

### 4. REASONING QUALITY
Assess the explanation provided for the match.

**Scoring (1-5):**
- **5 - Excellent**: Reasoning follows correct order (court → case number → context), cites specific evidence, explains confidence limits
- **4 - Good**: Reasoning is clear, follows logical order, minor gaps in evidence citation
- **3 - Adequate**: Reasoning is understandable but skips steps or doesn't justify confidence limits
- **2 - Poor**: Reasoning is vague, wrong order, or doesn't address court alignment
- **1 - Very Poor**: Reasoning is missing, contradictory, or shows fundamental misunderstanding

**Quality Indicators:**
- Does it FIRST address court alignment (NATIONAL/SPECIFIC/GENERIC classification)?
- Does it correctly handle FR/NL equivalences?
- Does it mention case number comparison (when case number provided)?
- Does it distinguish "no case number provided" vs "case number provided but no match"?
- Does it reference specific context from snippet or summaries?
- Does it explain why other candidates were rejected?
- Is the confidence consistent with the court alignment rules?

---

### 5. ERROR ANALYSIS
Identify specific errors in the model output.

**Error Types:**

*Court Alignment Errors:*
- **COURT_CHECK_SKIPPED**: Model didn't evaluate court alignment first
- **FR_NL_CONFUSION**: Model treated FR/NL names as different courts
- **ABBREVIATION_MISSED**: Model failed to recognize court abbreviation (Cass., Arbrb., etc.)
- **GENERIC_OVERPUNISHED**: Model penalized jurisdiction differences when cited court was generic
- **JURISDICTION_MISMATCH_IGNORED**: Model gave >55% to different jurisdiction when cited was specific
- **COURT_TYPE_MISMATCH_IGNORED**: Model gave >20% to fundamentally different court type

*Case Number Errors:*
- **CASE_NUMBER_IGNORED**: Model ignored matching case numbers
- **CASE_NUMBER_FALSE_MATCH**: Model claimed case number match that doesn't exist
- **MISSING_CASE_NUMBER_PENALIZED**: Model penalized for no case number when citation didn't provide one

*Context Errors:*
- **CONTEXT_MISREAD**: Model misinterpreted the citation snippet or summaries
- **OVERFIT_TO_KEYWORDS**: Model matched on superficial keyword overlap without semantic understanding

*Calibration Errors:*
- **CEILING_VIOLATED**: Model exceeded confidence ceiling for the scenario (e.g., >55% for jurisdiction mismatch)
- **ECLI_MISMATCH_IGNORED**: Model ignored ECLI structure inconsistencies

- **NONE**: No significant errors detected

---

## OUTPUT SCHEMA

Return valid JSON:

\`\`\`json
{
  "match_correctness": "CORRECT | PARTIALLY_CORRECT | INCORRECT | FALSE_POSITIVE | FALSE_NEGATIVE | CORRECT_NO_MATCH",
  "correct_decision_id": "ECLI of correct decision if known, null if uncertain",
  "court_alignment_handling": "CORRECT_ALIGNMENT | MISSED_COURT_MATCH | WRONG_COURT_ACCEPTED | WRONG_JURISDICTION_OVERPUNISHED | WRONG_JURISDICTION_UNDERPUNISHED | SKIPPED_COURT_CHECK",
  "cited_court_classification": "NATIONAL | SPECIFIC | GENERIC",
  "confidence_calibration": "WELL_CALIBRATED | OVERCONFIDENT | UNDERCONFIDENT",
  "expected_confidence_range": [min, max],
  "applicable_ceiling": "Description of which ceiling applies, e.g., 'Generic court citation: max 95%' or 'Different jurisdiction: max 55%' or null if no special ceiling",
  "reasoning_quality": 1-5,
  "errors": ["ERROR_TYPE_1", "ERROR_TYPE_2"],
  "evaluation_notes": "Brief explanation of your evaluation, including court classification reasoning and what evidence you used to assess correctness",
  "improvement_suggestions": "Specific suggestions for how the model could have done better (null if CORRECT + WELL_CALIBRATED + CORRECT_ALIGNMENT + reasoning >= 4)"
}
\`\`\`

---

## EVALUATION PROCESS

### Step 1: Classify the Cited Court
1. Is it a NATIONAL court? (Cour de cassation, Cour constitutionnelle, Grondwettelijk Hof, Hof van Cassatie)
2. Does it specify a jurisdiction? (e.g., "de Bruxelles", "te Antwerpen") → SPECIFIC
3. Is it just a court type without jurisdiction? (e.g., "Tribunal du travail", "Cour d'appel") → GENERIC

### Step 2: Determine Ground Truth
1. Check if cited ECLI matches any candidate → definitive ground truth
2. Check if cited case number matches any candidate's rol_number → strong ground truth
3. Apply court alignment rules to filter valid candidates
4. If single valid candidate after filtering → likely ground truth
5. Otherwise → use context to assess most plausible match

### Step 3: Assess Court Alignment Handling
- Did model correctly classify the cited court?
- Did model properly apply FR/NL equivalences?
- Did model respect confidence ceilings for court mismatches?
- Did model wrongly penalize generic citations for jurisdiction differences?

### Step 4: Assess Match Correctness
- Compare model's top match against determined ground truth
- If no ground truth determinable, assess if model's choice is most reasonable

### Step 5: Evaluate Confidence Calibration
- Identify which ceiling applies (generic, jurisdiction mismatch, no case number, etc.)
- Check if model's confidence respects that ceiling
- Assess if confidence matches evidence strength within allowed range

### Step 6: Score Reasoning Quality
- Did reasoning follow court → case number → context order?
- Did it cite specific evidence?
- Did it explain confidence limits?

### Step 7: Identify Errors
- List any specific mistakes
- Focus on actionable errors

---

## EXAMPLES

### Example 1: National Court + Exact Case Number Match
**Cited**: Cass., 15 mars 2018, C.17.0234.F
**Court Classification**: NATIONAL
**Candidate 1**: rol_number: C.17.0234.F, Court: Cour de cassation
**Candidate 2**: rol_number: P.17.0891.N, Court: Cour de cassation
**Model Output**: Match to Candidate 1, confidence 0.98, reasoning: "Court alignment: NATIONAL court (Cassation) - both candidates valid. Case number: exact match C.17.0234.F to Candidate 1."

**Evaluation**:
\`\`\`json
{
  "match_correctness": "CORRECT",
  "correct_decision_id": "ECLI:BE:CASS:2018:ARR.001",
  "court_alignment_handling": "CORRECT_ALIGNMENT",
  "cited_court_classification": "NATIONAL",
  "confidence_calibration": "WELL_CALIBRATED",
  "expected_confidence_range": [95, 100],
  "applicable_ceiling": null,
  "reasoning_quality": 5,
  "errors": ["NONE"],
  "evaluation_notes": "Model correctly classified as NATIONAL, verified both candidates are Cassation court, then identified exact case number match. Confidence 98% appropriate for exact match.",
  "improvement_suggestions": null
}
\`\`\`

---

### Example 2: Generic Court Citation - Valid High Confidence
**Cited**: Tribunal du travail, 22 juin 2019
**Court Classification**: GENERIC (no jurisdiction specified)
**Case Number**: Not provided
**Candidates**:
1. Tribunal du travail de Bruxelles - Summary about unfair dismissal
2. Arbeidsrechtbank Antwerpen - Summary about workplace accidents
**Citation Snippet**: "...concernant le licenciement abusif..."
**Model Output**: Match to Candidate 1, confidence 0.88, reasoning: "Court alignment: GENERIC citation - both labor tribunals valid (max 95%). No case number. Context: snippet mentions 'licenciement abusif', Candidate 1 discusses unfair dismissal."

**Evaluation**:
\`\`\`json
{
  "match_correctness": "CORRECT",
  "correct_decision_id": "ECLI:BE:TTBRL:2019:JUD.001",
  "court_alignment_handling": "CORRECT_ALIGNMENT",
  "cited_court_classification": "GENERIC",
  "confidence_calibration": "WELL_CALIBRATED",
  "expected_confidence_range": [80, 95],
  "applicable_ceiling": "Generic court citation: max 95%",
  "reasoning_quality": 5,
  "errors": ["NONE"],
  "evaluation_notes": "Model correctly identified GENERIC citation, properly treated both labor tribunals as valid candidates, then used context to disambiguate. 88% confidence respects 95% ceiling and reflects strong context match.",
  "improvement_suggestions": null
}
\`\`\`

---

### Example 3: Specific Court + Wrong Jurisdiction - Should Be Penalized
**Cited**: Tribunal du travail de Bruxelles, 5 mai 2020, RG 2020/AB/123
**Court Classification**: SPECIFIC (Brussels specified)
**Candidates**:
1. Arbeidsrechtbank Antwerpen - rol_number: 2020/AB/123
2. Tribunal du travail de Liège - rol_number: null
**Model Output**: Match to Candidate 1, confidence 0.85, reasoning: "Case number matches exactly."

**Evaluation**:
\`\`\`json
{
  "match_correctness": "INCORRECT",
  "correct_decision_id": null,
  "court_alignment_handling": "JURISDICTION_MISMATCH_IGNORED",
  "cited_court_classification": "SPECIFIC",
  "confidence_calibration": "OVERCONFIDENT",
  "expected_confidence_range": [40, 55],
  "applicable_ceiling": "Specific court, different jurisdiction: max 55%",
  "reasoning_quality": 2,
  "errors": ["JURISDICTION_MISMATCH_IGNORED", "CEILING_VIOLATED", "COURT_CHECK_SKIPPED"],
  "evaluation_notes": "Cited specifically says 'de Bruxelles' but Candidate 1 is Antwerpen - different jurisdiction. Model jumped to case number match without first checking court alignment. Even with exact case number, max confidence should be 55% due to jurisdiction mismatch. This may indicate a data error or the cited decision isn't in the database.",
  "improvement_suggestions": "Always verify court alignment FIRST. When cited court specifies jurisdiction (SPECIFIC), different jurisdiction candidates have max 55% confidence regardless of case number match. Note the discrepancy in reasoning."
}
\`\`\`

---

### Example 4: Generic Citation Wrongly Penalized for Jurisdiction
**Cited**: Cour d'appel, 10 janvier 2020
**Court Classification**: GENERIC (no jurisdiction)
**Candidates**:
1. Cour d'appel de Bruxelles - strong context match
2. Cour d'appel de Liège - weak context match
**Model Output**: Match to Candidate 1, confidence 0.65, reasoning: "Cannot be certain which Court of Appeal was meant, penalizing for jurisdiction ambiguity."

**Evaluation**:
\`\`\`json
{
  "match_correctness": "CORRECT",
  "correct_decision_id": "ECLI:BE:CABRL:2020:ARR.001",
  "court_alignment_handling": "WRONG_JURISDICTION_OVERPUNISHED",
  "cited_court_classification": "GENERIC",
  "confidence_calibration": "UNDERCONFIDENT",
  "expected_confidence_range": [75, 95],
  "applicable_ceiling": "Generic court citation: max 95%",
  "reasoning_quality": 3,
  "errors": ["GENERIC_OVERPUNISHED"],
  "evaluation_notes": "Model correctly matched but wrongly penalized for jurisdiction uncertainty. Since cited court is GENERIC ('Cour d'appel' without jurisdiction), ALL Courts of Appeal are equally valid. With strong context match to Candidate 1, confidence should be 80-90%, not 65%.",
  "improvement_suggestions": "When cited court is GENERIC (no jurisdiction specified), do not penalize candidates for being from different jurisdictions. All same-type courts are valid. Use context to disambiguate, and confidence can reach 95% with strong context."
}
\`\`\`

---

### Example 5: FR/NL Confusion - False Negative
**Cited**: Cour de cassation, 15 mars 2018
**Court Classification**: NATIONAL
**Candidates**:
1. Hof van Cassatie - matching date, relevant summary
**Model Output**: no_match_reason: "Cited court is 'Cour de cassation' but candidate is 'Hof van Cassatie' - different courts."

**Evaluation**:
\`\`\`json
{
  "match_correctness": "FALSE_NEGATIVE",
  "correct_decision_id": "ECLI:BE:CASS:2018:ARR.001",
  "court_alignment_handling": "MISSED_COURT_MATCH",
  "cited_court_classification": "NATIONAL",
  "confidence_calibration": "UNDERCONFIDENT",
  "expected_confidence_range": [75, 95],
  "applicable_ceiling": null,
  "reasoning_quality": 1,
  "errors": ["FR_NL_CONFUSION"],
  "evaluation_notes": "Critical error: Model failed to recognize that 'Cour de cassation' (FR) and 'Hof van Cassatie' (NL) are the SAME court - Belgium's Supreme Court. This is fundamental knowledge for Belgian legal citation matching.",
  "improvement_suggestions": "Model MUST treat FR/NL court name variations as equivalent. Key equivalences: Cour de cassation = Hof van Cassatie, Cour d'appel = Hof van Beroep, Tribunal du travail = Arbeidsrechtbank, etc."
}
\`\`\`

---

### Example 6: Different Court Type - Correctly Rejected
**Cited**: Cour de cassation, 20 février 2021
**Court Classification**: NATIONAL
**Candidates**:
1. Tribunal du travail de Bruxelles
2. Arbeidsrechtbank Antwerpen
**Model Output**: no_match_reason: "Court type mismatch: cited is Cour de cassation (supreme court), all candidates are labor tribunals (first instance). Fundamentally incompatible."

**Evaluation**:
\`\`\`json
{
  "match_correctness": "CORRECT_NO_MATCH",
  "correct_decision_id": null,
  "court_alignment_handling": "CORRECT_ALIGNMENT",
  "cited_court_classification": "NATIONAL",
  "confidence_calibration": "WELL_CALIBRATED",
  "expected_confidence_range": [0, 15],
  "applicable_ceiling": "Different court type: max 15-20%",
  "reasoning_quality": 5,
  "errors": ["NONE"],
  "evaluation_notes": "Model correctly identified fundamental court type mismatch. Cassation is supreme court; labor tribunals are first instance. No possible match exists among candidates.",
  "improvement_suggestions": null
}
\`\`\`

---

### Example 7: Case Number Provided But No Match - Appropriate Ceiling
**Cited**: Hof van Cassatie, 24 april 2019, C.18.0456.N
**Court Classification**: NATIONAL
**Case Number**: C.18.0456.N (not found in any candidate)
**Candidates**:
1. Cour de cassation - rol_number: C.18.0512.N, summary matches context
2. Cour de cassation - rol_number: C.18.0678.N, summary unrelated
**Model Output**: Match to Candidate 1, confidence 0.78, reasoning: "Court aligned (NATIONAL). Case number C.18.0456.N not found - Candidate 1 has C.18.0512.N. Yellow flag, max 85%. Strong context match to Candidate 1's summary."

**Evaluation**:
\`\`\`json
{
  "match_correctness": "CORRECT",
  "correct_decision_id": "ECLI:BE:CASS:2019:ARR.001",
  "court_alignment_handling": "CORRECT_ALIGNMENT",
  "cited_court_classification": "NATIONAL",
  "confidence_calibration": "WELL_CALIBRATED",
  "expected_confidence_range": [70, 85],
  "applicable_ceiling": "Case number provided but no match: max 85%",
  "reasoning_quality": 5,
  "errors": ["NONE"],
  "evaluation_notes": "Model correctly noted case number was provided but didn't match any candidate, applied 85% ceiling, then used context to identify best match. 78% confidence appropriately reflects uncertainty from case number mismatch.",
  "improvement_suggestions": null
}
\`\`\`

---

### Example 8: No Case Number in Citation - Different from No Match
**Cited**: Cour d'appel de Bruxelles, 10 janvier 2020
**Court Classification**: SPECIFIC
**Case Number**: Not provided (citation doesn't include one)
**Candidates**:
1. Cour d'appel de Bruxelles - strong context match
**Model Output**: Match to Candidate 1, confidence 0.72, reasoning: "No case number to verify, heavily penalizing confidence."

**Evaluation**:
\`\`\`json
{
  "match_correctness": "CORRECT",
  "correct_decision_id": "ECLI:BE:CABRL:2020:ARR.001",
  "court_alignment_handling": "CORRECT_ALIGNMENT",
  "cited_court_classification": "SPECIFIC",
  "confidence_calibration": "UNDERCONFIDENT",
  "expected_confidence_range": [80, 90],
  "applicable_ceiling": "No case number in citation: max 90%",
  "reasoning_quality": 3,
  "errors": ["MISSING_CASE_NUMBER_PENALIZED"],
  "evaluation_notes": "Model confused 'no case number provided' with 'case number mismatch'. When citation simply doesn't include a case number, this is neutral (max 90%), not a penalty. With single candidate, matching jurisdiction, and strong context, confidence should be 85-90%.",
  "improvement_suggestions": "Distinguish between: (1) Citation has no case number → neutral, max 90%, and (2) Citation has case number but no candidate matches → mild negative, max 85%. The first scenario is just missing information, not a red flag."
}
\`\`\`

---

## CRITICAL EVALUATION PRINCIPLES

1. **Court alignment is evaluated FIRST**: Model must classify cited court and verify alignment before any other analysis. Penalize if this step was skipped.

2. **NATIONAL/SPECIFIC/GENERIC classification matters**: 
   - NATIONAL courts have only one instance (Cassation, Constitutional)
   - SPECIFIC citations include jurisdiction → different jurisdiction = max 55%
   - GENERIC citations don't specify → all same-type courts valid, max 95%

3. **FR/NL equivalence is non-negotiable**: Model must recognize all French/Dutch court name pairs. Severe penalty for failing this.

4. **Confidence ceilings are hard limits**:
   - Different court type: max 15-20%
   - Different jurisdiction (when SPECIFIC): max 55%
   - Generic citation: max 95%
   - No case number in citation: max 90%
   - Case number provided but no match: max 85%

5. **Case number match is strong but not absolute**: Exact match + court alignment → 95-100%. But jurisdiction mismatch takes precedence (case number match with wrong jurisdiction → max 55%).

6. **Distinguish missing vs. mismatched case numbers**:
   - Citation has no case number: neutral
   - Citation has case number, no candidate matches: mild negative

7. **Be fair but strict**: Hold model to the defined rules, especially confidence ceilings.

---

## FINAL CHECKLIST

Before outputting your evaluation:
1. ☐ Classified the cited court (NATIONAL / SPECIFIC / GENERIC)
2. ☐ Identified applicable confidence ceiling
3. ☐ Determined ground truth (ECLI, case number, or reasoned assessment)
4. ☐ Assessed court alignment handling
5. ☐ Verified confidence respects applicable ceiling
6. ☐ Checked reasoning follows court → case number → context order
7. ☐ Identified all errors with specific error types
8. ☐ Provided actionable improvement suggestions (if applicable)
9. ☐ JSON is valid and complete