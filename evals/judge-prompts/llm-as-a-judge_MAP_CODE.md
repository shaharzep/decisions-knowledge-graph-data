# CODE/Constitution Provision Mapping — Evaluation Judge

You are evaluating the quality of an automated two-pass system that maps cited CODE and Constitution provisions to their parent documents in Belgian law.

## SYSTEM ARCHITECTURE

The system uses two passes:
- **Pass 1**: Identifies the Code family from the cited act name (e.g., "Burgerlijk Wetboek" → "Code civil")
- **Pass 2**: Finds the exact document within that Code family using hierarchical matching

## IMPORTANT CONTEXT

This job processes **CODE and CONSTITUTION** instruments:
- Codes (Wetboek/Code): Civil, Penal, Judicial, Commercial, etc.
- Constitution (Grondwet/Constitution)

**Key characteristics:**
- Codes are often split across multiple documents (e.g., Code civil has Livre I, II, III)
- Constitution has two versions (1831 historical, 1994 coordinated)
- Title matching is the PRIMARY signal
- Range and existence checks are DISAMBIGUATION TOOLS only
- Semantic matching is a FINAL TIEBREAKER when multiple documents have the article
- We prefer NO MATCH over FALSE POSITIVE

---

## Inputs You Will Receive

1. **Cited Article**: `provision_number` - The article number being cited
2. **Cited Act Name**: `parent_act_name` - The name of the code/constitution as cited
3. **Citation Paragraph**: `citation_paragraph` - The paragraph where the article is cited (may be empty)
4. **Legal Teachings**: `teaching_texts` - Summaries of the decision
5. **Candidate Documents**: `candidate_titles` - List of potential matches with titles
6. **System Output (Pass 1)**: `identified_code_families` - Array of code family names identified from the cited act name (e.g., ["Code judiciaire"] for "Gerechtelijk Wetboek")
7. **System Output (Pass 2)**: Document matching
   - `decision_path`: Object showing the reasoning chain
     - `title_matches`: IDs that passed title filtering
     - `after_range_elimination`: IDs remaining after range check
     - `existence_status`: { id: "EXISTS" | "UNKNOWN" } for each candidate
     - `semantic_disambiguation_used`: boolean
     - `semantic_match_reasoning`: string or null
   - `matches`: Array of document matches with scores, confidence, and status fields
   - `final_decision`: SINGLE_MATCH | RESOLVED_BY_RANGE | RESOLVED_BY_EXISTENCE | RESOLVED_BY_SEMANTIC | AMBIGUOUS | NO_MATCH | ERROR
   - `no_match_reason`: Explanation if no match found

---

## Evaluation Criteria

### 1. PASS 1: CODE FAMILY IDENTIFICATION (CRITICAL)

**Evaluate:**
- Did the system correctly identify the code family from the cited act name?
- Did it handle NL/FR translation correctly?
- Did it recognize abbreviations (B.W., Ger.W., Sw., etc.)?

**Common NL/FR Mappings:**
| Dutch (NL) | French (FR) |
|------------|-------------|
| Burgerlijk Wetboek (B.W.) | Code civil |
| Strafwetboek (Sw.) | Code pénal |
| Gerechtelijk Wetboek (Ger.W.) | Code judiciaire |
| Wetboek van Strafvordering | Code d'Instruction Criminelle |
| Grondwet / GW | Constitution |

**Precision Check:**
| Result | Rating |
|--------|--------|
| Returns only the correct code family (1 match) | OPTIMAL |
| Returns 2-3 candidates including the correct one | ACCEPTABLE |
| Returns 4+ candidates including the correct one | SUBOPTIMAL (too broad) |
| Correct code family NOT in results | WRONG |

**Evaluate:**
- ✓ CORRECT: Correctly mapped NL citation to FR code family
- ✓ CORRECT: Recognized abbreviation and mapped correctly
- ⚠ SUBOPTIMAL: Correct family included but too many candidates returned
- ✗ WRONG: Mapped to wrong code family
- ✗ WRONG: Failed to recognize common abbreviation
- ✗ WRONG: Returned empty when code family was identifiable

**CASCADE RULE**: If Pass 1 returns the WRONG code family (correct family not in results):
- Pass 2 evaluation is marked "N/A" for all criteria
- Verdict is immediate FAIL
- Do NOT compound penalties by also evaluating Pass 2

---

### 2. PASS 2: FINAL DECISION ACCURACY (CRITICAL)

The system should correctly identify the final decision:

| Decision | When Appropriate |
|----------|------------------|
| NO_MATCH | No candidate title matches the cited code |
| SINGLE_MATCH | Exactly one candidate's title matches |
| RESOLVED_BY_RANGE | Multiple matched, range check identified winner |
| RESOLVED_BY_EXISTENCE | Multiple matched, only one has article EXISTS |
| RESOLVED_BY_SEMANTIC | Multiple matched with EXISTS, semantic matching resolved |
| AMBIGUOUS | Multiple matched, cannot determine winner |
| ERROR | System error occurred |

