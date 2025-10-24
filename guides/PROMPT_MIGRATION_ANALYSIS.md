# Prompt Migration Analysis: Stage-1.md → P1_STAGE 1 (1).md

## Summary

Migrating from strict verbatim extraction to more flexible extraction with synthesis when necessary (except courtOrder which remains verbatim).

---

## CRITICAL SCHEMA CHANGES

### 1. Nesting Structure

**OLD:**
```json
{
  "decisionId": "...",
  "proceduralLanguage": "...",
  "reference": {...},
  "parties": [...],
  "facts": [...],
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
    "facts": "...",
    "requests": [...],
    "arguments": [...],
    "courtOrder": "...",
    "outcome": "..."
  }
}
```

**Changes:**
- `decisionId` and `proceduralLanguage` REMOVED from output schema (model doesn't output them)
- `facts`, `requests`, `arguments`, `courtOrder`, `outcome` MOVED into `currentInstance` object
- `reference` and `parties` remain at top level

### 2. Facts Field Type Change

**OLD:** Array of strings
```json
"facts": [
  "Le demandeur a été engagé le 1er janvier 2015.",
  "Par lettre du 15 mars 2022, l'employeur a notifié la rupture."
]
```

**NEW:** Single string
```json
"facts": "Le demandeur a été engagé le 1er janvier 2015. Par lettre du 15 mars 2022, l'employeur a notifié la rupture."
```

### 3. Request Field Name Change

**OLD:** Singular `request`
```json
"requests": [
  {
    "partyId": "PARTY-...-001",
    "request": "Condamner..."
  }
]
```

**NEW:** Plural `requests`
```json
"requests": [
  {
    "partyId": "PARTY-...-001",
    "requests": "Condamner..."
  }
]
```

### 4. Party Role Field Name Change

**OLD:** `role`
```json
"parties": [
  {
    "id": "...",
    "name": "...",
    "role": "DEMANDEUR",
    "type": "..."
  }
]
```

**NEW:** `proceduralRole`
```json
"parties": [
  {
    "id": "...",
    "name": "...",
    "type": "...",
    "proceduralRole": "DEMANDEUR"
  }
]
```

### 5. Party Role Enum Value Change (French)

**OLD:** `DEFENDANT` (English)
**NEW:** `DEFENDEUR` (French, no accent)

**Full enum:**
- FR: `DEMANDEUR`, `DEFENDEUR`, `PARTIE_INTERVENANTE`, `TIERCE_PARTIE`, `MINISTERE_PUBLIC`, `PARTIE_CIVILE`, `AUTRE`
- NL: `EISER`, `VERWEERDER`, `TUSSENKOMENDE_PARTIJ`, `DERDE_PARTIJ`, `OPENBAAR_MINISTERIE`, `BURGERLIJKE_PARTIJ`, `ANDERE`

---

## EXTRACTION PHILOSOPHY CHANGE

### OLD: Strict Verbatim Mandate

```
1. Extract text EXACTLY as written - copy directly from source
2. NO paraphrasing - use original wording only
3. NO summarization - extract complete relevant text
4. NO rewording - preserve original sentence structure
```

Applied to: **ALL fields** (facts, requests, arguments, courtOrder)

### NEW: Flexible Extraction

```
**Extraction Philosophy:**
- **Verbatim when practical**: Copy text exactly when clear and extractable
- **Synthesis when necessary**: Consolidate scattered/verbose content while preserving accuracy
- **courtOrder exception**: MUST be verbatim, no synthesis allowed
```

Applied to:
- **Facts**: Synthesis acceptable (verbatim preferred)
- **Requests**: Synthesis acceptable (verbatim preferred)
- **Arguments**: Synthesis acceptable (consolidate multi-paragraph arguments)
- **courtOrder**: VERBATIM REQUIRED (no changes)

---

## TEMPLATE VARIABLE CHANGES

### OLD Placeholders:
```
{{decision_id}}
{{fullTextMarkdown}}
{{proceduralLanguage}}
```

### NEW Placeholders:
```
{decisionId}
{proceduralLanguage}
{publicUrl}
{fullText.markdown}
```

**Note:** New prompt adds `{publicUrl}` which we don't currently use.

---

## PARTY NAME EXTRACTION

### NEW Instruction (not in old):

**CRITICAL**: If decision uses initials, extract FULL NAME if determinable from context

Examples:
- Decision shows "M. J.D." but context reveals "Jean Dupont" → Extract "Jean Dupont"
- Decision shows "M. J.D." with no context → Extract "M. J.D."
- Decision shows "Société X" → Extract full company name if stated elsewhere

---

## REMOVED FIELDS

### From Output Schema:

1. **`decisionId`** - No longer in output (provided as input, added via metadata)
2. **`proceduralLanguage`** - No longer in output (provided as input, added via metadata)

These are now:
- Input to the model (not expected in output)
- Added via `rowMetadataFields` during result processing

---

## VALIDATION IMPACT

### What Will Break:

1. **Schema validation** - Current schema expects old structure
2. **Evaluation system** - May expect old field names
3. **Result merging** - Works at top level, should still work

### What Will Still Work:

1. **Metadata merging** - Happens at top level before model output
2. **Database queries** - Unchanged
3. **Preprocessing** - Unchanged
4. **Concurrent/Batch infrastructure** - Schema-agnostic

---

## MIGRATION TASKS

### 1. Update prompt.ts
- Replace prompt content with new version
- Update template variable substitution:
  - `{{decision_id}}` → `{decisionId}`
  - `{{fullTextMarkdown}}` → `{fullText.markdown}`
  - `{{proceduralLanguage}}` → `{proceduralLanguage}`
  - Add `{publicUrl}` (can be empty or actual URL)

### 2. Update config.ts Output Schema
- Remove `decisionId` and `proceduralLanguage` from required fields
- Wrap facts/requests/arguments/courtOrder/outcome in `currentInstance`
- Change `facts` type from array to string
- Change `requests[].request` to `requests[].requests`
- Change `parties[].role` to `parties[].proceduralRole`
- Update `DEFENDANT` to `DEFENDEUR` in French enum

### 3. Verify Metadata Still Merges
- `decisionId` comes from `decision_id` metadata field
- `proceduralLanguage` comes from `language_metadata` → `language`
- These merge at top level with model output

### 4. Update Evaluation if Needed
- Check if evaluation system references old field paths
- Update to use `currentInstance.facts` instead of `facts`, etc.

---

## BACKWARD COMPATIBILITY

**Breaking Changes:**
- Old extraction results won't validate against new schema
- Need separate evaluation configs for old vs new results
- Can't mix old and new results in same analysis

**Migration Strategy:**
- Keep old results in separate directory
- New extractions use new schema
- Run new evaluations on new schema only

---

## RISK ASSESSMENT

**Low Risk:**
- Template variable substitution (simple find/replace)
- Metadata merging (happens at top level)
- Infrastructure (schema-agnostic)

**Medium Risk:**
- Schema validation (need exact match)
- Party role enum changes (DEFENDANT → DEFENDEUR)
- Request field name (request → requests)

**High Risk:**
- Facts type change (array → string) - biggest change
- Nesting under currentInstance - affects all downstream code
- Evaluation system may hardcode old paths

---

## TESTING PLAN

1. **Unit Test**: Validate new schema against sample output
2. **Concurrent Test**: Run 5 decisions, verify output structure
3. **Validation Test**: Ensure schema validation passes
4. **Evaluation Test**: Check if evaluation system works with new structure
5. **Full Test**: Run 50 decisions end-to-end

---

**Next Steps:**
1. Update prompt.ts ✓
2. Update config.ts schema ✓
3. Test with 1 decision
4. Verify evaluation compatibility
5. Run full test set
