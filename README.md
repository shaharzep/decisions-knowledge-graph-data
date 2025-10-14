# Azure OpenAI Batch API - Legal Data Extraction System

A Node.js/TypeScript system for submitting batch extraction jobs to Azure OpenAI to extract structured data from Belgian legal case laws.

## Overview

This system processes ~10 independent batch extraction jobs (parties, provisions, decisions, etc.) using Azure OpenAI's Batch API. Each extraction job:
- Takes different inputs from PostgreSQL
- Uses different prompts/logic
- Outputs validated JSON
- Runs independently

**Key Benefits:**
- 50% cost savings vs standard Azure OpenAI API
- Reusable core classes for all extraction jobs
- Clean organization with one status file per job
- Automatic validation against JSON schemas
- READ-ONLY database access (enforced)

## Architecture

```
src/
├── config/
│   ├── database.ts        # READ-ONLY PostgreSQL connection
│   └── azure.ts            # Azure OpenAI client
├── core/
│   ├── BatchJobGenerator.ts   # Generates JSONL from DB + prompt
│   ├── AzureBatchClient.ts    # Handles Azure API interactions
│   ├── JobStatusTracker.ts    # Manages status JSON files
│   ├── ResultProcessor.ts     # Validates & saves results
│   └── BatchJobRunner.ts      # Orchestrates full workflow
├── jobs/
│   ├── JobConfig.ts           # TypeScript interfaces
│   └── configs/               # Individual job definitions
│       └── extract-parties-EXAMPLE.ts
├── utils/
│   ├── logger.ts              # Winston logging
│   └── validators.ts          # JSON schema validation
└── cli.ts                     # CLI entry point
```

## Prerequisites

- Node.js 20+
- PostgreSQL database (READ-ONLY access)
- Azure OpenAI account with Batch API access
- Azure OpenAI deployment (e.g., gpt-4o)

## Installation

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build
```

## Configuration

The `.env` file is already configured with:

```env
# PostgreSQL (READ-ONLY)
PGHOST=13.39.114.68
PGUSER=postgres
PGPASSWORD=strongpassword
PGDATABASE=postgres
PGPORT=5433
POSTGRES_DB=lawyers

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://shacharsopenai.openai.azure.com/
AZURE_OPENAI_API_KEY=your-key-here
AZURE_OPENAI_DEPLOYMENT=gpt-4o-2
AZURE_API_VERSION=2024-11-20
```

## Usage

### Test Connections

```bash
npm run dev test-connections
```

### Submit a Batch Job

```bash
# Submit and return immediately
npm run dev submit extract-parties

# Submit and wait for completion (may take up to 24 hours)
npm run dev submit extract-parties --wait
```

### Check Job Status

```bash
npm run dev status extract-parties
```

### Process Completed Results

```bash
npm run dev process extract-parties
```

### List All Jobs

```bash
npm run dev list
```

## Workflow

### 1. Submit Job (`npm run dev submit <job-type>`)

**What happens:**
1. Executes database query from job config
2. Generates prompt for each row using `promptTemplate()`
3. Creates JSONL file in `input/` directory
4. Uploads file to Azure OpenAI
5. Submits batch job
6. Saves job metadata to `status/<job-type>.json`

**Output:**
- Input file: `input/<job-type>-<timestamp>.jsonl`
- Status file: `status/<job-type>.json`
- Azure Batch ID for tracking

### 2. Monitor Status (`npm run dev status <job-type>`)

**What happens:**
1. Loads job metadata from `status/<job-type>.json`
2. Fetches current status from Azure Batch API
3. Updates local status file
4. Displays progress

**Azure Batch Lifecycle:**
- `validating` → Azure validates input file
- `in_progress` → Processing requests
- `finalizing` → Completing job
- `completed` → Ready for processing
- `failed` / `cancelled` / `expired` → Terminal failure states

### 3. Process Results (`npm run dev process <job-type>`)

**What happens:**
1. Downloads output JSONL from Azure
2. Parses each response
3. Validates against output schema
4. Saves results to `results/<job-type>/<timestamp>/`

**Output files:**
- `all-results.json` - All responses (success + failures)
- `successful-results.json` - Valid responses only
- `extracted-data.json` - Just the extracted data (most useful)
- `failures.json` - Failed/invalid responses
- `summary.json` - Processing statistics

## Creating a New Extraction Job

### Step 1: Create Job Configuration

Create `src/jobs/configs/<job-name>.ts`:

```typescript
import { JobConfig } from '../JobConfig.js';

const myJobConfig: JobConfig = {
  id: 'my-extraction-job',

  description: 'Extract X from Y',

  // Database query (READ-ONLY)
  dbQuery: 'SELECT id, data FROM table WHERE status = $1',
  dbQueryParams: ['pending'],

  // Prompt template function
  promptTemplate: (row) => {
    return `Extract information from: ${row.data}`;
  },

  // JSON Schema for output validation
  outputSchema: {
    type: 'object',
    required: ['field1', 'field2'],
    properties: {
      field1: { type: 'string' },
      field2: { type: 'number' }
    }
  },

  // Azure settings
  deploymentName: 'gpt-4o-2',
  maxTokens: 4000,
  temperature: 0.0
};

