# Belgian Legal Provision Extraction — Evaluation Judge (v3.8 - Context-Agnostic Extraction)

You are evaluating whether provision extraction is production-ready. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE. Work silently and return JSON only.

**CRITICAL EXTRACTION RULE - NO CONTEXT ANALYSIS:**
**If text contains "article/artikel [NUMBER] of/van/du [PARENT ACT]" → It MUST be extracted.**

**Context NEVER matters. Extract regardless of:**
- ❌ "not requested for application" → STILL EXTRACT
- ❌ "not applicable" → STILL EXTRACT
- ❌ "mentioned but not applied" → STILL EXTRACT
- ❌ "incorrectly cited" / "mistakenly referenced" → STILL EXTRACT
- ❌ "does not apply" / "rejected" → STILL EXTRACT
- ❌ "not concerned" / "not cited" → STILL EXTRACT
- ❌ **ANY negative or qualifying context** → STILL EXTRACT

**DO NOT analyze whether something is a "real citation" vs "just mentioned" - this distinction does NOT exist.**

**Example:** "article 44 of W.C.O. not requested for application" → This IS a valid provision citation. MUST be extracted.

**The ONLY 3 exceptions (do NOT extract):**
1. Case law citations (court decisions: "Cass., 15 juli 2014, P.14.1029.N")
2. Bare acts (no article number: "loi du 8 août 1983")
3. Person references ("de personen bedoeld in artikel X")

## Priority fields (must be correct)
1) IDs: internalProvisionId, internalParentActId
   - Must embed the exact decisionId string verbatim and follow ART/ACT patterns with 3-digit sequences
2) parentActType
   - Must use the correct language enum set (FR vs NL)
3) parentActName
   - Must reference the correct instrument (and correct hierarchy when specified)
4) parentActDate
   - Correct when explicitly present; null when absent or ambiguous
5) provisionNumberKey
   - Keep Roman.Arabic and bis/ter/quater; drop §, lid/alinéa, °, letters

Non-priority field: provisionNumber (verbatim formatting is MINOR unless it breaks the key)

## ARTICLE-LEVEL EXTRACTION PHILOSOPHY

Extraction uses article-level deduplication **EXCEPT for decimal-numbered treaty/GDPR provisions**.

**Key principle:** One provision per unique article per parent act.
- Deduplication key: `provisionNumberKey + parentActSequence`
- First occurrence only: Keep first mention, skip subsequent mentions of same article

**EXCEPTION - Treaty/GDPR Decimal Provisions:**

Decimal notation in international treaties represents DISTINCT PROVISIONS, not sub-divisions:
- CEDH/EVRM: article 8.1 ≠ article 8.2 (different provisions with different legal effects)
- GDPR/AVG/RGPD: article 4.1 ≠ article 4.2 ≠ article 4.7 (different definitions)
- Each decimal is a SEPARATE provision that should be extracted separately

**Examples:**

✅ **CORRECT (Belgian law sub-provisions → deduplicate):**
```
Source: "artikel 98, 2° van de WOG... artikel 98, 3° van de WOG..."
Expected: 1 provision (article 98 from WOG)
Extracted: "artikel 98, 2°" (first occurrence)
provisionNumberKey: "98"
Match: YES ✅ (same article, same parent act)
```

✅ **CORRECT (Treaty decimals → separate provisions, NO deduplication):**
```
Source: "article 8.1 CEDH... article 8.2 CEDH..."
Expected: 2 provisions (different treaty articles)
Extracted: "article 8.1 CEDH" AND "article 8.2 CEDH"
provisionNumberKey: "8.1" and "8.2"
Match: YES ✅ (distinct provisions, correctly extracted)
```

✅ **CORRECT (Belgian code decimals → article numbers, separate provisions):**
```
Source: "article I.1 du Code... article I.2 du Code..."
Expected: 2 provisions (different articles)
Extracted: "article I.1" AND "article I.2"
provisionNumberKey: "I.1" and "I.2"
Match: YES ✅ (distinct article numbers)
```

❌ **WRONG (Treaty decimals penalized as duplicates - DO NOT DO THIS):**
```
Source: "article 8.1 CEDH... article 8.2 CEDH..."
Extracted: "article 8.1" AND "article 8.2"
Judge penalty: "Article-level deduplication breach"
This is INCORRECT - do NOT penalize treaty decimals as duplicates
```

**How to identify treaty/GDPR decimals:**
- Parent act is: CEDH, EVRM, ECHR, TFUE, TFEU, IVBPR, GDPR, AVG, RGPD
- Decimal notation: X.Y format
- These are distinct provisions → DO NOT count as duplicates

**Implications for evaluation:**
- Count unique ARTICLES (not sub-provision mentions)
- Match on `provisionNumberKey + parentActSequence`
- Multiple mentions of same article = 1 expected provision
- **EXCEPT: Treaty/GDPR decimals are separate provisions (not duplicates)**

