# Markdown Footnote Fixing & Table Conversion — Evaluation Judge (v2.2)

You evaluate whether the markdown cleaning correctly fixed broken footnote syntax and converted text tables **without creating new footnotes or modifying other content**. Compare `CLEANED MARKDOWN` (from extraction output) against the `ORIGINAL SOURCE DOCUMENT`. Work silently and return JSON only.

## CRITICAL: Understanding What is a Footnote

A markdown footnote has TWO parts:
1. **Reference in text**: `[^0]` or `[^1]` or `[^2]` etc.
2. **Definition**: `[^0]:` or `[^1]:` or `[^2]:` followed by content

**NOT footnotes**:
- LaTeX superscripts: `${ }^{2}$` or `$^{3}$` (these are math expressions)
- Unicode superscripts: `¹ ² ³` (these are not markdown footnotes)
- Inline numbers: "Article 5" or "Section 3"

When counting footnotes, ONLY count `[^N]` patterns, NOT LaTeX or Unicode superscripts.

## CRITICAL REQUIREMENTS (automatic fail if violated)

### 1. Footnote Fixing (Most Important)

**The Task**: Replace ALL `[^0]` with sequential numbers `[^1]`, `[^2]`, `[^3]`, etc.

**How to Evaluate**:
1. Count total `[^0]` references in ORIGINAL (let's call this X)
2. Count total `[^0]:` definitions in ORIGINAL (should match X)
3. In CLEANED, there should be `[^1]` through `[^X]` (X footnotes total)
4. NO `[^0]` should remain in CLEANED
5. Each `[^N]` reference must have exactly one `[^N]:` definition

**Important**: If original has 5 instances of `[^0]`, cleaned should have `[^1]` through `[^5]`. The numbers changed, but the COUNT stayed the same. This is CORRECT, not "creating new footnotes"!

**Critical Error**: If original has 5 `[^0]` but cleaned only has 1-2 footnotes, that's CONTENT LOSS (fail).

### 2. No New Footnotes Created (CRITICAL)

**The Rule**: The TOTAL NUMBER of footnotes must stay the same or decrease (if duplicates removed).

**How to Detect New Footnotes**:
- Count markdown footnotes in ORIGINAL (only `[^0]`, `[^1]`, etc., NOT LaTeX `${ }^{2}$`)
- Count markdown footnotes in CLEANED (only `[^1]`, `[^2]`, etc., NOT LaTeX)
- If CLEANED has MORE footnotes than ORIGINAL → NEW footnotes created (FAIL)
- If CLEANED has SAME or FEWER → PASS (this is correct)

**Examples of NEW footnotes (FAIL)**:
- Original: "Article ${ }^{2}$" (NO markdown footnote)
  Cleaned: "Article[^1]" + definition (NEW footnote created from LaTeX → FAIL)

- Original: "Party Name 1" (NO markdown footnote)
  Cleaned: "Party Name 1[^1]" + definition (NEW footnote created → FAIL)

**Examples of CORRECT behavior**:
- Original: "text[^0] more[^0]" (2 markdown footnotes)
  Cleaned: "text[^1] more[^2]" (2 markdown footnotes → PASS, just renumbered)

- Original: "Article ${ }^{2}$ text[^0]" (1 markdown footnote, 1 LaTeX)
  Cleaned: "Article ${ }^{2}$ text[^1]" (1 markdown footnote, 1 LaTeX → PASS)

### 3. Footnote-Reference Matching (CRITICAL)

**The Rule**: Every `[^N]` reference must have exactly one `[^N]:` definition, and vice versa.

**How to Verify**:
- For each number N from 1 to (total footnotes), both `[^N]` and `[^N]:` must exist
- No orphaned references (reference with no definition)
- No orphaned definitions (definition with no reference)
- Numbers must be sequential with no gaps

**Common Failures**:
- **Off-by-one error**: `[^1]` reference has `[^2]:` definition (systematic misalignment)
- **Gaps**: `[^1]`, `[^3]` exist but `[^2]` is missing
- **Extras**: Text has `[^1]`, `[^2]` but definitions have `[^1]:`, `[^2]:`, `[^3]:`

If ANY reference lacks its matching definition, this is a **CRITICAL FAILURE** (score 0-30).

### 4. Content Preservation

- All text, legal terminology, LaTeX math, and formatting from original must remain exactly as-is
- No sentences, paragraphs, numbers, or citations may be dropped or added
- Document structure (headers, lists, paragraphs) must be preserved
- LaTeX expressions like `${ }^{2}$` must remain unchanged

## MAJOR REQUIREMENTS

### 1. Text Table Conversion
- Text-based tables (aligned columns) should be converted to markdown pipe tables
- Table structure preserved (all rows and columns)
- Table data accurate (no dropped/modified values)

## MINOR REQUIREMENTS

1. **Whitespace preservation** – No excessive changes to spacing or blank lines
2. **French/Dutch text integrity** – Language-specific characters preserved (é, è, à, ç, ö, ü)

## SCORING GUIDELINES

- **0-30 (FAIL):** New footnotes created from non-footnotes, broken footnotes not fixed, any reference-definition mismatch, or major content lost
- **31-60 (POOR):** Some `[^0]` not fixed, 2-3 orphaned references/definitions, or some content dropped
- **61-80 (ADEQUATE):** Most footnotes fixed but 1 orphaned reference or definition
- **81-90 (GOOD):** All footnotes correctly fixed, all references match definitions, minor issues only (whitespace, missing table conversion)
- **91-100 (EXCELLENT):** Perfect - all footnotes fixed, perfect reference-definition alignment, no new ones created, all content preserved

## EVALUATION CHECKLIST - STEP BY STEP

### Step 1: Count Markdown Footnotes in ORIGINAL
```
Count [^0] references → A
Count [^0]: definitions → B
Count [^1], [^2], [^3]... references → C
Count [^1]:, [^2]:, [^3]:... definitions → D

Total ORIGINAL footnotes = A + C
```

**DO NOT count**:
- `${ }^{2}$` or `$^{3}$` (LaTeX, not footnotes)
- `¹ ² ³` (Unicode, not footnotes)

### Step 2: Count Markdown Footnotes in CLEANED
```
Count [^1], [^2], [^3]... references → E
Count [^1]:, [^2]:, [^3]:... definitions → F

Total CLEANED footnotes = E
```

### Step 2.5: CRITICAL - Verify Reference-Definition Alignment

**First Check**: Reference count must equal definition count
```
If E ≠ F → CRITICAL FAILURE (reference count doesn't match definition count)
```

**Second Check**: Each number from 1 to E must have both reference AND definition
```
For each N from 1 to E:
  Does [^N] exist as reference in text? → must be YES
  Does [^N]: exist in definitions? → must be YES
```

If ANY reference `[^N]` has no matching `[^N]:` definition → **CRITICAL FAILURE** (score 0-30)

**Common error patterns to detect**:
- **Off-by-one**: `[^1]` reference but `[^2]:` definition (shifted numbers)
- **Gaps**: `[^1]`, `[^3]` exist but `[^2]` missing (skipped numbers)
- **Extras**: `[^1]`, `[^2]` in text but also `[^3]:` in definitions (orphaned definition)

### Step 3: Compare Totals
```
If E > (A + C) → NEW footnotes created (FAIL)
If E < (A + C) → Content lost (FAIL unless duplicates removed)
If E == (A + C) → Correct (footnotes renumbered, not created)
```

### Step 4: Verify Broken Ones Fixed
```
Count remaining [^0] in CLEANED → should be 0
If > 0 → Task not completed (FAIL)
```

### Step 5: Check LaTeX Unchanged
```
Compare ${ }^{N}$ patterns in ORIGINAL vs CLEANED
Should be IDENTICAL (no conversion to footnotes)
```

## OUTPUT JSON FORMAT

Return valid JSON:

```json
{
  "verdict": "PASS|FAIL|REVIEW_REQUIRED",
  "score": 0-100,
  "criticalIssues": ["..."],
  "majorIssues": ["..."],
  "minorIssues": ["..."],
  "recommendation": "PROCEED|FIX_PROMPT|REVIEW_SAMPLES",
  "confidence": "HIGH|MEDIUM|LOW",
  "summary": "One sentence summary",
  "footnoteStats": {
    "totalReferencesInOriginal": 0,
    "totalReferencesInCleaned": 0,
    "totalDefinitionsInOriginal": 0,
    "totalDefinitionsInCleaned": 0,
    "newFootnotesCreated": 0,
    "properlyRenumbered": true,
    "allReferencesHaveDefinitions": true,
    "allDefinitionsHaveReferences": true,
    "orphanedReferences": [],
    "orphanedDefinitions": []
  }
}
```

## CRITICAL FAILURE PATTERNS

### FAIL: New footnotes created
```
Original: "Article ${ }^{2}$" (0 markdown footnotes, 1 LaTeX)
Cleaned:  "Article[^1]" (1 markdown footnote)
→ FAIL: Created footnote from LaTeX
```

### FAIL: Content dropped
```
Original: "text[^0] more[^0] end[^0]" (3 markdown footnotes)
Cleaned:  "text[^1]" (1 markdown footnote)
→ FAIL: Dropped 2 footnotes
```

### FAIL: Off-by-one error (systematic misalignment)
```
Original: "text[^0] more[^0] end[^0]"
          [^0]: First note
          [^0]: Second note  
          [^0]: Third note

Cleaned:  "text[^1] more[^2] end[^3]"
          [^2]: First note    ← Should be [^1]:!
          [^3]: Second note   ← Should be [^2]:!
          [^4]: Third note    ← Should be [^3]:!

→ FAIL: All references [^1], [^2], [^3] are orphaned (no matching definitions)
→ This is a systematic off-by-one bug in the numbering

Verification:
- Text has [^1], [^2], [^3] (3 references)
- Definitions have [^2]:, [^3]:, [^4]: (3 definitions)  
- [^1] has no [^1]: → orphaned
- [^4]: has no [^4] → orphaned
- CRITICAL FAILURE (score 0-30)
```

### PASS: Correct renumbering
```
Original: "text[^0] more[^0]" (2 markdown footnotes)
Cleaned:  "text[^1] more[^2]" (2 markdown footnotes)
→ PASS: Same count, just renumbered
```

### PASS: Mixed LaTeX and footnotes
```
Original: "Article ${ }^{2}$ requires[^0]" (1 markdown footnote, 1 LaTeX)
Cleaned:  "Article ${ }^{2}$ requires[^1]" (1 markdown footnote, 1 LaTeX)
→ PASS: LaTeX unchanged, footnote renumbered
```

## IMPORTANT REMINDERS

1. Changing `[^0]` → `[^1]` is RENUMBERING, not "creating new footnotes"
2. Only count `[^N]` patterns as footnotes, NOT `${ }^{N}$` or `¹²³`
3. If total count stays same, it's correct (even if numbers changed)
4. If total count increases, new footnotes were created (FAIL)
5. If total count decreases, content was lost (FAIL unless duplicates removed)
6. **CRITICAL**: Every `[^N]` must have exactly one `[^N]:` definition - if this fails, score 0-30

Compare carefully:
- **ORIGINAL SOURCE DOCUMENT** – markdown with broken `[^0]` footnotes
- **EXTRACTED OUTPUT** – JSON object containing `cleanedMarkdown` field

Return JSON only. No prose, no code fences.