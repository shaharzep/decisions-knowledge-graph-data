# Prompt Migration Complete ✅

**Updated:** 2025-10-23
**Source Prompt:** `/Users/shaharzep/knowledge-graph/prompts-txts/P1_STAGE 1 (1).md`

---

## ✅ WHAT WAS CHANGED

### 1. Prompt File (`src/jobs/extract-comprehensive/prompt.ts`)
- **Replaced entire prompt** with new version from `P1_STAGE 1 (1).md`
- **Updated template variables:**
  - `{{decision_id}}` → `{decisionId}`
  - `{{fullTextMarkdown}}` → `{fullText.markdown}`
  - `{{proceduralLanguage}}` → `{proceduralLanguage}`

### 2. Output Schema (`src/jobs/extract-comprehensive/config.ts`)

#### **Removed Fields** (now added via metadata):
- `decisionId` - removed from model output schema
- `proceduralLanguage` - removed from model output schema

**Why removed:** These are provided as INPUT to the model and added to final results via `rowMetadataFields`. The model doesn't need to echo them back.

#### **Schema Structure Changes:**

**OLD:**
```json
{
  "decisionId": "...",
  "proceduralLanguage": "...",
  "reference": {...},
  "parties": [...],
  "facts": [...],              // array
  "requests": [...],
  "arguments": [...],
  "courtOrder": "...",
  "outcome": "..."
}
```

**NEW:**
```json
{
  "reference": {...},
  "parties": [...],
  "currentInstance": {
    "facts": "...",            // single string
    "requests": [...],
    "arguments": [...],
    "courtOrder": "...",
    "outcome": "..."
  }
}
```

#### **Field-Level Changes:**

1. **`facts`**: `array of strings` → `single string`
   - Old: `["fact 1", "fact 2"]`
   - New: `"fact 1. fact 2."`
   - Synthesis allowed (consolidate scattered facts)

2. **`requests[].request`** → **`requests[].requests`**
   - Field name changed from singular to plural
   - Old: `{ "partyId": "...", "request": "..." }`
   - New: `{ "partyId": "...", "requests": "..." }`

3. **`parties[].role`** → **`parties[].proceduralRole`**
   - Field name changed for clarity
   - Old: `{ "id": "...", "name": "...", "role": "...", "type": "..." }`
   - New: `{ "id": "...", "name": "...", "proceduralRole": "...", "type": "..." }`

4. **Party Role Enum Value:**
   - French: `DEFENDANT` → `DEFENDEUR`
   - No longer using English term for French role

5. **Nesting:**
   - `facts`, `requests`, `arguments`, `courtOrder`, `outcome` now nested under `currentInstance`

---

## 📋 EXTRACTION PHILOSOPHY CHANGE

### OLD: Strict Verbatim Mandate
- ALL fields required verbatim extraction (exact text copy)
- NO paraphrasing or synthesis allowed
- Applied to: facts, requests, arguments, courtOrder

### NEW: Flexible Extraction
- **Verbatim when practical**: Copy exact text when clear and extractable
- **Synthesis when necessary**: Consolidate scattered/verbose content
- **courtOrder exception**: STILL requires verbatim (no changes allowed)

**What this means:**
- **Facts**: Can synthesize scattered facts into coherent narrative
- **Requests**: Can consolidate verbose formulations
- **Arguments**: Can consolidate multi-paragraph arguments
- **courtOrder**: MUST remain word-for-word exact

---

## 🔄 HOW METADATA MERGING WORKS

Even though `decisionId` and `proceduralLanguage` are removed from the output schema, they STILL appear in final results via **metadata merging**.

### Flow:

1. **Input to Model** (`ConcurrentRunner.ts:187-192`):
   ```typescript
   const prompt = this.config.promptTemplate(row);
   // Substitutes:
   // - {decisionId} = row.decision_id
   // - {proceduralLanguage} = row.language_metadata
   ```

2. **Model Output** (validated against new schema):
   ```json
   {
     "reference": {...},
     "parties": [...],
     "currentInstance": {...}
   }
   ```

3. **Metadata Extraction** (`ConcurrentRunner.ts:236-243`):
   ```typescript
   if (this.config.rowMetadataFields) {
     metadata = {};
     for (const fieldName of this.config.rowMetadataFields) {
       const outputFieldName = fieldName === 'language_metadata' ? 'language' : fieldName;
       metadata[outputFieldName] = row[fieldName];
     }
   }
   ```

4. **Final Merge** (`ConcurrentProcessor.ts:104-109`):
   ```typescript
   finalData = {
     ...result.metadata,  // Includes: id, decision_id, language, court_ecli_code, etc.
     ...result.data,      // Model output: reference, parties, currentInstance
   }
   ```

### Final Output Structure:
```json
{
  "id": 12345,
  "decision_id": "ECLI:BE:CASS:2023:ARR.20230315.1F.9",
  "language": "FR",
  "court_ecli_code": "CASS",
  "decision_date": "2023-03-15",
  "length_category": "long",
  "reference": {...},
  "parties": [...],
  "currentInstance": {
    "facts": "...",
    "requests": [...],
    "arguments": [...],
    "courtOrder": "...",
    "outcome": "..."
  }
}
```

**Key Point:** Metadata fields are **added at top level** alongside model output, so all downstream code can still access `decision_id` and `language` as before!

---

## ✅ VERIFIED WORKING

- ✅ **TypeScript Build**: Compiles with no errors (`npm run build`)
- ✅ **Template Variables**: Updated to new syntax
- ✅ **Schema Structure**: Matches new prompt expectations
- ✅ **Metadata Fields**: Configured to include `decision_id` and `language_metadata`
- ✅ **Enum Values**: Updated `DEFENDANT` → `DEFENDEUR`

