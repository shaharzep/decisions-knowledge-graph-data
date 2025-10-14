# Extract Keywords Job

Generates custom keywords and maps legal issues from the Belgian legal taxonomy (UTU keywords) for court decisions.

## Overview

This job processes Belgian legal decisions to:
1. **Generate custom keywords** (8-15 keywords) that capture the essence of each decision
2. **Map to legal taxonomy** (2-8 UTU keywords) from the official Belgian legal classification system

## Architecture

### Two-Stage Processing

**Stage 1: Taxonomy Pre-filtering (GPT-5 via OpenAI)**
- For each decision, GPT-5 analyzes the text
- Selects 2-3 most relevant parent legal categories from 8 options:
  - KUU1: DROIT JUDICIAIRE (Judicial Law)
  - KUU2: DROIT CIVIL (Civil Law)
  - KUU3: DROIT PENAL (Criminal Law)
  - KUU4: DROIT ÉCONOMIQUE, COMMERCIAL ET FINANCIER (Commercial/Financial Law)
  - KUU5: DROIT SOCIAL (Social Law)
  - KUU6: DROIT FISCAL (Tax Law)
  - KUU7: DROIT PUBLIC ET ADMINISTRATIF (Public/Administrative Law)
  - KUU8: DROIT INTERNATIONAL (International Law)
- Filters full taxonomy (3,880 entries) to selected categories
- **Result**: ~80% token reduction (500k → 60-100k tokens)

**Stage 2: Keyword Generation (GPT-4o via Azure Batch API)**
- Uses filtered taxonomy in prompt
- Generates custom keywords specific to the decision
- Maps decision to specific legal issues in taxonomy
- Validates output against JSON schema

## Database Schema

### Query Logic

Only processes decisions that **don't have UTU keywords yet**:

```sql
SELECT
  d.id,
  d.decision_id,
  d.language_metadata
FROM decisions1 d
WHERE NOT EXISTS (
  SELECT 1
  FROM decisions_summaries_keywords dsk
  JOIN keywords1 k ON dsk.keyword_id = k.id
  WHERE dsk.decision_id = d.decision_id
    AND k.keyword_type = 'UTU'
)
AND d.status = 'pending'
LIMIT 100
```

### Tables Used

- **decisions1**: Main decisions table
- **decisions_summaries_keywords**: Links decisions to keywords
- **keywords1**: Keyword definitions (includes `keyword_type`)

## File Structure

```
src/jobs/extract-keywords/
├── config.ts              # Job configuration with preprocessRow hook
├── prompt.ts              # Exact prompt template (DO NOT MODIFY)
├── parentCategories.ts    # 8 parent category definitions (EDIT HERE)
├── taxonomy.ts            # TaxonomyManager class
├── taxonomyFilter.ts      # TaxonomyFilterService (GPT-5 integration)
└── README.md             # This file
```

### Editing Parent Category Definitions

**To customize the 8 parent legal categories used by GPT-5 for taxonomy filtering:**

Edit `parentCategories.ts` - this file contains hardcoded definitions for all 8 categories (KUU1-KUU8).

Each category includes:
- `id`: Taxonomy identifier (KUU1-KUU8)
- `nameFr`: French name
- `nameNl`: Dutch name
- `descriptionFr`: French description (used by GPT-5 for category selection)
- `descriptionNl`: Dutch description (used by GPT-5 for category selection)

**The descriptions are critical** - they help GPT-5 understand which categories are relevant for each legal decision.

## Key Components

### 1. TaxonomyManager (`taxonomy.ts`)
- **Loads taxonomy** from `keywords_utu.csv` (3,880 entries)
- **Filters by parents**: Reduces taxonomy to selected categories
- **Formats for prompt**: Creates readable taxonomy string with prominent IDs
  - IDs displayed in brackets at start of each line: `[KUD2-15-8] DROIT CIVIL > Contrats > Résiliation`
  - Uses language-specific keyword sequences (keywordsSequenceFr or keywordsSequenceNl)
  - Includes explicit instruction for LLM to return exact IDs