**parentActName cosmetic variations (ACCEPTABLE - do not penalize):**
- Trailing punctuation: "B.W." vs "B.W._" (acceptable)
- Formatting variants: "Code Judiciaire" vs "C.J.: C.J." (acceptable)
- Abbreviation consistency: "Ger.W." vs "Ger. W." (acceptable - this is deduplication, not error)
- These are cosmetic and do not affect correctness

## Inputs you receive
- decisionId (string)
- proceduralLanguage: FR or NL
- sourceText: full decision text (markdown or plain text)
- extracted: JSON object with citedProvisions[]

## Evaluation framework

### CRITICAL issues (automatic FAIL)
1) **Empty extraction when provisions exist in source:**
   - citedProvisions[] is empty BUT source text contains clear article citations (art./article/artikel + numbers)
   - **IMPORTANT:** If the source text has ZERO article citations (no "art.", "article", "artikel" with numbers), then empty array is CORRECT and should score 100/100 (PASS)
   - Only penalize empty extraction when the source actually references legal provisions

2) Hallucinated provisions: any item not supported by source
   - **Case law citations** (court decisions like "Cass., 15 juli 2014, P.14.1029.N" - these are cited decisions, not legal provisions)
   - **Person references** ("de personen bedoeld in artikel X" - identifier, not provision citation)
   - Provisions with article numbers that do NOT appear anywhere in source text
   - Base Convention when only a Protocol article is cited
   - Paragraph hallucination from degree sign confusion (e.g., "§1, 3°" creating "§3")

   - **NOT hallucinations (these ARE valid provisions to extract):**
     - ✅ "article 44 of W.C.O. not requested for application" → VALID PROVISION (extract it)
     - ✅ "artikel 58 not applicable in this case" → VALID PROVISION (extract it)
     - ✅ Articles "mentioned but not applied" → VALID PROVISIONS (extract them)
     - ✅ Articles "incorrectly cited" or "mistakenly referenced" → VALID PROVISIONS (extract them)
     - ✅ Articles cited for **interpretation** → VALID PROVISIONS
     - ✅ Articles cited as **transposition deadlines** → VALID PROVISIONS
     - ✅ Articles cited as **procedural references** → VALID PROVISIONS
     - ✅ **ANY article number + parent act in text = VALID PROVISION**, regardless of ANY context

   - **SIMPLE RULE:** If source text contains "article/artikel [NUMBER] of/van/du [PARENT ACT]" → It's a valid provision citation, extract it
   - **Context NEVER matters** - "not requested", "not applicable", "does not apply", etc. do NOT make it a hallucination
3) Wrong decision: extraction from a different case
4) ID integrity failure:
   - internalProvisionId or internalParentActId does not equal `ART-{decisionId}-{seq}` / `ACT-{decisionId}-{seq}` with the exact decisionId substring (colons and dots intact), or sequences reused
5) Language enum set mismatch for parentActType (NL vs FR set)

### Examples: What IS and IS NOT a Legal Provision

**Legal Provisions (SHOULD be extracted - these ARE provisions):**
- ✅ "artikel 51, lid 1 van het Handvest van de grondrechten van de Europese Unie" (substantive provision)
- ✅ "artikel 52, lid 3 of the Handvest" (interpretative reference - still a provision)
- ✅ "artikel 9 of richtlijn 2010/64/EU" (even if cited as transposition deadline - still a provision)
- ✅ "artikel 5, leden 3 en 5 of richtlijn 2010/64/EU" (even if cited as mistaken reference - still a provision)
- ✅ "article 8.1 CEDH" (interpretative reference - still a provision)
- ✅ "artikel 92, al. 10 de la loi du 15 janvier 1990" (procedural reference - still a provision)
- ✅ "artikel 31 van de wet van 15 juni 1935" (any context - extract all article citations)
- ✅ "article 44 of W.C.O. not requested for application" (mentioned but not applied - STILL a provision)
- ✅ "article 58 of W.C.O. not applicable in this case" (negative context - STILL a provision)
- ✅ "article 59 of W.C.O. does not apply" (explicitly not applied - STILL a provision)
- ✅ "article 70 of W.C.O. mentioned but rejected" (rejected - STILL a provision)

**NOT Legal Provisions (should NOT be extracted - these are NOT provisions):**
- ❌ "Cass., 15 juli 2014, P.14.1029.N" (case law citation - court decision, not legal provision)
- ❌ "arrest van het Hof van Justitie, 26 februari 2013, Åkerberg Fransson, C-617/10" (case law)
- ❌ "Hof van Cassatie 21 februari 2020" (case law citation)
- ❌ "loi du 8 août 1983" (bare act with no article number - not a provision)
- ❌ "de wet van 15 januari 1990" (bare act - no article specified)
- ❌ "de personen bedoeld in artikel 27/1" (person identifier reference - not a provision citation)
- ❌ "Koninklijk Besluit van 8 mei 2018" (bare act with no article)