**Evaluate:**
- ✓ CORRECT: Decision accurately reflects the candidate situation and resolution method
- ✗ WRONG: Claimed SINGLE_MATCH when multiple candidates match
- ✗ WRONG: Claimed NO_MATCH when a valid match exists
- ✗ WRONG: Claimed RESOLVED_BY_* when ambiguity actually remains
- ✗ WRONG: Claimed AMBIGUOUS when clear resolution was possible

---

### 3. TITLE MATCHING AS PRIMARY SIGNAL (CRITICAL)

Title matching should be the FIRST and PRIMARY matching method.

**Evaluate:**
- ✓ CORRECT: Title match determined the result (single match case)
- ✓ CORRECT: Recognized NL/FR equivalence in titles
- ✓ CORRECT: `decision_path.title_matches` correctly lists matching candidates
- ✗ WRONG: Ignored title matching and jumped to content check
- ✗ WRONG: Selected candidate with non-matching title
- ✗ WRONG: Failed to recognize NL/FR title equivalence

---

### 4. DECISION PATH CONSISTENCY (MAJOR)

The `decision_path` object should be internally consistent:

**Evaluate:**
- ✓ CORRECT: `after_range_elimination` is a subset of `title_matches`
- ✓ CORRECT: `existence_status` only contains IDs from `after_range_elimination`
- ✓ CORRECT: If `semantic_disambiguation_used: true`, then `semantic_match_reasoning` is non-null and meaningful
- ✓ CORRECT: `final_decision` matches the resolution method shown in path
- ✗ WRONG: Path shows range eliminated all but one, but `final_decision` is not RESOLVED_BY_RANGE
- ✗ WRONG: `semantic_disambiguation_used: true` but no reasoning provided
- ✗ WRONG: IDs appear in later steps that weren't in earlier steps

---

### 5. RANGE CHECK ACCURACY (MAJOR — WHEN USED)

If range check was used, evaluate correctness:

| Range Status | When Appropriate |
|--------------|------------------|
| INCLUDES | Title has range AND cited article falls within it |
| EXCLUDES | Title has range AND cited article falls outside it |
| NO_RANGE | Title has no article range specified |

**Evaluate:**
- ✓ CORRECT: Range correctly identified as including/excluding article
- ✓ CORRECT: NO_RANGE used when title has no range
- ✓ CORRECT: Candidates with EXCLUDES were eliminated from `after_range_elimination`
- ✗ WRONG: Claimed INCLUDES when article is outside range
- ✗ WRONG: Claimed EXCLUDES when article is inside range
- ✗ WRONG: Missed obvious range in title
- ✗ WRONG: Candidate with EXCLUDES still appears in later decision steps

---

### 6. EXISTENCE CHECK ACCURACY (MAJOR — WHEN USED)

The system uses a two-value existence classification:

| Status | Meaning |
|--------|---------|
| EXISTS | Article content was found (including abrogated articles) |
| UNKNOWN | Content not available — could be extraction failure OR absence |

**CRITICAL RULES:**
- **EXISTS includes abrogated articles** — "Abrogé/Opgeheven" means the article EXISTS
- **UNKNOWN ≠ ABSENT** — Do not penalize candidates just because content wasn't extracted
- **Length of content is IRRELEVANT** — A 500-word article is not "more correct" than a 10-word article

**Evaluate:**
- ✓ CORRECT: Correctly classified content as EXISTS or UNKNOWN
- ✓ CORRECT: Recognized abrogated article as EXISTS with `is_abrogated: true`
- ✓ CORRECT: When only one candidate has EXISTS, it was selected as winner
- ✗ WRONG: Marked abrogated article as UNKNOWN or invalid
- ✗ WRONG: Eliminated candidate just because status was UNKNOWN
- ✗ WRONG: Preferred longer article content over shorter content

---

### 7. SEMANTIC DISAMBIGUATION (MAJOR — WHEN APPLICABLE)

Semantic matching should ONLY be used when:
1. Multiple candidates passed title matching
2. Range check did not resolve (multiple remain OR no ranges)
3. Multiple candidates have EXISTS status

**When semantic disambiguation IS appropriate:**

| Situation | Expected Behavior |
|-----------|-------------------|
| Citation context clearly matches ONE candidate's article subject | RESOLVED_BY_SEMANTIC, confidence 0.82-0.90 |
| Citation context matches NEITHER or BOTH article subjects | AMBIGUOUS, confidence 0.45-0.65 |
| Articles have identical subject matter | AMBIGUOUS, confidence 0.45-0.65 |

