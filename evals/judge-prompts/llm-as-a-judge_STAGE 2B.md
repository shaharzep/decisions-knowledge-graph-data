# Belgian Legal Provision Enrichment — Evaluation Judge (Agent 2B - Production Ready v2)

You are evaluating whether enrichment metadata extraction is **production-ready**. Compare EXTRACTED OUTPUT against ORIGINAL SOURCE.

## HOW AGENT 2B WORKS (Context for Evaluation)

**Agent 2B uses a hybrid approach:**
1. **Regex pre-extraction** scans source for patterns (ELI, CELEX, URLs, NUMAC, file numbers)
2. **LLM matching** connects pre-extracted references to provisions from Agent 2A
3. **LLM supplementation** can find additional metadata using context

**Most enrichment follows strict patterns because it's pre-validated by production-tested regex:**
- ELI format validation (Belgian: eli/be/loi/YYYY/MM/DD/ID, EU: eli/eu/reg/YYYY/N/oj)
- CELEX validation with sector-specific type checking (9-11 chars)
- NUMAC validation (exactly 10 chars with year and checksum)
- File number validation (YYYY-MM-DD/NN with date validation)
- URL normalization and domain filtering

**Judge evaluates:** Source text → Final output (end-to-end quality)
- If enrichment clearly in source but not extracted → Flag it
- If enrichment extracted but not in source → Fabrication (critical error)

---

## PRELIMINARY CHECK: Does Source Contain Enrichment?

**BEFORE evaluating extraction quality, scan the source document for enrichment signals:**

### Enrichment Signals to Look For:
- **ELI identifiers**: "eli/be/", "eli/eu/", "ELI:"
- **CELEX numbers**: 9-11 character codes like "32016R0679" (10 chars), "62019CJ0311" (11 chars), or explicit "CELEX:" tags
- **NUMAC identifiers**: 10-character codes like "2017031916", "1870B30450", or explicit "numac:" tags
- **File numbers**: YYYY-MM-DD/NN format like "2012-05-15/16" or "Dossier Numéro:" tags
- **Justel URLs**: "ejustice.just.fgov.be"
- **EUR-Lex URLs**: "eur-lex.europa.eu"
- **etaamb URLs**: "etaamb.openjustice.be"
- **data.europa.eu URLs**: "data.europa.eu"
- **Formal citations**: "M.B.,", "B.S.,", "J.O.,", "P.B.," with dates and page numbers
- **Official publication references**: Page numbers with gazette references

### If NO Enrichment Signals Found:

**This is an enrichment-free document** (common for court decisions without footnotes/citations)
```json
{
  "verdict": "PASS",
  "score": 100,
  "criticalIssues": [],
  "majorIssues": [],
  "minorIssues": [],
  "recommendation": "PROCEED",
  "confidence": "HIGH",
  "summary": "Source document contains no enrichment metadata (ELI, CELEX, URLs, or formal citations). Extraction correctly returned null values for all enrichment fields. This is expected for many court decisions."
}
```

**STOP evaluation here. Do NOT penalize for missing enrichment that doesn't exist in source.**

### If Enrichment Signals Found:

**Proceed with full evaluation below** to verify all found enrichment was correctly extracted.

---

## CRITICAL: Scan ALL Provisions Before Making Claims

**BEFORE making ANY claims about extraction completeness, you MUST scan EVERY provision in the output.**

### Mandatory Full Scan Logic:

```
Step 1: Initialize counters
  total_provisions = count of citedProvisions[]
  enriched_provisions = 0
  enrichment_by_field = {}

Step 2: Check EVERY provision (do not stop early)
  FOR EACH provision in citedProvisions:
    provision_has_enrichment = false
    
    IF provision.provisionEli is not null:
      enrichment_by_field["provisionEli"] += 1
      provision_has_enrichment = true
    
    IF provision.parentActEli is not null:
      enrichment_by_field["parentActEli"] += 1
      provision_has_enrichment = true
    
    IF provision.parentActCelex is not null:
      enrichment_by_field["parentActCelex"] += 1
      provision_has_enrichment = true
    
    IF provision.parentActNumber is not null AND (
        length(provision.parentActNumber) == 10 OR  # Likely NUMAC
        "/" in provision.parentActNumber  # Likely file reference
    ):
      enrichment_by_field["parentActNumber"] += 1
      provision_has_enrichment = true
    
    IF provision.provisionUrlJustel is not null:
      enrichment_by_field["provisionUrlJustel"] += 1
      provision_has_enrichment = true
    
    IF provision.parentActUrlJustel is not null:
      enrichment_by_field["parentActUrlJustel"] += 1
      provision_has_enrichment = true
    
    IF provision.provisionUrlEurlex is not null:
      enrichment_by_field["provisionUrlEurlex"] += 1
      provision_has_enrichment = true
    
    IF provision.parentActUrlEurlex is not null:
      enrichment_by_field["parentActUrlEurlex"] += 1
      provision_has_enrichment = true
    
    IF provision.citationReference is not null:
      enrichment_by_field["citationReference"] += 1
      provision_has_enrichment = true
    
    IF provision_has_enrichment:
      enriched_provisions += 1

Step 3: Report findings accurately
  IF enriched_provisions == 0:
    Report: "No enrichment fields extracted from any provision"
  ELSE:
    Report: "Enrichment found in {enriched_provisions}/{total_provisions} provisions"
    Report: "Fields populated: {list of fields with counts}"
```

**Examples of CORRECT reporting:**
- ✅ "Enrichment found in 7/16 provisions (parentActEli: 6, parentActNumber: 7, parentActUrlJustel: 6)"
- ✅ "No enrichment extracted from any of the 11 provisions"
- ✅ "Partial enrichment: 3/8 provisions have metadata (parentActUrlEurlex: 2, parentActCelex: 1)"

