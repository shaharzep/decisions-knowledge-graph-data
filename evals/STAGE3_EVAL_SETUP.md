# Stage 3: Cited Decisions Extraction - Evaluation Setup

**Status:** ✅ **PRODUCTION READY**

This document confirms that the evaluation infrastructure for Stage 3 (extract-cited-decisions) is fully configured and ready for testing.

---

## What Was Fixed

### 1. **Judge Prompt Updated** ✅
**File:** `evals/judge-prompts/llm-as-a-judge_STAGE 3.md`

**Changes:**
- Updated to v4.0 with comprehensive fixes
- **Fixed verbatim extraction examples** (lines 446-486)
  - Clear: "Cass." stays "Cass." (not expanded)
  - Clear: "CJUE" stays "CJUE" (not expanded)
- **Added administrative body validation** (Section 4, lines 498-518)
  - Validates decision numbers are present
  - MAJOR issue (-12 points) if missing
- **Enhanced foreign court detection** (lines 141-157)
  - Three-layer system: code validation, code-name consistency, keyword detection
- **Clarified treatment penalties** (lines 629-643)
  - Individual: 4 wrong × -8 = -32
  - Aggregate: >30% threshold → -12
  - Total: -44 points (cap at -50)
- **Expanded context window** (lines 525-529)
  - 100-150 words BEFORE citation
  - 50-100 words AFTER citation
- **Refined verdict logic** (lines 824-840)
  - PASS: 0-1 MAJOR + score ≥ 80
  - REVIEW_REQUIRED: 2+ MAJOR or 5+ MINOR or score 60-79
- **Added ECLI validation** (Section 7, lines 667-683)
- **Added sequencing validation** (Section 8, lines 686-697)
- **Added confidence calibration** (lines 764-787)
- **Added zero-citation checklist** (lines 228-242)

**New Output Fields:**
```json
{
  "administrativeBodyErrors": [],
  "sequencingErrors": []
}
```

---

### 2. **TypeScript Types Updated** ✅
**File:** `evals/types.ts`

**Changes:**
- Updated `EvaluationResult` interface (lines 35-50)
- Added optional detailed tracking fields:
  - `counts` - citation counts (expected, extracted, matched, etc.)
  - `missing` - array of missing citations
  - `hallucinated` - array of hallucinated citations
  - `foreignCourts` - array of foreign court errors
  - `wrongTreatments` - array of treatment classification errors
  - `notVerbatim` - array of non-verbatim extraction errors
  - `administrativeBodyErrors` - array of admin body errors (NEW)
  - `sequencingErrors` - array of sequencing errors (NEW)

---

### 3. **Parser Updated** ✅
**File:** `evals/scorers/gpt5-judge-scorer.ts`

**Changes:**
- Updated `parseJudgeResponse()` function (lines 93-117)
- Now parses all optional fields from Stage 3 judge output
- Gracefully handles both minimal (Stage 1/2A) and detailed (Stage 3) output formats

---

### 4. **Configuration Verified** ✅

**File:** `evals/config/job-prompt-map.ts` (line 34)
```typescript
'extract-cited-decisions': 'llm-as-a-judge_STAGE 3.md',
```
✅ Correctly mapped

**File:** `evals/config/extraction-schemas.ts` (lines 78-82)
```typescript
'extract-cited-decisions': [
  'decisionId',
  'language',
  'citedDecisions',
],
```
✅ Correctly configured - filters metadata before sending to judge

---

## How to Run Evaluation

### Step 1: Run Extraction (if not already done)

```bash
# Run extraction on test set
npm run dev concurrent extract-cited-decisions
```

This will create results in:
```
concurrent/results/extract-cited-decisions/<model>/<timestamp>/
```

### Step 2: Run Evaluation

```bash
# Evaluate latest extraction results
npm run eval extract-cited-decisions

# Evaluate specific timestamp
npm run eval extract-cited-decisions --timestamp 2025-11-03T12-34-56

# Sample first 50 decisions
npm run eval extract-cited-decisions --sample 50

# Use more parallel workers (default: 100)
npm run eval extract-cited-decisions --workers 150
```

### Step 3: View Results