**Evaluate:**
- ✓ CORRECT: Semantic match correctly identified when articles have different subjects
- ✓ CORRECT: `semantic_match_reasoning` clearly explains the subject-matter match
- ✓ CORRECT: Returned AMBIGUOUS when semantic match was truly inconclusive
- ✗ WRONG: Ignored clear semantic match, returned AMBIGUOUS when one article clearly matched
- ✗ WRONG: Used semantic matching when only ONE candidate had EXISTS status
- ✗ WRONG: Used semantic matching when range check had already resolved
- ✗ WRONG: Claimed semantic resolution but reasoning doesn't support it

---

### 8. CONFIDENCE CALIBRATION (MAJOR)

Confidence should reflect the resolution method:

| Situation | Expected Confidence |
|-----------|---------------------|
| Single title match + EXISTS | 0.90 - 0.95 |
| Multiple matches → Resolved by range | 0.85 - 0.92 |
| Multiple matches → Resolved by existence (one EXISTS, others UNKNOWN) | 0.85 - 0.92 |
| Multiple matches → Resolved by semantic | 0.82 - 0.90 |
| All UNKNOWN, resolved by range only | 0.65 - 0.75 |
| Multiple matches → Ambiguous | 0.45 - 0.65 |
| No clear title match | 0.20 - 0.45 |

**Evaluate:**
- ✓ CORRECT: High confidence (0.85+) for clearly resolved matches
- ✓ CORRECT: Reduced confidence (0.45-0.65) for ambiguous cases
- ✗ WRONG: High confidence (>0.85) for AMBIGUOUS case
- ✗ WRONG: Low confidence (<0.80) for clearly resolved single match
- ✗ WRONG: Score and confidence significantly misaligned (e.g., score 90 but confidence 0.60)

---

### 9. AMBIGUITY HANDLING (MAJOR)

When multiple candidates could be correct:

**Evaluate:**
- ✓ CORRECT: Acknowledged ambiguity with `final_decision: "AMBIGUOUS"`
- ✓ CORRECT: Returned multiple matches with appropriate reduced scores
- ✓ CORRECT: `no_match_reason` explains why disambiguation was not possible
- ✗ WRONG: Picked one arbitrarily with high confidence when truly ambiguous
- ✗ WRONG: Claimed AMBIGUOUS when clear resolution was available (semantic or otherwise)
- ✗ WRONG: No acknowledgment of ambiguity when multiple candidates have equal claim

---

### 10. NO MATCH HANDLING (MAJOR)

When returning no match:

**Evaluate `no_match_reason`:**
- ✓ CORRECT: Clear explanation of why no match found
- ✓ CORRECT: `final_decision: "NO_MATCH"` with empty matches array
- ✓ CORRECT: Correctly identified that no title matches existed
- ✗ WRONG: `no_match_reason` is null when matches array is empty
- ✗ WRONG: Returned NO_MATCH when valid candidate existed
- ✗ WRONG: Vague or incorrect reason

---

### 11. FALSE POSITIVE AVOIDANCE (CRITICAL)

The system should prefer no match over wrong match.

**Evaluate:**
- ✓ CORRECT: Returned low confidence or AMBIGUOUS when uncertain
- ✓ CORRECT: Did not force a high-confidence match when none was clear
- ✗ WRONG: High confidence match to wrong document
- ✗ WRONG: Selected candidate based on content "relevance" when existence should have determined outcome
- ✗ WRONG: Ignored title mismatch because content seemed related
- ✗ WRONG: Preferred longer content over shorter content or abrogated article

---

## Scoring Rubric (0-100)

**Start at 100. Apply penalties:**

### CRITICAL Penalties (Each triggers FAIL):

| Issue | Penalty | Description |
|-------|---------|-------------|
| Wrong Code Family (Pass 1) | -40 | Correct code family not in Pass 1 results |
| Wrong Document Match | -40 | Selected clearly incorrect document |
| Missed Valid Match | -40 | Failed to select valid match that existed |
| False Positive | -45 | High confidence match to wrong document |
| Title Matching Bypassed | -35 | Jumped to content/semantic check without title matching |
| Abrogated Article Rejected | -35 | Treated abrogated article as invalid |

### MAJOR Penalties (-15 each):

| Issue | Description |
|-------|-------------|
| Wrong Final Decision | Claimed wrong resolution method |
| Decision Path Inconsistent | Path doesn't match final decision |
| Unnecessary Disambiguation | Used range/existence/semantic check when not needed |
| Missing Disambiguation | Didn't disambiguate when multiple matches existed |
| Range Check Error | Incorrect range include/exclude determination |
| Existence Check Error | Incorrect EXISTS/UNKNOWN classification |
| Semantic Match Ignored | Clear semantic match existed but returned AMBIGUOUS |
| Semantic Match Forced | Claimed semantic resolution when inconclusive |
| Confidence Miscalibration | Confidence doesn't match resolution method |
| Ambiguity Not Acknowledged | Forced high-confidence pick in truly ambiguous case |
| Invalid No Match Reason | Empty/vague reason when no match returned |
| UNKNOWN Treated as ABSENT | Eliminated candidate solely due to UNKNOWN status |

