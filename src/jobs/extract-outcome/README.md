# Extract Outcome Job

Legal metadata extraction job for classifying outcomes of Belgian court decisions.

## Purpose

This job analyzes Belgian legal decisions to extract and classify:
- **Outcome classification**: Final decision type (GRANTED, DENIED, PARTIALLY_GRANTED, etc.)
- **Decision metadata**: Confidence level, procedural posture, appellate status
- **Outcome summary**: Brief explanation in the decision's procedural language

## Input Requirements

### Database Tables
- **decisions1**: Main decisions table
- **decision_fulltext1**: Full text markdown storage

### Required Fields
The job requires decisions with complete markdown text:
- `decisions1.id` - Unique identifier
- `decisions1.decision_id` - ECLI or other decision identifier
- `decisions1.language_metadata` - Procedural language (FR/NL)
- `decision_fulltext1.full_md` - Full markdown text of the decision

**CRITICAL**: Only processes decisions where `full_md IS NOT NULL`

### Database Query
```sql
SELECT
  d.id,
  d.decision_id,
  d.language_metadata,
  df.full_md
FROM decisions1 d
INNER JOIN decision_fulltext1 df ON d.id = df.decision_id
WHERE df.full_md IS NOT NULL
  AND d.status = 'pending'
LIMIT 100
```

## Output Structure

### Model Output (from Azure)
```json
{
  "currentInstance": {
    "outcome": "PARTIALLY_GRANTED"
  },
  "metadata": {
    "outcomeConfidence": "HIGH",
    "outcomeSummary": "L'appel est partiellement fondé. La décision de première instance est confirmée quant à la résiliation du contrat mais réformée quant aux dommages et intérêts.",
    "isAppellateDecision": true,
    "proceduralPosture": "Appeal from commercial court first instance judgment"
  }
}
```

### Final Output (with metadata merged)
```json
{
  "id": "123",
  "decision_id": "ECLI:BE:CASS:2023:ARR.20231215.1",
  "language": "FR",
  "currentInstance": {
    "outcome": "PARTIALLY_GRANTED"
  },
  "metadata": {
    "outcomeConfidence": "HIGH",
    "outcomeSummary": "L'appel est partiellement fondé. La décision de première instance est confirmée quant à la résiliation du contrat mais réformée quant aux dommages et intérêts.",
    "isAppellateDecision": true,
    "proceduralPosture": "Appeal from commercial court first instance judgment"
  }
}
```

**Note**: The `id`, `decision_id`, and `language` fields are automatically added from database rows to enable merging results across all extraction jobs.

## Outcome Types

The model classifies decisions into one of these categories:

| Outcome | Description | Use Case |
|---------|-------------|----------|
| `GRANTED` | Request fully granted | Claimant wins completely |
| `DENIED` | Request fully denied/rejected | Defendant wins completely |
| `PARTIALLY_GRANTED` | Request partially granted | Mixed outcome |
| `DISMISSED` | Case dismissed | Incompetence, procedural defect |
| `INADMISSIBLE` | Declared inadmissible | Procedural bar to hearing case |
| `REMANDED` | Case sent back to lower court | For further proceedings |
| `PARTIAL_CASSATION` | Partial cassation | Cour de cassation partially overturns |
| `CONFIRMED` | Lower decision confirmed | Appellate court affirms |
| `REVERSED` | Lower decision reversed | Appellate court overturns |

## Extraction Process

The prompt instructs the model to:

1. **Focus on dispositif/beschikking**: The operative part of the decision
2. **Consider procedural posture**: Distinguish appellate from first instance
3. **Handle multiple requests**: Determine overall outcome when multiple requests exist
4. **Assess confidence**: Honestly evaluate classification confidence
5. **Generate summary**: Provide 1-2 sentence explanation in decision language

## Metadata Tracking

This job uses the `rowMetadataFields` feature to track database identifiers:

```typescript
rowMetadataFields: ['id', 'decision_id', 'language_metadata']
```

### How It Works

1. **During Generation**:
   - System creates `input/extract-outcome-<timestamp>-metadata.json`
   - Maps each `custom_id` to database fields: `{ id, decision_id, language }`

2. **During Processing**:
   - System loads metadata mapping
   - Merges metadata into each successful extraction result
   - Final JSON includes top-level `id`, `decision_id`, `language` fields