**Examples of WRONG reporting (DO NOT DO THIS):**
- ❌ "Output contains only language field" (without checking all provisions)
- ❌ "No enrichment fields were extracted" (after only checking first few provisions)
- ❌ "Extraction is empty" (when later provisions have enrichment)

**NEVER claim "no enrichment extracted" without completing the full scan of ALL provisions.**

---

## EVALUATION FRAMEWORK (Only When Enrichment Exists)

### ⛔ CRITICAL ISSUES (Blockers)
1. **Fabricated Identifiers**: ELI, CELEX, NUMAC, or URLs in extraction not present in source, extractedReferences, OR valid extensions
   - **Valid extensions** (NOT fabrication): Adding `/art_{article}` to parent ELI, adding `#Art.{article}` to parent URL
   - **Fabrication** (CRITICAL): Identifier not in source/extractedReferences AND not a valid extension
2. **Malformed Identifiers**: Invalid format (wrong ELI prefix, wrong CELEX length, wrong NUMAC length)
3. **Wrong Decision Data**: Enrichment from different case

### ⚠️ MAJOR ISSUES (Quality Problems)
1. **Missed Identifiers**: ELI/CELEX/URL clearly in extractedReferences but not used (>30% miss rate)
2. **Wrong Level**: Provision-level identifier assigned to parent (or vice versa)
3. **Format Violations**: Near-valid format but with structural issues

### ℹ️ MINOR ISSUES (Acceptable)
1. **One Missed Identifier**: Single ELI/URL not extracted when in extractedReferences
2. **Partial Extraction**: Some enrichment missing (acceptable if context makes matching difficult)

---

## SPECIFIC VALIDATION CHECKS

### 1. No Fabrication (CRITICAL)

Every identifier and URL in output must exist in source text, extractedReferences, OR be a valid extension.

**What is a "valid extension"?**
Agent 2B can enhance identifiers from extractedReferences:
- ✅ Adding `/art_{article}` to parent ELI: `eli/be/loi/2007/05/10/2007202032` → `eli/be/loi/2007/05/10/2007202032/art_31`
- ✅ Adding `#Art.{article}` anchor to parent URL: `http://ejustice.../loi_a1.pl?cn=...` → `http://ejustice.../loi_a.pl?cn=...#Art.31`
- ✅ Adding fragment to EUR-Lex URL: `https://eur-lex.../CELEX:32016R0679` → `https://eur-lex.../CELEX:32016R0679#d1e1888-1-1`

**What is fabrication? (CRITICAL)**
- ❌ Identifier in output but NOT in source, NOT in extractedReferences, AND NOT a valid extension
- ❌ Base identifier doesn't exist in extractedReferences (even if extension is valid)
- ❌ URL constructed from scratch (not derived from extractedReferences)

**Red flags:**
- ELI/CELEX/NUMAC not in extractedReferences arrays AND not in source text
- Base ELI/URL doesn't exist before adding article component
- Completely fabricated identifier

---

### 1B. Cross-Validation Against extractedReferences (CRITICAL)

**Agent 2B pre-extracts references using production-tested regex. ALL identifiers/URLs in output must exist in extractedReferences.**

**Validation Algorithm:**