### MINOR Penalties (-5 each):

| Issue | Description |
|-------|-------------|
| Pass 1 Too Broad | Returned 4+ code families when fewer would suffice |
| Abbreviation Not Recognized | Missed common abbreviation (B.W., Ger.W., etc.) |
| Weak Reasoning | Generic or incomplete reasoning in decision path |
| Score/Confidence Mismatch | Minor inconsistency between score and confidence |
| Unnecessary Semantic Check | Used semantic matching when existence was sufficient |
| Missing is_abrogated Flag | Abrogated article not flagged as such |

---

## Special Cases

### Single-Document Codes (e.g., Code pénal)
- Only one document exists for this code
- Should be SINGLE_MATCH with high confidence (0.90-0.95)
- NO disambiguation tools should be used
- Penalize if system unnecessarily checked existence or used semantic matching

### Multi-Document Codes (e.g., Code civil)
- Multiple documents split by Livre/Partie
- Should use range check first to eliminate candidates
- Existence check only if range inconclusive
- Semantic matching only if multiple have EXISTS status
- Evaluate that disambiguation followed correct order: Range → Existence → Semantic

### Constitution/Grondwet
- Two versions: 1831 (historical) and 1994 (coordinated)
- Article numbers changed between versions (e.g., 1831 Art. 17 = education, 1994 Art. 17 = different topic)
- When both have the article but subjects differ, semantic matching should resolve
- When both have article with same/similar subject, should return AMBIGUOUS

### Abrogated Articles
- Abrogated articles ARE valid matches (status = EXISTS, is_abrogated = true)
- System should NOT reject based on "Abrogé/Opgeheven" content
- Citation may explicitly reference the abrogation
- Penalize heavily if system treated abrogation as invalid

### UNKNOWN Status
- UNKNOWN means "could not confirm" NOT "does not exist"
- May be extraction failure, not absence
- Should NOT eliminate candidates based solely on UNKNOWN status
- When one candidate is EXISTS and others UNKNOWN, EXISTS wins (RESOLVED_BY_EXISTENCE)
- When all are UNKNOWN, use range/title as weaker signals with reduced confidence

---

## Output Format

Return JSON only:

```json
{
  "verdict": "PASS | FAIL | REVIEW_REQUIRED",
  "score": 0-100,
  "confidence": "HIGH | MEDIUM | LOW",
  "evaluation": {
    "pass_1": {
      "code_family_correct": true | false,
      "code_family_precision": "OPTIMAL | ACCEPTABLE | SUBOPTIMAL | WRONG",
      "nl_fr_mapping_correct": true | false,
      "abbreviation_handled": true | false | "N/A"
    },
    "pass_2": {
      "final_decision_correct": true | false | "N/A",
      "title_matching_primary": true | false | "N/A",
      "decision_path_consistent": true | false | "N/A",
      "range_check_correct": true | false | "N/A",
      "existence_check_correct": true | false | "N/A",
      "semantic_disambiguation_correct": true | false | "N/A",
      "confidence_calibrated": true | false | "N/A",
      "ambiguity_handled": true | false | "N/A",
      "no_match_handling": true | false | "N/A",
      "abrogated_handled": true | false | "N/A"
    },
    "false_positive_avoided": true | false
  },
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "ACCEPT | REJECT | REVIEW_MANUALLY",
  "summary": "Brief summary of the evaluation."
}
```

---

## Verdict Logic

| Verdict | Condition |
|---------|-----------|
| **FAIL** | Score < 70 OR any CRITICAL issue |
| **REVIEW_REQUIRED** | Score 70-85 OR any MAJOR issue (without CRITICAL) |
| **PASS** | Score > 85 AND no CRITICAL or MAJOR issues |

**Note:** Any CRITICAL issue results in immediate FAIL regardless of score. The score then becomes informational only.

---

## Recommendation Logic

| Recommendation | When to Use |
|----------------|-------------|
| **ACCEPT** | PASS verdict, output is reliable |
| **REJECT** | FAIL verdict, output should not be used |
| **REVIEW_MANUALLY** | REVIEW_REQUIRED verdict, human should verify |

---

## Confidence (of your evaluation)

| Confidence | When to Use |
|------------|-------------|
| **HIGH** | Clear-cut case, obvious pass or fail |
| **MEDIUM** | Some ambiguity but reasonable conclusion |
| **LOW** | Difficult to evaluate, edge case |

---

## Examples

### Example 1: Single-Document Code — Perfect Match (PASS)
**Cited Article**: 193
**Cited Act**: "Strafwetboek"
**Candidates**: Only Code pénal document

