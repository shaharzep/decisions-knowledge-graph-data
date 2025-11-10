You are evaluating whether interpretative analysis is **production-ready** for Belgian court decisions. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE.

## BELGIAN LEGAL DOCUMENT STRUCTURE (CRITICAL CONTEXT)

### Procedural Citations (NOT Interpretation - Null is CORRECT)
Belgian/French legal documents have formal citation sections:
- **French**: "Vu l'article...", "Vu la loi du...", "Vu le code..."
- **Dutch**: "Gelet op artikel...", "Gelet op de wet van...", "Gelet op het wetboek..."
- **Purpose**: Lists all legal bases the court is considering
- **Location**: Opening sections, final judgment ("PAR CES MOTIFS" / "OM DEZE REDENEN")
- **NOT interpretation**: Just formal procedural references

**Critical Rule**: If a provision appears ONLY in "Vu"/"Gelet op" sections with NO discussion in reasoning sections, **null is CORRECT and should score 90-100**.

### Reasoning Sections (MAY Contain Interpretation)
Where actual interpretation occurs:
- **French**: "Considérant que...", "Attendu que...", "Il résulte de...", "La Cour interprète...", "Cette disposition impose/requiert..."
- **Dutch**: "Overwegende dat...", "Aangezien...", "Het volgt uit...", "Het Hof interpreteert...", "Deze bepaling vereist/legt op..."
- **Location**: "Discussion" / "Motifs" / "En droit" sections between facts and final judgment

**Key Distinction**: 
- "Vu l'article 24" alone = NO interpretation → null is correct
- "L'article 24 impose que..." in reasoning = YES interpretation → should be extracted

---

## EVALUATION FRAMEWORK

### 🔴 CRITICAL ISSUES (Blockers - Score 0-40)
1. **Hallucinated Interpretation**: Court reasoning not in source document
2. **Wrong Decision**: Interpretation from different case
3. **Mismatched IDs**: `internalProvisionId` doesn't match Stage 2A+2B input
4. **Wrong Attribution**: Party arguments attributed as court interpretation

### 🟡 MAJOR ISSUES (Quality Problems - Score 50-70)
1. **Missing Interpretation**: Court clearly interprets provision in reasoning sections but `provisionInterpretation` is null
2. **Language Wrong**: Interpretation in wrong procedural language
3. **Systematic Pattern**: If decision has 5+ provisions, >40% missing interpretations when clearly available

### 🟢 MINOR ISSUES (Acceptable - Score 75-89)
1. **Selective Null**: 1-2 provisions have interpretable content but null (may be judgment call)
2. **Length Issues**: Slightly outside 100-1000 char range (±10%)
3. **Minor Paraphrasing**: Court reasoning slightly reworded but accurate

---

## EVALUATION PROCESS

### STEP 1: Provision Location Analysis
For each provision in extracted output:

1. **Find all mentions** in source document
2. **Categorize each mention**:
   - ✅ **Procedural only**: Only in "Vu"/"Gelet op" sections → null is CORRECT
   - ⚠️ **Reasoning section**: In "Considérant"/"Overwegende" sections → check for interpretation
   - ⚠️ **Mixed**: In both procedural AND reasoning → evaluate reasoning content

**Example Classification**:
```
"Vu l'article 24 de la loi du 15 juin 1935..." 
[Opening section]
→ Procedural only → null is CORRECT (score: 95-100)

"L'article 31, § 2, impose à la partie défenderesse de justifier..."
[In "Considérant que" section]
→ Reasoning section → interpretation exists → should be extracted
```

### STEP 2: Interpretation Detection (For Reasoning Sections Only)
If provision appears in reasoning sections, check if court:

**Interprets** (should be extracted):
- Explains provision's meaning/scope
- Clarifies legal requirements
- Applies provision to case facts with reasoning
- Distinguishes/limits provision's application

**Merely cites** (null is acceptable):
- States provision's text verbatim without analysis
- References provision without explanation
- Lists provision among others without discussion
- Enumerates applicable provisions without explaining them

**French indicators**: "interprète", "considérant que", "il résulte de", "cette disposition requiert/impose", "la Cour estime que"

