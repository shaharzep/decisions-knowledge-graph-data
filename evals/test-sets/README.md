# Test Sets

Test sets are predefined collections of decisions used for consistent evaluation and testing of extraction jobs.

## Purpose

Using fixed test sets ensures:
- **Reproducibility**: Same decisions tested across different prompts/models
- **Diversity**: Curated set representing various case types, courts, languages
- **Comparability**: Valid A/B testing between configurations
- **Quality control**: Known ground truth for evaluation

## File Format

Test set files are JSON arrays with decision identifiers:

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

### Fields

- **`decision_id`** (required): ECLI code or unique decision identifier from `decisions1.decision_id`
- **`language`** (required): Language code (`FR` or `NL`) from `decisions1.language_metadata`

## Available Test Sets

### `comprehensive-200.json`

- **Size**: 200 decisions
- **Purpose**: Primary test set for extract-comprehensive job evaluation
- **Selection criteria**:
  - Diverse case types (civil, criminal, administrative)
  - Multiple court levels (cassation, appeal, first instance)
  - Balanced FR/NL distribution
  - Various decision lengths and complexities

## Creating a Test Set

### 1. Query Database for Candidates

```sql
-- Example: Select diverse decisions
SELECT
  d.decision_id,
  d.language_metadata AS language,
  dm.full_md,
  LENGTH(dm.full_md) AS length,
  d.court_name
FROM decisions1 d
INNER JOIN decisions_md dm
  ON dm.decision_id = d.decision_id
  AND dm.language = d.language_metadata
WHERE dm.full_md IS NOT NULL
  AND dm.full_md != ''
ORDER BY RANDOM()
LIMIT 200;
```

### 2. Export to JSON

```javascript
// Convert query results to test set format
const testSet = results.map(row => ({
  decision_id: row.decision_id,
  language: row.language
}));

// Save to file
fs.writeFileSync(
  'evals/test-sets/comprehensive-200.json',
  JSON.stringify(testSet, null, 2)
);
```

### 3. Verify Test Set

```bash
# Check format and count
cat evals/test-sets/comprehensive-200.json | jq '. | length'

# Verify all entries have required fields
cat evals/test-sets/comprehensive-200.json | jq '.[] | select(.decision_id == null or .language == null)'
# Should return nothing if all entries are valid
```

## Using Test Sets in Job Configs

Test sets are loaded automatically when configured in a job:

```typescript
import { TestSetLoader } from "../../utils/testSetLoader.js";

const config: JobConfig = {
  id: "extract-comprehensive",

  dbQuery: `
    SELECT d.id, d.decision_id, d.language_metadata, dm.full_md
    FROM decisions1 d
    INNER JOIN decisions_md dm
      ON dm.decision_id = d.decision_id
      AND dm.language = d.language_metadata
    INNER JOIN unnest($1::text[], $2::text[]) AS test_set(decision_id, language)
      ON d.decision_id = test_set.decision_id
      AND d.language_metadata = test_set.language
    WHERE dm.full_md IS NOT NULL
      AND dm.full_md != ''
  `,

  dbQueryParams: await (async () => {
    const testSet = await TestSetLoader.loadTestSet(
      "evals/test-sets/comprehensive-200.json"
    );
    const params = TestSetLoader.toQueryParams(testSet);
    return [params.decisionIds, params.languages];
  })(),
};
```

## Test Set Utilities

The `TestSetLoader` class provides:

### `loadTestSet(filePath: string)`
Loads and validates a test set file.

```typescript
const testSet = await TestSetLoader.loadTestSet(
  "evals/test-sets/comprehensive-200.json"
);
// Returns: TestSetEntry[]
```

### `toQueryParams(testSet: TestSetEntry[])`
Converts test set to PostgreSQL query parameters.

```typescript
const params = TestSetLoader.toQueryParams(testSet);
// Returns: { decisionIds: string[], languages: string[] }
```

### `getSummary(testSet: TestSetEntry[])`
Generates statistics about the test set.

```typescript
const summary = TestSetLoader.getSummary(testSet);
// Returns: { total: number, byLanguage: Record<string, number> }
console.log(`Total: ${summary.total}`);
console.log(`FR: ${summary.byLanguage.FR}`);
console.log(`NL: ${summary.byLanguage.NL}`);
```

## Best Practices

1. **Version Control**: Commit test set files to git for reproducibility
2. **Documentation**: Document selection criteria in this README
3. **Diversity**: Include various case types, courts, and complexities
4. **Balance**: Maintain reasonable FR/NL distribution
5. **Stability**: Don't change test sets frequently - create new ones for new experiments
6. **Naming**: Use descriptive names: `<job-type>-<size>-<variant>.json`

## Example: Populating comprehensive-200.json

Once you've selected your 200 diverse decisions, update the file:

```bash
# Edit the file directly
nano evals/test-sets/comprehensive-200.json

# Or use a script to populate from database export
node scripts/create-test-set.js \
  --query="SELECT decision_id, language_metadata FROM ..." \
  --output=evals/test-sets/comprehensive-200.json
```

## Troubleshooting

### "Test set file must contain a JSON array"
- Ensure file is valid JSON
- File must be an array at the top level: `[...]`

### "Invalid entry at index X: must have 'decision_id' and 'language' fields"
- Each entry must have both `decision_id` and `language` properties
- Check for typos in property names

### "No decisions found for test set"
- Verify decision_ids exist in database
- Check that language codes match exactly (`FR` vs `fr`)
- Ensure decisions have `full_md` content in `decisions_md` table

### Query returns different count than test set size
- Some decisions might not have `full_md` content
- Check for duplicate entries in test set file
- Verify join conditions match database schema