```
FOR EACH provision in citedProvisions:
    
    # Check parentActCelex
    IF provision.parentActCelex is not null:
        IF provision.parentActCelex NOT IN extractedReferences.celex[]:
            CRITICAL: "CELEX {value} not in extractedReferences.celex[]"
            CRITICAL: "  Available: {extractedReferences.celex}"
    
    # Check parentActEli
    IF provision.parentActEli is not null:
        found = false

        # 1. Check exact match
        IF provision.parentActEli IN extractedReferences.eli[]:
            found = true

        # 2. Check if base exists (parent ELI should NOT have /art_ component)
        IF "/art_" IN provision.parentActEli:
            # Parent ELI has article component - wrong level but check if base exists
            parent_eli_base = remove_after("/art_", provision.parentActEli)
            IF parent_eli_base IN extractedReferences.eli[]:
                found = true
                MAJOR: "parentActEli contains article component (should be in provisionEli)"
                MAJOR: "  Found: {provision.parentActEli}"
            ELSE:
                found = false

        # 3. Check if URL was mistakenly used as ELI
        IF provision.parentActEli IN extractedReferences.justelUrls[]:
            CRITICAL: "parentActEli contains URL, not ELI: {value}"
            found = false

        # 4. LLM supplementation check (found in source but not by regex)
        IF NOT found:
            IF provision.parentActEli IN source_text OR search_in_source(provision.parentActEli):
                MINOR: "Parent ELI found by LLM but not by regex (acceptable supplementation)"
                MINOR: "  ELI: {provision.parentActEli}"
                found = true

        IF NOT found:
            CRITICAL: "Parent ELI not in extractedReferences, not in source (fabrication)"
            CRITICAL: "  Found: {provision.parentActEli}"
            CRITICAL: "  Available in extractedReferences.eli: {extractedReferences.eli}"
    
    # Check provisionEli
    IF provision.provisionEli is not null:
        found = false

        # 1. Check exact match (provision ELI from extractedReferences)
        IF provision.provisionEli IN extractedReferences.eli[]:
            found = true

        # 2. Check if base exists (VALID EXTENSION: Agent 2B added /art_ component)
        IF "/art_" IN provision.provisionEli:
            base = remove_after("/art_", provision.provisionEli)
            IF base IN extractedReferences.eli[]:
                found = true  # ✅ Valid extension - Agent 2B enhanced parent ELI with article
            ELSE:
                # Base doesn't exist - check source text
                IF base IN source_text OR search_in_source(base):
                    found = true
                    MINOR: "Provision ELI base found in source but not by regex"
        ELSE:
            # Provision ELI without /art_ component - wrong level but check if exists
            IF provision.provisionEli IN extractedReferences.eli[]:
                found = true
                MAJOR: "provisionEli missing article component (should have /art_)"

        # 3. LLM supplementation check
        IF NOT found:
            IF provision.provisionEli IN source_text OR search_in_source(provision.provisionEli):
                MINOR: "Provision ELI found by LLM but not by regex (acceptable)"
                found = true

        IF NOT found:
            CRITICAL: "Provision ELI not in extractedReferences, not in source (fabrication)"
            CRITICAL: "  Found: {provision.provisionEli}"
            CRITICAL: "  Available in extractedReferences.eli: {extractedReferences.eli}"
    
    # Check NUMAC (if parentActNumber is 10 chars alphanumeric)
    IF provision.parentActNumber is not null:
        IF length(provision.parentActNumber) == 10:
            IF is_alphanumeric(provision.parentActNumber):
                found = false

                # 1. Check exact match
                IF provision.parentActNumber IN extractedReferences.numac[]:
                    found = true

                # 2. LLM supplementation check (found in source but not by regex)
                IF NOT found:
                    IF provision.parentActNumber IN source_text OR search_in_source(provision.parentActNumber):
                        MINOR: "NUMAC found by LLM but not by regex (acceptable)"
                        found = true

                IF NOT found:
                    CRITICAL: "NUMAC not in extractedReferences, not in source (fabrication)"
                    CRITICAL: "  Found: {provision.parentActNumber}"
                    CRITICAL: "  Available in extractedReferences.numac: {extractedReferences.numac}"
    
    # Check file reference (if YYYY-MM-DD/NN format)
    IF provision.parentActNumber is not null:
        IF matches_pattern(provision.parentActNumber, "YYYY-MM-DD/NN"):
            IF provision.parentActNumber NOT IN extractedReferences.fileNumber[]:
                MINOR: "File reference {value} not in extractedReferences.fileNumber[]"
                MINOR: "  (May be acceptable if extracted via alternative method)"
    
    # Check Justel URLs
    IF provision.parentActUrlJustel is not null:
        found = false

        # 1. Check exact match
        IF provision.parentActUrlJustel IN extractedReferences.justelUrls[]:
            found = true

        # 2. Check if base exists (should NOT have article anchor)
        IF "#Art." IN provision.parentActUrlJustel OR "#art." IN provision.parentActUrlJustel:
            # Parent URL has article anchor - wrong level but check if base exists
            base_url = remove_after("#", provision.parentActUrlJustel)
            IF base_url IN extractedReferences.justelUrls[]:
                found = true
                MAJOR: "parentActUrlJustel has article anchor (should be in provisionUrlJustel)"
            ELSE:
                found = false

        IF NOT found:
            CRITICAL: "Parent Justel URL not in extractedReferences (fabrication)"
            CRITICAL: "  Found: {provision.parentActUrlJustel}"

    IF provision.provisionUrlJustel is not null:
        found = false

        # 1. Check exact match
        IF provision.provisionUrlJustel IN extractedReferences.justelUrls[]:
            found = true

        # 2. Check if base exists (VALID EXTENSION: Agent 2B added #Art anchor)
        IF "#Art." IN provision.provisionUrlJustel OR "#art." IN provision.provisionUrlJustel:
            base_url = remove_after("#", provision.provisionUrlJustel)
            IF base_url IN extractedReferences.justelUrls[]:
                found = true  # ✅ Valid extension - Agent 2B added article anchor
            ELSE:
                found = false
        ELSE:
            # Provision URL without anchor - wrong level
            MAJOR: "provisionUrlJustel missing article anchor"

        IF NOT found:
            CRITICAL: "Provision Justel URL not in extractedReferences (fabrication)"
            CRITICAL: "  Found: {provision.provisionUrlJustel}"
    
    # Check EUR-Lex URLs
    IF provision.parentActUrlEurlex is not null:
        found = false

        # 1. Check exact match
        IF provision.parentActUrlEurlex IN extractedReferences.eurLexUrls[]:
            found = true

        # 2. Check if base exists (should NOT have fragment)
        IF "#" IN provision.parentActUrlEurlex:
            base_url = remove_after("#", provision.parentActUrlEurlex)
            IF base_url IN extractedReferences.eurLexUrls[]:
                found = true
                MAJOR: "parentActUrlEurlex has fragment (should be in provisionUrlEurlex)"
            ELSE:
                found = false

        IF NOT found:
            CRITICAL: "Parent EUR-Lex URL not in extractedReferences (fabrication)"
            CRITICAL: "  Found: {provision.parentActUrlEurlex}"

    IF provision.provisionUrlEurlex is not null:
        found = false

        # 1. Check exact match
        IF provision.provisionUrlEurlex IN extractedReferences.eurLexUrls[]:
            found = true

        # 2. Check if base exists (VALID EXTENSION: Agent 2B added fragment)
        IF "#" IN provision.provisionUrlEurlex:
            base_url = remove_after("#", provision.provisionUrlEurlex)
            IF base_url IN extractedReferences.eurLexUrls[]:
                found = true  # ✅ Valid extension - Agent 2B added fragment
            ELSE:
                found = false
        ELSE:
            # Provision URL without fragment - acceptable but not ideal
            IF provision.provisionUrlEurlex IN extractedReferences.eurLexUrls[]:
                found = true

        IF NOT found:
            CRITICAL: "Provision EUR-Lex URL not in extractedReferences (fabrication)"
            CRITICAL: "  Found: {provision.provisionUrlEurlex}"
```

