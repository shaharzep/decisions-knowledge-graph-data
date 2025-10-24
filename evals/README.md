# Evaluation System for Belgian Legal Document Extraction

This directory contains the evaluation infrastructure for assessing extraction quality using GPT-5 as an LLM judge.

## Overview

The evaluation system:
- Scores extraction quality across 8 dimensions
- Uses GPT-5 with high reasoning for thorough evaluation
- Tracks results in Braintrust for analysis
- Enables model comparison (o4-mini vs gpt-5-mini, etc.)
- Generates detailed reports

## Directory Structure

```
evals/
├── config/
│   ├── braintrust.ts           # Braintrust client & experiment management
│   ├── judge-prompt.ts         # 8-dimension evaluation rubric
│   └── openai.ts               # GPT-5 client for judge
├── scorers/
│   └── gpt5-judge-scorer.ts    # Core scoring logic
├── loaders/
│   ├── extraction-result-loader.ts  # Load processed results
│   └── source-document-loader.ts    # Load original documents from DB
├── runners/
│   └── evaluation-runner.ts    # Main evaluation orchestrator
├── reporters/
│   └── analysis-reporter.ts    # Comparison reports & analysis
├── results/                    # Local evaluation results
│   └── <experiment-name>/
│       ├── evaluations.json
│       ├── summary.json
│       └── failures.json
├── types.ts                    # TypeScript interfaces
├── cli.ts                      # CLI entry point
└── README.md                   # This file
```

## 8-Dimension Evaluation Framework

Each extraction is scored across:

1. **Language Consistency** (0-10 points)
   - Correct procedural language identification
   - No mixed-language content
   - Enum values match language

2. **Verbatim Extraction Quality** (0-25 points) ⭐ **MOST CRITICAL**
   - Facts: Copied exactly from source
   - Requests: Complete petitum/conclusions
   - Arguments: Full reasoning (200-2000 chars)
   - Court Order: Complete dispositif

3. **Enum Correctness** (0-10 points)
   - Valid enum values
   - Language-specific enums match procedureLanguage

4. **Party & Reference Integrity** (0-10 points)
   - Valid party ID format
   - All references point to existing parties
   - No orphaned references

5. **Court Information Accuracy** (0-10 points)
   - Court name matches source
   - Correct ECLI code
   - Valid decision type

6. **Completeness** (0-15 points)
   - All required fields populated
   - All parties extracted
   - All legal issues identified

7. **Structural Correctness** (0-10 points)
   - Valid JSON structure
   - Correct data types
   - Proper date formats

8. **Critical Error Detection** (0-10 points)
   - No hallucinated content
   - No fabricated quotes
   - Core fields not empty

**Total: 100 points**

**Grading Scale:**
- A (90-100): Excellent
- B (80-89): Good
- C (70-79): Acceptable
- D (60-69): Poor
- F (0-59): Failed

**Usability Threshold:** ≥70 points

## Quick Start

### 1. Prerequisites

Ensure environment variables are set in `.env`:

```env
# OpenAI (for GPT-5 judge)
OPENAI_API_KEY=sk-...
OPENAI_ORG_ID=          # Optional

# Braintrust
BRAINTRUST_API_KEY=sk-...

# PostgreSQL (for source documents)
PGHOST=...
PGUSER=...
PGPASSWORD=...
PGDATABASE=...
PGPORT=...
```

### 2. Test Connections

```bash
npm run eval test-connections
```

### 3. Run Evaluation

```bash
# Evaluate latest extraction results
npm run eval run extract-comprehensive

# Evaluate with sample (50 decisions)
npm run eval run extract-comprehensive --sample 50

# Evaluate specific timestamp
npm run eval run extract-comprehensive --timestamp 2025-10-18T22-45-00-000Z
```

### 4. View Results

**Local Results:**
```bash
cat evals/results/<experiment-name>/summary.json
```

**Braintrust Dashboard:**
https://www.braintrustdata.com

## CLI Commands

### Run Evaluation

```bash
# Evaluate latest results
npm run eval run <job-type>

# With sample size
npm run eval run <job-type> --sample <n>

# Specific timestamp
npm run eval run <job-type> --timestamp <timestamp>

# Skip local save (Braintrust only)
npm run eval run <job-type> --no-save
```

**Example:**
```bash
npm run eval run extract-comprehensive --sample 100
```

### Compare Experiments

```bash
npm run eval compare <path1> <path2>
```

**Example:**
```bash
npm run eval compare \
  evals/results/extract-comprehensive-o4-mini-latest \
  evals/results/extract-comprehensive-gpt-5-mini-latest
```

Generates `evals/comparison-report.md` with:
- Score differences
- Grade distributions
- Common issues
- Recommendations

### List Available Results

```bash
npm run eval list <job-type>
```

**Example:**
```bash
npm run eval list extract-comprehensive
```

### Test Connections

```bash
npm run eval test-connections
```

Verifies:
- PostgreSQL connection
- OpenAI API key
- Braintrust API key

## Output Files

### Evaluation Results

For each evaluation run, creates:

```
evals/results/<experiment-name>/
├── evaluations.json       # Full evaluation details
├── summary.json          # Aggregate statistics
└── failures.json         # Failed evaluations only
```

### Summary Statistics

```json
{
  "metadata": {
    "jobType": "extract-comprehensive",
    "model": "o4-mini",
    "extractionDate": "2025-10-18T22:45:00.000Z"
  },
  "totalEvaluated": 100,
  "avgOverallScore": 85.3,
  "avgVerbatimScore": 21.2,
  "usableCount": 92,
  "usableRate": 0.92,
  "gradeDistribution": {
    "A": 35,
    "B+": 28,
    "B": 20,
    "C+": 7,
    "C": 5,
    "D": 3,
    "F": 2
  },
  "dimensionAverages": {
    "languageConsistency": 9.8,
    "verbatimQuality": 21.2,
    "enumCorrectness": 8.5,
    "partyReferences": 9.5,
    "courtInformation": 9.7,
    "completeness": 13.1,
    "structuralCorrectness": 9.9,
    "criticalErrors": 9.8
  }
}
```

## Comparison Reports

Generated in markdown format at `evals/comparison-report.md`:

```markdown
# Extraction Evaluation Comparison Report

## Experiments

### extract-comprehensive-o4-mini-latest
- Average Overall Score: 85.3/100
- Average Verbatim Score: 21.2/25
- Usable Rate: 92.0%

### extract-comprehensive-gpt-5-mini-latest
- Average Overall Score: 87.1/100
- Average Verbatim Score: 22.5/25
- Usable Rate: 94.0%

## Comparison
**Better Experiment**: extract-comprehensive-gpt-5-mini-latest
- Overall Score: +1.8
- Verbatim Score: +1.3
- Usable Rate: +2.0%

## Common Issues
- Arguments appear slightly summarized, should be longer (15 occurrences)
- Dispositif incomplete, missing some operative parts (8 occurrences)
- ...
```

## Expected Results

For high-quality extractions:

| Metric | Target | Threshold |
|--------|--------|-----------|
| Overall Score | 80-95 | ≥70 |
| Verbatim Quality | 20-25/25 | ≥18 |
| Usable Rate | >90% | ≥80% |
| Critical Errors | <5% | <10% |

## Troubleshooting

### Low Verbatim Scores (<18/25)

**Issue:** Text is summarized instead of extracted verbatim

**Solutions:**
1. Review extraction prompt for verbatim extraction mandate
2. Check if model is paraphrasing
3. Add examples of correct verbatim extraction
4. Increase minLength requirements in schema

### High Failure Rate (>10%)

**Issue:** Many extractions fail validation

**Check:**
```bash
cat evals/results/<experiment>/failures.json
```

**Common causes:**
- Schema too strict
- Enum values incorrect
- Party ID format issues
- Missing required fields

### Rate Limiting

**Issue:** `429 Too Many Requests` from OpenAI

**Solution:**
- Reduce sample size
- Add delays between requests (currently 1s)
- Use smaller batches

### Memory Issues

**Issue:** Out of memory with large evaluations

**Solution:**
- Use `--sample` to limit size
- Clear document cache periodically
- Process in batches

## Tips for Effective Evaluation

1. **Start Small:** Run on sample of 50 decisions first
2. **Calibrate:** Adjust thresholds based on your quality requirements
3. **Iterate:** Refine both extraction and judge prompts
4. **Focus on Patterns:** Look for systemic issues, not one-offs
5. **Monitor Drift:** Re-evaluate periodically

## Advanced Usage

### Custom Judge Prompt

Modify `evals/config/judge-prompt.ts` to adjust:
- Scoring criteria
- Dimension weights
- Validation rules

### Parallel Processing

Currently processes sequentially to avoid rate limits. To enable parallel:

1. Modify `evaluation-runner.ts`
2. Add worker pool
3. Adjust rate limiting

### Custom Reporters

Create custom analysis in `evals/reporters/`:
```typescript
import { EvaluationResult } from '../types.js';

export function customAnalysis(evaluations: EvaluationResult[]) {
  // Your analysis logic
}
```

## Integration with Braintrust

All evaluations are automatically logged to Braintrust with:
- Input metadata (decision ID, source length)
- Output (full evaluation)
- Scores (all 8 dimensions)
- Metadata (grade, usable flag)

**View in Braintrust:**
1. Visit https://www.braintrustdata.com
2. Navigate to "belgian-legal-extraction" project
3. Select experiment
4. Analyze scores, distributions, trends

## Contributing

When adding new evaluation dimensions:

1. Update `types.ts` with new interfaces
2. Modify `judge-prompt.ts` scoring rubric
3. Update `gpt5-judge-scorer.ts` validation
4. Adjust `analysis-reporter.ts` for new stats
5. Document in this README

## Support

For issues:
1. Check logs in evaluation output
2. Verify `.env` configuration
3. Test connections: `npm run eval test-connections`
4. Review Braintrust dashboard for patterns

---

**Version:** 1.0.0
**Last Updated:** 2025-10-20