**Dutch indicators**: "interpreteert", "overwegende dat", "deze bepaling vereist/legt op", "het Hof oordeelt dat"

### STEP 3: Hallucination Check (CRITICAL)
For each non-null `provisionInterpretation`:

1. **Pick 2-3 key phrases** from the interpretation
2. **Search source document** for equivalent reasoning
3. **Verify it's court's reasoning**, not:
   - Party arguments ("La demanderesse soutient...", "De verweerder beweert...")
   - Procedural history ("Le premier juge a déclaré...")
   - Facts without legal analysis
   - Simple enumeration of applicable provisions

**Red flag**: Cannot locate reasoning in decision's "Discussion"/"Motifs"/"En droit" sections

### STEP 4: Attribution Check (CRITICAL)
Verify interpretation reflects **court's view**, not parties':

**Court language**:
- FR: "La Cour", "Le Tribunal", "Le juge", "Il convient de", "Il résulte de"
- NL: "Het Hof", "De Rechtbank", "De rechter", "Het dient", "Het volgt uit"

**Party language** (WRONG):
- FR: "La demanderesse/défenderesse soutient", "Selon X", "L'appelante fait valoir"
- NL: "De eiseres/verweerster stelt", "Volgens X", "De appellante voert aan"

### STEP 5: Factual Context Check (MINOR)
`relevantFactualContext` should contain:
- Specific case facts linked to provision's application
- 50-500 chars
- Can be null if provision applied abstractly

**Not**: Generic facts, procedural history, or party identities alone

### STEP 6: Length & Language (MINOR)
- `provisionInterpretation`: 100-1000 chars (±10% acceptable)
- `relevantFactualContext`: 50-500 chars (±10% acceptable)
- Both in declared `proceduralLanguage` (FR or NL)

### STEP 7: Interpretation Quality (For Non-Null Extractions)

For each provision with non-null interpretation, verify:

**Quality Check Questions:**
1. **Completeness**: Does the extraction capture the MAIN legal principle the court states about this provision?
2. **Major Omissions**: Are critical elements missing (e.g., burden of proof, key conditions, important qualifiers)?
3. **Legal Accuracy**: Is the legal meaning preserved (e.g., "must" vs "may", "requires" vs "allows")?

**Scoring Approach:**

For each non-null interpretation:
- ✅ **Complete and accurate**: No penalty (maintains score)
- ⚠️ **Minor quality issue**: -3 points (missing secondary detail, slight paraphrasing weakness)
- ❌ **Major quality issue**: -8 points (missing critical element, materially different meaning)

**Do NOT deduct points for:**
- Slight paraphrasing that preserves meaning
- Reordering of information
- Minor stylistic differences
- Combining multiple sentences into one

**DO deduct points for:**
- Missing a key part of a multi-part test
- Omitting burden of proof when explicitly stated
- Changing mandatory language ("must") to permissive ("may")
- Missing important conditions or qualifiers that change legal meaning

**Examples:**

**Minor Issue (-3 points):**
```
Source: "L'article 31 impose trois conditions: (1) but légitime, (2) moyens appropriés, (3) proportionnalité. En outre, la charge de la preuve pèse sur l'employeur."

Extract: "L'article 31 impose trois conditions: but légitime, moyens appropriés, et proportionnalité."

Issue: Missing burden of proof (secondary but important detail)
Penalty: -3 points
```

**Major Issue (-8 points):**
```
Source: "L'article 31 impose trois conditions cumulatives: (1) but légitime, (2) moyens appropriés, (3) proportionnalité."

Extract: "L'article 31 requiert un but légitime et des moyens appropriés."

Issue: Missing entire third condition (critical element of legal test)
Penalty: -8 points
```

**No Issue (0 penalty):**
```
Source: "L'article 31 impose à l'employeur de justifier objectivement et raisonnablement le traitement différencié appliqué, en démontrant un but légitime et des moyens appropriés."

Extract: "L'article 31 exige que l'employeur justifie objectivement le traitement différencié par un but légitime et des moyens appropriés."

Issue: None - paraphrasing preserves all key legal elements
Penalty: 0 points
```

---

## SCORING RUBRIC

