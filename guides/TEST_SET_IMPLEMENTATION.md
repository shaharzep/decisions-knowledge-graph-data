# Test Set Implementation

## Summary

Added support for running batch jobs on predefined test sets instead of arbitrary database queries. This enables consistent, reproducible evaluation on a curated set of diverse decisions.

## What Was Added

### 1. Test Set Infrastructure

#### `src/utils/testSetLoader.ts`
**Utility for loading and managing test sets**

**Key Functions:**
- `loadTestSet(filePath)` - Loads and validates JSON test set file
- `toQueryParams(testSet)` - Converts to PostgreSQL query parameters (two arrays: decision_ids, languages)
- `getSummary(testSet)` - Generates statistics (total count, language distribution)

**Validation:**
- Ensures file is valid JSON array
- Validates each entry has `decision_id` and `language` fields
- Provides helpful error messages

### 2. Test Set Files

#### `evals/test-sets/comprehensive-200.json`
**Main test set file (template)**

**Format:**
```json
[
  {
    "decision_id": "ECLI:BE:CASS:2023:ARR.20230315",
    "language": "FR"
  },
  {
    "decision_id": "ECLI:BE:CASS:2023:ARR.20230316",
    "language": "NL"
  }
]
```

**Status:** Template with 2 examples - ready for you to populate with 200 decisions

#### `evals/test-sets/README.md`
**Complete documentation**

Includes:
- File format specification
- Usage examples
- Best practices
- SQL query examples for creating test sets
- Troubleshooting guide

### 3. Updated Job Configuration

#### `src/jobs/extract-comprehensive/config.ts`
**Now uses test set instead of LIMIT**

**Query Changes:**
```sql
-- OLD APPROACH (first X decisions)
SELECT d.id, d.decision_id, d.language_metadata, dm.full_md
FROM decisions1 d
INNER JOIN decisions_md dm ...
WHERE dm.full_md IS NOT NULL
LIMIT $1

-- NEW APPROACH (specific test set decisions)
SELECT d.id, d.decision_id, d.language_metadata, dm.full_md
FROM decisions1 d
INNER JOIN decisions_md dm ...
INNER JOIN unnest($1::text[], $2::text[]) AS test_set(decision_id, language)
  ON d.decision_id = test_set.decision_id
  AND d.language_metadata = test_set.language
WHERE dm.full_md IS NOT NULL
```

**Parameters:**
- `$1`: Array of decision_ids from test set
- `$2`: Array of languages (matching order)

**Runtime Loading:**
- Test set loaded automatically when config is imported
- Shows summary on console (count, language distribution)

## How It Works

### PostgreSQL `unnest()` Technique

The query uses PostgreSQL's `unnest()` function to convert two arrays into a virtual table:

```sql
unnest($1::text[], $2::text[]) AS test_set(decision_id, language)
```

This creates a temporary table with columns `decision_id` and `language`, which we then join against to filter the exact decisions we want.

**Example:**
```
Input arrays:
  $1 = ['ECLI:BE:CASS:2023:ARR.001', 'ECLI:BE:CASS:2023:ARR.002']
  $2 = ['FR', 'NL']

Virtual table created:
  ┌──────────────────────────────┬──────────┐
  │ decision_id                  │ language │
  ├──────────────────────────────┼──────────┤
  │ ECLI:BE:CASS:2023:ARR.001   │ FR       │
  │ ECLI:BE:CASS:2023:ARR.002   │ NL       │
  └──────────────────────────────┴──────────┘
```

This approach:
- ✅ Matches both `decision_id` AND `language` correctly
- ✅ Handles any number of decisions efficiently
- ✅ Preserves exact order from test set
- ✅ No risk of combinatorial explosion (unlike separate ANY clauses)

## Next Steps

### 1. Populate Your Test Set

You need to fill `evals/test-sets/comprehensive-200.json` with your 200 curated decisions.

**Option A: SQL Export**
```sql
-- Select your 200 diverse decisions
SELECT
  d.decision_id,
  d.language_metadata AS language
FROM decisions1 d
INNER JOIN decisions_md dm
  ON dm.decision_id = d.decision_id
  AND dm.language = d.language_metadata
WHERE dm.full_md IS NOT NULL
  AND dm.full_md != ''
  -- Add your selection criteria here
  -- e.g., diverse courts, case types, lengths
ORDER BY ...
LIMIT 200;

-- Export as JSON
```

**Option B: Manual Selection**
```bash
# Edit the file directly with your 200 decisions
nano evals/test-sets/comprehensive-200.json
```

### 2. Verify Test Set

```bash
# Check count
cat evals/test-sets/comprehensive-200.json | jq '. | length'

# Verify format
cat evals/test-sets/comprehensive-200.json | jq '.[] | {decision_id, language}'

# Check language distribution
cat evals/test-sets/comprehensive-200.json | jq 'group_by(.language) | map({language: .[0].language, count: length})'
```

### 3. Run Evaluation

```bash
# Submit job (will process exactly 200 decisions from test set)
npm run dev submit extract-comprehensive

# Or wait for completion
npm run dev submit extract-comprehensive --wait
```

**Expected Output:**
```
✅ Loaded test set: 200 decisions from evals/test-sets/comprehensive-200.json
📊 Test set summary: 200 decisions
   Languages: {"FR":100,"NL":100}
🟢 Using OpenAI Batch API for job: extract-comprehensive-2025-10-23...
```

## Benefits

1. **Reproducibility**: Same 200 decisions every time
2. **Comparability**: Valid A/B testing between prompts/models
3. **Diversity**: You control the mix of case types, courts, languages
4. **Quality Control**: Known ground truth for evaluation
5. **Efficiency**: No need to process thousands of random decisions
6. **Tracking**: Test set is version controlled with code

## File Structure

```
knowledge-graph/
├── evals/
│   └── test-sets/
│       ├── README.md                    # Documentation
│       └── comprehensive-200.json       # Your 200 decisions (populate this!)
└── src/
    ├── jobs/
    │   └── extract-comprehensive/
    │       └── config.ts                # Uses test set
    └── utils/
        └── testSetLoader.ts             # Test set utilities
```

## Example Selection Criteria for 200 Decisions

Consider including:

**By Court Level:**
- 40 Cour de cassation decisions
- 40 Appellate court decisions  
- 80 First instance decisions
- 40 Administrative/specialized courts

**By Language:**
- 100 French decisions
- 100 Dutch decisions

**By Complexity:**
- 50 Short decisions (< 5000 chars)
- 100 Medium decisions (5000-15000 chars)
- 50 Long decisions (> 15000 chars)

**By Case Type:**
- Civil, criminal, administrative, labor law mix
- Various legal domains represented

## Troubleshooting

### Test set loads but query returns 0 results
- Check that `full_md` exists for these decisions in `decisions_md` table
- Verify join condition matches your database schema

### Syntax error near `unnest`
- Ensure PostgreSQL version supports `unnest()` with multiple arrays (9.4+)
- Check that array type casting is correct (`::text[]`)

### Wrong number of decisions returned
- Some decisions in test set might not have `full_md` content
- Check for duplicates in test set file

---

**Implementation Status**: ✅ **COMPLETE**

**Ready for**: Populating test set with 200 curated decisions
