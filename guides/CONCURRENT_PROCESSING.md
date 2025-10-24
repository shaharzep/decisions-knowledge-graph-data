# Concurrent Processing System

## Overview

Process all 197 test decisions using **OpenAI GPT-5-mini** with concurrent API calls for fast results (10-20 minutes instead of 24 hours batch processing).

## Quick Start

```bash
# Run concurrent processing
npm run dev concurrent extract-comprehensive
```

## What It Does

1. ✅ Loads 197 decisions from CSV test set
2. ✅ Queries database for full markdown text
3. ✅ Processes 10 decisions in parallel (configurable)
4. ✅ Uses OpenAI GPT-5-mini with structured outputs
5. ✅ Same prompt, schema, and settings as batch config
6. ✅ Validates against JSON schema
7. ✅ Saves results in same format as batch processing

## Configuration

The system reuses settings from `extract-comprehensive/config.ts`:

- **Model**: `gpt-5-mini`
- **Max Tokens**: `128000`
- **Reasoning Effort**: `low`
- **Verbosity**: `minimal`
- **Schema**: Same comprehensive extraction schema
- **Prompt**: Same Stage 1 prompt template

## Output

Results are saved to: `concurrent/results/extract-comprehensive/{timestamp}/`

**Files created:**
- `extracted-data.json` - Successfully extracted data (clean)
- `successful-results.json` - Successful results with metadata
- `failures.json` - Failed extractions with error messages
- `summary.json` - Statistics and breakdown
- `all-results.json` - Complete raw results

## Performance

**Expected:**
- **Concurrency**: 10 parallel requests
- **Time**: ~10-20 minutes for 197 decisions
- **Cost**: ~$5-10 (standard OpenAI pricing, no batch discount)
- **Token Usage**: ~2-3 million tokens total

## Advanced Usage

### Adjust Concurrency

Edit `src/concurrent/ConcurrentRunner.ts` to change default concurrency:

```typescript
// Line 18: default concurrency limit
concurrencyLimit: options.concurrencyLimit || 10,  // Change 10 to desired value
```

Or modify the code to accept a command-line parameter.

### Custom Timeout

Edit `src/concurrent/ConcurrentRunner.ts`:

```typescript
// Line 19: timeout per request
timeout: options.timeout || 300000,  // 5 minutes in milliseconds
```

## Output Format

Same as batch processing:

```json
// summary.json
{
  "processedAt": "2025-10-23T...",
  "jobType": "extract-comprehensive",
  "totalRecords": 197,
  "successfulRecords": 185,
  "failedRecords": 12,
  "validationErrors": 3,
  "totalTokens": 2456789,
  "averageTokensPerRequest": 12468,
  "successRate": "93.9%",
  "outputDirectory": "concurrent/results/extract-comprehensive/2025-10-23...",
  "errorsByType": {
    "Schema Validation": 3,
    "Timeout": 5,
    "API Error": 4
  }
}
```

## Error Handling

The system handles:
- ✅ **Rate limits (429)**: Automatic retry with exponential backoff
- ✅ **Timeouts**: 5-minute limit per decision
- ✅ **API errors**: Logged and marked as failed
- ✅ **Schema validation**: Failed validations saved to failures.json
- ✅ **JSON parse errors**: Invalid responses marked as failed

Failed decisions don't stop processing - all 197 will complete.

## Comparison with Batch Processing

| Feature | Concurrent | Batch |
|---------|-----------|-------|
| **Speed** | 10-20 min | Up to 24 hrs |
| **Cost** | Standard pricing | 50% discount |
| **Provider** | OpenAI | OpenAI/Azure |
| **Concurrency** | 10 parallel | N/A (batch) |
| **Validation** | Same schema | Same schema |
| **Output format** | Identical | Identical |
| **Use case** | Testing, quick results | Production, large scale |

## Troubleshooting

### Rate Limit Errors

If you see many rate limit errors:
1. Reduce concurrency limit (change from 10 to 5)
2. Check OpenAI API quota/limits
3. Wait a few minutes and retry

### Timeout Errors

If decisions timeout (>5 min):
- This is expected for very long decisions
- Check token counts in failures.json
- Consider increasing maxCompletionTokens if needed

### Validation Failures

Check `failures.json` for details:
```bash
cat concurrent/results/extract-comprehensive/latest/failures.json | jq '.[0]'
```

Common issues:
- Arguments too short (<200 chars)
- Missing required fields
- Invalid enum values
- Party ID format issues

## Files Created

### New Files (3)
- `src/concurrent/OpenAIConcurrentClient.ts` - OpenAI API wrapper
- `src/concurrent/ConcurrentProcessor.ts` - Validation & output
- `src/concurrent/ConcurrentRunner.ts` - Main orchestrator

### Modified Files (2)
- `package.json` - Added p-limit dependency
- `src/cli.ts` - Added concurrent command

### Reused (No Changes)
- `src/jobs/extract-comprehensive/config.ts` - Prompt & schema
- `src/utils/validators.ts` - JSON schema validation
- `src/utils/testSetLoader.ts` - CSV test set loading
- `src/config/database.ts` - Database queries
- `src/config/openai.ts` - OpenAI client

## Next Steps

After running concurrent processing:

1. **Review Summary**:
   ```bash
   cat concurrent/results/extract-comprehensive/*/summary.json | jq
   ```

2. **Check Failures**:
   ```bash
   cat concurrent/results/extract-comprehensive/*/failures.json | jq '.[] | .error' | sort | uniq -c
   ```

3. **Evaluate Quality** (optional):
   ```bash
   npm run eval run extract-comprehensive
   ```

4. **Compare with Batch** (when batch completes):
   ```bash
   npm run eval compare \
     concurrent/results/extract-comprehensive/latest \
     results/extract-comprehensive/latest
   ```

## Support

For issues:
- Check logs in `logs/` directory
- Review failures.json for error patterns
- Verify OpenAI API key and quota
- Test with smaller concurrency first (5 instead of 10)

---

**Status**: ✅ Ready to use
**Implementation**: Complete
**Build**: Passing
