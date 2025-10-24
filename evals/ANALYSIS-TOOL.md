# Braintrust Experiment Analysis Tool

## Overview

This tool fetches experiment results from Braintrust via API and analyzes them by decision metadata dimensions (court, language, decision type, length). It reveals performance patterns across different case characteristics.

**Automatic Analysis:** When you run evaluations with `npm run eval`, the analysis runs automatically at the end and displays results in the console. You can also run it manually anytime with the commands below.

## Usage

### Automatic Analysis (After Evaluation)

When you run an evaluation, the analyzer automatically runs at the end:

```bash
npm run eval extract-comprehensive

# After evaluation completes, you'll see:
# ✨ Evaluation complete!
#    Experiment ID: gpt-5-mini-2025-10-24T16-20-28-781Z
#
# 📊 Running automatic analysis...
#
# [Analysis tables displayed here]
```

The analysis is displayed in console format. To save a markdown report, run manually (see below).

### Manual Analysis

You can run the analyzer manually anytime using either the experiment **name** or **ID**:

```bash
npm run analyze-results -- <experimentNameOrId>
```

**Examples:**
```bash
# Using experiment name (automatically looks up ID)
npm run analyze-results -- gpt-5-mini-latest

# Using experiment ID directly
npm run analyze-results -- c2193b43-8eb3-4354-802f-adc51883fa72
```

**Why run manually?**
- Save analysis as markdown for documentation
- Re-analyze past experiments
- Export as JSON for further processing
- Compare multiple experiment reports side-by-side

### Options

```bash
# Display in console (default)
npm run analyze-results -- <experimentId>

# Output as JSON
npm run analyze-results -- <experimentId> --format json

# Output as Markdown (clean, presentable)
npm run analyze-results -- <experimentId> --format markdown

# Save report to file (auto-detects extension)
npm run analyze-results -- <experimentId> --format markdown --save

# Custom output path
npm run analyze-results -- <experimentId> --format markdown --save --output report.md

# Help
npm run analyze-results -- help
```

**Note:** The `--` is required to separate npm options from script arguments.

**Format Options:**
- `console` (default) - ASCII tables for terminal viewing
- `markdown` - Clean markdown with tables (best for documentation)
- `json` - Structured JSON data (for programmatic access)

## Output Example

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Experiment Analysis: gpt-5-mini-2025-10-24T16-20-28-781Z
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Overall Statistics:
  Total Evaluations: 197
  Average Score: 87.3/100

  Verdict Distribution:
    ✅ PASS: 163 (82.7%)
    ❌ FAIL: 16 (8.1%)
    ⚠️  REVIEW REQUIRED: 18 (9.1%)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Breakdown by Language:

  ┌──────────────────────────────────────────────────────────────────────────┐
  │Language        │ Count  │ Avg Score   │ Pass Rate   │ Avg Issues (C/M/m)│
  ├──────────────────────────────────────────────────────────────────────────┤
  │FR              │ 134    │ 88.2/100    │ 84.3%       │ 0.2/0.8/1.2       │
  │NL              │ 63     │ 85.1/100    │ 79.4%       │ 0.3/1.1/1.5       │
  └──────────────────────────────────────────────────────────────────────────┘

Breakdown by Court (ECLI Code):

  ┌──────────────────────────────────────────────────────────────────────────┐
  │Court (ECLI Code)│ Count │ Avg Score   │ Pass Rate   │ Avg Issues (C/M/m)│
  ├──────────────────────────────────────────────────────────────────────────┤
  │CASS            │ 45     │ 91.2/100    │ 91.1%       │ 0.1/0.5/0.9       │
  │GBAPD           │ 32     │ 86.5/100    │ 81.3%       │ 0.2/0.9/1.3       │
  │CABRL           │ 28     │ 84.3/100    │ 78.6%       │ 0.3/1.2/1.4       │
  └──────────────────────────────────────────────────────────────────────────┘

Breakdown by Length Category:

  ┌──────────────────────────────────────────────────────────────────────────┐
  │Length Category │ Count  │ Avg Score   │ Pass Rate   │ Avg Issues (C/M/m)│
  ├──────────────────────────────────────────────────────────────────────────┤
  │long            │ 89     │ 89.7/100    │ 86.5%       │ 0.1/0.7/1.1       │
  │medium          │ 78     │ 86.4/100    │ 82.1%       │ 0.2/0.9/1.3       │
  │very_long       │ 18     │ 88.2/100    │ 83.3%       │ 0.2/0.8/1.2       │
  │short           │ 12     │ 79.1/100    │ 66.7%       │ 0.5/1.5/1.8       │
  └──────────────────────────────────────────────────────────────────────────┘