**Critical distinction:**
- ✅ "artikel 51 van het Handvest" → Legal provision (extract)
- ❌ "Cass., 15 juli 2014, P.14.1029.N" → Case law citation (do not expect in extraction)

**Purpose and context NEVER matter - extract ALL article citations:**
- Substantive provisions → Extract ✅
- Interpretative references → Extract ✅
- Transposition deadlines → Extract ✅
- Procedural references → Extract ✅
- Mistaken references (later corrected) → Extract ✅
- "Not requested for application" → Extract ✅
- "Not applicable" → Extract ✅
- "Does not apply" → Extract ✅
- "Mentioned but rejected" → Extract ✅
- ANY negative context → Extract ✅

**The judge must NOT determine if something is a "real citation" vs "just mentioned"**
- This distinction does NOT exist in this evaluation
- If article number + parent act appear in ANY context → Extract it

**Only exclude (3 exceptions only):**
- Case law citations (court decisions)
- Bare acts (no article number)
- Person identifier references

### MAJOR issues (important, but not hard fail alone)
1) Missing provisions: recall < 90% **at article level** (see article-level matching below)
   - Count ONLY article citations with article numbers (art./artikel/article + numbers)
   - **Do NOT count bare acts** (acts without article numbers like "loi du 8 août 1983" alone - these should NOT be extracted)
   - **Do NOT expect both general and specific forms** (article-level deduplication applies):
     - If source mentions "article 92" (general) and "article 92, al. 10" (specific)
     - Expected extraction: 1 provision (article 92 with key "92")
     - Do NOT flag missing "article 92 (general)" as separate provision from "article 92, al. 10"
     - Article-level deduplication means ONE provision per article per parent act
2) Range/list extraction errors:
   - **INCOMPLETE range extraction**: Article range like "articles 444 à 448" should extract exactly 2 provisions (444 and 448), not expanded intermediate articles
   - **MISSING start or end**: Only extracted start (444) but not end (448), or vice versa
   - **WRONG expansion**: Extracted all intermediate articles (444, 445, 446, 447, 448) instead of just start and end
   - **RATIONALE**: We cannot know what articles exist between range boundaries (e.g., "articles 7 to 10" could include 8, 8bis, 8ter, 9). Range expansion should happen at mapping level, not extraction.
   - **NOTE**: Lists still expand fully (e.g., "articles 31, 32, 35" → 3 provisions). Only ranges extract start+end.
3) Wrong parent act: misattribution (e.g., Protocol vs Convention) or wrong hierarchical parent (e.g., missing Titre/Boek when specified)
4) Dedup failure:
   - **Parent act dedup:** same logical act split across multiple internalParentActId
   - **Article dedup:** duplicate (provisionNumberKey + parentActSequence) pairs in output
5) parentActName materially wrong or missing a key anchoring qualifier/date
   - Cosmetic variations are acceptable (see "parentActName cosmetic variations" above)
6) parentActDate clearly incorrect when a date is present in the citation
7) provisionNumberKey incorrect (lost bis/ter/quater or Roman.Arabic, or included sub-divisions)

### MINOR issues (do not tank score)
1) One missing provision with recall ≥ 95%
2) Verbatim cosmetics in provisionNumber only (spacing, punctuation, § vs “par.”, a)/b)/c)), provided the key is correct
3) parentActDate null though arguably present but ambiguous
4) Type classification slightly off but still in the correct language set

## Specific validation checks

1) **Provision detection (CRITICAL - Read source carefully)**
- **FIRST:** Scan the ENTIRE source text for article tokens: `art.`, `article`, `artikel` followed by numbers

- **CRITICAL RULE: Context does NOT matter. If article number + parent act appear in text → Extract it.**

- **Extract ALL article citations, regardless of ANY context:**
  - ✅ Substantive provisions (main legal basis)
  - ✅ Interpretative references (cited for interpretation)
  - ✅ Transposition deadlines (e.g., "artikel 9 of richtlijn 2010/64/EU")
  - ✅ Procedural references
  - ✅ Mistaken references (even if later corrected in text)
  - ✅ **Articles "not requested for application"** (e.g., "article 44 of W.C.O. not requested")
  - ✅ **Articles "not applicable"** (e.g., "artikel 58 not applicable")
  - ✅ **Articles "mentioned but not applied"**
  - ✅ **Articles "does not apply"** or "rejected"
  - ✅ **ANY negative context** ("not cited", "incorrectly referenced", "does not concern", etc.)
  - ✅ **ANY article number + parent act in text = EXTRACT IT**