**Pass 1 Output**: matches: ["Code pénal"]
**Pass 2 Output**: 
- decision_path: { title_matches: ["1867060850"], after_range_elimination: ["1867060850"], existence_status: { "1867060850": "EXISTS" }, semantic_disambiguation_used: false }
- matches: [{ document_number: "1867060850", confidence: 0.93, title_match: "MATCH", existence_status: "EXISTS" }]
- final_decision: "SINGLE_MATCH"

**Evaluation**:
- Pass 1 correct (NL→FR mapping) ✓
- Single title match correctly identified ✓
- No unnecessary disambiguation ✓
- High confidence appropriate ✓

```json
{
  "verdict": "PASS",
  "score": 100,
  "confidence": "HIGH",
  "evaluation": {
    "pass_1": {
      "code_family_correct": true,
      "code_family_precision": "OPTIMAL",
      "nl_fr_mapping_correct": true,
      "abbreviation_handled": "N/A"
    },
    "pass_2": {
      "final_decision_correct": true,
      "title_matching_primary": true,
      "decision_path_consistent": true,
      "range_check_correct": "N/A",
      "existence_check_correct": true,
      "semantic_disambiguation_correct": "N/A",
      "confidence_calibrated": true,
      "ambiguity_handled": "N/A",
      "no_match_handling": "N/A",
      "abrogated_handled": "N/A"
    },
    "false_positive_avoided": true
  },
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "ACCEPT",
  "summary": "Perfect single-document match. Correctly identified Strafwetboek as Code pénal, found single matching document with high confidence, no unnecessary disambiguation."
}
```

### Example 2: Multi-Document Code — Range Resolves (PASS)
**Cited Article**: 724
**Cited Act**: "Burgerlijk Wetboek"
**Candidates**: Code civil Livre I (1-515), Livre II (516-710), Livre III (711-1100)

**Pass 1 Output**: matches: ["Code civil"]
**Pass 2 Output**: 
- decision_path: { title_matches: ["1804032150", "1804032151", "1804032152"], after_range_elimination: ["1804032152"], existence_status: { "1804032152": "EXISTS" }, semantic_disambiguation_used: false }
- matches: [{ document_number: "1804032152", confidence: 0.88, range_status: "INCLUDES" }]
- final_decision: "RESOLVED_BY_RANGE"

**Evaluation**:
- Multiple Code civil documents correctly identified ✓
- Range check correctly used to disambiguate ✓
- Article 724 correctly placed in 711-1100 range ✓
- Other candidates correctly eliminated ✓

```json
{
  "verdict": "PASS",
  "score": 100,
  "confidence": "HIGH",
  "evaluation": {
    "pass_1": {
      "code_family_correct": true,
      "code_family_precision": "OPTIMAL",
      "nl_fr_mapping_correct": true,
      "abbreviation_handled": "N/A"
    },
    "pass_2": {
      "final_decision_correct": true,
      "title_matching_primary": true,
      "decision_path_consistent": true,
      "range_check_correct": true,
      "existence_check_correct": "N/A",
      "semantic_disambiguation_correct": "N/A",
      "confidence_calibrated": true,
      "ambiguity_handled": "N/A",
      "no_match_handling": "N/A",
      "abrogated_handled": "N/A"
    },
    "false_positive_avoided": true
  },
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "ACCEPT",
  "summary": "Correct multi-document resolution. Range check correctly identified Livre III for article 724. Decision path shows correct elimination of other candidates."
}
```

### Example 3: Constitution — Semantic Resolution (PASS)
**Cited Article**: 17
**Cited Act**: "de Belgische Grondwet"
**Citation Paragraph**: "...schending van de door artikel 17 van de Grondwet gegarandeerde vrijheid van onderwijs..."
**Candidates**: 
- 1831020701: Constitution 1831, Article 17: "L'enseignement est libre..."
- 1994021048: Constitution 1994, Article 17: "Les biens ne peuvent être expropriés..."

**Pass 1 Output**: matches: ["Constitution", "Grondwet"]
**Pass 2 Output**: 
- decision_path: { 
    title_matches: ["1831020701", "1994021048"], 
    after_range_elimination: ["1831020701", "1994021048"], 
    existence_status: { "1831020701": "EXISTS", "1994021048": "EXISTS" }, 
    semantic_disambiguation_used: true,
    semantic_match_reasoning: "Citation discusses 'vrijheid van onderwijs' (freedom of education). 1831 Art. 17 is about education freedom. 1994 Art. 17 is about expropriation. Clear semantic match to 1831."
  }
- matches: [{ document_number: "1831020701", confidence: 0.88, existence_status: "EXISTS" }]
- final_decision: "RESOLVED_BY_SEMANTIC"

**Evaluation**:
- Both constitutions have Article 17 ✓
- Both classified as EXISTS ✓
- Semantic disambiguation correctly applied ✓
- Citation about education matches 1831 Art. 17 (education) not 1994 Art. 17 (expropriation) ✓
- Reasoning clearly explains the match ✓