**This check prevents fabrication while allowing valid extensions:**
- ✅ **Allowed**: Agent 2B adds `/art_` to parent ELI, `#Art.` to parent URL, fragments to EUR-Lex URLs
- ✅ **Allowed**: LLM finds identifiers regex missed (if they exist in source text)
- ❌ **Forbidden**: Creating identifiers not in source, not in extractedReferences, not valid extensions

---

### 2. Detection Completeness (MAJOR)

Calculate detection rates by comparing usage against availability in extractedReferences:

```
# Count available identifiers
celex_available = length(extractedReferences.celex)
eli_available = length(extractedReferences.eli)
numac_available = length(extractedReferences.numac)
justel_available = length(extractedReferences.justelUrls)
eurlex_available = length(extractedReferences.eurLexUrls)
filenum_available = length(extractedReferences.fileNumber)

# Count usage in output
celex_used = count provisions where parentActCelex != null
eli_used = count provisions where parentActEli or provisionEli != null
numac_used = count provisions where parentActNumber is 10-char alphanumeric
justel_used = count provisions where any Justel URL != null
eurlex_used = count provisions where any EUR-Lex URL != null
filenum_used = count provisions where parentActNumber matches YYYY-MM-DD/NN

# Calculate rates (avoid division by zero)
celex_rate = celex_used / max(celex_available, 1) IF celex_available > 0 ELSE null
eli_rate = eli_used / max(eli_available, 1) IF eli_available > 0 ELSE null
numac_rate = numac_used / max(numac_available, 1) IF numac_available > 0 ELSE null
justel_rate = justel_used / max(justel_available, 1) IF justel_available > 0 ELSE null
eurlex_rate = eurlex_used / max(eurlex_available, 1) IF eurlex_available > 0 ELSE null
```

**Thresholds:**
- **≥70%**: Good detection
- **50-69%**: Acceptable (some misses)
- **30-49%**: MAJOR issue (significant under-extraction)
- **<30%**: MAJOR issue (severe under-extraction)

```
IF any rate < 30% AND available > 0:
    MAJOR: "Severe under-extraction of {type}: {available} available, {used} used ({rate}%)"

IF any rate < 50% AND available > 2:
    MAJOR: "Significant under-extraction of {type}: {available} available, {used} used ({rate}%)"
```

**Note:** Don't penalize if identifiers are ambiguous or context makes matching impossible.

---

### 3. Provision vs Parent Level (MAJOR)

**Provision-level fields** point to SPECIFIC articles:
- `provisionEli`: Must contain `/art_` component
- `provisionUrlJustel`: Must contain `#Art.` or `#art.` anchor
- `provisionUrlEurlex`: Must contain fragment identifier (e.g., `#d1e1888-1-1`)

**Parent act-level fields** point to ENTIRE acts:
- `parentActEli`: Must NOT contain `/art_` component
- `parentActCelex`: Applies to entire act only (no provision-level CELEX)
- `parentActUrlJustel`: Must NOT contain article anchor
- `parentActUrlEurlex`: Must NOT contain article anchor

**Validation:**
```
FOR EACH provision:
    # Check provision ELI
    IF provisionEli is not null:
        IF "/art_" NOT IN provisionEli:
            MAJOR: "provisionEli missing article component: {value}"
            MAJOR: "  Should be in parentActEli instead"
    
    # Check parent ELI
    IF parentActEli is not null:
        IF "/art_" IN parentActEli:
            MAJOR: "parentActEli contains article component: {value}"
            MAJOR: "  Should be in provisionEli instead"
    
    # Check Justel URLs
    IF provisionUrlJustel is not null:
        IF "#Art." NOT IN provisionUrlJustel AND "#art." NOT IN provisionUrlJustel:
            MAJOR: "provisionUrlJustel missing article anchor"
    
    IF parentActUrlJustel is not null:
        IF "#Art." IN parentActUrlJustel OR "#art." IN parentActUrlJustel:
            MAJOR: "parentActUrlJustel contains article anchor: {value}"
            MAJOR: "  Should be in provisionUrlJustel instead"
    
    # Check EUR-Lex URLs
    IF provisionUrlEurlex is not null:
        IF "#" NOT IN provisionUrlEurlex:
            MAJOR: "provisionUrlEurlex missing fragment identifier"
    
    IF parentActUrlEurlex is not null:
        IF "#" IN parentActUrlEurlex:
            # Check if fragment looks like article reference
            IF looks_like_article_anchor(parentActUrlEurlex):
                MAJOR: "parentActUrlEurlex contains article fragment"
```

---

### 4. Format Validation (MAJOR)

#### ELI Format (Strict Validation)

**Belgian ELI Requirements:**
- **MUST start with**: `eli/be/` (NOT `eli/wet/`, `eli/loi/`, `eli/arrete/`, or any other variant)
- **Valid types**: `loi`, `wet`, `arrete_royal`, `koninklijk_besluit`, `ordonnance`, `decret`, `arrete_gouvernement`, `besluit_van_de_regering`
- **Date component**: `/YYYY/MM/DD/` with valid calendar date (1789-2025)
- **NUMAC component**: Exactly 10 alphanumeric characters (last segment before optional `/art_`)
- **Optional article**: `/art_{number}` for provision-level ELI
- **Optional language**: `/fr` or `/nl` suffix

**Valid Belgian ELI patterns:**
```
Parent act: eli/be/{type}/YYYY/MM/DD/{10-char-numac}
Provision: eli/be/{type}/YYYY/MM/DD/{10-char-numac}/art_{article}
With language: eli/be/{type}/YYYY/MM/DD/{10-char-numac}/fr
```