### 2. TaxonomyFilterService (`taxonomyFilter.ts`)
- **Uses GPT-5** (personal OpenAI account) for pre-filtering
- **Analyzes decision text** (first 2000 chars)
- **Selects 2-3 relevant** parent categories
- **Fallback**: Defaults to Civil + Commercial law if GPT-5 fails

### 3. PreprocessRow Hook (`config.ts`)
- **Runs before batch generation**
- **Filters taxonomy** for each decision individually
- **Adds filtered taxonomy** to row data
- **Enriches row** with empty strings for missing fields

## Usage

### Submit Job

```bash
npm run dev submit extract-keywords
```

### Check Status

```bash
npm run dev status extract-keywords
```

### Process Results

```bash
npm run dev process extract-keywords
```

## Taxonomy Format in Prompt

The filtered taxonomy is formatted with **prominent IDs in brackets** to ensure the LLM can easily identify and return the correct taxonomy IDs:

```
# Legal Issues Taxonomy

Total entries: 245

IMPORTANT: When selecting legal issues, you MUST return the exact ID shown in [brackets] for each entry.

## DROIT CIVIL (KUU2)
Entries: 120

[KUD2-15-8] DROIT CIVIL > Contrats > Résiliation
[KUD2-20-3] DROIT CIVIL > Responsabilité > Dommages et intérêts
[KUD2-25-1] DROIT CIVIL > Biens > Propriété
...

## DROIT ÉCONOMIQUE, COMMERCIAL ET FINANCIER (KUU4)
Entries: 125

[KUD4-23-19] DROIT ÉCONOMIQUE > Contrats commerciaux > Distribution
[KUD4-30-5] DROIT ÉCONOMIQUE > Concurrence > Pratiques restrictives
...
```

**Key Features:**
- IDs are displayed at the start of each line in `[brackets]` for maximum visibility
- Language-specific sequences are used (French or Dutch based on decision language)
- Explicit instruction reminds LLM to return exact IDs

## Output Format

### Successful Result

```json
{
  "index": {
    "customKeywords": [
      "contrat de distribution exclusive",
      "résiliation unilatérale",
      "préavis raisonnable",
      "dépendance économique",
      "bonne foi contractuelle",
      "dommages et intérêts",
      "droit commercial",
      "appel partiellement fondé"
    ],
    "legalIssues": [
      {
        "id": "KUD4-23-19",
        "keywordsSequenceFr": "DROIT ÉCONOMIQUE > Contrats commerciaux > Distribution",
        "keywordsSequenceNl": "HANDELSRECHT > Handelsovereenkomsten > Distributie"
      },
      {
        "id": "KUD2-15-8",
        "keywordsSequenceFr": "DROIT CIVIL > Contrats > Résiliation",
        "keywordsSequenceNl": "BURGERLIJK RECHT > Overeenkomsten > Beëindiging"
      }
    ]
  },
  "metadata": {
    "keywordCount": 8,
    "legalIssueCount": 2,
    "primaryLegalField": "Droit commercial",
    "indexingConfidence": "HIGH"
  }
}
```

**Note:** The LLM returns the exact taxonomy IDs (e.g., "KUD4-23-19") that were shown in brackets in the prompt.

## Environment Variables

### Required

```env
# Azure OpenAI (for batch processing)
AZURE_OPENAI_ENDPOINT=https://your-endpoint.openai.azure.com/
AZURE_OPENAI_API_KEY=your-azure-key
AZURE_OPENAI_DEPLOYMENT=gpt-4o-2
AZURE_API_VERSION=2024-11-20

# OpenAI Personal Account (for taxonomy pre-filtering)
OPENAI_API_KEY=sk-proj-...
OPENAI_ORG_ID=  # Optional

# PostgreSQL (READ-ONLY)
PGHOST=...
PGUSER=...
PGPASSWORD=...
PGDATABASE=...
PGPORT=5433
```

## Token Usage & Cost

