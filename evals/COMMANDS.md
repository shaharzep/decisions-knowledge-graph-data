# Evaluation Commands - Simple Reference

## ✅ Simplified Syntax (No More `--` or `run`)

### Basic Evaluation

```bash
# Evaluate latest concurrent results
npm run eval extract-comprehensive

# With sample
npm run eval extract-comprehensive --sample 50

# With workers
npm run eval extract-comprehensive --workers 10

# Combined
npm run eval extract-comprehensive --sample 100 --workers 10
```

---

## Evaluating Batch Results

### Latest Batch Results

```bash
npm run eval extract-comprehensive --batch
```

### Specific Batch Timestamp

**Step 1: List available batch timestamps**
```bash
npm run eval list extract-comprehensive
```

**Output:**
```
📋 Available results for extract-comprehensive:

  ✅ 2025-10-23T14-30-00-000Z
  ✅ 2025-10-23T16-45-00-000Z
  ✅ 2025-10-24T10-15-00-000Z

Total: 3 result sets
```

**Step 2: Evaluate specific timestamp**
```bash
npm run eval extract-comprehensive --batch --timestamp 2025-10-23T16-45-00-000Z
```

---

## Evaluating Concurrent Results (Default)

### Latest Concurrent Results

```bash
# Default - no flag needed
npm run eval extract-comprehensive
```

### Specific Concurrent Timestamp

```bash
npm run eval extract-comprehensive --timestamp 2025-10-23T14-30-00-000Z
```

---

## All Options

```bash
npm run eval <job-type> [options]

Options:
  --sample <n>        Evaluate only first N decisions
  --workers <n>       Number of parallel workers (default: 5)
  --batch             Evaluate batch results instead of concurrent (default: concurrent)
  --timestamp <ts>    Evaluate specific timestamp instead of latest
  --no-save           Don't save results locally (only Braintrust)
```

---

## Common Use Cases

### Quick test (10 decisions, concurrent)
```bash
npm run eval extract-comprehensive --sample 10
```

### Full evaluation (all concurrent results)
```bash
npm run eval extract-comprehensive
```

### Fast parallel evaluation
```bash
npm run eval extract-comprehensive --workers 15 --sample 50
```

### Evaluate batch production run
```bash
npm run eval extract-comprehensive --batch
```

### Compare specific batch timestamp
```bash
# First list available
npm run eval list extract-comprehensive

# Then evaluate specific one
npm run eval extract-comprehensive --batch --timestamp 2025-10-23T16-45-00-000Z
```

---

## Other Commands

### List available results
```bash
npm run eval list extract-comprehensive
```

### Test connections
```bash
npm run eval test-connections
```

### Compare experiments (future)
```bash
npm run eval compare evals/results/exp1 evals/results/exp2
```

---

## Example Full Workflow

**1. Run concurrent processing**
```bash
npm run dev concurrent extract-comprehensive
```

**2. Quick eval on sample**
```bash
npm run eval extract-comprehensive --sample 20 --workers 10
```

**3. Review results, iterate on prompt**

**4. Full concurrent eval**
```bash
npm run eval extract-comprehensive
```

**5. When confident, run batch on all data**
```bash
npm run dev submit extract-comprehensive
```

**6. Evaluate batch results**
```bash
# List available batch timestamps
npm run eval list extract-comprehensive

# Evaluate specific batch run
npm run eval extract-comprehensive --batch --timestamp 2025-10-24T10-15-00-000Z
```

---

## Summary

✅ **Simple**: Just `npm run eval <job-type>`
✅ **No `--`**: Not needed anymore
✅ **No `run`**: Job type is the command
✅ **Clear flags**: `--batch`, `--timestamp`, `--workers`, etc.
✅ **Concurrent by default**: Matches your workflow
