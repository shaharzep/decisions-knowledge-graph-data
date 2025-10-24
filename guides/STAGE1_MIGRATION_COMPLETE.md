# ✅ Stage 1 Migration Complete

**Date:** 2025-10-18  
**Status:** SUCCESSFULLY COMPLETED

---

## Summary

The `extract-comprehensive` job has been successfully migrated to align with the Stage 1 prompt and schema requirements. Both configuration and prompt files have been updated and verified.

## Files Modified

### 1. `src/jobs/extract-comprehensive/config.ts` (407 lines)

**Key changes:**
- ✅ Updated `outputSchema` to Stage 1 structure
- ✅ Changed template variables to `{{decision_id}}`, `{{fullTextMarkdown}}`, `{{proceduralLanguage}}`
- ✅ Removed `{{publicUrl}}` variable
- ✅ Simplified `rowMetadataFields` to `['id']` only
- ✅ Added new required fields: `decisionId`, `procedureLanguage`, `court`, `date`, `caseNumber`, `decisionTypeName`, `legalIssues`, `priorInstances`
- ✅ Removed fields: `reference`, `metadata`, `enterpriseNumber`
- ✅ Updated party ID pattern: `party001` → `PARTY-{decisionId}-001`
- ✅ Updated party type enums: `LEGAL_PERSON` → `LEGAL_ENTITY`, `PUBLIC_BODY` → `PUBLIC_AUTHORITY`, added `OTHER`
- ✅ Increased argument minLength: 50 → 200 characters
- ✅ Increased request minLength: 30 → 50 characters

### 2. `src/jobs/extract-comprehensive/prompt.ts` (677 lines)

**Completely replaced with Stage 1 prompt:**
- ✅ Added verbatim extraction mandate with examples
- ✅ Included Belgian Court Reference Table (12 courts)
- ✅ Added comprehensive field specifications for all fields
- ✅ Updated all examples to match Stage 1 requirements
- ✅ Added validation checklist (language consistency, text quality, references, completeness)
- ✅ Template variables aligned: `{{decision_id}}`, `{{fullTextMarkdown}}`, `{{proceduralLanguage}}`

---

## Verification

### TypeScript Compilation
```bash
npm run build
```
**Result:** ✅ SUCCESS (No errors)

### File Integrity
- Config file: 407 lines, valid TypeScript
- Prompt file: 677 lines, properly closed template string

---

## Next Steps

### 1. Test with Small Batch (RECOMMENDED)

```bash
# Update config to test with 5 decisions
# Edit src/jobs/extract-comprehensive/config.ts line 62
dbQueryParams: [5],  # Change from [100] to [5]

# Rebuild
npm run build

# Submit test batch
npm run dev submit extract-comprehensive --wait

# Review results
cat results/extract-comprehensive/latest/summary.json
cat results/extract-comprehensive/latest/failures.json | jq '.[0]'
```

### 2. Review Expected Output Structure

Successful extractions should have this structure:

```json
{
  "id": 123,
  "decisionId": "ECLI:BE:CASS:2023:ARR.20230315",
  "procedureLanguage": "FR",
  "parties": [
    {
      "id": "PARTY-ECLI:BE:CASS:2023:ARR.20230315-001",
      "name": "Jean Dupont",
      "role": "PLAINTIFF",
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
        "issue": "La validité du licenciement..."
      }
    ],
    "facts": ["Verbatim fact 1...", "Verbatim fact 2..."],
    "requests": [
      {
        "partyId": "PARTY-ECLI:BE:CASS:2023:ARR.20230315-001",
        "request": "Verbatim request..."
      }
    ],
    "arguments": [
      {
        "partyId": "PARTY-ECLI:BE:CASS:2023:ARR.20230315-001",
        "argument": "Verbatim argument (200+ chars)...",
        "courtTreatment": "ACCEPTE"
      }
    ],
    "courtOrder": "PAR CES MOTIFS, LA COUR...",
    "outcome": "CASSATION"
  },
  "priorInstances": []
}
```

### 3. Common Validation Errors to Watch For

Based on strictness of Stage 1 schema:

1. **Arguments too short** (< 200 chars)
   - Model may need to extract longer verbatim text
   - Adjust schema if systematic issue

2. **Missing legal issues**
   - Model must identify at least 1 legal issue per decision

3. **Invalid party/issue IDs**
   - Must match pattern: `PARTY-{decisionId}-001`
   - Model needs to construct IDs correctly

4. **Missing court metadata**
   - Court name, jurisdiction code, ECLI code all required

5. **Date format errors**
   - Must be `YYYY-MM-DD`

### 4. If Issues Arise

**Schema too strict:**
```typescript
// In config.ts, adjust minLength values
argument: { minLength: 150 }  // From 200
request: { minLength: 40 }     // From 50
```

**Prompt unclear:**
- Review prompt.ts examples
- Add more examples for problematic fields

**Model performance:**
- Check token usage in summary.json
- Review failures.json for patterns

---

## Rollback Instructions

If you need to rollback:

```bash
# Restore both files from git
git checkout HEAD -- src/jobs/extract-comprehensive/config.ts
git checkout HEAD -- src/jobs/extract-comprehensive/prompt.ts

# Rebuild
npm run build
```

---

## Documentation

- Migration details: `STAGE1_MIGRATION_SUMMARY.md`
- Original Stage 1 prompt: `prompts-txts/Stage 1.txt`
- Job configuration: `src/jobs/extract-comprehensive/config.ts`
- Prompt template: `src/jobs/extract-comprehensive/prompt.ts`

---

## Success Criteria

Migration is successful if:

- ✅ TypeScript compilation succeeds
- ✅ Test batch (5-10 decisions) processes without errors
- ✅ Success rate ≥ 60% on test batch
- ✅ Extracted data matches Stage 1 schema
- ✅ Verbatim extraction quality is good

---

**Migration completed by:** Claude Code  
**Verification:** Build successful, no TypeScript errors  
**Ready for:** Testing with small batch
