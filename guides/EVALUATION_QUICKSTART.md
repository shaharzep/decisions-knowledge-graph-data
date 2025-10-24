# Evaluation System Quick Start Guide

## What Was Built

A complete evaluation system for assessing the quality of Belgian legal document extractions using **GPT-5 as an LLM judge** with **Braintrust tracking**.

### Key Features

✅ **8-Dimension Scoring** - Comprehensive quality assessment
✅ **GPT-5 Judge** - High reasoning for thorough evaluation
✅ **Braintrust Integration** - Track and analyze results
✅ **Model Comparison** - Compare o4-mini vs gpt-5-mini
✅ **Automated Reports** - Generate comparison reports
✅ **Local + Cloud** - Save results locally and to Braintrust

---

## Quick Start (3 Steps)

### 1. Test Your Setup

```bash
npm run eval test-connections
```

Should show:
```
✅ Database connection successful
✅ OpenAI GPT-5 configuration valid
✅ Braintrust configuration valid
✅ All connections successful!
```

### 2. Run Your First Evaluation

```bash
# Start with a small sample (50 decisions)
npm run eval run extract-comprehensive --sample 50
```

**What happens:**
1. Loads latest `extract-comprehensive` results
2. Loads original source documents from database
3. Creates Braintrust experiment
4. Evaluates each decision with GPT-5 judge
5. Saves results locally + to Braintrust

**Expected output:**
```
🚀 Starting evaluation for extract-comprehensive (latest)

📥 Loading extraction results...
✅ Loaded 1000 extraction results
   Model: o4-mini
   Extraction date: 2025-10-18T22:45:00.000Z

📊 Sampling 50 decisions for evaluation

📚 Loading 50 source documents from database...
✅ Loaded 50 source documents

🧪 Creating Braintrust experiment: extract-comprehensive-o4-mini-latest
✅ Experiment created

🎯 Evaluating 50 decisions...

[50/50] (100%) Evaluating ECLI:BE:CASS:2023:ARR.20230315...

✅ Evaluation complete!
   Completed: 50/50
   Failed: 0

📊 Summary Statistics:
   Average Overall Score: 85.3/100
   Average Verbatim Score: 21.2/25
   Usable Rate: 48/50 (96.0%)

💾 Results saved to: evals/results/extract-comprehensive-o4-mini-latest

✨ Evaluation complete!
   Experiment ID: extract-comprehensive-o4-mini-latest
   View results in Braintrust: https://www.braintrustdata.com
```

### 3. View Results

**Local Results:**
```bash
cat evals/results/extract-comprehensive-o4-mini-latest/summary.json
```

**Braintrust Dashboard:**
Visit https://www.braintrustdata.com and navigate to "belgian-legal-extraction" project

---

## Key Commands

### Run Evaluation

```bash
# Latest results
npm run eval run extract-comprehensive

# Sample (faster testing)
npm run eval run extract-comprehensive --sample 50

# Specific timestamp
npm run eval run extract-comprehensive --timestamp 2025-10-18T22-45-00-000Z
```

### Compare Experiments

After running evaluations on different models:

```bash
npm run eval compare \
  evals/results/extract-comprehensive-o4-mini-latest \
  evals/results/extract-comprehensive-gpt-5-mini-latest
```

Generates `evals/comparison-report.md`

### List Available Results

```bash
npm run eval list extract-comprehensive
```

---

## Understanding the Scores

### 8 Dimensions (100 points total)

1. **Language Consistency** (10 pts) - Correct language, no mixing
2. **Verbatim Quality** (25 pts) ⭐ **MOST IMPORTANT** - Text extracted verbatim
3. **Enum Correctness** (10 pts) - Valid enum values
4. **Party References** (10 pts) - Valid party IDs and references
5. **Court Information** (10 pts) - Accurate court metadata
6. **Completeness** (15 pts) - All required fields present
7. **Structural Correctness** (10 pts) - Valid JSON structure
8. **Critical Errors** (10 pts) - No hallucinations or fabrications

### Grades

- **A (90-100)**: Excellent - Production ready
- **B (80-89)**: Good - Minor improvements needed
- **C (70-79)**: Acceptable - Notable issues to fix
- **D (60-69)**: Poor - Significant problems
- **F (0-59)**: Failed - Not usable