**EU ELI Requirements:**
- **Valid formats**: 
  - `eli/eu/{type}/YYYY/{number}/oj` (parent act)
  - `eli/eu/{type}/YYYY/{number}/oj/art_{article}` (provision)
  - `eli/reg/YYYY/{number}/oj` (alternative regulation format)
  - `eli/dir/YYYY/{number}/oj` (alternative directive format)
- **Types**: `reg` (regulation), `dir` (directive), `dec` (decision)
- **Number**: 1-5 digits

**Validation Checks for EVERY ELI:**

```
FOR EACH provision:
    # Check parentActEli
    IF parentActEli is not null:
        
        # 1. Prefix validation
        IF starts_with(parentActEli, "eli/wet/"):
            CRITICAL: "Invalid ELI prefix: starts with 'eli/wet/' instead of 'eli/be/'"
            CRITICAL: "  Found: {parentActEli}"
        
        IF starts_with(parentActEli, "eli/loi/"):
            CRITICAL: "Invalid ELI prefix: starts with 'eli/loi/' instead of 'eli/be/'"
            CRITICAL: "  Found: {parentActEli}"
        
        IF starts_with(parentActEli, "eli/arrete/"):
            CRITICAL: "Invalid ELI prefix: starts with 'eli/arrete/' instead of 'eli/be/'"
            CRITICAL: "  Found: {parentActEli}"
        
        # 2. Belgian ELI structure validation
        IF starts_with(parentActEli, "eli/be/"):
            parts = split(parentActEli, "/")
            
            # Check basic structure: eli/be/{type}/YYYY/MM/DD/{numac}
            IF length(parts) < 7:
                CRITICAL: "Malformed Belgian ELI: insufficient path segments"
                CRITICAL: "  Expected: eli/be/{type}/YYYY/MM/DD/{numac}"
                CRITICAL: "  Found: {parentActEli}"
            
            # Extract NUMAC component (7th segment)
            IF length(parts) >= 7:
                numac_component = parts[6]  # 0-indexed: eli(0)/be(1)/type(2)/year(3)/month(4)/day(5)/numac(6)
                
                IF length(numac_component) != 10:
                    CRITICAL: "Invalid Belgian ELI: NUMAC component must be exactly 10 characters"
                    CRITICAL: "  Found NUMAC: {numac_component} (length: {length})"
                    CRITICAL: "  Full ELI: {parentActEli}"
                
                IF NOT is_alphanumeric(numac_component):
                    CRITICAL: "Invalid Belgian ELI: NUMAC must be alphanumeric"
                    CRITICAL: "  Found NUMAC: {numac_component}"
            
            # Check for extra unexpected segments
            IF length(parts) > 7:
                # Allowed: /art_{article} or /fr or /nl
                IF parts[7] NOT IN ["art_*", "fr", "nl", "and", "or"]:
                    IF NOT starts_with(parts[7], "art_"):
                        CRITICAL: "Malformed Belgian ELI: unexpected path segment after NUMAC"
                        CRITICAL: "  Unexpected: /{parts[7]}"
                        CRITICAL: "  Full ELI: {parentActEli}"
        
        # 3. EU ELI structure validation
        IF starts_with(parentActEli, "eli/eu/") OR starts_with(parentActEli, "eli/reg/") OR starts_with(parentActEli, "eli/dir/"):
            # Valid EU patterns
            IF NOT matches_pattern(parentActEli, "eli/(eu|reg|dir)/(reg|dir|dec)?/?\d{4}/\d{1,5}(/oj)?(/art_.*)?"):
                MAJOR: "Malformed EU ELI structure"
                MAJOR: "  Found: {parentActEli}"
        
        # 4. Check for URL contamination
        IF "justel" IN parentActEli:
            CRITICAL: "ELI contaminated with URL path: contains 'justel'"
            CRITICAL: "  Found: {parentActEli}"
        
        IF "http" IN parentActEli:
            CRITICAL: "ELI contaminated with URL: contains 'http'"
            CRITICAL: "  Found: {parentActEli}"
    
    # Repeat same checks for provisionEli
    IF provisionEli is not null:
        [Apply same validation logic as above]
```

**Common Fabrication Patterns to Catch:**

❌ **Invalid Prefix:**
- `eli/wet/2007/05/15/2007000560` → Should be `eli/be/wet/...`
- `eli/loi/2007/05/10/2007202032` → Should be `eli/be/loi/...`
- `eli/arrete/2009/05/19/2009201234` → Should be `eli/be/arrete_royal/...`

❌ **Extra Segments:**
- `eli/be/loi/2007/05/15/0/2007000560` → Extra `/0/` before NUMAC
- `eli/be/loi/2007/05/15/2007000560/and` → Invalid `/and` suffix
- `eli/be/loi/2007/05/15/2007000560/justel` → URL path leaked into ELI

❌ **Wrong NUMAC Length:**
- `eli/be/loi/2007/05/15/200700056` → NUMAC only 9 chars (need 10)
- `eli/be/loi/2007/05/15/20070005600` → NUMAC 11 chars (need 10)
- `eli/be/loi/2007/05/15/207000560` → NUMAC only 9 chars (need 10)

✅ **CORRECT Belgian ELI:**
- `eli/be/loi/2007/05/10/2007202032` (parent act)
- `eli/be/loi/2007/05/10/2007202032/art_31` (provision)
- `eli/be/arrete_royal/2009/05/19/2009201234` (royal decree)
- `eli/be/wet/2007/05/15/2007000560/nl` (with language)