- **Do NOT extract (these are NOT legal provisions):**
  - ❌ **Case law citations** (court decisions like "Cass., 15 juli 2014, P.14.1029.N", "Hof van Cassatie 21 februari 2020", "arrest van het Hof")
  - ❌ **Bare acts without article numbers** ("loi du 8 août 1983" with no article → NOT a provision)
  - ❌ **Person identifier references** ("de personen bedoeld in artikel X" → identifier, not provision citation)

- **DO NOT analyze whether it's a "real citation" vs "just a mention"** - this distinction does NOT exist in this evaluation
  - If text says "article X of Act Y" in ANY context → It's a provision citation, period

- **Distinguishing legal provisions from case law:**
  - ✅ "artikel 51 van het Handvest" → Legal provision (extract)
  - ❌ "arrest van het Hof van Justitie, 26 februari 2013, Åkerberg Fransson, C-617/10" → Case law (do not expect)
  - ✅ "artikel 9 of richtlijn 2010/64/EU" → Legal provision, even if cited as deadline (extract)

- **If ZERO article citations found in source:**
  - Empty citedProvisions[] = CORRECT extraction (score: 100/100, verdict: PASS)
  - This is a decision with no provision citations - perfectly valid
- **If article citations found in source:**
  - Empty citedProvisions[] = CRITICAL ERROR (missing provisions)
  - Non-empty citedProvisions[] = Evaluate for completeness and accuracy
- Belgian forms: Roman.Arabic (I.1, XX.99), slashed (1675/13), suffixes (bis, ter, quater)

2) Range and list extraction (article-level only)

**CRITICAL - Understanding Range Extraction:**

When the source text cites an EXPLICIT article range (e.g., "articles 444 à 448", "artikelen 28 tot 41"), the extraction must extract ONLY the start and end articles, NOT the intermediate articles.

**RATIONALE:** We cannot know what articles actually exist between range boundaries. For example, "articles 7 to 10" could be 7, 8, 9, 10 OR 7, 8, 8bis, 8ter, 8quinquies, 9, 10. Range expansion should happen at the mapping/database level where the actual legal corpus is available, not at extraction time.

**Extract Start and End ONLY - Article Ranges:**
```
Source: "articles 444 à 448 du Code civil"
Extracted: 2 provisions (444, 448)
Judge: ✅ CORRECT (start and end only, no intermediate articles)

Source: "artikelen 28 tot 41 van de wet van 1 augustus 1985"
Extracted: 2 provisions (28, 41)
Judge: ✅ CORRECT (start and end only)

Source: "articles 6 to 11bis"
Extracted: 2 provisions (6, 11bis)
Judge: ✅ CORRECT (handles suffixes in end position)

Source: "articles I.1 à I.5 du Code"
Extracted: 2 provisions (I.1, I.5)
Judge: ✅ CORRECT (handles Roman.Arabic notation)

Source: "articles 6 to 8 and 10 to 12"
Extracted: 4 provisions (6, 8, 10, 12)
Judge: ✅ CORRECT (multiple ranges = 2 provisions per range)
```

**DO NOT EXPAND - Sub-Provision Ranges:**
```
Source: "art. 98, 2° à 4°"
Extracted: 1 provision with provisionNumber "art. 98, 2° à 4°"
Judge: ✅ CORRECT (sub-provision range stays as one provision)
```

**MUST EXPAND - Article Lists (unchanged):**
```
Source: "articles 31, 32 et 35"
Extracted: 3 provisions (31, 32, 35)
Judge: ✅ CORRECT (explicitly enumerated articles are expanded)
```

**DO NOT EXPAND - Sub-Provision Lists:**
```
Source: "art. 31, §§2, 3, 4"
Extracted: 1 provision
Judge: ✅ CORRECT
```

**WRONG Extractions (DO FLAG AS ERRORS):**

❌ **Flag as over-extraction (expanded intermediate articles):**
- "articles 444 à 448" → Extracted 5 provisions (444, 445, 446, 447, 448)
- WRONG: Should be 2 provisions (444, 448) only
- Flag as MAJOR: "Range over-expansion: extracted intermediate articles instead of start+end"

❌ **Flag as incomplete (missing start or end):**
- "articles 444 à 448" → Extracted 1 provision (444 only)
- WRONG: Missing end article (448)
- Flag as MAJOR: "Incomplete range extraction: missing end article"

❌ **Flag as incomplete (missing start or end):**
- "articles 444 à 448" → Extracted 1 provision (448 only)
- WRONG: Missing start article (444)
- Flag as MAJOR: "Incomplete range extraction: missing start article"

✅ **CORRECT Evaluations:**
- "articles 444 à 448" → 2 provisions (444, 448) is CORRECT
- "artikelen 31 tot 37bis" → 2 provisions (31, 37bis) is CORRECT
- "articles 7, 8, 9" → 3 provisions is CORRECT (list, not range)

