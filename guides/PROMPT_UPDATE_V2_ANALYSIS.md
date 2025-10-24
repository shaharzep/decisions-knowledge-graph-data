# Prompt Update Analysis: P1_STAGE 1 (1).md → P1_STAGE 1 (2).md

**Date:** 2025-10-23
**Migration:** Version 1 → Version 2

---

## SUMMARY OF CHANGES

This update significantly **expands the enum vocabularies** to cover more comprehensive legal terminology while changing enum formatting from **UNDERSCORE_SEPARATED** to **SPACE SEPARATED**.

---

## 🔴 CRITICAL CHANGE: Enum Formatting

### **OLD FORMAT:** Underscores
```typescript
"PARTIELLEMENT_ACCEPTE"
"NON_TRAITE"
"PARTIE_INTERVENANTE"
"TIERCE_PARTIE"
"GEDEELTELIJKE_VERNIETIGING"
```

### **NEW FORMAT:** Spaces
```typescript
"PARTIELLEMENT ACCEPTE"
"NON TRAITE"
"PARTIE INTERVENANTE"
"TIERS OPPOSANT"
"GEDEELTELIJKE VERNIETIGING"
```

**Impact:** This affects ALL multi-word enum values across parties, arguments, and outcomes.

---

## 1. PARTY ROLES - COMPREHENSIVE EXPANSION

### OLD Enum (7 FR + 7 NL = 14 values):
```typescript
// French
"DEMANDEUR"
"DEFENDEUR"
"PARTIE_INTERVENANTE"
"TIERCE_PARTIE"
"MINISTERE_PUBLIC"
"PARTIE_CIVILE"
"AUTRE"

// Dutch
"EISER"
"VERWEERDER"
"TUSSENKOMENDE_PARTIJ"
"DERDE_PARTIJ"
"OPENBAAR_MINISTERIE"
"BURGERLIJKE_PARTIJ"
"ANDERE"
```

### NEW Enum (15 FR + 15 NL = 30 values):

**Organized by Context:**

**General / First Instance Roles:**
```typescript
// French
"DEMANDEUR"           // Claimant/Plaintiff
"DEFENDEUR"           // Defendant
"PARTIE INTERVENANTE" // Intervening party (SPACE, not underscore!)
"TIERS OPPOSANT"      // Third-party objector (NEW!)

// Dutch
"EISER"
"VERWEERDER"
"TUSSENKOMENDE PARTIJ"
"DERDE VERZETTENDE"   // (NEW!)
```

**Appeal Roles (NEW CATEGORY):**
```typescript
// French
"APPELANT"            // Appellant (NEW!)
"INTIME"              // Respondent (NEW!)

// Dutch
"APPELLANT"           // (NEW!)
"GEÏNTIMEERDE"        // (NEW!)
```

**Cassation Roles (NEW CATEGORY):**
```typescript
// French
"DEMANDEUR EN CASSATION"  // (NEW!)
"DEFENDEUR EN CASSATION"  // (NEW!)

// Dutch
"EISER IN CASSATIE"       // (NEW!)
"VERWEERDER IN CASSATIE"  // (NEW!)
```

**Criminal & Specific Roles:**
```typescript
// French
"MINISTERE PUBLIC"                // Public prosecutor
"PARTIE CIVILE"                   // Civil party
"PRÉVENU"                         // Accused (NEW!)
"PARTIE CIVILEMENT RESPONSABLE"   // Civilly liable party (NEW!)
"AUTRE"

// Dutch
"OPENBAAR MINISTERIE"
"BURGERLIJKE PARTIJ"
"BEKLAAGDE"                       // Accused (NEW!)
"BURGERLIJK AANSPRAKELIJKE PARTIJ" // (NEW!)
"ANDERE"
```

**Key Changes:**
- 14 → 30 values (more than doubled!)
- Context-aware roles (first instance vs appeal vs cassation)
- Underscores → Spaces in multi-word values
- `TIERCE_PARTIE` → `TIERS OPPOSANT` (name change)
- `DERDE_PARTIJ` → `DERDE VERZETTENDE` (name change)

---

## 2. ARGUMENT TREATMENT - EXPANDED OPTIONS

### OLD Enum (5 FR + 5 NL = 10 values):
```typescript
// French
"ACCEPTE"
"PARTIELLEMENT_ACCEPTE"
"REJETE"
"NON_TRAITE"
"INCERTAIN"

// Dutch
"AANVAARD"
"GEDEELTELIJK_AANVAARD"
"VERWORPEN"
"NIET_BEHANDELD"
"ONZEKER"
```

