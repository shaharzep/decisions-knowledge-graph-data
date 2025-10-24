# Evaluation Defaults - Concurrent First

## ✅ What Changed

**OLD Behavior:**
- Default: Evaluate batch results from `results/`
- Flag `--concurrent` to evaluate concurrent results

**NEW Behavior:**
- **Default: Evaluate concurrent results from `concurrent/results/`** ✅
- Flag `--batch` to evaluate batch results (if needed)

---

## Why This Change?

**Your workflow:**
1. **Concurrent processing** → Fast iteration, test prompts (10-20 min for 197 decisions)
2. **Evaluate concurrent results** → Verify quality before scaling
3. **Batch processing** → Run on all data only when confident (24 hours, thousands of decisions)

**Default should match your primary workflow** = concurrent results evaluation

---

## New Commands

### Default: Evaluate Concurrent Results

```bash
# Evaluate latest concurrent results (DEFAULT)
npm run eval -- run extract-comprehensive

# With sample
npm run eval -- run extract-comprehensive --sample 50

# With workers
npm run eval -- run extract-comprehensive --workers 10

# Combined
npm run eval -- run extract-comprehensive --sample 100 --workers 10
```

### Explicit: Evaluate Batch Results

```bash
# Evaluate batch results (when you need to)
npm run eval -- run extract-comprehensive --batch

# Batch with sample
npm run eval -- run extract-comprehensive --batch --sample 50
```

---

## What Gets Evaluated

### Without `--batch` flag (DEFAULT):
```
Loads from: concurrent/results/extract-comprehensive/
Console shows: "Starting evaluation from concurrent results"
```

### With `--batch` flag:
```
Loads from: results/extract-comprehensive/
Console shows: "Starting evaluation from batch results"
```

---

## Directory Structure

```
# Concurrent results (DEFAULT evaluated)
concurrent/results/
└── extract-comprehensive/
    └── 2025-10-23T14-30-00/
        ├── extracted-data.json
        └── summary.json

# Batch results (use --batch to evaluate)
results/
└── extract-comprehensive/
    └── 2025-10-23T16-45-00/
        ├── extracted-data.json
        └── summary.json

# Evaluation results (job-first, always in evals/)
evals/results/
└── extract-comprehensive/
    └── gpt-5-mini-2025-10-23.../
        ├── evaluations.json
        └── summary.json
```

---

## Complete Workflow Example

### 1. Run Concurrent Processing (Fast)
```bash
npm run dev concurrent extract-comprehensive
# → Results in: concurrent/results/extract-comprehensive/{timestamp}/
```

### 2. Evaluate Concurrent Results (DEFAULT)
```bash
npm run eval -- run extract-comprehensive --sample 50
# → Automatically loads from concurrent/results/
# → Saves eval to: evals/results/extract-comprehensive/{timestamp}/
```

### 3. Review in Braintrust
- Check scores, verdicts, issues
- Iterate on prompt if needed

### 4. When Confident: Run Batch (Scale)
```bash
npm run dev submit extract-comprehensive
# → Results in: results/extract-comprehensive/{timestamp}/
```

### 5. (Optional) Evaluate Batch Results
```bash
npm run eval -- run extract-comprehensive --batch
# → Explicitly loads from results/
```

---

## Benefits

✅ **Less typing** - No need for `--concurrent` flag anymore (it's the default)
✅ **Matches workflow** - Default behavior matches your iteration process
✅ **Explicit batch** - `--batch` flag makes it clear when evaluating production batch
✅ **Fast iteration** - Default path optimized for speed

---

## Migration from Old Commands

**Old command:**
```bash
npm run eval -- run extract-comprehensive --concurrent
```

**New command:**
```bash
npm run eval -- run extract-comprehensive
# Same result, --concurrent is now the default
```

**Old command:**
```bash
npm run eval -- run extract-comprehensive
# This used to load batch results
```

**New command:**
```bash
npm run eval -- run extract-comprehensive --batch
# Now explicit with --batch flag
```

---

## Summary

- ✅ Default: Concurrent results (your primary workflow)
- ✅ Explicit `--batch` when needed
- ✅ Cleaner commands (no unnecessary flags)
- ✅ Same Braintrust logging
- ✅ Same result structure
