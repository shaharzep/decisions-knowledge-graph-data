You are evaluating whether a data extraction from a Belgian court decision is **production-ready**. Compare the EXTRACTED OUTPUT against the ORIGINAL SOURCE.

## EVALUATION FRAMEWORK

Grade extractions using a **3-tier severity system**:

### ?? CRITICAL ISSUES (Blockers - Must Fix)
These make the extraction **unusable**. ANY critical issue = FAIL.

1. **Wrong Language**: Extraction in French when source is Dutch (or vice versa)
2. **Hallucinated Content**: Text in extraction not present in source document (invented facts/arguments)
3. **Wrong Decision**: Extraction appears to be from completely different case
4. **Missing Court Order**: `courtOrder` field empty when dispositif exists in source
5. **Court Order Not Verbatim**: `courtOrder` paraphrased or summarized (MUST be exact)
6. **Empty Core Content**: `facts`, `requests[]`, or `arguments[]` empty when content clearly available

### ?? MAJOR ISSUES (Quality Problems - Review Required)
These reduce value significantly. 2+ major issues = requires review before production.

1. **Inaccurate Content**: Facts/requests/arguments don't accurately represent source (wrong dates, amounts, or key details)
2. **Significant Missing Content**: Missing >30% of parties, facts, or arguments from source
3. **Language Mismatch**: `proceduralLanguage` incorrectly identified
4. **Multiple Broken References**: 3+ `partyId` references pointing to non-existent parties
5. **Wrong Enum Values**: Multiple enum values not from approved lists or wrong language variant

### ?? MINOR ISSUES (Acceptable - Can Proceed)
These are acceptable for production launch. Note but don't block on these.

1. **Synthesis Style**: Facts/arguments synthesized rather than verbatim (acceptable if accurate)
2. **One Missing Element**: One party, fact, or argument not extracted
3. **One Broken Reference**: Single `partyId` pointing to non-existent party
4. **Minor Enum Issues**: 1-2 enum values incorrect
5. **Minor Length Issues**: Fields slightly outside char limits

---

## SPECIFIC CHECKS

### 1. Language Verification (CRITICAL)
- Source language vs `proceduralLanguage`: Match?
- Content language: All in declared language?
- **Red flag**: FR extraction when source clearly Dutch

### 2. Accuracy Check (MAJOR) - REVISED
For facts, requests, arguments:
- **NOT checking**: Whether verbatim vs synthesized
- **CHECKING**: Whether accurate representation of source
- Are dates, amounts, relationships correct?
- Are key details preserved?
- Is substance captured completely?
- **Red flag**: Wrong dates, missing key details, distorted facts

### 3. Court Order Verbatim Check (CRITICAL) - STRICT
- `courtOrder` copied exactly from dispositif?
- No paraphrasing or summarization?
- All operative parts included?
- **Red flag**: Any modification of dispositif text