✅ **CORRECT EU ELI:**
- `eli/eu/reg/2016/679/oj` (GDPR parent)
- `eli/reg/2016/679/oj/art_6` (GDPR article 6)
- `eli/dir/2000/78/oj` (Directive parent)

---

#### CELEX Format

**Length**: 9-11 characters (with optional corrigendum: 9-13 chars)
**Pattern**: Sector(1) + Year(4) + Type(1-2 letters) + Sequential(4-6 digits) + Optional R(XX)

**Sector-Specific Types:**

**Sector 3 - Legal Acts (1-letter type, 10 chars total):**
- Types: R, L, D, A, B, C, E, F, G, H, J, K, M, O, Q, S, X, Y
- Examples: `32016R0679` (GDPR), `32019L1024` (directive), `32003R0001` (with leading zeros)

**Sector 5 - Preparatory Documents (often 2-letter type, 11 chars total):**
- Types: DC, PC, SC, AG, KG, IG, XG, JC, EC, FC, GC, M, AT, AS, XC, etc.
- Examples: `52020DC0066` (Commission doc), `52021PC0206` (proposal)

**Sector 6 - Case Law (2-letter type, 11 chars total):**
- Types: CJ, TJ, CO, CC, CS, CT, CV, CX, CD, CP, CN, CA, CB, CU, CG, etc.
- Examples: `62019CJ0311` (Schrems II), `62022CC0307` (pending case)

**With corrigendum**: `32016R0679R(01)` (13 chars total)

**Validation:**
```
IF parentActCelex is not null:
    celex = parentActCelex
    
    # Check length
    IF length(celex) NOT IN [9, 10, 11, 12, 13]:
        MAJOR: "Invalid CELEX length: {length} chars (expected 9-13)"
        MAJOR: "  Found: {celex}"
    
    # Check sector
    sector = celex[0]
    IF sector NOT IN ['3', '5', '6']:
        MAJOR: "Invalid CELEX sector: {sector} (expected 3, 5, or 6)"
        MAJOR: "  Found: {celex}"
    
    # Validate sector-specific type codes
    year = celex[1:5]
    type_code = extract_type_code(celex)  # Next 1-2 letters after year
    
    IF sector == '3':
        IF length(type_code) != 1:
            MAJOR: "Sector 3 CELEX should have 1-letter type code"
        IF type_code NOT IN ['R','L','D','A','B','C','E','F','G','H','J','K','M','O','Q','S','X','Y']:
            MAJOR: "Invalid Sector 3 type code: {type_code}"
    
    IF sector == '5':
        # Usually 2-letter but can be 1-letter (M)
        IF type_code NOT IN ['DC','PC','SC','AG','KG','IG','XG','JC','EC','FC','GC','M','AT','AS','XC', ...]:
            MAJOR: "Invalid Sector 5 type code: {type_code}"
    
    IF sector == '6':
        IF length(type_code) != 2:
            MAJOR: "Sector 6 CELEX should have 2-letter type code"
        IF type_code NOT IN ['CJ','TJ','CO','CC','CS','CT','CV','CX','CD','CP','CN','CA','CB','CU','CG', ...]:
            MAJOR: "Invalid Sector 6 type code: {type_code}"
    
    # CELEX only for EU law
    IF provision.parentActType IN [Belgian types]:
        MAJOR: "Belgian law should not have CELEX (EU only)"
        MAJOR: "  parentActType: {provision.parentActType}"
        MAJOR: "  parentActCelex: {celex}"
```

**Valid CELEX Examples:**
- `32016R0679` (GDPR - sector 3, type R, 10 chars)
- `62019CJ0311` (Schrems II - sector 6, type CJ, 11 chars)
- `52020DC0066` (Commission doc - sector 5, type DC, 11 chars)
- `32003R0001` (With leading zeros - sector 3, type R, 10 chars)
- `32016R0679R(01)` (With corrigendum - 13 chars)

**Invalid CELEX Examples:**
- `2016R0679` (missing sector, too short)
- `32016R679` (only 9 chars, sequential too short)
- `420160679` (sector 4 invalid, no type letter)

---

#### NUMAC Format (parentActNumber field)

**Requirements:**
- **Length**: Exactly 10 characters (no more, no less)
- **Pattern**: YYYY[0-9A-E]\d{5}
  - Positions 1-4: Year (1789-2025)
  - Position 5: Digit (0-9) OR letter (A, B, C, D, E only)
  - Positions 6-10: Digits only

**Validation:**
```
IF parentActNumber is not null:
    IF length(parentActNumber) == 10 AND is_alphanumeric(parentActNumber):
        numac = parentActNumber
        
        # Extract year
        year_str = numac[0:4]
        IF NOT is_numeric(year_str):
            MAJOR: "Invalid NUMAC: first 4 chars must be year"
            MAJOR: "  Found: {numac}"
        
        year = to_integer(year_str)
        IF year < 1789 OR year > 2025:
            MAJOR: "Invalid NUMAC: year out of range (1789-2025)"
            MAJOR: "  Found year: {year}"
            MAJOR: "  Full NUMAC: {numac}"
        
        # Check position 5 (category)
        category = numac[4]
        IF category NOT IN ['0','1','2','3','4','5','6','7','8','9','A','B','C','D','E']:
            MAJOR: "Invalid NUMAC: position 5 must be digit or A-E"
            MAJOR: "  Found: {category}"
            MAJOR: "  Full NUMAC: {numac}"
        
        # Check positions 6-10 (sequence)
        sequence = numac[5:10]
        IF NOT is_numeric(sequence):
            MAJOR: "Invalid NUMAC: positions 6-10 must be digits"
            MAJOR: "  Found: {sequence}"
            MAJOR: "  Full NUMAC: {numac}"
```

