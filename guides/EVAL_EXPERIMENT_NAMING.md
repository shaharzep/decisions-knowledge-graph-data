# Evaluation Experiment Naming - Implementation Complete

## Overview

Updated the evaluation system to use a **clean, consistent naming convention** for Braintrust experiments:

**New Format:** `{jobType}-{YYYY-MM-DD}`

**Examples:**
- `extract-comprehensive-2025-10-24`
- `enrich-provisions-2025-10-24`
- `extract-cited-decisions-2025-10-24`

This makes it easy to track experiments by job type and date.

---

## What Changed

### Files Modified (1)
- `evals/runners/evaluation-runner.ts`

### Files Created (1)
- `evals/utils/experiment-naming.ts`

---

## Implementation Details

### 1. Created Experiment Naming Utility

**File:** `evals/utils/experiment-naming.ts`

**Purpose:** Centralized, reusable experiment naming logic

**Functions:**

#### `generateExperimentName(jobType: string): string`
Generates standard experiment name using job type and today's date.

```typescript
// Example usage
const name = generateExperimentName('extract-comprehensive');
// Returns: "extract-comprehensive-2025-10-24"
```

**Implementation:**
```typescript
function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function generateExperimentName(jobType: string): string {
  const dateString = getTodayDateString();
  return `${jobType}-${dateString}`;
}
```

**Benefits:**
- ✅ Clean, testable code
- ✅ Single responsibility (date formatting)
- ✅ Consistent date format (YYYY-MM-DD)
- ✅ Zero-padded months/days (10 not 010)

#### `generateExperimentNameWithSuffix(jobType: string, suffix: string): string`
Optional utility for multiple experiments on same day.

```typescript
// Example usage
const name = generateExperimentNameWithSuffix('extract-comprehensive', 'baseline');
// Returns: "extract-comprehensive-2025-10-24-baseline"
```

**Use cases:**
- Running multiple variations on same day
- A/B testing different prompts
- Baseline vs improved model comparisons

---

### 2. Updated Evaluation Runner

**File:** `evals/runners/evaluation-runner.ts`

**Changes:**

#### Import Statement
```typescript
import { generateExperimentName } from '../utils/experiment-naming.js';
```

#### Experiment Name Generation
**Before:**
```typescript
const experimentName = `${metadata.model}-${timestamp || 'latest'}`;
console.log(`\n🧪 Creating Braintrust experiment: ${jobType}/${experimentName}`);
```

**After:**
```typescript
const experimentName = generateExperimentName(jobType);
console.log(`\n🧪 Creating Braintrust experiment: ${experimentName}`);
```

**Benefits:**
- ✅ Job-centric naming (not model-centric)
- ✅ Always uses today's date (not timestamp parameter)
- ✅ Cleaner console output (no redundant jobType prefix)
- ✅ Easier to find experiments in Braintrust UI

---

## Before vs After Comparison

### Old Naming Convention
```
Format: {model}-{timestamp}
Examples:
  - gpt-5-mini-2025-10-18T22-19-38-155Z
  - gpt-4o-mini-latest
  - o4-mini-2025-10-19T13-03-04-570Z
```

**Issues:**
- ❌ Model-centric (hard to find by job type)
- ❌ Includes full timestamp (too verbose)
- ❌ "latest" is ambiguous
- ❌ No standard format

### New Naming Convention
```
Format: {jobType}-{YYYY-MM-DD}
Examples:
  - extract-comprehensive-2025-10-24
  - enrich-provisions-2025-10-24
  - extract-cited-decisions-2025-10-24
```

**Benefits:**
- ✅ Job-centric (easy to group by job)
- ✅ Clean, readable date format
- ✅ No ambiguity
- ✅ Consistent format

---

## Usage

### Running Evaluations

```bash
# Run evaluation for extract-comprehensive
npm run eval extract-comprehensive

# Creates experiment: extract-comprehensive-2025-10-24
```

**Console Output:**
```
🚀 Starting evaluation for extract-comprehensive (latest) from concurrent results

📋 Using judge prompt: llm-as-a-judge_STAGE 1.md

📥 Loading extraction results...
✅ Loaded 197 extraction results
   Model: gpt-5-mini
   Extraction date: 2025-10-24T15:30:00.000Z

📚 Loading 197 source documents from database...
✅ Loaded 197 source documents

🧪 Creating Braintrust experiment: extract-comprehensive-2025-10-24
✅ Experiment created
```

### Multiple Experiments Same Day

If you need to run multiple experiments on the same day:

```typescript
// In code, use the suffix variant
const experimentName = generateExperimentNameWithSuffix(
  'extract-comprehensive',
  'prompt-v2'
);
// Returns: "extract-comprehensive-2025-10-24-prompt-v2"
```

---

## How It Works

### Experiment Creation Flow

```
1. User runs: npm run eval extract-comprehensive

2. EvaluationRunner.runEvaluation():
   a. Load extraction results
   b. Load source documents
   c. Generate experiment name:
      - Call generateExperimentName('extract-comprehensive')
      - Get today's date: 2025-10-24
      - Return: 'extract-comprehensive-2025-10-24'

3. Create Braintrust experiment:
   - Project: 'belgian-legal-extraction'
   - Experiment: 'extract-comprehensive-2025-10-24'
   - Metadata: { jobType, model, extractionDate, ... }

4. Run evaluations and log to Braintrust

5. Results saved to:
   - Braintrust cloud dashboard
   - Local: evals/results/extract-comprehensive/extract-comprehensive-2025-10-24/
```

