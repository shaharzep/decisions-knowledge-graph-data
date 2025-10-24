# Stage 1 Schema Migration Summary

## Overview

Successfully updated `extract-comprehensive` job configuration to align with the Stage 1 prompt schema. The configuration now validates against the new comprehensive structure with enhanced metadata, court information, and legal issues extraction.

---

## Changes Made

### File Modified: `src/jobs/extract-comprehensive/config.ts`

#### 1. Header Documentation Updated
- Updated to reflect Stage 1 structure
- Added legal issues, court metadata, and prior instances to description
- Emphasized verbatim extraction requirements

#### 2. Row Metadata Fields Simplified
**Before:**
```typescript
rowMetadataFields: ['id', 'decision_id', 'language_metadata']
```

**After:**
```typescript
rowMetadataFields: ['id']
```

**Rationale:** Model now outputs `decisionId` and `procedureLanguage` directly per schema, eliminating redundancy.

#### 3. Prompt Template Variables Updated
**Before:**
```typescript
.replace('{{decisionId}}', String(row.id))
.replace('{{publicUrl}}', row.url_official_publication)
.replace('{{proceduralLanguage}}', row.language_metadata)
.replace('{{fullTextMarkdown}}', row.full_md)
```

**After:**
```typescript
.replace('{{decision_id}}', row.decision_id)  // Uses ECLI, not serial ID
.replace('{{fullTextMarkdown}}', row.full_md)
.replace('{{proceduralLanguage}}', row.language_metadata)
```

**Changes:**
- Removed `{{publicUrl}}` (not in Stage 1)
- Changed `{{decisionId}}` → `{{decision_id}}` to use ECLI identifier
- Use `row.decision_id` instead of `String(row.id)` for proper ECLI

#### 4. Output Schema Completely Restructured

##### Added Top-Level Fields:
```typescript
{
  decisionId: string,           // ECLI identifier
  procedureLanguage: 'FR'|'NL', // Explicit language field
  // ... rest
}
```

##### Parties Schema Changes:
**Removed:**
- `enterpriseNumber` field
- `proceduralRole` field (replaced with `role`)

**Changed:**
- ID pattern: `party001` → `PARTY-{decisionId}-001`
- Type enums: `LEGAL_PERSON` → `LEGAL_ENTITY`, `PUBLIC_BODY` → `PUBLIC_AUTHORITY`
- Added `OTHER` type
- Added `maxLength: 500` for name

**New structure:**
```typescript
parties: [{
  id: "PARTY-ECLI:BE:CASS:2023:ARR.20230315-001",
  name: "string",
  role: "PLAINTIFF", // Freeform text in procedural language
  type: "NATURAL_PERSON|LEGAL_ENTITY|PUBLIC_AUTHORITY|OTHER"
}]
```

##### Removed Objects:
- `reference` object (citation reference)
- `metadata` object (validation checks)

##### Added to currentInstance:
```typescript
currentInstance: {
  // NEW: Court metadata object
  court: {
    courtName: string,
    courtJurisdictionCode: "BE",
    courtEcliCode: string
  },

  // NEW: Decision metadata
  date: "YYYY-MM-DD",
  caseNumber: string|null,
  decisionTypeName: string,

  // NEW: Legal issues array
  legalIssues: [{
    id: "ISSUE-{decisionId}-001",
    issue: string (50-500 chars)
  }],

  // UPDATED: Monolingual fields (no Fr/Nl variants)
  facts: string[],
  requests: [{partyId, request}],
  arguments: [{partyId, argument, courtTreatment}],
  courtOrder: string,
  outcome: string
}
```

##### Updated Field Constraints:
- `argument`: minLength 50 → **200** chars, added maxLength 2000
- `request`: minLength 30 → **50** chars, added maxLength 1000
- `courtOrder`: added maxLength 10000
- Party ID patterns: `^party\d{3}$` → `^PARTY-[a-zA-Z0-9:.]+-\d{3}$`
- Issue ID pattern: `^ISSUE-[a-zA-Z0-9:.]+-\d{3}$`