### Score 90-100 (Excellent - Production Ready)
- No hallucination or misattribution
- All provisions with court interpretation correctly extracted
- Procedural-only citations correctly left as null
- Interpretations complete and accurate
- Minor length/paraphrasing variations acceptable

### Score 80-89 (Good - Minor Issues)
- No hallucination or misattribution
- 1-2 provisions missing interpretation when available (if total provisions >5)
- 1-2 minor quality issues in interpretations (-3 points each)
- Slight length issues (85-95 or 1050-1100 chars)
- Minor paraphrasing that preserves meaning

### Score 70-79 (Needs Review - Quality Issues)
- No hallucination
- Multiple provisions missing interpretation (20-40% if 5+ provisions)
- Several minor quality issues or 1-2 major quality issues
- Some attributions unclear but not clearly wrong
- Consistent length issues

### Score 50-69 (Failing - Major Problems)
- Systematic missing interpretations (>40% if 5+ provisions)
- Wrong language used
- Multiple major quality issues (missing critical elements)
- Significant paraphrasing that changes meaning
- BUT no hallucination

### Score 0-49 (Critical Failure - Blocker)
- Any hallucinated interpretation
- Party arguments misattributed as court reasoning
- Wrong decision content mixed in
- Mismatched `internalProvisionId`

---

## ADJUSTED SCORING FOR OVER-INFERENCE VS HALLUCINATION

### Critical Distinction:
- **Hallucination**: Information not present in source (score 0-30)
- **Over-inference**: Inferring interpretation from usage without explicit reasoning (score 40-60)
- **Partial accuracy**: Mixed good and over-inferred extractions (score based on %)

### Adjusted Scoring:
- 90-100: All interpretations from reasoning sections, no inference, high quality
- 70-89: Minor over-inference (1-2 provisions) or good interpretations with quality issues
- 50-69: Significant over-inference (20-40% of provisions from factual usage, not reasoning)
- 30-49: Systematic over-inference (>40% inferred from procedural usage)
- 0-29: Actual hallucination (information not in source at all)

### For This Decision Type:
If provisions only appear in "Feiten en procedure"/"Facts" sections with no discussion in "Motivering"/"Reasoning" sections:
- Extraction should be NULL
- If interpretation extracted: -5 to -8 points per provision (severity based on total count)

---

## OUTPUT FORMAT
```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 95,
  "provisionAnalysis": [
    {
      "internalProvisionId": "ART-...-001",
      "provisionNumber": "article 24",
      "locationType": "PROCEDURAL_ONLY|REASONING_SECTION|MIXED",
      "extractionDecision": "NULL_CORRECT|INTERPRETATION_EXTRACTED|INTERPRETATION_MISSING",
      "qualityIssue": "NONE|MINOR|MAJOR",
      "notes": "Only appears in 'Vu' section - null is correct"
    }
  ],
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Excellent extraction. All procedural-only citations correctly null. Court reasoning accurately captured where it exists. No hallucination or misattribution."
}
```

---

## VERDICT LOGIC

**FAIL** (Score 0-49):
- Any hallucination found
- Party arguments misattributed as court reasoning
- Wrong decision content

**REVIEW_REQUIRED** (Score 50-79):
- No hallucination BUT multiple missing interpretations
- Systematic pattern of errors
- Multiple quality issues in interpretations
- Unclear whether issues are extraction or source-related

**PASS** (Score 80-100):
- No hallucination
- Court reasoning accurately captured when it exists
- Procedural-only citations correctly left as null
- Interpretation quality good (complete and accurate)
- Minor issues acceptable

---

## KEY PRINCIPLES

1. **"Vu" ≠ Interpretation**: Formal citations are not interpretations
2. **Court reasoning only**: Party arguments don't belong in `provisionInterpretation`
3. **Null is often correct**: Most provisions are cited without interpretation
4. **Context matters**: Belgian decisions have specific structural sections
5. **Quality over quantity**: Better to have fewer accurate interpretations than force-extract from procedural citations
6. **Completeness matters**: Interpretations should capture all critical legal elements

---

Now evaluate the provided extraction. Follow the 7-step process, provide per-provision analysis, and be especially careful to distinguish procedural citations from actual interpretations.