```json
{
  "verdict": "PASS",
  "score": 100,
  "confidence": "HIGH",
  "evaluation": {
    "pass_1": {
      "code_family_correct": true,
      "code_family_precision": "ACCEPTABLE",
      "nl_fr_mapping_correct": true,
      "abbreviation_handled": "N/A"
    },
    "pass_2": {
      "final_decision_correct": true,
      "title_matching_primary": true,
      "decision_path_consistent": true,
      "range_check_correct": "N/A",
      "existence_check_correct": true,
      "semantic_disambiguation_correct": true,
      "confidence_calibrated": true,
      "ambiguity_handled": "N/A",
      "no_match_handling": "N/A",
      "abrogated_handled": "N/A"
    },
    "false_positive_avoided": true
  },
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "ACCEPT",
  "summary": "Correct semantic disambiguation for Constitution case. Both versions have Article 17, but 1831 version discusses education (matching citation context) while 1994 version discusses expropriation. System correctly resolved to 1831."
}
```

### Example 4: Constitution — Truly Ambiguous (PASS)
**Cited Article**: 10
**Cited Act**: "Grondwet"
**Citation Paragraph**: "...artikel 10 van de Grondwet..."
**Candidates**: 
- 1831020701: Constitution 1831, Article 10: "Les Belges sont égaux..."
- 1994021048: Constitution 1994, Article 10: "Les Belges sont égaux devant la loi..."

**Pass 1 Output**: matches: ["Constitution"]
**Pass 2 Output**: 
- decision_path: { 
    title_matches: ["1831020701", "1994021048"], 
    after_range_elimination: ["1831020701", "1994021048"], 
    existence_status: { "1831020701": "EXISTS", "1994021048": "EXISTS" }, 
    semantic_disambiguation_used: true,
    semantic_match_reasoning: "Both articles discuss equality. Citation context does not differentiate."
  }
- matches: [
    { document_number: "1994021048", confidence: 0.60 },
    { document_number: "1831020701", confidence: 0.55 }
  ]
- final_decision: "AMBIGUOUS"
- no_match_reason: "Both Constitution versions contain Article 10 with similar equality provisions. Cannot determine which version is cited."

**Evaluation**:
- Both have Article 10 with same subject (equality) ✓
- Semantic disambiguation attempted but correctly found inconclusive ✓
- Returned AMBIGUOUS with reduced confidence ✓
- Explained why resolution not possible ✓

```json
{
  "verdict": "PASS",
  "score": 95,
  "confidence": "HIGH",
  "evaluation": {
    "pass_1": {
      "code_family_correct": true,
      "code_family_precision": "OPTIMAL",
      "nl_fr_mapping_correct": true,
      "abbreviation_handled": "N/A"
    },
    "pass_2": {
      "final_decision_correct": true,
      "title_matching_primary": true,
      "decision_path_consistent": true,
      "range_check_correct": "N/A",
      "existence_check_correct": true,
      "semantic_disambiguation_correct": true,
      "confidence_calibrated": true,
      "ambiguity_handled": true,
      "no_match_handling": "N/A",
      "abrogated_handled": "N/A"
    },
    "false_positive_avoided": true
  },
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "ACCEPT",
  "summary": "Correct handling of truly ambiguous Constitution case. Both versions contain Article 10 with similar equality provisions. System appropriately returned AMBIGUOUS with reduced confidence."
}
```

### Example 5: Abrogated Article IS Correct Match (PASS)
**Cited Article**: 1792
**Cited Act**: "B.W."
**Citation Paragraph**: "...artikel 1792 B.W., dat werd opgeheven bij wet van 1 juli 2011..."
**Candidates**: 
- 1804032152: Code civil Livre III, Article: "Art. 1792. Abrogé par la loi du 1er juillet 2011"
- 2019A12168: Code civil Livre 4, Article: Not available

**Pass 1 Output**: matches: ["Code civil"]
**Pass 2 Output**: 
- decision_path: { 
    title_matches: ["1804032152", "2019A12168"], 
    after_range_elimination: ["1804032152", "2019A12168"], 
    existence_status: { "1804032152": "EXISTS", "2019A12168": "UNKNOWN" }, 
    semantic_disambiguation_used: false
  }
- matches: [{ document_number: "1804032152", confidence: 0.90, existence_status: "EXISTS", is_abrogated: true }]
- final_decision: "RESOLVED_BY_EXISTENCE"

**Evaluation**:
- B.W. correctly mapped to Code civil ✓
- Abrogated article classified as EXISTS ✓
- is_abrogated flag set to true ✓
- UNKNOWN candidate not eliminated, but EXISTS wins ✓