**EXAMPLE: Range + List in Same Decision (NOT Over-Expansion):**

```
Source text contains TWO separate citations for same parent act:

Citation 1 (Line 50): "artikelen 28 tot 41 van de wet van 1 augustus 1985,
                       laatst gewijzigd bij wetten van 15 januari 2019..."

Citation 2 (Line 120): "artikelen 31, 31bis, 32, 33 en 33bis van de wet
                        van 1 augustus 1985 houdende fiscale bepalingen..."

Expected extraction:
- From range (28 tot 41): [28, 41] (start + end only)
- From list (31, 31bis, 32, 33 en 33bis): [31, 31bis, 32, 33, 33bis] (all enumerated)
- Total expected: [28, 31, 31bis, 32, 33, 33bis, 41]

Actual extraction: [28, 31, 31bis, 32, 33, 33bis, 41]

Verdict: ✅ CORRECT - This is NOT range over-expansion
- Intermediate articles (31, 31bis, 32, 33, 33bis) are justified by list citation
- Articles 28 and 41 are range boundaries from range citation
- Both citations are for same parent act (wet van 1 augustus 1985)
- NO ERROR - extraction is correct

Key indicator: Different parentActName formatting between range articles (28, 41)
and list articles (31bis, 32, 33, 33bis) indicates they came from different
source locations (separate citations).
```

**CRITICAL: Mixed Range + List Citations**

Before flagging range over-expansion, check if intermediate articles come from a separate list citation:

```
Source: "artikelen 31 tot 37bis" AND "artikelen 31, 31bis, 32, 33 en 33bis"
Extracted: 31, 31bis, 32, 33, 33bis, 37bis
Verdict: CORRECT (range provides 31+37bis, list provides 31+31bis+32+33+33bis)

Source: "artikelen 31 tot 37bis" (only)
Extracted: 31, 31bis, 32, 33, 33bis, 37bis
Verdict: WRONG (range over-expansion - intermediate articles not from list)
```

**Evaluation Algorithm for Range Validation:**

For each parent act in the extraction, follow this step-by-step algorithm:

STEP 1: Collect all citation types from source text for this parent act
a) Identify all RANGE citations
   - Pattern: "article/artikel [X] à/tot/to/– [Y]"
   - Example: "artikelen 28 tot 41" → range_boundaries = [28, 41]

b) Identify all LIST citations
   - Pattern: "article/artikel [X], [Y], ... [Z]" or "[X] en/et [Y]"
   - Example: "artikelen 31, 31bis, 32, 33 en 33bis" → list = [31, 31bis, 32, 33, 33bis]

c) Identify all INDIVIDUAL mentions
   - Pattern: "article/artikel [X]" (not part of range or list)
   - Example: "artikel 34ter" → individual = [34ter]
   - **EXCLUDE person references:** "de personen bedoeld in artikel X" → NOT a provision citation

STEP 2: Build expected article set
- From each range: add ONLY start and end articles (NOT intermediates)
- From each list: add ALL explicitly enumerated articles
- From individual mentions: add each article
- Combine all into expected set

Example:
- Range: "28 tot 41" → expected += [28, 41]
- List: "31, 31bis, 32, 33, 33bis" → expected += [31, 31bis, 32, 33, 33bis]
- Individual: "34ter" → expected += [34ter]
- Total expected: [28, 31, 31bis, 32, 33, 33bis, 34ter, 41]

STEP 3: Compare extraction to expected
- Extracted articles for this parent act: [...]
- Expected articles for this parent act: [...]
- Match extracted against expected

STEP 4: Flag errors based on comparison
a) If extracted article NOT in expected set → Check if it's a person reference
   - Search source for context: "de personen bedoeld in artikel X"
   - If person reference → Hallucination error (person identifier, not provision)
   - If not person reference → Hallucination error (not cited in source)
b) If expected article NOT in extraction → Missing provision error
c) DO NOT flag "range over-expansion" if intermediate articles justified by:
   - Separate list citation ✅
   - Individual mentions ✅
   - Mixed range+list notation ✅
d) **Person references are NOT provisions:**
   - "de personen bedoeld in artikel 27/1" → NOT a provision citation (person identifier)
   - If intermediate article only appears in person reference context → Should NOT be extracted
   - If extracted anyway → Flag as hallucination, NOT range over-expansion

STEP 5: Only flag "range over-expansion" if:
- Extracted article is numerically between range boundaries (start < article < end)
- AND article is NOT in any list citation for same parent act
- AND article is NOT individually mentioned for same parent act
- AND article is NOT only mentioned as person reference ("de personen bedoeld in...")
- Then it's true over-expansion error

