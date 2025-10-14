# Quick Start Guide

## System Successfully Installed! ✅

Your Azure OpenAI Batch API system is ready to use.

## What's Been Built

### Core Infrastructure (Reusable for all 10 jobs)
- ✅ **BatchJobGenerator** - Generates JSONL from database queries
- ✅ **AzureBatchClient** - Handles Azure Batch API interactions
- ✅ **JobStatusTracker** - Manages job status (one JSON per job)
- ✅ **ResultProcessor** - Downloads, validates, and saves results
- ✅ **BatchJobRunner** - Orchestrates complete workflow

### Configuration
- ✅ READ-ONLY PostgreSQL connection (enforced)
- ✅ Azure OpenAI client with Batch API support
- ✅ JSON schema validation
- ✅ Structured logging (Winston)

### CLI
- ✅ Submit jobs
- ✅ Check status
- ✅ Process results
- ✅ List all jobs
- ✅ Test connections

## Next Steps

### 1. Test Connections

```bash
npm run dev test-connections
```

This will verify:
- PostgreSQL database access
- Azure OpenAI credentials

### 2. Create Your First Job Configuration

Copy the example and modify it:

```bash
cp src/jobs/configs/extract-parties-EXAMPLE.ts src/jobs/configs/extract-preprocessing.ts
```

Edit `extract-preprocessing.ts`:

```typescript
import { JobConfig } from '../JobConfig.js';

const config: JobConfig = {
  id: 'extract-preprocessing',

  description: 'Convert HTML to Markdown, detect language, generate SPR',

  // Your database query
  dbQuery: `
    SELECT
      id as decision_id,
      html_content,
      official_url
    FROM decisions
    WHERE status = 'pending'
    LIMIT 10
  `,

  // Your prompt template
  promptTemplate: (row) => {
    return `# MISSION
You are a legal document preprocessor...

# INPUT
- Decision ID: ${row.decision_id}
- HTML Content: ${row.html_content}
- Official URL: ${row.official_url}

# TASK
Convert HTML to Markdown, detect language, generate SPR...

# OUTPUT
Return JSON with: { fullText: { markdown: "...", SPR: "..." }, language: { proceduralLanguage: "FR|NL|BILINGUAL" } }`;
  },

  // Your output schema
  outputSchema: {
    type: 'object',
    required: ['fullText', 'language'],
    properties: {
      fullText: {
        type: 'object',
        properties: {
          markdown: { type: 'string' },
          SPR: { type: 'string' }
        }
      },
      language: {
        type: 'object',
        properties: {
          proceduralLanguage: {
            type: 'string',
            enum: ['FR', 'NL', 'BILINGUAL']
          }
        }
      }
    }
  },

  deploymentName: 'gpt-4o-2',
  maxTokens: 4000,
  temperature: 0.0
};

export default config;
```

### 3. Submit Your First Job

```bash
npm run dev submit extract-preprocessing
```

This will:
1. Execute your database query
2. Generate prompts for each row
3. Create JSONL file
4. Upload to Azure
5. Submit batch job
6. Save status to `status/extract-preprocessing.json`

### 4. Monitor Progress

```bash
npm run dev status extract-preprocessing
```

Azure will process your batch within 24 hours.

### 5. Process Results (When Complete)

```bash
npm run dev process extract-preprocessing
```

Results will be saved to:
- `results/extract-preprocessing/<timestamp>/extracted-data.json` - Your extracted data
- `results/extract-preprocessing/<timestamp>/successful-results.json` - With metadata
- `results/extract-preprocessing/<timestamp>/failures.json` - Any errors

## Creating All 10 Jobs

Based on your workflow, create configs for:

1. **extract-preprocessing.ts** - HTML → Markdown, language detection, SPR
2. **extract-outcome.ts** - Decision outcome classification
3. **extract-parties.ts** - Party identification & citations *(example provided)*
4. **extract-content.ts** - Facts, requests, arguments, court orders
5. **extract-provisions.ts** - Legal provisions cited
6. **extract-decisions.ts** - Precedents cited
7. **extract-<additional>.ts** - Your remaining extraction types

Each config is ~50-100 lines. The infrastructure handles everything else!

## Common Workflows

### Submit Multiple Jobs in Sequence

```bash
npm run dev submit extract-preprocessing
npm run dev submit extract-outcome
npm run dev submit extract-parties
# ... etc
```

Each job runs independently. Status tracked separately.

### Check All Jobs

```bash
npm run dev list
```

Shows status of all jobs at a glance.

### Wait for Completion

```bash
npm run dev submit extract-parties --wait
```

Submits and polls until complete (may take hours).

## File Locations

```
input/           - Generated JSONL for Azure
output/          - Downloaded JSONL from Azure
results/         - Processed & validated results
  └── <job-type>/
      └── <timestamp>/
          ├── extracted-data.json     ⭐ Most useful
          ├── successful-results.json
          ├── failures.json
          └── summary.json
status/          - Job metadata
  ├── extract-preprocessing.json
  ├── extract-outcome.json
  └── ...
logs/            - Application logs
```

## Important Reminders

### Database Security
- System enforces READ-ONLY access
- Only SELECT queries allowed
- Attempts to write will throw errors

### Azure Limits
- Max file size: 200 MB
- Processing window: 24 hours
- Batch API = 50% cost savings

### Status Files
- One JSON per job type
- Tracks full job history
- Persists across runs
- Safe to commit to git (no secrets)

## Debugging

### View Logs
```bash
tail -f logs/combined.log
```

### Check Job Status File
```bash
cat status/extract-parties.json | jq
```

### Test Database Query
```bash
npm run dev test-connections
```

### Validate Job Config
TypeScript will catch errors when you run:
```bash
npm run build
```

## Cost Estimation

Before submitting, the system shows estimated cost:

```
Cost estimate:
  Records: 150
  Estimated prompt tokens: 245,000
  Estimated cost: $0.31 USD
```

Batch API = 50% off standard pricing!

## Support

- 📖 Full documentation: `README.md`
- 🔧 Example config: `src/jobs/configs/extract-parties-EXAMPLE.ts`
- 📝 Logs: `logs/combined.log`
- ❓ Help: `npm run dev help`

## You're Ready! 🚀

Start creating your job configurations and extracting data from your Belgian legal case laws.

The infrastructure is solid, tested, and ready for production use.