### NEW Enum (7 FR + 7 NL = 14 values):
```typescript
// French
"ACCEPTE"                    // Accepted
"PARTIELLEMENT ACCEPTE"      // Partially accepted (SPACE!)
"REJETE"                     // Rejected (on merits)
"IRRECEVABLE"                // Inadmissible (NEW!)
"SANS OBJET"                 // Moot/Without object (NEW!)
"NON TRAITE"                 // Not addressed (SPACE!)
"INCERTAIN"                  // Cannot determine

// Dutch
"AANVAARD"
"GEDEELTELIJK AANVAARD"      // (SPACE!)
"VERWORPEN"
"NIET-ONTVANKELIJK"          // Inadmissible (NEW!)
"ZONDER VOORWERP"            // Moot (NEW!)
"NIET BEHANDELD"             // (SPACE!)
"ONZEKER"
```

**Key Changes:**
- 10 → 14 values
- Added: IRRECEVABLE/NIET-ONTVANKELIJK (inadmissible)
- Added: SANS OBJET/ZONDER VOORWERP (moot)
- Underscores → Spaces (except NL "NIET-ONTVANKELIJK" keeps hyphen)
- More precise legal distinctions (rejected vs inadmissible)

---

## 3. OUTCOME - MAJOR EXPANSION

### OLD Enum (12 FR + 12 NL = 24 values):
```typescript
// French
"ANNULATION"
"ANNULATION_PARTIELLE"
"CASSATION"
"CASSATION_PARTIELLE"
"CONFIRMATION"
"IRRECEVABILITE"
"RENVOI"
"REVOCATION"
"REJET"
"DESISTEMENT"
"SUSPENSION"
"AUTRE"

// Dutch
"VERNIETIGING"
"GEDEELTELIJKE_VERNIETIGING"
"CASSATIE"
"GEDEELTELIJKE_CASSATIE"
"BEVESTIGING"
"NIET_ONTVANKELIJKHEID"
"VERWIJZING"
"HERROEPING"
"AFWIJZING"
"AFSTAND"
"SCHORSING"
"ANDERE"
```

### NEW Enum (25 FR + 25 NL = 50 values!):

**Organized by Category:**

**General Substantive Outcomes (NEW CATEGORY):**
```typescript
// French
"FONDÉ"               // Granted/Founded (NEW!)
"NON FONDÉ"           // Unfounded (NEW!)
"REJET"               // Dismissal (kept)
"CONDAMNATION"        // Order/Conviction (NEW!)
"ACQUITTEMENT"        // Acquittal (NEW!)

// Dutch
"GEGROND"             // (NEW!)
"ONGEGROND"           // (NEW!)
"AFWIJZING"           // (kept)
"VEROORDELING"        // (NEW!)
"VRIJSPRAAK"          // (NEW!)
```

**Appellate Outcomes:**
```typescript
// French
"CONFIRMATION"                // Confirmation (kept)
"CONFIRMATION PARTIELLE"      // Partial Confirmation (NEW!)
"RÉFORMATION"                 // Reformation (NEW!)
"ANNULATION"                  // Annulment (kept)
"ANNULATION PARTIELLE"        // Partial annulment (SPACE!)

// Dutch
"BEVESTIGING"                 // (kept)
"GEDEELTELIJKE BEVESTIGING"   // (NEW!)
"HERVORMING"                  // (NEW!)
"VERNIETIGING"                // (kept)
"GEDEELTELIJKE VERNIETIGING"  // (SPACE!)
```

**Cassation Outcomes:**
```typescript
// French
"CASSATION"           // (kept)
"CASSATION PARTIELLE" // (SPACE!)
"RENVOI"              // Remand (kept)

// Dutch
"CASSATIE"            // (kept)
"GEDEELTELIJKE CASSATIE" // (SPACE!)
"VERWIJZING"          // (kept)
```

**Procedural & Other Outcomes:**
```typescript
// French
"IRRECEVABILITE"      // Inadmissibility (kept)
"DÉCHÉANCE"           // Forfeiture/Lapse (NEW!)
"DESSAISISSEMENT"     // Declining Jurisdiction (NEW!)
"DESISTEMENT"         // Withdrawal (kept)
"SUSPENSION"          // Suspension (kept)
"RADIATION"           // Striking from roll (NEW!)
"NON-LIEU À STATUER"  // No need to rule (NEW!)
"REVOCATION"          // Revocation (kept)
"AUTRE"               // Other (kept)

// Dutch
"NIET ONTVANKELIJKHEID"      // (SPACE!)
"VERVAL"                     // (NEW!)
"ONTZEGGING VAN RECHTSMACHT" // (NEW!)
"AFSTAND"                    // (kept)
"SCHORSING"                  // (kept)
"DOORHALING"                 // (NEW!)
"GEEN AANLEIDING TOT UITSPRAAK" // (NEW!)
"HERROEPING"                 // (kept)
"ANDERE"                     // (kept)
```

**Key Changes:**
- 24 → 50 values (more than doubled!)
- Organized by court level and type
- Underscores → Spaces throughout
- Added substantive outcomes (FONDÉ, CONDAMNATION, etc.)
- Added appellate outcomes (RÉFORMATION, CONFIRMATION PARTIELLE)
- Added procedural outcomes (DÉCHÉANCE, RADIATION, etc.)
- Much more comprehensive legal vocabulary