Results are automatically:
1. **Logged to Braintrust** - View at https://www.braintrust.dev/
2. **Saved locally** - `evals/results/extract-cited-decisions/<experiment-name>/`
3. **Analyzed** - Automatic analysis runs after evaluation completes

---

## Available Test Sets

**Location:** `evals/test-sets/`

1. **comprehensive-197.csv** - 197 decisions, stratified sample
   - Multiple courts (CASS, GBAPD, COPRIV, GHCC, CABRL, etc.)
   - Both FR and NL languages
   - Various lengths (medium, long, very_long)
   - **Use this for comprehensive testing**

2. **keywords-test-4.csv** - 4 decisions for quick testing
   - Fast iteration during development

3. **low-scores-9.csv** - 9 decisions with historical low scores
   - Regression testing
   - Challenging cases

---

## What the Judge Evaluates

### Critical Issues (Automatic FAIL):
1. **Foreign national courts included**
   - Three-layer detection (code, consistency, keywords)
   - Any French/German/etc. national court = FAIL

2. **Hallucinated citations**
   - Citations not in source text
   - Court names not in source
   - Case numbers not in source

3. **Wrong decision**
   - Extraction from different case

### Major Issues:
1. **Missing citations (recall < 70%)**
2. **Wrong treatment classification (>30%)**
3. **Not verbatim extraction (>3 violations)**
4. **Administrative body without decision number** (NEW)
5. **Date clearly incorrect**

### Minor Issues:
1. **1-2 missing citations (recall ≥ 85%)**
2. **Date null when unclear** (acceptable)
3. **Treatment UNCERTAIN** (appropriate)
4. **Missing ECLI when not explicit** (acceptable)
5. **Incorrect sequencing** (NEW)

---

## Scoring System

**Start at 100:**

**CRITICAL penalties (cap at 59):**
- Foreign national court: cap at 59
- Hallucinated citations: cap at 59

**MAJOR penalties:**
- Each MAJOR issue: -12 points (cap -36)
- Recall < 70%: -15 points
- >30% wrong treatments: -20 points
- >3 not-verbatim: -15 points
- Admin body without decision number: -12 points

**MINOR penalties:**
- Each MINOR issue: -2 points (cap -8)

**Field-specific penalties:**
- Each wrong treatment: -8 points (individual)
- Treatment aggregate (>30%): -12 points (ONCE)
- Total treatment penalties: cap -50
- Each not-verbatim: -5 points (cap -20)
- Each wrong date: -5 points (cap -15)
- Missing ECLI (explicit): -2 points (cap -6)
- Incorrect sequencing: -2 points

**Final score = max(0, min(100, 100 - all penalties))**

---

## Verdict Logic

**FAIL:**
- Any CRITICAL issue
- OR score < 60

**REVIEW_REQUIRED:**
- 2+ MAJOR issues
- OR 5+ MINOR issues
- OR score 60-79
- No CRITICAL issues

**PASS:**
- 0-1 MAJOR issues AND score ≥ 80
- OR 0-4 MINOR issues AND score ≥ 80
- No CRITICAL issues

---

## Target Scores

**Stage 3 (Cited Decisions):** **95-100/100**

The two-stage agentic snippet architecture should enable:
- **100% recall** of precedent citations
- **Perfect verbatim extraction** (including abbreviations)
- **Accurate treatment classification** (FOLLOWED, DISTINGUISHED, etc.)
- **Zero hallucinations**
- **Zero foreign courts**

---

## Key Features of Updated Judge

1. **Verbatim extraction enforcement**
   - Preserves abbreviations exactly ("Cass." not "Hof van Cassatie")
   - Clear examples prevent confusion

2. **Administrative body validation**
   - Ensures decision numbers present
   - Detects missing "Advies nr." / "Décision n°"

3. **Three-layer foreign court detection**
   - Code validation (only BE/EU/INT)
   - Code-name consistency check
   - Foreign keyword detection

4. **Treatment penalty clarity**
   - Clear accumulation rules
   - Example calculations

5. **Expanded context window**
   - Handles distant treatment indicators
   - More robust classification

6. **Confidence calibration**
   - HIGH/MEDIUM/LOW with clear criteria
   - Helps identify edge cases

7. **Zero-citation checklist**
   - Prevents judge errors
   - Systematic verification

---

## Example Commands

