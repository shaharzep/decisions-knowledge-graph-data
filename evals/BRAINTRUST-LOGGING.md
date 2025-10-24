# Braintrust Logging Reference

## What Gets Logged to Braintrust

Every evaluation logs 4 sections to Braintrust:

### 1. Input (What was evaluated)

```json
{
  "decision_id": "ECLI:BE:CASS:2023:ARR.20230315",
  "url": "https://...",
  "source_document_length": 18098,
  "extracted_data": {
    // Full extracted JSON object (rendered nicely in Braintrust UI)
    "decisionId": "ECLI:BE:CASS:2023:ARR.20230315",
    "parties": [...],
    "currentInstance": {...},
    // ... all fields from your extraction job
  }
}
```

### 2. Output (Evaluation result from judge)

```json
{
  "verdict": "PASS",
  "score": 87,
  "criticalIssues": [],
  "majorIssues": ["One argument slightly paraphrased"],
  "minorIssues": ["One enum in wrong language"],
  "recommendation": "PROCEED",
  "confidence": "HIGH",
  "summary": "Strong extraction. Text mostly verbatim..."
}
```

### 3. Scores (Single column for charts/filtering)

```json
{
  "score": 0.87  // Normalized to 0-1 (87/100)
}
```

**This is the ONLY score column** - used for Braintrust charts and aggregations.

### 4. Metadata (All other details)

```json
{
  // Decision info
  "decision_id": "ECLI:BE:CASS:2023:ARR.20230315",
  "url": "https://...",

  // Evaluation results
  "verdict": "PASS",
  "overall_score": 87,
  "production_ready": true,

  // Issue counts
  "critical_issues_count": 0,
  "major_issues_count": 1,
  "minor_issues_count": 1,

  // Recommendation
  "recommendation": "PROCEED",
  "confidence": "HIGH",

  // Full extracted JSON (formatted string)
  "extracted_json": "{\n  \"decisionId\": \"...\",\n  ..."
}
```

---

## Why This Structure?

### ✅ **Input**: Shows what was being evaluated
- Full extracted JSON displayed as object (easy to browse in UI)
- URL linked to source decision
- Document length for context

### ✅ **Output**: Shows the judge's evaluation
- Complete evaluation result
- Includes all issues and summary
- This is what the judge "outputted"

### ✅ **Scores**: Single metric for aggregation
- Just `score` (0-1 normalized)
- Used for charts, filtering, comparisons
- Clean, simple metric column

### ✅ **Metadata**: Everything else
- All evaluation details (verdict, issues, recommendation)
- Both extracted JSON (as formatted string for copy-paste)
- URL and decision ID for traceability
- Filterable/groupable in Braintrust UI

---

## Works for All Jobs Automatically

This logging structure is **job-agnostic**:

### Different jobs, same logging:

**extract-comprehensive**:
```json
"extracted_data": {
  "parties": [...],
  "currentInstance": {...},
  "priorInstances": [...]
}
```

**extract-provisions-fr**:
```json
"extracted_data": {
  "citedProvisions": [
    {"provisionNumber": "article 31", ...}
  ]
}
```

**extract-legal-teachings**:
```json
"extracted_data": {
  "legalTeachings": [
    {"relatedFullTextCitations": [...], ...}
  ]
}
```

The logging function doesn't care about the structure - it just logs whatever `extractedData` you pass it. Each job's data will be different, but all visible in Braintrust.

---

## Viewing in Braintrust

### Scores Tab
- See distribution of overall scores (0-1)
- Filter by score ranges
- Compare across experiments

### Metadata Tab
- Filter by `verdict` (PASS/FAIL/REVIEW_REQUIRED)
- Filter by `production_ready` (true/false)
- Group by `recommendation` or `confidence`
- See issue counts

### Individual Rows
- Click any row to see:
  - **Input**: Full extracted JSON (interactive object viewer)
  - **Output**: Full evaluation with all issues
  - **Metadata**: URL, verdict, all counts

### URL Linking
- Every row has `url` field
- Click to view original decision on Belgian legal database
- Easy to verify evaluation by reading source

---

## Example Braintrust View

```
┌─────────────────────────────────────────┬───────┬──────────┬──────────┐
│ Decision ID                             │ Score │ Verdict  │ URL      │
├─────────────────────────────────────────┼───────┼──────────┼──────────┤
│ ECLI:BE:CASS:2023:ARR.20230315         │ 0.87  │ PASS     │ [link]   │
│ ECLI:BE:CASS:2023:ARR.20230316         │ 0.72  │ REVIEW   │ [link]   │
│ ECLI:BE:CASS:2023:ARR.20230317         │ 0.45  │ FAIL     │ [link]   │
└─────────────────────────────────────────┴───────┴──────────┴──────────┘

Click row → See:
  - Full extracted JSON (parties, facts, arguments, etc.)
  - Full evaluation (all issues, summary, confidence)
  - URL to source decision
  - All metadata fields
```

---

## Filtering Examples

In Braintrust, you can filter by:

**Score:**
```
score >= 0.8  // Good extractions
score < 0.6   // Failed extractions
```

**Verdict:**
```
metadata.verdict = "PASS"
metadata.verdict = "FAIL"
metadata.verdict = "REVIEW_REQUIRED"
```

**Production Ready:**
```
metadata.production_ready = true
```

**Issue Counts:**
```
metadata.critical_issues_count > 0  // Has blockers
metadata.major_issues_count > 2     // Multiple quality issues
```

**Recommendation:**
```
metadata.recommendation = "FIX_PROMPT"
metadata.recommendation = "REVIEW_SAMPLES"
```

---

## Summary

✅ **What you asked for:**
- ✅ Extraction data JSON logged (in `input.extracted_data` + `metadata.extracted_json`)
- ✅ Decision URL logged (in `input.url` + `metadata.url`)
- ✅ Only overall score as score column (just `score` in scores)
- ✅ Everything else in metadata (verdict, issues, recommendation, confidence)

✅ **Works for all jobs:**
- No job-specific logic needed
- Different jobs = different extractedData structures
- All logged the same way to Braintrust

✅ **Easy to evaluate:**
- Click URL to see source decision
- See full extracted JSON
- See full evaluation with issues
- Filter/group by any metadata field