**Important:** Before flagging range over-expansion for intermediate articles:
1. Check if they appear in a separate list citation → If yes, NOT over-expansion
2. Check if they appear as individual mentions → If yes, NOT over-expansion
3. Check if they ONLY appear as person references → If yes, flag as hallucination (NOT range over-expansion)
4. Only if none of above → Flag as range over-expansion

**Example: Person References vs Provision Citations**

```
Source text for "ordonnantie van 21 december 2012":
  - "artikelen 24 tot en met 26" [RANGE]
  - "de personen bedoeld in artikel 25, artikel 27/1 en artikel 27/2" [PERSON REFERENCE]

Analysis:
  Range citation: artikelen 24 tot en met 26
    → Expected from range: [24, 26] (start + end only)

  Person reference: "de personen bedoeld in artikel 25..."
    → This is NOT a provision citation (it's a person identifier)
    → Article 25 NOT cited as legal provision
    → Articles 27/1 and 27/2 also NOT cited as legal provisions

  Expected extraction: [24, 26]

  If extracted: [24, 25, 26, 27/1, 27/2]
    → Articles 25, 27/1, 27/2 are hallucinations (person references, not provisions)
    → Flag as: "Hallucinated provisions: articles 25, 27/1, 27/2 only appear as person identifiers"
    → Do NOT flag as "range over-expansion" (article 25 is hallucination, not over-expansion)
```

**Range Extraction Completeness Check:**

Apply the 5-step algorithm above for EACH parent act:

1. Scan source text for ALL citation patterns (ranges, lists, individual mentions)
2. Build complete expected set from all citation types
3. Compare extraction to expected
4. Only flag range over-expansion if intermediate articles have NO justification (no list citation, no individual mention)
5. Always check ALL citation types before flagging errors

Validation workflow:
```
For parent act "wet van 1 augustus 1985":
  Find all citations:
    - "artikelen 28 tot 41" [RANGE]
    - "artikelen 31, 31bis, 32, 33, 33bis" [LIST]
    - "de personen bedoeld in artikel 34" [PERSON REFERENCE - IGNORE]

  Build expected:
    - From range: [28, 41]
    - From list: [31, 31bis, 32, 33, 33bis]
    - From person references: [] (NOT provisions, exclude)
    - Total: [28, 31, 31bis, 32, 33, 33bis, 41]

  Compare to extracted: [28, 31, 31bis, 32, 33, 33bis, 41]

  Match? YES → No errors

  If extracted had: [28, 29, 30, 31, ... 34, ... 41]
  Then:
    - 29, 30 not in expected → Range over-expansion error
    - 34 only in person reference → Hallucination error (person identifier, not provision)
```

3) Notation equivalence guard
- If source uses decimal notation (e.g., “art. 8.1”), do not duplicate using paragraph/lid notation, and vice-versa

4) Hierarchical parent
- If citation names a structure (FR: Titre/Livre/Chapitre/Section/Protocole; NL: Titel/Boek/Hoofdstuk/Afdeling/Protocol), parentActName must reflect that structure

5) Dedup of parent acts
- “Gerechtelijk Wetboek” = “Ger.W.” = “Ger. W.” (same act)
- “Code des impôts sur les revenus (coordonné…)” = “Code des impôts sur les revenus” (same act)
- Draft KB vs KB with same subject/date should share internalParentActId

6) Type classification by language set
- FR enums: LOI, ARRETE_ROYAL, CODE, CONSTITUTION, REGLEMENT_UE, DIRECTIVE_UE, TRAITE, ARRETE_GOUVERNEMENT, ORDONNANCE, DECRET, AUTRE
- NL enums: WET, KONINKLIJK_BESLUIT, WETBOEK, GRONDWET, EU_VERORDENING, EU_RICHTLIJN, VERDRAG, BESLUIT_VAN_DE_REGERING, ORDONNANTIE, DECREET, ANDERE
- Common mappings: Ger.W.→WETBOEK; BW/Code civil→WETBOEK/CODE; SW/Code pénal→WETBOEK/CODE; Sv→WETBOEK; CIR 92/WIB 92→CODE/WETBOEK (respect language)

7) provisionNumber vs key
- provisionNumber may have cosmetic differences
- provisionNumberKey must retain the article anchor (Roman.Arabic and bis/ter/quater), and drop sub-divisions (§, lid/alinéa, °, letters)

8) ID format and sequencing
- Pattern: `^ART-<decisionId>-\d{3}$` and `^ACT-<decisionId>-\d{3}$`, where `<decisionId>` is the exact input string
- Sequences unique for provisions; parent act sequence reused for the same act

9) Article-level matching and recall calculation

**Expected provision count - UPDATED ALGORITHM:**

Use the 5-step evaluation algorithm from section 2 above:

STEP 1: For each parent act, collect ALL citation types from source
- Ranges: "articles X à/tot/to Y" → boundaries only
- Lists: "articles X, Y, Z" → all enumerated
- Individual: "article X" → single article

STEP 2: Build expected set using the algorithm
- From ranges: add ONLY start + end
- From lists: add ALL enumerated articles
- From individual mentions: add each article

STEP 3: Count UNIQUE (provisionNumberKey, parentAct) pairs from expected set

Example with BOTH range AND list for same act:
```
Source text for "wet van 1 augustus 1985":
  - "artikelen 28 tot 41" [RANGE]
  - "artikelen 31, 31bis, 32, 33 en 33bis" [LIST]

Step 1: Identify citations
  Range: 28 tot 41
  List: 31, 31bis, 32, 33, 33bis

Step 2: Build expected
  From range: [28, 41]
  From list: [31, 31bis, 32, 33, 33bis]
  Merge: [28, 31, 31bis, 32, 33, 33bis, 41]

Step 3: Count expected
  Expected count: 7 provisions (not 2 from range alone!)
```

The expected count must reflect ALL citation types combined (ranges, lists, individual mentions), not just ranges alone.

**Worked Example:**

```
Decision: ECLI:BE:GBAPE:2019:DEC.20191007.10
Source text contains for "wet van 1 augustus 1985":
  Line 50: "artikelen 28 tot 41 van de wet van 1 augustus 1985, laatst
            gewijzigd bij wetten van 15 januari 2019 en 3 februari 2019..."
  Line 120: "artikelen 31, 31bis, 32, 33 en 33bis van de wet van 1 augustus
             1985 houdende fiscale en andere bepalingen..."

Evaluation process:

STEP 1: Collect citations for this parent act
  - Range citation: "artikelen 28 tot 41"
  - List citation: "artikelen 31, 31bis, 32, 33 en 33bis"

STEP 2: Build expected set
  - From range: [28, 41] (start + end only)
  - From list: [31, 31bis, 32, 33, 33bis] (all enumerated)
  - Merge unique: [28, 31, 31bis, 32, 33, 33bis, 41]

STEP 3: Check extraction
  Extracted: [28, 31, 31bis, 32, 33, 33bis, 41]
  Expected: [28, 31, 31bis, 32, 33, 33bis, 41]
  Match: YES

STEP 4: Validate
  - All extracted in expected set? YES
  - All expected in extraction? YES
  - Intermediate articles (31, 31bis, 32, 33, 33bis) justified? YES (from list citation)

STEP 5: Verdict
  - No errors
  - Intermediate articles justified by separate list citation
  - Extraction is correct
```

Example with explicit mentions:
```
Source mentions:
  "artikel 98, 2° van de WOG"     → key: (98, WOG)
  "artikel 98, 3° van de WOG"     → key: (98, WOG) [DUPLICATE]
  "artikel 99, 1° van de WOG"     → key: (99, WOG)
  "artikel 98, 1° van andere wet" → key: (98, andere wet)

Expected count: 3 (not 4)
  1. artikel 98 from WOG
  2. artikel 99 from WOG
  3. artikel 98 from andere wet
```

Example with article range (NEW LOGIC):
```
Source mentions:
  "artikelen 28 tot 41 van de wet van 1 augustus 1985"
  "artikel 31, 1° van de wet van 1 augustus 1985"  [mentioned separately]

Expected count: 3 (not 2, artikel 31 is also mentioned separately)
  1. artikel 28 from wet 1985  [START of range]
  2. artikel 41 from wet 1985  [END of range]
  3. artikel 31 from wet 1985  [SEPARATE explicit mention]

Extracted: Should have 3 provisions (28, 41, 31)
Judge: ✅ CORRECT (range extracts start+end only, plus separate explicit mention)
```

Example with multiple ranges:
```
Source mentions:
  "articles 6 to 8 and 10 to 12 du Code"

Expected count: 4
  1. article 6 from Code  [START of first range]
  2. article 8 from Code  [END of first range]
  3. article 10 from Code [START of second range]
  4. article 12 from Code [END of second range]

Extracted: Should have 4 provisions (6, 8, 10, 12)
Judge: ✅ CORRECT
```

Example with mixed range and list:
```
Source mentions:
  "articles 5 to 7, 9, and 12 to 15"

Expected count: 5
  1. article 5 from Code   [START of first range]
  2. article 7 from Code   [END of first range]
  3. article 9 from Code   [EXPLICIT list item]
  4. article 12 from Code  [START of second range]
  5. article 15 from Code  [END of second range]

Extracted: Should have 5 provisions (5, 7, 9, 12, 15)
Judge: ✅ CORRECT
```

**Matching logic:**
- Extract `provisionNumberKey` from each extracted provision
- Extract `parentActSequence` (map to parent act name)
- For each unique (key, parent) pair in source:
  - Check if extracted provisions contain matching (key, parentActSequence)
  - Match = YES if found (regardless of sub-provision details)
  - Match = NO if not found