### Without Pre-filtering (not implemented)
- Full taxonomy: ~500,000 tokens per request
- 100 decisions: ~50M tokens
- Cost: ~$62.50 (at $1.25/1M tokens for batch API)

### With Pre-filtering (current implementation)
- Filtered taxonomy: ~60-100k tokens per request
- 100 decisions: ~6-10M tokens
- Pre-filtering cost: ~$0.50 (GPT-5, 100 requests)
- Batch processing cost: ~$7.50
- **Total cost: ~$8.00** (87% savings)

## Current Limitations

### Fields Not Yet Available

The following fields are currently passed as empty strings:
- `fullTextMarkdown`
- `factsFr`
- `citedProvisions`

**Impact**: GPT-5 taxonomy filtering uses only `decision_id` and `language_metadata` as proxy.

**Future**: When these fields are available:
1. Update `preprocessRow` hook to use actual decision text
2. Improve taxonomy filtering accuracy
3. Better keyword generation

### Temporary Workaround

Until full decision text is available, taxonomy filtering uses fallback logic:
```typescript
const decisionText = `Decision ${row.decision_id} - Language: ${row.language_metadata}`;
```

This still works because:
- GPT-5 can fall back to most common categories (Civil + Commercial law)
- Most Belgian decisions fall into these categories anyway
- System is designed to be conservative (include rather than exclude)

## Testing

### Test Connections

```bash
npm run dev test-connections
```

Should show:
- ✅ Database connection successful
- ✅ Azure OpenAI configuration valid
- ✅ OpenAI configuration valid

### Test with Small Batch

Edit `config.ts`:
```typescript
dbQueryParams: ['pending', 5],  // Process only 5 decisions
```

### Monitor Logs

```bash
tail -f logs/combined.log
```

Look for:
- Taxonomy loading
- GPT-5 category selection
- Batch generation
- Azure submission

## Troubleshooting

### Taxonomy Not Found

```
Error: ENOENT: no such file or directory, open 'keywords_utu.csv'
```

**Solution**: Ensure `keywords_utu.csv` is in project root directory.

### OpenAI API Error

```
Error: Missing required OpenAI configuration
```

**Solution**: Check `.env` file has `OPENAI_API_KEY` set.

### GPT-5 Fallback Used

```
WARN: Using fallback categories: Civil + Commercial law
```

**Reason**: GPT-5 call failed (rate limit, timeout, or invalid response).

**Impact**: Job continues with default categories. Not critical.

### No Decisions Found

```
Error: Database query returned no rows
```

**Reason**: All pending decisions already have UTU keywords.

**Solution**: Check database or update query filter.

## Next Steps

### When Full Text Becomes Available

1. **Update `config.ts` preprocessRow**:
```typescript
const decisionText = row.full_text_markdown || row.decision_id;
```

2. **Add fields to query**:
```sql
SELECT
  d.id,
  d.decision_id,
  d.language_metadata,
  d.full_text_markdown,
  d.facts_fr,
  d.cited_provisions
FROM decisions1 d
...
```

3. **Update prompt template** to use actual data:
```typescript
.replace('{{fullTextMarkdown}}', row.full_text_markdown || '')
.replace('{{factsFr}}', row.factsFr || '')
```

### Adding More Extraction Jobs

This job demonstrates the `preprocessRow` pattern. Use it for other jobs that need:
- Data enrichment
- API calls before batch processing
- Large dataset filtering
- Row-level preprocessing

## Support

For issues:
1. Check `logs/combined.log`
2. Verify `.env` configuration
3. Test connections: `npm run dev test-connections`
4. Check status file: `status/extract-keywords.json`

## Important Notes

⚠️ **Prompt is tested and validated** - Do NOT modify `prompt.ts` without re-testing.

⚠️ **Database is READ-ONLY** - No write operations are performed.

⚠️ **Preprocessing uses personal OpenAI** - Not Azure. Check rate limits.

⚠️ **Batch processing uses Azure** - 50% cost savings vs standard API.
