# Concurrent Processing & Braintrust Evaluation Guide

## 🎚️ Changing Reasoning Effort

**File**: `src/jobs/extract-comprehensive/config.ts`

**Line 455** (approximately):
```typescript
reasoningEffort: "low",  // ← Change this value
```

### Valid Values:
- `"low"` - Faster, less reasoning (current default)
- `"medium"` - Balanced reasoning and speed
- `"high"` - Most thorough, recommended for complex legal analysis

### After Changing:
```bash
npm run build
npm run dev concurrent extract-comprehensive
```

---

## 📊 Submitting Concurrent Results to Braintrust

The evaluation system now fully supports concurrent processing results!

### Quick Start

```bash
# 1. Run concurrent processing
npm run dev concurrent extract-comprehensive

# 2. Evaluate and submit to Braintrust
npm run eval run extract-comprehensive --concurrent

# 3. Optional: Sample size for testing
npm run eval run extract-comprehensive --concurrent --sample 50
```

### What `--concurrent` Does

The `--concurrent` flag tells the evaluation system to:
- Load results from `concurrent/results/` instead of `results/`
- Label experiments appropriately in Braintrust
- Use the same evaluation logic (GPT-5 judge, 8 dimensions, etc.)

### Full Command Options

```bash
# Evaluate all concurrent results
npm run eval run extract-comprehensive --concurrent

# Evaluate sample of 50 concurrent results
npm run eval run extract-comprehensive --concurrent --sample 50

# Use more parallel workers for faster evaluation
npm run eval run extract-comprehensive --concurrent --workers 10

# Combine options
npm run eval run extract-comprehensive --concurrent --sample 100 --workers 10
```

---

## 📁 Results Organization

### Batch Processing
```
results/
└── extract-comprehensive/
    └── 2025-10-23T...
        ├── extracted-data.json
        ├── successful-results.json
        ├── failures.json
        └── summary.json
```

### Concurrent Processing (NEW: Includes Model Name!)
```
concurrent/results/
└── extract-comprehensive/
    └── gpt-5-mini/                  ← Model name in path
        └── 2025-10-23T...
            ├── extracted-data.json
            ├── successful-results.json
            ├── failures.json
            └── summary.json
```

**Benefits**:
- 🏷️ Model name visible in filesystem
- 📊 Model name automatically included in Braintrust experiment name
- 🔍 Easy to compare different models side-by-side
- 📁 Organized by model for easy navigation

---

## 🔄 Complete Workflow Example

### 1. Process Decisions Concurrently
```bash
# Edit config if needed (reasoning effort, verbosity, etc.)
nano src/jobs/extract-comprehensive/config.ts

# Rebuild
npm run build

# Process all 197 decisions (10-20 minutes)
npm run dev concurrent extract-comprehensive
```

**Output**:
```
✅ Concurrent processing completed!

Output directory: concurrent/results/extract-comprehensive/gpt-5-mini/2025-10-23T...
Total records: 197
Successful: 195 (99.0%)
Failed: 2
Total tokens: 2,456,789
```

**Note**: Results are now saved with the model name in the path!

### 2. Evaluate Quality with GPT-5 Judge
```bash
# Evaluate all results and submit to Braintrust
npm run eval run extract-comprehensive --concurrent

# Or test with sample first
npm run eval run extract-comprehensive --concurrent --sample 50
```

**Output**:
```
🚀 Starting evaluation for extract-comprehensive (latest) from concurrent results

📥 Loading extraction results...
✅ Loaded 197 extraction results
   Model: gpt-5-mini
   Extraction date: 2025-10-23T20:00:00.000Z

📚 Loading 197 source documents from database...
✅ Loaded 197 source documents

🧪 Creating Braintrust experiment: extract-comprehensive-gpt-5-mini-latest
✅ Experiment created: [experiment-id]

📊 Evaluating 197 decisions...
Progress: 50/197 (25.4%)
Progress: 100/197 (50.8%)
Progress: 150/197 (76.1%)
Progress: 197/197 (100.0%)

✨ Evaluation complete!
   Experiment ID: [experiment-id]
   View results in Braintrust: https://www.braintrustdata.com
```

### 3. View Results in Braintrust

1. Go to https://www.braintrustdata.com
2. Navigate to project: "belgian-legal-extraction"
3. Find your experiment with **model name included**:
   - Example: `extract-comprehensive-gpt-5-mini-latest`
   - The model name comes from `summary.json` automatically
