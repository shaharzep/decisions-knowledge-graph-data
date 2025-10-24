# Project Memory - Legal Data Extraction System

## Azure OpenAI Configuration

### Current Deployment
- **Model**: `o4-mini`
- **Endpoint**: `https://azure-foundry.cognitiveservices.azure.com/`
- **API Version**: `2025-08-07`
- **API Key**: Configured in `.env`

**IMPORTANT**: Always use `o4-mini` as the deployment name for all job configurations.

## Database Schema

### Critical Join Condition
**Always use**: `decisions1.id = decisions_md.decision_id`

This is the correct join between the main decisions table and the markdown text table.

### Main Tables
- `decisions1` - Main decisions table (id, decision_id, url_official_publication, language_metadata, etc.)
- `decisions_md` - Full text markdown storage (decision_serial, decision_id, full_md)

## Job Configuration Standards

### Current Jobs
1. **extract-keywords** - Keyword generation + taxonomy mapping (complex with GPT-4o pre-filtering)
2. **extract-comprehensive** - All-in-one extraction (parties, citation, facts, requests, arguments, court orders, outcome)

### Standard Configuration
```typescript
{
  deploymentName: 'o4-mini',
  maxTokens: 16000,
  temperature: 0.0,
  rowMetadataFields: ['id', 'decision_id', 'language_metadata']
}
```

### Database Query Pattern
```sql
SELECT
  d.id,
  d.decision_id,
  d.language_metadata,
  dm.full_md
FROM decisions1 d
INNER JOIN decisions_md dm ON d.id = dm.decision_id
WHERE dm.full_md IS NOT NULL AND dm.full_md != ''
LIMIT $1
```

## Important Notes

- **READ-ONLY Database**: All queries must be SELECT only
- **Tested Prompts**: Do NOT modify prompts marked as tested
- **Metadata Tracking**: Always include id, decision_id, language_metadata for result merging
- **Bilingual Support**: Many fields support French (`*Fr`) and Dutch (`*Nl`) variants