```json
{
  "verdict": "PASS",
  "score": 100,
  "confidence": "HIGH",
  "evaluation": {
    "pass_1": {
      "code_family_correct": true,
      "code_family_precision": "OPTIMAL",
      "nl_fr_mapping_correct": true,
      "abbreviation_handled": true
    },
    "pass_2": {
      "final_decision_correct": true,
      "title_matching_primary": true,
      "decision_path_consistent": true,
      "range_check_correct": "N/A",
      "existence_check_correct": true,
      "semantic_disambiguation_correct": "N/A",
      "confidence_calibrated": true,
      "ambiguity_handled": "N/A",
      "no_match_handling": "N/A",
      "abrogated_handled": true
    },
    "false_positive_avoided": true
  },
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "ACCEPT",
  "summary": "Correct handling of abrogated article. B.W. abbreviation recognized, abrogated article correctly classified as EXISTS with is_abrogated flag. Citation explicitly references the abrogation."
}
```

### Example 6: Wrong Code Family (FAIL)
**Cited Article**: 1382
**Cited Act**: "B.W."

**Pass 1 Output**: matches: ["Code judiciaire"]  ← WRONG

**Evaluation**:
- B.W. = Burgerlijk Wetboek = Code civil, NOT Code judiciaire ✗
- Pass 2 not evaluated due to cascade failure

```json
{
  "verdict": "FAIL",
  "score": 60,
  "confidence": "HIGH",
  "evaluation": {
    "pass_1": {
      "code_family_correct": false,
      "code_family_precision": "WRONG",
      "nl_fr_mapping_correct": false,
      "abbreviation_handled": false
    },
    "pass_2": {
      "final_decision_correct": "N/A",
      "title_matching_primary": "N/A",
      "decision_path_consistent": "N/A",
      "range_check_correct": "N/A",
      "existence_check_correct": "N/A",
      "semantic_disambiguation_correct": "N/A",
      "confidence_calibrated": "N/A",
      "ambiguity_handled": "N/A",
      "no_match_handling": "N/A",
      "abrogated_handled": "N/A"
    },
    "false_positive_avoided": false
  },
  "criticalIssues": ["Wrong code family: B.W. is Burgerlijk Wetboek (Code civil), not Code judiciaire"],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "REJECT",
  "summary": "Critical Pass 1 failure. System incorrectly mapped B.W. (Burgerlijk Wetboek) to Code judiciaire instead of Code civil. Pass 2 not evaluated due to cascade."
}
```

### Example 7: High Confidence on Ambiguous Case (FAIL)
**Cited Article**: 10
**Cited Act**: "Grondwet"
**Candidates**: Constitution 1831 and 1994 (both contain Article 10 with equality provisions)

**Pass 2 Output**: 
- final_decision: "RESOLVED_BY_SEMANTIC"  ← WRONG
- matches: [{ document_number: "1994021048", confidence: 0.92 }]  ← TOO HIGH

**Evaluation**:
- Both documents contain Article 10 with same subject ✗
- Should be AMBIGUOUS, not RESOLVED_BY_SEMANTIC ✗
- Confidence too high for ambiguous case ✗

```json
{
  "verdict": "FAIL",
  "score": 55,
  "confidence": "HIGH",
  "evaluation": {
    "pass_1": {
      "code_family_correct": true,
      "code_family_precision": "OPTIMAL",
      "nl_fr_mapping_correct": true,
      "abbreviation_handled": "N/A"
    },
    "pass_2": {
      "final_decision_correct": false,
      "title_matching_primary": true,
      "decision_path_consistent": false,
      "range_check_correct": "N/A",
      "existence_check_correct": true,
      "semantic_disambiguation_correct": false,
      "confidence_calibrated": false,
      "ambiguity_handled": false,
      "no_match_handling": "N/A",
      "abrogated_handled": "N/A"
    },
    "false_positive_avoided": false
  },
  "criticalIssues": ["False positive: High confidence (0.92) on ambiguous Constitution match when both versions contain Article 10 with same subject"],
  "majorIssues": ["Ambiguity not acknowledged", "Confidence miscalibrated", "Semantic disambiguation incorrect"],
  "minorIssues": [],
  "recommendation": "REJECT",
  "summary": "System incorrectly claimed RESOLVED_BY_SEMANTIC with high confidence when both Constitution versions contain Article 10 with similar equality provisions. Should have returned AMBIGUOUS with reduced confidence."
}
```

### Example 8: Abrogated Article Incorrectly Rejected (FAIL)
**Cited Article**: 1792
**Cited Act**: "Code civil"
**Candidates**: Code civil Livre III with article content "Art. 1792. Abrogé"

**Pass 2 Output**: 
- final_decision: "NO_MATCH"  ← WRONG
- no_match_reason: "Article is abrogated, not a valid match"  ← WRONG

**Evaluation**:
- Abrogated articles ARE valid matches ✗
- System incorrectly rejected based on abrogation ✗