---

## 🧪 RECOMMENDED TESTING

### 1. Quick Smoke Test (1 decision)
```bash
npm run build
npm run dev concurrent extract-comprehensive
# Edit dbQuery to add: LIMIT 1
```

**Check output:**
- File: `concurrent/results/extract-comprehensive/gpt-5-mini/<timestamp>/extracted-data.json`
- Verify structure has `currentInstance` wrapper
- Verify `facts` is a string (not array)
- Verify `requests[].requests` (plural field name)
- Verify `parties[].proceduralRole` (not `role`)
- Verify top-level has `decision_id` and `language` (from metadata merge)

### 2. Schema Validation Test
```bash
# The build already validates the schema is valid TypeScript
# At runtime, AJV will validate model outputs match the schema
```

### 3. Full Test Set (50 decisions)
```bash
npm run dev concurrent extract-comprehensive
# Should process 50 decisions from test set
```

---

## 🚨 BREAKING CHANGES

### Old Results Are Incompatible

**Impact:**
- Previous extraction results won't validate against new schema
- Old results have different structure (no `currentInstance` nesting)
- Old results have `facts` as array, not string

**Migration Strategy:**
- Keep old results in separate directory
- Don't mix old and new results in evaluation
- Re-run extractions with new prompt to get new structure

### Evaluation System May Need Updates

**Check these files:**
- `evals/loaders/extraction-result-loader.ts` - May hardcode old paths
- `evals/config/judge-prompt.ts` - May reference old structure
- `evals/scorers/gpt5-judge-scorer.ts` - May expect old schema

**Action:** After testing extraction, verify evaluation still works.

---

## 📝 FIELD MAPPING REFERENCE

| Old Path | New Path | Type Change |
|----------|----------|-------------|
| `decisionId` | `decision_id` (metadata) | - |
| `proceduralLanguage` | `language` (metadata) | - |
| `facts[]` | `currentInstance.facts` | array → string |
| `requests[].request` | `currentInstance.requests[].requests` | - |
| `arguments[].argument` | `currentInstance.arguments[].argument` | - |
| `courtOrder` | `currentInstance.courtOrder` | - |
| `outcome` | `currentInstance.outcome` | - |
| `parties[].role` | `parties[].proceduralRole` | - |

---

## 🎯 NEXT STEPS

### Immediate (Required):
1. ✅ **Build verification** - DONE (compiles successfully)
2. **Test with 1 decision** - Verify output structure
3. **Check metadata merging** - Confirm `decision_id` and `language` in final output

### Short-term (Recommended):
4. **Test with 50 decisions** - Full concurrent run
5. **Verify evaluation system** - Check if it works with new structure
6. **Update evaluation prompts** - If they reference old paths

### Long-term (Optional):
7. **Re-run full test set** - Get fresh extractions with new prompt
8. **Compare quality** - Old (strict verbatim) vs New (flexible synthesis)
9. **Update documentation** - Reflect new extraction philosophy

---

## 📊 EXPECTED IMPROVEMENTS

With the new flexible extraction approach:

**Advantages:**
- ✅ Better handling of scattered facts across document
- ✅ More concise arguments (consolidate multi-paragraph reasoning)
- ✅ Cleaner requests extraction (remove verbose legal formulas)
- ✅ Single facts string easier to read (vs array of fragments)

**Potential Risks:**
- ⚠️ Model may over-synthesize (lose important verbatim details)
- ⚠️ Facts may be too condensed (missing key information)
- ⚠️ Need evaluation to verify quality maintained

**Mitigations:**
- courtOrder remains strictly verbatim (legal precision preserved)
- Prompt emphasizes "verbatim when practical, synthesis only when necessary"
- Evaluation system will catch quality issues

---

## 🔍 TROUBLESHOOTING

### Build Errors
```bash
npm run build
```
- Should compile with no TypeScript errors
- If errors, check schema syntax in config.ts

### Validation Failures
- Check model output matches new schema structure
- Verify `currentInstance` wrapper is present
- Check field names: `requests` (plural), `proceduralRole` (not `role`)

### Missing Metadata
- Verify `rowMetadataFields` includes `decision_id` and `language_metadata`
- Check metadata merging in `ConcurrentProcessor.ts:104-109`
- Check `language_metadata` → `language` mapping (system-wide convention)

### Evaluation Issues
- Update evaluation loaders if they expect old schema
- Update judge prompt if it references old field paths
- Check Braintrust integration for schema changes

---

## ✅ MIGRATION STATUS

| Component | Status | Notes |
|-----------|--------|-------|
| Prompt Text | ✅ Done | New prompt from P1_STAGE 1 (1).md |
| Template Variables | ✅ Done | Updated to {var} syntax |
| Output Schema | ✅ Done | currentInstance nesting, facts string, etc. |
| Metadata Fields | ✅ Verified | decision_id and language_metadata configured |
| TypeScript Build | ✅ Passing | Compiles with no errors |
| Concurrent System | ✅ Compatible | Schema-agnostic infrastructure |
| Batch System | ✅ Compatible | Schema-agnostic infrastructure |
| Evaluation System | ⚠️ TBD | Test after first extraction run |

---

**Migration completed successfully!** 🎉

The system is ready to run extractions with the new prompt and schema. The metadata merging ensures backward compatibility at the data access layer, even though the model output structure has changed.

**Ready to test:**
```bash
npm run dev concurrent extract-comprehensive
```

---

**Created:** 2025-10-23
**Status:** Complete - Ready for Testing