3. **Why This Matters**:
   - Enables merging results from multiple extraction jobs
   - No need for additional database lookups
   - All results have consistent identifier fields

## Usage

### Submit Job
```bash
npm run dev submit extract-outcome
```

### Check Status
```bash
npm run dev status extract-outcome
```

### Process Results (when complete)
```bash
npm run dev process extract-outcome
```

## Output Files

After processing, results are saved to `results/extract-outcome/<timestamp>/`:

```
results/extract-outcome/2025-10-14T12-00-00/
├── all-results.json           # All responses (success + failures)
├── successful-results.json    # Valid responses with metadata
├── extracted-data.json        # Just the extracted data (most useful) ⭐
├── failures.json              # Failed/invalid responses
└── summary.json               # Processing statistics
```

**Most useful**: `extracted-data.json` contains the clean array of outcomes with merged metadata.

## Example Result

```json
{
  "id": "12345",
  "decision_id": "ECLI:BE:GHENT:2024:ARR.20240315.45",
  "language": "NL",
  "currentInstance": {
    "outcome": "CONFIRMED"
  },
  "metadata": {
    "outcomeConfidence": "HIGH",
    "outcomeSummary": "Het beroep wordt als ongegrond afgewezen. Het vonnis van de eerste rechter wordt in al zijn onderdelen bevestigd.",
    "isAppellateDecision": true,
    "proceduralPosture": "Appeal from first instance commercial court decision"
  }
}
```

## Configuration

### Key Config Properties

```typescript
{
  id: 'extract-outcome',
  dbQuery: '...', // Joins decisions1 + decision_fulltext1
  rowMetadataFields: ['id', 'decision_id', 'language_metadata'],
  deploymentName: 'gpt-4o-2',
  maxTokens: 4000,
  temperature: 0.0, // Deterministic for classification
}
```

### Adjusting Batch Size

Modify `dbQueryParams` in `config.ts`:
```typescript
dbQueryParams: ['pending', 100], // Limit to 100 decisions
```

## Validation

The output schema enforces:
- ✅ Outcome must be one of 9 valid enum values
- ✅ Confidence must be HIGH, MEDIUM, or LOW
- ✅ Summary must be at least 10 characters
- ✅ Procedural posture must be at least 5 characters
- ✅ isAppellateDecision must be boolean

Invalid responses are saved to `failures.json` with error details.

## Common Issues

### Issue: No results processed
**Cause**: No decisions have `full_md IS NOT NULL`
**Solution**: Ensure decision_fulltext1 table is populated with markdown

### Issue: Low confidence outcomes
**Cause**: Dispositif section unclear or missing
**Solution**: Review decisions manually, may need text preprocessing

### Issue: Wrong outcome classification
**Cause**: Model misinterpreted dispositif
**Solution**: Review prompt, consider adding examples for edge cases

### Issue: Missing metadata fields
**Cause**: Metadata mapping file not found
**Solution**: Ensure `rowMetadataFields` is configured and JSONL file was generated with current system

## Cost Estimation

Before submitting, the system provides cost estimate:

```
Cost estimate:
  Records: 100
  Estimated prompt tokens: ~300,000
  Estimated cost: $0.38 USD
```

Actual costs depend on markdown text length. Batch API = 50% off standard pricing.

## Integration

This job is part of the larger Belgian legal data extraction pipeline:

1. **extract-preprocessing** → Markdown conversion
2. **extract-outcome** → Outcome classification ⭐ You are here
3. **extract-parties** → Party identification
4. **extract-content** → Facts, requests, arguments
5. **extract-provisions** → Legal provisions cited
6. ... additional extraction jobs

All jobs output compatible JSON with `id`, `decision_id`, `language` fields for final merging.

## Maintenance

### Updating the Prompt

**⚠️ WARNING**: The prompt in `prompt.ts` is tested and validated. Do not modify without thorough testing.

If prompt updates are needed:
1. Test changes on sample decisions first
2. Validate output schema still matches
3. Update schema in `config.ts` if output structure changes

### Adding New Outcome Types

If you need additional outcome categories:

1. Update enum in `config.ts` output schema
2. Update prompt in `prompt.ts` with new category
3. Test on sample decisions
4. Document new category in this README

## Support

For issues:
- Check logs: `logs/combined.log`
- Review status file: `status/extract-outcome.json`
- Examine failures: `results/extract-outcome/<timestamp>/failures.json`
- Test connections: `npm run dev test-connections`