**Usability Threshold:** ≥70 points

### Target Metrics

| Metric | Good | Excellent |
|--------|------|-----------|
| Overall Score | 80-89 | 90-100 |
| Verbatim Quality | 20-22/25 | 23-25/25 |
| Usable Rate | 85-94% | 95-100% |

---

## Common Issues & Solutions

### Issue: Low Verbatim Scores (<20/25)

**Symptom:** Arguments/facts are summarized, not extracted verbatim

**Solution:**
1. Review Stage 1 prompt - emphasize verbatim extraction
2. Check if model is paraphrasing
3. Increase minLength requirements in schema

### Issue: High Failure Rate (>10%)

**Symptom:** Many extractions marked as "not usable"

**Solution:**
```bash
# Check what's failing
cat evals/results/<experiment>/failures.json | jq '.[0]'
```

Common causes:
- Schema too strict (adjust validation)
- Enum language mismatches (fix prompt)
- Party ID format issues (check pattern)

### Issue: Rate Limiting (429 Errors)

**Symptom:** OpenAI API rate limit errors

**Solution:**
- Use `--sample 50` for testing
- Currently has 1s delay between requests
- Process in smaller batches

---

## Next Steps

### 1. Run Full Evaluation

After testing with sample:

```bash
npm run eval run extract-comprehensive
```

This will evaluate all extraction results (may take hours depending on volume).

### 2. Compare Models

When you have extractions from different models:

```bash
# Run o4-mini evaluation
npm run eval run extract-comprehensive

# Run gpt-5-mini evaluation (after extraction with gpt-5-mini)
npm run eval run extract-comprehensive-gpt5

# Compare
npm run eval compare \
  evals/results/extract-comprehensive-o4-mini-latest \
  evals/results/extract-comprehensive-gpt5-mini-latest
```

### 3. Analyze Patterns

Look for systematic issues in Braintrust dashboard:
- Which dimensions score lowest?
- Are certain decision types problematic?
- What are the most common issues?

### 4. Iterate

1. Fix issues in extraction prompt
2. Re-run extraction
3. Re-evaluate
4. Compare before/after

---

## File Locations

```
evals/
├── results/                          # Local evaluation results
│   └── <experiment-name>/
│       ├── evaluations.json          # Full evaluations
│       ├── summary.json              # Statistics
│       └── failures.json             # Failed evaluations
├── comparison-report.md              # Latest comparison report
├── cli.ts                            # CLI entry point
├── config/                           # Configuration files
├── scorers/                          # GPT-5 judge logic
├── loaders/                          # Data loaders
├── runners/                          # Evaluation orchestration
├── reporters/                        # Report generation
└── README.md                         # Full documentation
```

---

## Environment Variables

Already configured in `.env`:

```env
# OpenAI (for GPT-5 judge)
OPENAI_API_KEY=sk-...                 ✅ Already set

# Braintrust
BRAINTRUST_API_KEY=sk-...             ✅ Already set

# PostgreSQL (for source documents)
PGHOST=13.39.114.68                   ✅ Already set
PGUSER=postgres                       ✅ Already set
PGPASSWORD=strongpassword             ✅ Already set
PGDATABASE=lawyers                    ✅ Already set
PGPORT=5433                           ✅ Already set
```

---

## Troubleshooting

### Build Errors

```bash
npm run build
```

Should complete with no errors.

### Connection Issues

```bash
npm run eval test-connections
```

Verifies all connections work.

### Missing Results

```bash
npm run eval list extract-comprehensive
```

Shows available result timestamps. If empty, run extraction first:

```bash
npm run dev submit extract-comprehensive
npm run dev process extract-comprehensive
```

---

## Support

For detailed documentation:
- See `evals/README.md`
- Check Braintrust docs: https://www.braintrustdata.com/docs

For issues:
- Check evaluation output logs
- Verify `.env` configuration
- Test connections
- Review Braintrust dashboard

---

**Ready to start evaluating!** 🚀

Begin with:
```bash
npm run eval run extract-comprehensive --sample 50
```