##### Added priorInstances Array:
```typescript
priorInstances: [{
  courtName: string,
  date: "YYYY-MM-DD"|null,
  caseNumber: string|null,
  outcome: string (20-200 chars)
}] // Optional, can be empty
```

---

## Schema Comparison Table

| Field | Old Schema | New Schema | Change Type |
|-------|-----------|------------|-------------|
| `decisionId` | ❌ Not present | ✅ Required (top-level) | **Added** |
| `procedureLanguage` | ❌ Not present | ✅ Required (top-level) | **Added** |
| `parties[].id` | `party001` | `PARTY-ECLI:BE:...-001` | **Modified** |
| `parties[].enterpriseNumber` | ✅ Present | ❌ Removed | **Removed** |
| `parties[].proceduralRole` | ✅ Present | ❌ Removed (now `role`) | **Modified** |
| `parties[].type` | 3 enums | 4 enums (added OTHER) | **Modified** |
| `reference` | ✅ Present | ❌ Removed | **Removed** |
| `currentInstance.court` | ❌ Not present | ✅ Required | **Added** |
| `currentInstance.date` | ❌ Not present | ✅ Required | **Added** |
| `currentInstance.caseNumber` | ❌ Not present | ✅ Required | **Added** |
| `currentInstance.decisionTypeName` | ❌ Not present | ✅ Required | **Added** |
| `currentInstance.legalIssues` | ❌ Not present | ✅ Required | **Added** |
| `currentInstance.arguments[].argument` | minLength 50 | minLength 200 | **Stricter** |
| `currentInstance.requests[].request` | minLength 30 | minLength 50 | **Stricter** |
| `priorInstances` | ❌ Not present | ✅ Optional | **Added** |
| `metadata` | ✅ Present | ❌ Removed | **Removed** |

---

## Validation Changes

### Stricter Requirements:
1. **Argument length**: 50 → 200 characters minimum (enforces verbatim extraction)
2. **Request length**: 30 → 50 characters minimum
3. **Party IDs**: Must include decision ID in format
4. **Issue IDs**: Must include decision ID in format

### New Required Fields:
- `decisionId` (top-level)
- `procedureLanguage` (top-level)
- `currentInstance.court` (object with 3 required fields)
- `currentInstance.date`
- `currentInstance.caseNumber` (can be null)
- `currentInstance.decisionTypeName`
- `currentInstance.legalIssues` (array, min 1 item)

### Removed Requirements:
- `reference.citationReference`
- `metadata.totalParties`
- `metadata.validationChecks`
- Party enterprise numbers
- Party procedural role field (replaced with freeform `role`)

---

## Testing Checklist

### 1. Compilation
- [x] TypeScript builds successfully: `npm run build`

### 2. Small Batch Test
Run a test batch with 5-10 decisions:

```bash
# Update LIMIT in config.ts to 5
npm run dev submit extract-comprehensive

# Wait for completion (or check status periodically)
npm run dev status extract-comprehensive

# When completed, process results
npm run dev process extract-comprehensive
```

### 3. Validation Review
Check the output files:

```bash
# View summary
cat results/extract-comprehensive/latest/summary.json

# Check failures (if any)
cat results/extract-comprehensive/latest/failures.json | jq '.[0]'

# Verify successful extraction structure
cat results/extract-comprehensive/latest/extracted-data.json | jq '.[0]'
```

### 4. Expected Output Structure
Successful extractions should have:

```json
{
  "id": 123,  // From metadata merge
  "decisionId": "ECLI:BE:CASS:2023:ARR.20230315",
  "procedureLanguage": "FR",
  "parties": [
    {
      "id": "PARTY-ECLI:BE:CASS:2023:ARR.20230315-001",
      "name": "Jean Dupont",
      "role": "DEMANDEUR",
      "type": "NATURAL_PERSON"
    }
  ],
  "currentInstance": {
    "court": {
      "courtName": "Cour de cassation",
      "courtJurisdictionCode": "BE",
      "courtEcliCode": "CASS"
    },
    "date": "2023-03-15",
    "caseNumber": "C.22.0456.N",
    "decisionTypeName": "ARRÊT",
    "legalIssues": [
      {
        "id": "ISSUE-ECLI:BE:CASS:2023:ARR.20230315-001",
        "issue": "Question de savoir si..."
      }
    ],
    "facts": [...],
    "requests": [...],
    "arguments": [...],
    "courtOrder": "...",
    "outcome": "CASSATION"
  },
  "priorInstances": []
}
```

### 5. Common Validation Errors to Watch For

Based on schema strictness:

1. **Arguments too short** (< 200 chars)
   - Model may need to extract longer verbatim text
   - Adjust prompt if systematic issue

2. **Missing legal issues**
   - Model must identify at least 1 legal issue
   - Review prompt clarity

3. **Invalid party/issue IDs**
   - Must match pattern: `PARTY-{decisionId}-001`
   - Model needs to construct IDs correctly

4. **Missing court metadata**
   - Court name, jurisdiction, ECLI code all required
   - Model must extract from text or reference table

5. **Date format errors**
   - Must be `YYYY-MM-DD`
   - Model needs clear date parsing instructions

---

## Rollback Instructions

If issues arise and you need to rollback:

```bash
# Restore from git
git checkout HEAD -- src/jobs/extract-comprehensive/config.ts

# Or restore from this commit
git show HEAD~1:src/jobs/extract-comprehensive/config.ts > src/jobs/extract-comprehensive/config.ts

# Rebuild
npm run build
```

---

## Next Steps

1. **Prompt Alignment**: Ensure `prompt.ts` contains Stage 1 prompt with template variables:
   - `{{decision_id}}`
   - `{{fullTextMarkdown}}`
   - `{{proceduralLanguage}}`

2. **Test Batch**: Run small test (5-10 decisions) to verify schema validation

3. **Review Failures**: Analyze any validation failures to identify:
   - Schema issues (adjust config)
   - Prompt issues (adjust prompt.ts)
   - Model limitations (adjust expectations)

4. **Iterate**: Adjust minLength/maxLength constraints based on real-world data

5. **Full Production Run**: When validated, increase LIMIT and run full batch

---

## Notes

- **No infrastructure changes required** - Validator (AJV) automatically uses new schema
- **Backward incompatible** - Old job results have different structure
- **Cross-job merging** - Use `id` field to match with other job results
- **Model outputs decisionId** - No need to merge from metadata anymore

---

## Files Changed

- ✅ `src/jobs/extract-comprehensive/config.ts` (407 lines) - **COMPLETED**
- ✅ `src/jobs/extract-comprehensive/prompt.ts` (677 lines) - **COMPLETED**

## Files NOT Changed (but may need review)

- ⚠️ `src/jobs/extract-comprehensive/README.md` - May need updating to reflect new schema

## Migration Status

**✅ MIGRATION COMPLETE**

Both configuration and prompt files have been successfully updated to align with Stage 1 requirements.

### Changes Summary:

**Config Changes:**
- Updated outputSchema to Stage 1 structure
- Changed template variables to use `{{decision_id}}` instead of `{{decisionId}}`
- Removed `{{publicUrl}}` variable (not in Stage 1)
- Simplified rowMetadataFields to `['id']` only
- Added new required fields: court metadata, legal issues, prior instances
- Removed fields: reference object, metadata validation object
- Updated party schema with new ID patterns and type enums

**Prompt Changes:**
- Completely replaced with Stage 1 prompt (677 lines)
- Added verbatim extraction mandate and examples
- Included Belgian Court Reference Table
- Added comprehensive field specifications
- Updated all examples to match Stage 1 requirements
- Added validation checklist