4. View:
   - Overall score distribution
   - Individual dimension scores (Verbatim Quality, Completeness, etc.)
   - Decision-by-decision breakdown
   - Failing cases and issues

**Why This Matters**:
- 🏷️ Clear identification of which model was used
- 📊 Easy comparison: "gpt-5-mini" vs "gpt-4o" vs "o4-mini"
- 🔍 Filter experiments by model name
- 📈 Track model performance over time

---

## 🆚 Comparing Different Models

### Test Different Models Side-by-Side

```bash
# 1. Test with gpt-5-mini (current default)
npm run dev concurrent extract-comprehensive
npm run eval run extract-comprehensive --concurrent
# → Creates: extract-comprehensive-gpt-5-mini-latest

# 2. Change model to gpt-4o in config
# Edit config.ts: model: "gpt-4o"
npm run build
npm run dev concurrent extract-comprehensive
npm run eval run extract-comprehensive --concurrent
# → Creates: extract-comprehensive-gpt-4o-latest

# 3. Compare in Braintrust dashboard
# Both experiments clearly labeled with model names!
```

### Comparing Batch vs Concurrent

```bash
# Evaluate batch results
npm run eval run extract-comprehensive

# Evaluate concurrent results
npm run eval run extract-comprehensive --concurrent

# Compare in Braintrust dashboard
# Both experiments will show up in the project
```

---

## 🎯 Typical Use Cases

### Test New Reasoning Effort
```bash
# 1. Change reasoning effort to "high" in config
# 2. Rebuild and run concurrent
npm run build
npm run dev concurrent extract-comprehensive

# 3. Evaluate
npm run eval run extract-comprehensive --concurrent --sample 50

# 4. Check Braintrust to see if quality improved
```

### Quick Quality Check
```bash
# Process and evaluate sample
npm run dev concurrent extract-comprehensive  # (config has LIMIT 10)
npm run eval run extract-comprehensive --concurrent
```

### Full Production Evaluation
```bash
# Remove LIMIT from config, process all 197 decisions
npm run build
npm run dev concurrent extract-comprehensive

# Evaluate all
npm run eval run extract-comprehensive --concurrent

# Results viewable in Braintrust immediately
```

---

## 📈 Braintrust Dashboard

### Metrics You'll See:
- **Overall Score**: Average across all 8 dimensions (0-100)
- **Usability Rate**: % of extractions scoring ≥70 points
- **Dimension Breakdown**:
  - Verbatim Quality (25 pts) - Most critical
  - Completeness (15 pts)
  - Language Consistency (10 pts)
  - Enum Correctness (10 pts)
  - Party References (10 pts)
  - Court Information (10 pts)
  - Structural Correctness (10 pts)
  - Critical Errors (10 pts)

### Filtering Options:
- By language (FR/NL)
- By court type (CASS, GBAPD, etc.)
- By decision length (short, medium, long)
- By score threshold
- By specific dimensions

---

## 🔧 Technical Details

### What Changed (Model Name Integration):
1. ✅ **ConcurrentProcessor.ts**:
   - Directory structure: `concurrent/results/{jobType}/{model}/{timestamp}/`
   - Added `model` field to `ConcurrentSummary` interface
   - Model name extracted from config automatically

2. ✅ **jobResultLoader.ts**:
   - Smart detection of concurrent vs batch results
   - For concurrent: searches within model subdirectories
   - For batch: direct timestamp search (unchanged)

3. ✅ **evaluation-runner.ts**:
   - Loads model name from `summary.json`
   - Experiment name: `{jobType}-{model}-{timestamp}`
   - Example: `extract-comprehensive-gpt-5-mini-latest`

### Backward Compatible:
- ✅ Batch results unchanged: `results/{jobType}/{timestamp}/`
- ✅ Concurrent results enhanced: `concurrent/results/{jobType}/{model}/{timestamp}/`
- ✅ Evaluation system auto-detects structure
- ✅ All existing code works identically

---

## ✅ Ready to Use!

Both systems are fully integrated:

```bash
# Run concurrent processing
npm run dev concurrent extract-comprehensive

# Submit to Braintrust
npm run eval run extract-comprehensive --concurrent
```

Your concurrent results will appear in Braintrust alongside batch results, allowing you to:
- Compare quality across different models
- Track improvements over time
- Identify systematic issues
- Make data-driven decisions about prompts and settings

🎉 **Everything is working and ready to go!**