export default myJobConfig;
```

### Step 2: Run the Job

```bash
npm run dev submit my-extraction-job
```

That's it! The shared infrastructure handles everything else.

## File Locations

```
input/           - Generated JSONL files for Azure
output/          - Downloaded JSONL files from Azure
results/         - Processed and validated results
  ├── <job-type>/
  │   └── <timestamp>/
  │       ├── all-results.json
  │       ├── successful-results.json
  │       ├── extracted-data.json
  │       ├── failures.json
  │       └── summary.json
status/          - Job metadata (one JSON per job type)
  └── <job-type>.json
logs/            - Application logs
  ├── combined.log
  └── error.log
```

## Status File Format

Each job has a status file at `status/<job-type>.json`:

```json
{
  "jobId": "extract-parties-2025-10-13T12-00-00",
  "jobType": "extract-parties",
  "status": "completed",
  "azureBatchJobId": "batch_abc123xyz",
  "createdAt": "2025-10-13T12:00:00.000Z",
  "submittedAt": "2025-10-13T12:01:00.000Z",
  "completedAt": "2025-10-13T14:30:00.000Z",
  "inputFile": "input/extract-parties-2025-10-13.jsonl",
  "outputFile": "output/extract-parties-2025-10-13-output.jsonl",
  "resultsDirectory": "results/extract-parties/2025-10-13T14-30-00",
  "totalRecords": 150,
  "recordsProcessed": 148,
  "recordsFailed": 2,
  "errors": [],
  "metadata": {
    "inputFileId": "file-abc123",
    "outputFileId": "file-xyz789",
    "totalTokens": 245678
  }
}
```

## Important Notes

### Database Access

- **READ-ONLY**: The system enforces read-only database access
- Only `SELECT` queries are allowed
- Any attempt to run `INSERT`, `UPDATE`, `DELETE`, etc. will throw an error
- This is a security measure to protect your data

### Azure Batch API Limits

- **Processing time**: Up to 24 hours
- **File size**: 200 MB maximum
- **Requests per batch**: ~100,000 maximum
- **Cost**: 50% off standard API pricing

### Token Usage

The system tracks token usage for each job:
- Prompt tokens
- Completion tokens
- Total tokens
- Average tokens per request

Cost estimation is provided when submitting jobs.

## Troubleshooting

### Connection Issues

```bash
npm run dev test-connections
```

Check that:
- PostgreSQL is accessible
- Azure credentials are correct
- `.env` file is properly formatted

### Job Stuck in "validating"

Azure is checking your input file. This usually takes < 5 minutes.

If stuck for > 10 minutes:
1. Check file format (must be valid JSONL)
2. Check file size (< 200 MB)
3. Check deployment name matches Azure

### Validation Errors

If results fail schema validation:
1. Check `results/<job>/failures.json` for error details
2. Review your `outputSchema` in job config
3. Update prompt to better guide model output
4. Consider adding examples to prompt

### Rate Limits

Azure Batch API has separate quota from standard API.
Batch requests use "enqueued tokens" quota.

## Example: Extract Parties Job

See `src/jobs/configs/extract-parties-EXAMPLE.ts` for a complete example.

This example:
- Fetches decisions from PostgreSQL
- Generates detailed extraction prompt
- Validates output against strict schema
- Extracts party names and citation references

## Development

```bash
# Run in development mode (with auto-reload)
npm run dev <command>

# Build for production
npm run build

# Run production build
npm start <command>

# Type checking
npm run type-check

# Linting
npm run lint
```

## Logging

Logs are written to:
- Console (colored, formatted)
- `logs/combined.log` (all logs)
- `logs/error.log` (errors only)

Log level can be set via `LOG_LEVEL` environment variable:
```bash
LOG_LEVEL=debug npm run dev submit extract-parties
```

## Adding Your 10 Extraction Jobs

Based on your workflow, you'll create configs for:

1. `extract-preprocessing.ts` - Convert HTML to Markdown, detect language, generate SPR
2. `extract-outcome.ts` - Extract decision outcome
3. `extract-parties.ts` - Identify parties and generate citations
4. `extract-content.ts` - Extract facts, requests, arguments, court orders
5. `extract-provisions.ts` - Extract cited legal provisions
6. `extract-decisions.ts` - Extract cited precedents
7. ... (add your remaining extraction types)

Each config is ~50-100 lines. The shared infrastructure handles all the Azure API complexity.

## Support

For issues:
1. Check logs in `logs/` directory
2. Review status file for job state
3. Test connections with `npm run dev test-connections`
4. Verify `.env` configuration

## License

MIT