**Valid NUMAC Examples:**
- `2017031916` (standard format)
- `1870B30450` (rare format with letter B at position 5)
- `2006202382` (standard format)
- `1999062050` (often represents date YYYYMMDD + 2 digits)

**Invalid NUMAC Examples:**
- `201703191` (only 9 chars)
- `20170319160` (11 chars)
- `2017F31916` (position 5 has F - only A-E allowed)
- `2017031G16` (position 8 has letter)

---

#### File Number Format (parentActNumber field)

**Pattern**: YYYY-MM-DD/NN
- Date component: Full date (validated)
- Counter component: 1-3 digits

**Validation:**
```
IF parentActNumber is not null:
    IF matches_pattern(parentActNumber, "YYYY-MM-DD/NN"):
        parts = split(parentActNumber, "/")
        date_part = parts[0]
        counter_part = parts[1]
        
        # Validate date
        date_components = split(date_part, "-")
        year = to_integer(date_components[0])
        month = to_integer(date_components[1])
        day = to_integer(date_components[2])
        
        IF NOT is_valid_date(year, month, day):
            MAJOR: "Invalid file reference: date component invalid"
            MAJOR: "  Found: {date_part}"
            MAJOR: "  Full reference: {parentActNumber}"
        
        IF year < 1789 OR year > 2025:
            MAJOR: "Invalid file reference: year out of range"
            MAJOR: "  Found year: {year}"
        
        # Validate counter
        IF NOT is_numeric(counter_part):
            MAJOR: "Invalid file reference: counter must be numeric"
            MAJOR: "  Found: {counter_part}"
        
        IF length(counter_part) < 1 OR length(counter_part) > 3:
            MAJOR: "Invalid file reference: counter should be 1-3 digits"
            MAJOR: "  Found: {counter_part}"
```

**Valid File Reference Examples:**
- `2012-05-15/16`
- `2012-04-22/26`
- `2023-01-09/6`

**Invalid File Reference Examples:**
- `2012-13-45/16` (invalid date: month 13, day 45)
- `2012-05-15/X` (counter not numeric)
- `2012/05/15/16` (wrong separator: / instead of -)

---

#### URL Format

**Valid Domains:**
- Justel: `ejustice.just.fgov.be`
- EUR-Lex: `eur-lex.europa.eu`
- etaamb: `etaamb.openjustice.be`
- Data Europa: `data.europa.eu`

**Validation:**
```
FOR EACH URL field (provisionUrl*, parentActUrl*):
    IF URL is not null:
        # Check domain
        domain = extract_domain(URL)
        
        IF field is Justel URL:
            IF domain != "ejustice.just.fgov.be":
                MAJOR: "Invalid Justel URL domain: {domain}"
        
        IF field is EUR-Lex URL:
            IF domain != "eur-lex.europa.eu":
                MAJOR: "Invalid EUR-Lex URL domain: {domain}"
        
        # Check scheme
        IF NOT starts_with(URL, "http://") AND NOT starts_with(URL, "https://"):
            MAJOR: "Invalid URL scheme (must be http or https)"
            MAJOR: "  Found: {URL}"
```

---

### 5. Type Consistency (MAJOR)

**Belgian law types:**
- French: LOI, ARRETE_ROYAL, CODE, CONSTITUTION, ARRETE_GOUVERNEMENT, ORDONNANCE, DECRET, AUTRE
- Dutch: WET, KONINKLIJK_BESLUIT, WETBOEK, GRONDWET, BESLUIT_VAN_DE_REGERING, ORDONNANTIE, DECREET, ANDERE

**EU law types:**
- French: REGLEMENT_UE, DIRECTIVE_UE, TRAITE
- Dutch: EU_VERORDENING, EU_RICHTLIJN, VERDRAG

**Validation:**
```
FOR EACH provision:
    is_belgian = parentActType IN [Belgian types]
    is_eu = parentActType IN [EU types]
    
    IF is_belgian:
        IF parentActCelex is not null:
            MAJOR: "Belgian law should not have CELEX (EU only)"
            MAJOR: "  parentActType: {parentActType}"
            MAJOR: "  parentActCelex: {parentActCelex}"
        
        IF parentActUrlEurlex is not null OR provisionUrlEurlex is not null:
            MAJOR: "Belgian law should not have EUR-Lex URLs"
            MAJOR: "  parentActType: {parentActType}"
    
    IF is_eu:
        IF provisionUrlJustel is not null OR parentActUrlJustel is not null:
            MAJOR: "EU law should not have Justel URLs (Belgian only)"
            MAJOR: "  parentActType: {parentActType}"
        
        IF parentActNumber looks like NUMAC (10 chars alphanumeric):
            MAJOR: "EU law should not have NUMAC (Belgian only)"
            MAJOR: "  parentActType: {parentActType}"
            MAJOR: "  parentActNumber: {parentActNumber}"
```

---

### 6. Citation Reference Quality (MINOR)

**What is citationReference?**
Formal legal citation in Bluebook or European citation style, typically found in footnotes or bibliographic sections.

**Required Components:**
- Act type and date: "Loi du 30 juillet 2018" or "Wet van 30 juli 2018"
- Publication source: M.B., B.S., or J.O.
- Publication date
- Optional: Page numbers ("p. 68616" or "blz. 29016")

**Valid Citation Formats:**

Belgian (French):
```
"Loi du [date], M.B., [date], p. [page]"
"Arrêté royal du [date], M.B., [date]"
```

Belgian (Dutch):
```
"Wet van [datum], B.S., [datum], blz. [pagina]"
"Koninklijk besluit van [datum], B.S., [datum]"
```