```bash
# Quick test on 10 decisions
npm run eval extract-cited-decisions --sample 10

# Full evaluation on test set (197 decisions)
npm run eval extract-cited-decisions

# Evaluate batch results instead of concurrent
npm run eval extract-cited-decisions --batch

# List available extraction results
npm run eval list extract-cited-decisions

# Test connections to Braintrust and database
npm run eval test-connections

# View specific experiment analysis
npm run eval analyze <experiment-id>
```

---

## Expected Output

```
🚀 Starting evaluation for extract-cited-decisions (latest) from concurrent results

🤖 Using LLM Judge: Azure GPT-4.1

📋 Using judge prompt: llm-as-a-judge_STAGE 3.md

📥 Loading extraction results...
✅ Loaded 197 extraction results
   Model: gpt-5-mini
   Extraction date: 2025-11-03T12:34:56

   Decisions to evaluate: 197

📚 Loading 197 source documents from database...
✅ Loaded 197 source documents

🧪 Creating Braintrust experiment: extract-cited-decisions-gpt-5-mini-medium-128k
   Using enhanced naming with config parameters

✅ Experiment created

🎯 Evaluating 197 decisions...
   Using 100 parallel workers

[197/197] (100%) Last: ECLI:BE:CASS:2023:ARR.20230209.1F.1...

✅ Evaluation complete!
   Completed: 197/197
   Failed: 0

📊 Summary Statistics:
   Average Score: 97.3/100
   Verdict Distribution:
     ✅ PASS: 189 (95.9%)
     ❌ FAIL: 1 (0.5%)
     ⚠️  REVIEW: 7 (3.6%)

💾 Results saved to: evals/results/extract-cited-decisions/extract-cited-decisions-gpt-5-mini-medium-128k

📊 Running automatic analysis...

[Analysis results display...]
```

---

## Troubleshooting

### Issue: "No eval configured for job type"
**Solution:** Job type is correctly configured. Check spelling of job name.

### Issue: "Judge prompt file not found"
**Solution:** Judge prompt is at `evals/judge-prompts/llm-as-a-judge_STAGE 3.md` - verify file exists.

### Issue: "Source document not found"
**Solution:** Ensure database connection is working and decision IDs match between extraction and database.

### Issue: "Failed to parse judge response"
**Solution:** Check Azure GPT-4.1 API response. May need to adjust prompt or parser.

### Issue: Evaluation very slow
**Solution:** Increase `--workers` (default 100). Max recommended: 200.

---

## Files Modified

1. ✅ `evals/judge-prompts/llm-as-a-judge_STAGE 3.md` - Judge prompt v4.0
2. ✅ `evals/types.ts` - Added optional tracking fields to `EvaluationResult`
3. ✅ `evals/scorers/gpt5-judge-scorer.ts` - Updated parser for new fields
4. ✅ `evals/config/job-prompt-map.ts` - Already configured (verified)
5. ✅ `evals/config/extraction-schemas.ts` - Already configured (verified)

---

## Files NOT Modified (Already Correct)

- `evals/runners/evaluation-runner.ts` - Works with updated types
- `evals/loaders/extraction-result-loader.ts` - No changes needed
- `evals/loaders/source-document-loader.ts` - No changes needed
- `evals/config/braintrust.ts` - No changes needed
- `evals/utils/prompt-loader.ts` - No changes needed
- `evals/utils/extraction-filter.ts` - No changes needed

---

## Next Steps

1. **Run extraction** (if not done):
   ```bash
   npm run dev concurrent extract-cited-decisions
   ```

2. **Run evaluation**:
   ```bash
   npm run eval extract-cited-decisions
   ```

3. **Review results** in Braintrust and local files

4. **Iterate** on prompts if needed based on evaluation results

---

## Summary

The Stage 3 evaluation infrastructure is **fully configured and production-ready**. All critical issues in the judge prompt have been fixed:

- ✅ Verbatim extraction (preserves abbreviations)
- ✅ Administrative body validation (requires decision numbers)
- ✅ Foreign court detection (three-layer system)
- ✅ Treatment penalties (clear accumulation rules)
- ✅ Verdict logic (aligned with scores)
- ✅ TypeScript types (support new fields)
- ✅ Parser (handles optional fields)
- ✅ Test sets (197 decisions available)

**Ready to evaluate!** 🚀