### 4. Completeness Check (MAJOR)
- All parties extracted?
- Key facts present (don't need ALL if minor details)?
- Main arguments captured?
- **Red flag**: <70% of important content extracted

### 5. Reference Integrity (MAJOR if multiple)
- `requests[].partyId` values exist in `parties[].id`?
- `arguments[].partyId` values exist in `parties[].id`?
- **Red flag**: 3+ orphaned references

### 6. Hallucination Check (CRITICAL)
- Pick 2-3 facts/arguments, verify in source
- Is content actually in decision?
- **Red flag**: Cannot find extracted content in source

### 7. Enum Validation (MAJOR if multiple)
- All enum values from approved comprehensive lists?
- Language-specific enums match `proceduralLanguage`?
- **Check these enums**:
  - `parties[].type`: NATURAL_PERSON, LEGAL_ENTITY, PUBLIC_AUTHORITY, OTHER, UNCLEAR
  - `parties[].proceduralRole`: Language-specific (FR: DEMANDEUR, APPELANT, DEMANDEUR EN CASSATION, MINISTERE PUBLIC, etc. / NL: EISER, APPELLANT, EISER IN CASSATIE, OPENBAAR MINISTERIE, etc.)
  - `arguments[].treatment`: Language-specific (FR: ACCEPTE, REJETE, IRRECEVABLE, SANS OBJET, etc. / NL: AANVAARD, VERWORPEN, NIET-ONTVANKELIJK, ZONDER VOORWERP, etc.)
  - `currentInstance.outcome`: Language-specific (FR: FONDÉ, CASSATION, CONFIRMATION, IRRECEVABILITE, etc. / NL: GEGROND, CASSATIE, BEVESTIGING, NIET ONTVANKELIJKHEID, etc.)
- **Red flag**: 3+ invalid enum values or consistent language mismatches

### 8. Schema Compliance (MAJOR)
- `facts` is single string (not array)?
- `requests` field name is plural?
- `parties[].id` format: `PARTY-{decisionId}-{sequence}` with 3 digits?
- Character limits respected (requests 50-1000, arguments 200-2000)?
- **Red flag**: Multiple schema violations

---

## OUTPUT FORMAT
```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 85,
  "criticalIssues": [],
  "majorIssues": [
    "Two facts have wrong dates",
    "One main argument not extracted"
  ],
  "minorIssues": [
    "Facts synthesized rather than verbatim (acceptable if accurate)",
    "One partyId reference broken"
  ],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "Good extraction with accurate content. Facts synthesized clearly (acceptable). Court order verbatim (correct). Main issues: wrong dates in two facts, one missing argument."
}
```

---

## VERDICT LOGIC

**FAIL** (Score 0-59):
- ANY critical issue detected
- Court order not verbatim
- Hallucinated content
- Wrong language

**REVIEW_REQUIRED** (Score 60-79):
- 2+ major issues (inaccuracy, incompleteness, multiple enum errors)
- No critical issues

**PASS** (Score 80-100):
- Accurate and complete content
- Court order verbatim
- Only minor issues
- Synthesis acceptable if accurate

---

## SCORING GUIDE

**90-100**: Excellent
- Accurate and complete
- Court order verbatim
- No significant issues
- Synthesis acceptable if accurate
- Valid enums

**80-89**: Good
- Mostly accurate and complete
- Court order verbatim
- One missing element or minor inaccuracies
- 1-2 enum issues acceptable
- Acceptable for production

**60-79**: Fair
- Multiple inaccuracies or missing content
- Court order may have issues
- Multiple enum errors
- Requires review

**0-59**: Poor
- Critical issues
- Court order not verbatim
- Hallucinated content
- Must fix

---

## WHAT TO EMPHASIZE IN YOUR REVIEW

**Most Important:**
1. Is this the right decision? (not mixed with another case)
2. Is the language correct? (FR/NL match)
3. Are critical sections present? (courtOrder, facts, arguments)
4. Is courtOrder verbatim? (MUST be exact)
5. Are facts/arguments accurate? (don't penalize synthesis if accurate)

**Important:**
6. Is content complete? (all parties, key facts)
7. Are enums valid? (from approved comprehensive lists, correct language)
8. Are references valid? (partyId integrity)

**Less Important:**
9. Is extraction style verbatim vs synthesized? (acceptable either way if accurate)
10. Party ID format (can be validated separately)
11. One missing fact/argument (acceptable loss)

---

## KEY CHANGES FROM PREVIOUS VERSION

**REMOVED:**
- ? Penalizing synthesis/paraphrasing of facts/requests/arguments
- ? "Verbatim extraction" as quality criterion for facts/requests/arguments

**ADDED:**
- ? Focus on accuracy regardless of extraction style
- ? Accept synthesis if accurate and complete
- ? Enum validation against comprehensive lists
- ? Schema compliance checks (facts as string, requests plural)

**MAINTAINED:**
- ? Strict verbatim requirement for courtOrder only
- ? Hallucination detection
- ? Completeness checking
- ? Reference integrity

**PHILOSOPHY:**
- Facts/Requests/Arguments: "Is it accurate and complete?" (synthesis OK)
- Court Order: "Is it verbatim?" (synthesis NOT OK)
- Enums: "Are values from approved comprehensive lists and correct language?"

---

## EXAMPLE EVALUATIONS

**Example 1: PASS**
```json
{
  "verdict": "PASS",
  "score": 88,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [
    "Facts synthesized from scattered paragraphs (acceptable - accurate)",
    "One proceduralRole enum uses old value (minor)"
  ],
  "recommendation": "PROCEED",
  "confidence": "HIGH",
  "summary": "Strong extraction. All content accurate and complete. Court order verbatim. Facts synthesized clearly but preserve all key details and dates. Minor enum issue acceptable."
}
```

**Example 2: FAIL**
```json
{
  "verdict": "FAIL",
  "score": 35,
  "criticalIssues": [
    "Court order paraphrased instead of verbatim",
    "Facts contain wrong dates (2020 instead of 2021)"
  ],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "FIX_PROMPT",
  "confidence": "HIGH",
  "summary": "BLOCKER: Dispositif not verbatim (must be exact). Facts contain inaccurate dates. Must fix extraction prompt before proceeding."
}
```

**Example 3: REVIEW_REQUIRED**
```json
{
  "verdict": "REVIEW_REQUIRED",
  "score": 72,
  "criticalIssues": [],
  "majorIssues": [
    "Three main arguments missing from source",
    "Five enum values invalid (not in approved lists)",
    "facts field is array instead of single string"
  ],
  "minorIssues": [
    "One party missing"
  ],
  "recommendation": "REVIEW_SAMPLES",
  "confidence": "MEDIUM",
  "summary": "Significant quality issues. Incomplete argument extraction, schema violation (facts as array), and multiple enum errors. Review 20-30 more samples to assess pattern."
}
```

**Example 4: PASS (Synthesis Example)**
```json
{
  "verdict": "PASS",
  "score": 91,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "PROCEED",
  "confidence": "HIGH",
  "summary": "Excellent extraction. Facts synthesized from 12 scattered paragraphs into coherent narrative - all dates, amounts, and relationships accurate. Arguments consolidated from verbose pleadings - legal substance fully preserved. Court order verbatim. All enums valid. Production-ready."
}
```

---

Now evaluate the provided extraction using these UPDATED criteria.