EU:
```
"Règlement (UE) [number], J.O., L [vol], [date], p. [pages]"
"Directive (EU) [number], OJ L [vol], [date], p. [pages]"
```

**Validation:**
```
IF citationReference is not null:
    citation = citationReference
    
    # Check for publication source
    has_belgian_pub = "M.B." IN citation OR "B.S." IN citation
    has_eu_pub = "J.O." IN citation OR "OJ " IN citation OR "P.B." IN citation
    
    IF NOT (has_belgian_pub OR has_eu_pub):
        MINOR: "Citation missing publication source (M.B./B.S./J.O.)"
        MINOR: "  Found: {citation}"
    
    # Check minimum length
    IF length(citation) < 20:
        MINOR: "Citation too short (< 20 chars) - likely incomplete"
        MINOR: "  Found: {citation}"
    
    # Check for invalid patterns (not real citations)
    IF starts_with(citation, "article") OR starts_with(citation, "artikel"):
        MINOR: "Citation looks like article mention, not formal citation"
        MINOR: "  Found: {citation}"
    
    IF "ejustice" IN citation OR "eur-lex" IN citation:
        MINOR: "Citation contains URL - should be bibliographic reference"
        MINOR: "  Found: {citation}"
    
    IF citation == "CELEX:" or matches_pattern(citation, "CELEX:.*"):
        MINOR: "CELEX number alone is not a citation"
        MINOR: "  Found: {citation}"
```

**What NOT to accept as citations:**
- ❌ Simple mentions: "l'article 31 de la loi de 2007"
- ❌ URLs or ELI identifiers
- ❌ CELEX numbers alone: "CELEX: 32016R0679"
- ❌ Narrative references: "la loi précitée"

**Can be null:**
- Many decisions lack formal citations (especially court opinions without legislative footnotes)
- Bibliographic references from extractedReferences are article mentions, not formal citations
- Null is appropriate when no formal citation exists in source

---

## OUTPUT FORMAT

Return ONLY valid JSON:

```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 88,
  "confidence": "HIGH|MEDIUM|LOW",
  "enrichmentPresent": true,
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  
  "criticalIssues": [
    "Fabricated ELI: 'eli/wet/2007/05/15/0/2007000560/and' not in extractedReferences",
    "Invalid ELI format: starts with 'eli/wet/' instead of 'eli/be/'"
  ],
  
  "majorIssues": [
    "Severe under-extraction of CELEX: 5 available, 0 used (0%)",
    "Belgian law has CELEX (EU only)"
  ],
  
  "minorIssues": [
    "Citation reference missing publication source",
    "One ELI in extractedReferences not used"
  ],
  
  "enrichmentStats": {
    "provisionsEnriched": "7/16",
    "fieldsPopulated": "parentActEli, parentActNumber, parentActUrlJustel",
    "celexAvailable": 0,
    "celexUsed": 0,
    "celexRate": null,
    "eliAvailable": 2,
    "eliUsed": 1,
    "eliRate": 0.50,
    "numacAvailable": 2,
    "numacUsed": 2,
    "numacRate": 1.00,
    "justelAvailable": 2,
    "justelUsed": 1,
    "justelRate": 0.50,
    "eurlexAvailable": 1,
    "eurlexUsed": 0,
    "eurlexRate": 0.00
  },
  
  "summary": "Enrichment found in 7/16 provisions but with critical ELI fabrication. The ELI 'eli/wet/2007/05/15/0/2007000560/and' does not exist in extractedReferences and has invalid format with wrong prefix and extra segments. NUMAC extraction was correct (100% rate). Detection rates: ELI 50%, Justel 50%."
}
```

---

## VERDICT LOGIC

```
IF any CRITICAL issue:
    verdict = FAIL

ELSE IF score >= 90 AND no MAJOR issues:
    verdict = PASS

ELSE IF score >= 70 AND MAJOR issues <= 2:
    verdict = REVIEW_REQUIRED

ELSE IF score < 70 OR MAJOR issues > 2:
    verdict = FAIL

ELSE:
    verdict = PASS
```

---

## SCORING (Only When Enrichment Present)

Start at 100 points:

```
# Critical issues
FOR EACH CRITICAL issue:
    score -= 20

# Major issues
FOR EACH MAJOR issue:
    score -= 10

# Minor issues
FOR EACH MINOR issue:
    score -= 2

# Detection rate penalties
FOR EACH identifier type with rate < 30% AND available > 0:
    score -= 15

FOR EACH identifier type with rate 30-49% AND available > 2:
    score -= 10

# Clamp score
score = max(0, min(100, score))
```

**Special Case - No Enrichment in Source:**
- If extractedReferences has zero items AND source scan finds no signals → score = 100

---

## KEY PRINCIPLES

1. **Check ALL provisions** before claiming "no enrichment extracted"
2. **Better to have null than fabricate** - Missing enrichment is acceptable; invented enrichment is not
3. **Cross-validate against extractedReferences** - All identifiers must be in pre-extracted arrays OR valid extensions
4. **Allow valid extensions** - Agent 2B can enhance identifiers (add /art_, #Art., fragments) if base exists in extractedReferences
5. **Allow LLM supplementation** - If identifier is in source text but regex missed it, that's acceptable (flag as MINOR)
6. **Validate format strictly** - ELI must start with eli/be/, CELEX must be 9-11 chars, NUMAC must be exactly 10 chars
7. **Not all decisions have enrichment** - Enrichment-free documents should score 100
8. **Only evaluate what exists** - Don't penalize for not extracting metadata that isn't in the source

Now evaluate the provided extraction.