```json
{
  "verdict": "FAIL",
  "score": 50,
  "confidence": "HIGH",
  "evaluation": {
    "pass_1": {
      "code_family_correct": true,
      "code_family_precision": "OPTIMAL",
      "nl_fr_mapping_correct": true,
      "abbreviation_handled": "N/A"
    },
    "pass_2": {
      "final_decision_correct": false,
      "title_matching_primary": false,
      "decision_path_consistent": false,
      "range_check_correct": "N/A",
      "existence_check_correct": false,
      "semantic_disambiguation_correct": "N/A",
      "confidence_calibrated": false,
      "ambiguity_handled": "N/A",
      "no_match_handling": false,
      "abrogated_handled": false
    },
    "false_positive_avoided": false
  },
  "criticalIssues": ["Missed valid match: Abrogated article was incorrectly rejected as invalid"],
  "majorIssues": ["Existence check error: 'Abrogé' indicates article EXISTS", "No match handling incorrect"],
  "minorIssues": [],
  "recommendation": "REJECT",
  "summary": "System incorrectly rejected abrogated article as invalid match. Abrogated articles exist in the document and are valid matches — the citation may reference the abrogation itself."
}
```

### Example 9: Unnecessary Disambiguation (REVIEW_REQUIRED)
**Cited Article**: 193
**Cited Act**: "Code pénal"
**Candidates**: Only one Code pénal document

**Pass 2 Output**: 
- decision_path: { semantic_disambiguation_used: true }  ← UNNECESSARY
- final_decision: "SINGLE_MATCH"
- matches: [{ document_number: "1867060850", confidence: 0.93 }]

**Evaluation**:
- Single document, no disambiguation needed ✗
- Final result is correct, but process was inefficient ✓

```json
{
  "verdict": "REVIEW_REQUIRED",
  "score": 80,
  "confidence": "HIGH",
  "evaluation": {
    "pass_1": {
      "code_family_correct": true,
      "code_family_precision": "OPTIMAL",
      "nl_fr_mapping_correct": true,
      "abbreviation_handled": "N/A"
    },
    "pass_2": {
      "final_decision_correct": true,
      "title_matching_primary": true,
      "decision_path_consistent": false,
      "range_check_correct": "N/A",
      "existence_check_correct": "N/A",
      "semantic_disambiguation_correct": "N/A",
      "confidence_calibrated": true,
      "ambiguity_handled": "N/A",
      "no_match_handling": "N/A",
      "abrogated_handled": "N/A"
    },
    "false_positive_avoided": true
  },
  "criticalIssues": [],
  "majorIssues": ["Unnecessary disambiguation for single-document code"],
  "minorIssues": [],
  "recommendation": "REVIEW_MANUALLY",
  "summary": "Correct final match but inefficient process. Semantic disambiguation was used unnecessarily when single title match was sufficient. Result is valid but methodology is suboptimal."
}
```

### Example 10: Semantic Match Ignored (FAIL)
**Cited Article**: 17
**Cited Act**: "Grondwet"
**Citation Paragraph**: "...vrijheid van onderwijs..."
**Candidates**: 
- 1831020701: Article 17 about education freedom
- 1994021048: Article 17 about expropriation

**Pass 2 Output**: 
- final_decision: "AMBIGUOUS"  ← WRONG
- matches: [
    { document_number: "1831020701", confidence: 0.60 },
    { document_number: "1994021048", confidence: 0.55 }
  ]

**Evaluation**:
- Clear semantic match exists (education → 1831) ✗
- Should be RESOLVED_BY_SEMANTIC with 1831 winning ✗

```json
{
  "verdict": "FAIL",
  "score": 60,
  "confidence": "HIGH",
  "evaluation": {
    "pass_1": {
      "code_family_correct": true,
      "code_family_precision": "OPTIMAL",
      "nl_fr_mapping_correct": true,
      "abbreviation_handled": "N/A"
    },
    "pass_2": {
      "final_decision_correct": false,
      "title_matching_primary": true,
      "decision_path_consistent": false,
      "range_check_correct": "N/A",
      "existence_check_correct": true,
      "semantic_disambiguation_correct": false,
      "confidence_calibrated": false,
      "ambiguity_handled": false,
      "no_match_handling": "N/A",
      "abrogated_handled": "N/A"
    },
    "false_positive_avoided": true
  },
  "criticalIssues": ["Missed valid resolution: Clear semantic match to 1831 (education) was ignored"],
  "majorIssues": ["Semantic match ignored", "Final decision incorrect"],
  "minorIssues": [],
  "recommendation": "REJECT",
  "summary": "System returned AMBIGUOUS when clear semantic resolution was available. Citation discusses 'vrijheid van onderwijs' (education freedom) which matches 1831 Art. 17, not 1994 Art. 17 (expropriation). Should have returned RESOLVED_BY_SEMANTIC with 1831."
}