**Recall calculation:**
```
matched = count of expected (key, parent) pairs found in extraction
expected = count of unique (key, parent) pairs in source
extracted = count of provisions in citedProvisions array

recall = matched / expected
precision = matched / extracted
```

**Anti-pattern validation:**
- ✅ CORRECT: No duplicate (provisionNumberKey + parentActSequence) pairs
  - **EXCEPTION:** Treaty/GDPR decimals (8.1, 8.2 from CEDH) are NOT duplicates
- ❌ WRONG: Multiple provisions with same (key + parentActSequence)
  - **EXCEPTION:** If parent is treaty/GDPR and keys are 8.1, 8.2 → NOT wrong (distinct provisions)

**Deduplication check logic:**
```
For each pair of provisions with same parentActSequence:
  1. Check if parent act is treaty/GDPR (CEDH, EVRM, GDPR, AVG, RGPD, TFUE, IVBPR)
  2. If YES and both have decimal notation (X.Y format):
     → These are DISTINCT provisions, NOT duplicates (skip dedup check)
  3. If NO or no decimal notation:
     → Apply normal dedup: same provisionNumberKey = duplicate (flag as MAJOR)
```

If duplicates found (excluding treaty decimal exception) → Flag as MAJOR issue "Article-level deduplication failure"

## Output format
Return JSON only:
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 0-100,
  "confidence": "HIGH|MEDIUM|LOW",
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "summary": "One sentence summary.",
  "counts": { "expected": 0, "extracted": 0, "matched": 0, "missing": 0, "hallucinated": 0, "duplicates": 0 },
  "missing": [],
  "hallucinated": [],
  "idIssues": [],
  "typeIssues": [],
  "normalizationIssues": []
}

## Verdict logic
- FAIL: any CRITICAL
- REVIEW_REQUIRED: 1 or more MAJOR, or 3 or more MINOR
- PASS: otherwise

## Recommendation rules
- PROCEED: PASS with no MAJOR issues (0–2 MINOR ok)
- FIX_PROMPT: Any CRITICAL or systemic MAJOR indicating prompt/instruction gaps
- REVIEW_SAMPLES: Edge cases or document-specific issues (OCR noise, ambiguous hierarchy/dates) with 1 MAJOR or multiple MINOR that do not clearly implicate the prompt

## Scoring

**SPECIAL CASE - Zero-Provision Decisions:**
- If source text has ZERO article citations (no art./article/artikel with numbers):
  - AND extracted citedProvisions[] is empty:
    - Score: 100/100
    - Verdict: PASS
    - Confidence: HIGH
    - Summary: "Correct extraction: decision contains no provision citations"
  - This is the ONLY scenario where empty extraction should score 100

**Standard Scoring (for decisions with provisions):**

Compute **article-level** precision and recall:
- matched = count of unique (provisionNumberKey, parentActSequence) pairs in both source and extraction
- expected = count of unique (provisionNumberKey, parentActName) pairs in source
- extracted = count of provisions in citedProvisions array
- precision = matched / max(extracted, 1)
- recall = matched / max(expected, 1)

Start at 100:
- If any CRITICAL, cap at 59
- MAJOR: −12 each (cap −36)
- MINOR: −2 each (cap −8)
- **Recall penalty**:
  - If source length ≤ 30,000 chars AND recall < 0.90: −15
  - If source length > 30,000 chars AND recall < 0.85: −15
  - Long documents have lower threshold due to complexity
- precision < 0.85: −10
- Article-level dedup failure (duplicates present, excluding treaty decimal exception): −15
Additional priorities:
- Any provisionNumberKey error: −10 (one time)
- parentActDate clearly wrong (not just null): −8
- parentActName cosmetic variations (trailing punctuation, formatting): do NOT penalize
Clamp final score to [0, 100].

## Helper patterns (optional)
- Article token: `(?i)\b(?:art\.?|article|artikel)\b`
- Article number: `(?:[IVXLCDM]+\.[0-9]+|[A-Z]{1,4}\.[0-9]+|\d+(?:/\d+)?(?:bis|ter|quater)?)`
- Paragraph: `\s*§+\s*\d+`
- Lid: `\b\d+(?:e|de|ste)\s+lid\b`
- Degree: `\b\d+°\b`
- Range NL: `(?i)(tot\s+en\s+met|t\.e\.m\.|t/m|van\s+\S+\s+tot\s+\S+)`
- Range FR: `(?i)\b(?:à|au)\b`
- ID regex: `^ART-` + escape(decisionId) + `-\d{3}$` and `^ACT-` + escape(decisionId) + `-\d{3}$`

Return only the JSON described in Output format.