---

## Braintrust UI Benefits

### Experiment Organization

**Before:**
```
belgian-legal-extraction/
├── gpt-5-mini-2025-10-18T22-19-38-155Z
├── gpt-5-mini-2025-10-19T13-03-04-570Z
├── o4-mini-latest
└── gpt-4o-mini-2025-10-20T08-15-22-444Z
```
❌ Hard to see which job type
❌ Models mixed together
❌ Timestamps hard to read

**After:**
```
belgian-legal-extraction/
├── extract-comprehensive-2025-10-24
├── extract-comprehensive-2025-10-23
├── enrich-provisions-2025-10-24
├── extract-cited-decisions-2025-10-24
└── extract-comprehensive-2025-10-22
```
✅ Clear job grouping
✅ Chronological ordering
✅ Easy to compare dates

### Filtering & Searching

**Search by job type:**
```
Search: "extract-comprehensive"
Results: All comprehensive extraction experiments
```

**Search by date:**
```
Search: "2025-10-24"
Results: All experiments run today
```

**Search specific experiment:**
```
Search: "enrich-provisions-2025-10-24"
Results: Exact match
```

---

## Code Quality

### Clean Code Principles

✅ **Single Responsibility**
- `getTodayDateString()`: Only formats dates
- `generateExperimentName()`: Only creates experiment names
- Each function has one job

✅ **DRY (Don't Repeat Yourself)**
- Date formatting centralized
- Experiment naming centralized
- Easy to change format globally

✅ **Testability**
```typescript
// Easy to test in isolation
describe('generateExperimentName', () => {
  it('should generate name with today date', () => {
    const name = generateExperimentName('extract-comprehensive');
    expect(name).toMatch(/^extract-comprehensive-\d{4}-\d{2}-\d{2}$/);
  });
});
```

✅ **Extensibility**
```typescript
// Easy to add new variations
export function generateExperimentNameWithModel(
  jobType: string,
  model: string
): string {
  return `${jobType}-${model}-${getTodayDateString()}`;
}
```

---

## Migration Notes

### Backward Compatibility

**Old experiments are not affected:**
- Existing experiments in Braintrust keep their names
- No data migration needed
- Old naming convention results still accessible

**New experiments use new naming:**
- All future experiments use `{jobType}-{date}` format
- Applies to all job types automatically
- No configuration needed

### Local Results Directory

**Directory structure unchanged:**
```
evals/results/
├── extract-comprehensive/
│   ├── extract-comprehensive-2025-10-24/  ← New format
│   ├── gpt-5-mini-2025-10-18/             ← Old format (still works)
│   └── summary.json
└── enrich-provisions/
    └── enrich-provisions-2025-10-24/      ← New format
```

---

## Testing

### Type Checking
```bash
npm run type-check
# ✓ No errors
```

### Manual Testing
```bash
# Run evaluation
npm run eval extract-comprehensive

# Check experiment name in output
# Should see: "Creating Braintrust experiment: extract-comprehensive-2025-10-24"

# Verify in Braintrust UI
# Navigate to: belgian-legal-extraction project
# Should see: extract-comprehensive-2025-10-24
```

---

## Future Enhancements

### Option 1: Include Model Name (Optional)
```typescript
export function generateExperimentNameWithModel(
  jobType: string,
  model: string
): string {
  const dateString = getTodayDateString();
  return `${jobType}-${model}-${dateString}`;
}

// Usage
const name = generateExperimentNameWithModel('extract-comprehensive', 'gpt-5-mini');
// Returns: "extract-comprehensive-gpt-5-mini-2025-10-24"
```

### Option 2: Include Run Number (Optional)
```typescript
export function generateExperimentNameWithRun(
  jobType: string,
  runNumber: number
): string {
  const dateString = getTodayDateString();
  return `${jobType}-${dateString}-run${runNumber}`;
}

// Usage
const name = generateExperimentNameWithRun('extract-comprehensive', 2);
// Returns: "extract-comprehensive-2025-10-24-run2"
```

### Option 3: Custom Suffix (Already Implemented)
```typescript
const name = generateExperimentNameWithSuffix('extract-comprehensive', 'baseline');
// Returns: "extract-comprehensive-2025-10-24-baseline"
```

---

## Summary

### Changes Made
- ✅ Created `evals/utils/experiment-naming.ts` with clean utility functions
- ✅ Updated `evals/runners/evaluation-runner.ts` to use new naming
- ✅ TypeScript compilation passes
- ✅ No breaking changes

### Benefits Achieved
- ✅ **Consistent naming:** All experiments use `{jobType}-{date}` format
- ✅ **Job-centric:** Easy to find experiments by job type
- ✅ **Readable dates:** YYYY-MM-DD format is clear and sortable
- ✅ **Clean code:** Centralized, testable, extensible
- ✅ **Better UX:** Easier to navigate Braintrust UI

### Files Changed
- **Created:** `evals/utils/experiment-naming.ts` (62 lines)
- **Modified:** `evals/runners/evaluation-runner.ts` (3 line changes)

---

**Status:** ✅ **COMPLETE**

**Date:** 2025-10-24
**Impact:** All future evaluations
**Breaking Changes:** None