---

## 4. NO SCHEMA STRUCTURE CHANGES

✅ **Good news:** The OUTPUT SCHEMA STRUCTURE remains the same as Version 1:
- Still has `reference`, `parties`, `currentInstance`
- Still has `facts` as single string
- Still has `requests[].requests` (plural)
- Still has `parties[].proceduralRole`
- Still has `currentInstance` nesting

**Only the ENUM VALUES changed, not the structure.**

---

## IMPACT ASSESSMENT

### HIGH IMPACT:
1. **Enum Formatting Change:** Underscores → Spaces affects ALL enums
   - Schema must be updated
   - Validation will fail on old underscore values
   - Results using old enums incompatible with new schema

2. **Enum Value Expansion:** 14 → 30 party roles, 10 → 14 treatments, 24 → 50 outcomes
   - Much more expressive legal vocabulary
   - Better coverage of different court types and proceedings
   - Model has more precise options to choose from

### MEDIUM IMPACT:
3. **Specific Enum Renames:**
   - `TIERCE_PARTIE` → `TIERS OPPOSANT`
   - `DERDE_PARTIJ` → `DERDE VERZETTENDE`
   - Old values will fail validation

### LOW IMPACT:
4. **Example Updated:** Shows cassation roles (`DEMANDEUR EN CASSATION`)
5. **Documentation Improved:** Better explanations of when to use which enum

---

## MIGRATION REQUIREMENTS

### 1. Update prompt.ts
- Replace entire prompt with new version

### 2. Update config.ts Output Schema
- Update `parties[].proceduralRole` enum (14 → 30 values)
- Update `arguments[].treatment` enum (10 → 14 values)
- Update `currentInstance.outcome` enum (24 → 50 values)
- Change ALL multi-word enums from UNDERSCORE to SPACE format

### 3. Test Build
- Ensure TypeScript compiles
- Verify enum syntax is valid

### 4. Breaking Change Notice
- Old extraction results won't validate against new schema
- Different enum values (underscores vs spaces)
- Need to re-run extractions

---

## ADVANTAGES OF NEW VERSION

✅ **More Comprehensive Legal Coverage:**
- Appeals handled properly (APPELANT/INTIME roles)
- Cassation handled properly (EN CASSATION roles)
- Criminal cases handled (PRÉVENU, ACQUITTEMENT)
- Procedural outcomes (RADIATION, DÉCHÉANCE, etc.)

✅ **Better Legal Precision:**
- Distinguish REJETE (on merits) vs IRRECEVABLE (inadmissible)
- Distinguish FONDÉ (granted) vs CONDAMNATION (order to pay)
- Distinguish court levels (first instance vs appeal vs cassation)

✅ **More Natural Formatting:**
- Spaces in multi-word terms (more readable)
- Matches how they appear in actual decisions

---

## POTENTIAL RISKS

⚠️ **Enum Explosion:**
- 50 outcome values might confuse the model
- More options = more chance of wrong selection
- Need evaluation to verify correct usage

⚠️ **Space vs Underscore Ambiguity:**
- Model might mix formats
- Need strict validation
- Old results incompatible

⚠️ **Backwards Compatibility:**
- Cannot mix old and new results
- All evaluations need re-running
- Historical data needs migration if needed

---

## TESTING CHECKLIST

### 1. Schema Validation
- [ ] Compile TypeScript with no errors
- [ ] Enum values have spaces (not underscores)
- [ ] All 30 party roles present
- [ ] All 14 treatment values present
- [ ] All 50 outcome values present

### 2. Extraction Test
- [ ] Run 5 decisions (varied types)
- [ ] Verify model uses new enum values
- [ ] Check spaces in multi-word enums
- [ ] Verify appropriate role selection (cassation vs appeal vs first instance)

### 3. Evaluation Compatibility
- [ ] Check if evaluation system handles new enums
- [ ] Update judge prompts if they reference specific enum values
- [ ] Verify Braintrust logging works

---

## FIELD-BY-FIELD ENUM COMPARISON

| Field | Old Count | New Count | Format Change |
|-------|-----------|-----------|---------------|
| `parties[].proceduralRole` | 14 | 30 | ✓ Underscores → Spaces |
| `arguments[].treatment` | 10 | 14 | ✓ Underscores → Spaces |
| `currentInstance.outcome` | 24 | 50 | ✓ Underscores → Spaces |

**Total enum values:** 48 → 94 (almost doubled!)

---

## NEXT STEPS

1. ✅ Analysis complete
2. Update prompt.ts
3. Update config.ts schema enums
4. Build and test
5. Run sample extractions
6. Document changes
7. Consider evaluation system updates

---

**Status:** Ready for implementation
**Complexity:** Medium (enum expansion, formatting change)
**Breaking:** Yes (enum values incompatible with v1)