```

## How It Works

### 1. Metadata Sources (Dual-Source Support)

The analyzer retrieves metadata from **two possible locations** in Braintrust:

**Source 1: Direct Metadata (New Evaluations)**
When you run evaluations with the updated code, metadata is logged directly to `event.metadata`:
- `language`, `court_ecli_code`, `court_name`, etc.
- Fastest access, cleanest structure

**Source 2: Extracted Data (Existing + New Evaluations)**
All evaluations have metadata merged into `event.input.extracted_data` from the CSV test set:
- Same fields: `language`, `court_ecli_code`, `decision_type_ecli_code`, `length_category`, etc.
- Works with existing experiments without re-running
- The analyzer checks both locations automatically

**Priority**: The analyzer prefers direct metadata but falls back to extracted_data, so it works with both old and new experiments.

### 2. API Fetching

The tool fetches all evaluation events from Braintrust using the REST API with automatic pagination and deduplication.

### 3. Aggregation

Results are grouped by each metadata dimension and statistics are calculated:
- Average score per group
- Pass/fail/review rates
- Average issue counts (critical/major/minor)

### 4. Reporting

Results are formatted as ASCII tables for easy console viewing, or as JSON for programmatic access.

## Finding Experiments

You can reference experiments by **name** or **ID**:

### By Name (Easier)

When you run an evaluation, it creates an experiment with a name like:
- `gpt-5-mini-latest` (most common)
- `gpt-5-mini-2025-10-24T16-20-28-781Z` (timestamped)

```bash
npm run eval extract-comprehensive

# Output:
🧪 Creating Braintrust experiment: extract-comprehensive/gpt-5-mini-latest
✅ Experiment created

✨ Evaluation complete!
   Experiment ID: gpt-5-mini-latest  # <-- Use this name
```

The analyzer automatically looks up the ID from the name.

### By ID (Direct)

You can also use the UUID directly:

1. Go to https://www.braintrustdata.com
2. Open your project: `belgian-legal-extraction`
3. Click on an experiment
4. Copy the ID from the URL or experiment details (e.g., `c2193b43-8eb3-4354-802f-adc51883fa72`)

**Tip:** Using names is easier! The analyzer handles the ID lookup automatically.

## Requirements

- `BRAINTRUST_API_KEY` must be set in `.env`
- Experiment must exist in Braintrust
- For dimension breakdowns, evaluations must include metadata (all new evaluations will have this)

## Metadata Availability

The analyzer works with **both existing and new experiments** because:

1. **New evaluations** (after this update): Metadata logged directly to `event.metadata`
2. **Existing evaluations**: Metadata already present in `event.input.extracted_data` from CSV test set
3. **Fallback logic**: Analyzer checks both locations automatically

**Most experiments will "just work"** because metadata was merged into extracted_data during the extraction process.

**If you see "Unknown" values:**
- This means metadata is missing from both locations
- Rare case: Evaluation was run on decisions not in the CSV test set
- Solution: Re-run evaluation with test set decisions

## Use Cases

### Compare Performance Across Languages

```bash
npm run analyze-results -- <exp-id> --format markdown --save --output fr-vs-nl-analysis.md
```

Check if French decisions score differently than Dutch decisions.

### Identify Problematic Courts

Look for courts with low pass rates or high issue counts. These may need prompt adjustments.

### Optimize for Length Categories

See if short decisions perform poorly. If so, consider adding more examples or guidance for short decisions in the prompt.

### Track Improvements

```bash
npm run analyze-results -- exp-v1 --format markdown --save --output v1-analysis.md
npm run analyze-results -- exp-v2 --format markdown --save --output v2-analysis.md
diff v1-analysis.md v2-analysis.md
```

Compare before/after prompt changes to see which dimensions improved.

## Files Created

- `evals/analyzers/braintrust-fetcher.ts` - API client for Braintrust
- `evals/analyzers/results-analyzer.ts` - Aggregation logic
- `evals/analyzers/report-formatter.ts` - Console/JSON formatting
- `evals/analyze-cli.ts` - CLI entry point
- `evals/types.ts` - Updated with new interfaces

## Files Modified

- `evals/config/braintrust.ts` - Updated `logEvaluation()` to accept metadata
- `evals/runners/evaluation-runner.ts` - Pass metadata to `logEvaluation()`
- `package.json` - Added `analyze-results` script

## Next Steps

1. Run a fresh evaluation to populate metadata:
   ```bash
   npm run eval extract-comprehensive
   ```

2. Analyze the results:
   ```bash
   npm run analyze-results -- <experiment-id>
   ```

3. Save a clean markdown report:
   ```bash
   npm run analyze-results -- <experiment-id> --format markdown --save
   ```

4. Iterate on prompts based on dimension-specific insights!
