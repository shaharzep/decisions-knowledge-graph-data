export const STAGE_2_PARSING_PROMPT = `## TASK
Extract cited court decisions from detected citation regions. Regex has identified text windows (1200 chars each) where citations likely exist. Your job is to extract ALL structured fields from these regions.

**Critical**: This is complete field extraction, not validation. Extract court names, dates, case numbers, ECLI codes, and classify treatment - all from scratch.

---

## INPUT

**Decision ID**: {decisionId}
**Procedural Language**: {proceduralLanguage}

**Citation Regions Detected**: {regionCount} regions found

**Detection Statistics**:
{triggerStats}

**Regions to Process**:

{citationRegions}

---

## WHAT ARE CITATION REGIONS?

Each region is a 1200-character text window where regex detected potential citation triggers:
- **ECLI codes** (e.g., ECLI:BE:CASS:2022:...)
- **Court keywords** (e.g., Cass., Hof van Cassatie, CJUE)
- **Date patterns** (e.g., 15 mars 2022, 12/01/2021)
- **Case number patterns** (e.g., C.21.0789.N, C-123/17)
- **Bibliographic patterns** (e.g., Arr.Cass. 2022)

**Important**:
- One region may contain MULTIPLE citations
- One region may contain NO valid citations (false positive triggers)
- Triggers are HINTS, not definitive - verify in the text window

---

## EXTRACTION RULES

### 1. Identify Valid Citations in Each Region

A valid citation must have:
✅ **Court/body name** from the scope list (Belgian, EU, or International courts)
✅ **At least ONE identifier**: date, case number, OR ECLI
✅ **Context indicating precedent citation** (not procedural history or bare reference)

**What to extract:**

Example text: "La Cour rappelle que, conformément à son arrêt du 15 mars 2022 (C.21.0789.N), l'obligation..."
→ Extract: Cass., 2022-03-15, C.21.0789.N, FOLLOWED

**What NOT to extract:**
- Procedural history: "fut libéré par arrêt de la Chambre du 12 janvier 2021" (event in current case)
- Bare references: "selon le Hof van Cassatie" (no identifier)
- Legal provisions: "article 31 de la loi du 15 juin 1935" (not a court decision)
- Self-references: Citations to {decisionId} itself

### 2. Extract Court Name (Verbatim)

**Rules:**
- Extract EXACTLY as written in text (FR or NL, preserve language)
- Include location qualifiers if present: "Hof van Beroep te Antwerpen" (not just "Hof van Beroep")
- Expand abbreviations ONLY if full form is in the text
- Do NOT translate or standardize
- Length: 10-200 characters

**Examples:**
- Text: "Cass." → Extract: "Cass."
- Text: "Cour de cassation" → Extract: "Cour de cassation"
- Text: "Hof van Beroep te Gent" → Extract: "Hof van Beroep te Gent"
- Text: "CJUE" → Extract: "CJUE"

### 3. Extract Date (Normalize to YYYY-MM-DD)

**Format conversions:**
- "15 mars 2022" → "2022-03-15"
- "15/03/2022" → "2022-03-15"
- "15.03.2022" → "2022-03-15"
- "15 maart 2022" → "2022-03-15"
- "1er juin 2018" → "2018-06-01"

**Rules:**
- MUST be complete date (day, month, year)
- If date not mentioned or unclear → null
- No partial dates (year-only, month-year not allowed)

**Month mappings:**
- FR: janvier=01, février=02, mars=03, avril=04, mai=05, juin=06, juillet=07, août=08, septembre=09, octobre=10, novembre=11, décembre=12
- NL: januari=01, februari=02, maart=03, april=04, mei=05, juni=06, juli=07, augustus=08, september=09, oktober=10, november=11, december=12

### 4. Extract Case Number (Verbatim)

**Valid formats:**
- Belgian Cassation: C.21.0789.N, P.20.1234.F
- EU Courts: C-123/17, T-456/18, F-789/19
- Decision numbers: Advies nr. 07/2013, Décision n° 12/2020
- Roll numbers: rol nr. 2021/AR/123

**Rules:**
- Extract EXACTLY as written (preserve punctuation, spaces, capitalization)
- If not mentioned → null
- Skip paragraph references: B.3.2, §5, art. 31 (these are NOT case numbers)

### 5. Extract ECLI Code

**Format:** ECLI:BE:CASS:2022:ARR.20220315.1N.4

**Rules:**
- Only if EXPLICITLY present in text
- Must match pattern: ECLI:[A-Z]{2}:[A-Z0-9]+:[0-9]{4}:.*
- Fix spacing if needed: "ECLI : BE : CASS : 2022" → "ECLI:BE:CASS:2022:..."
- If not present → null
- Do NOT construct ECLI codes

### 6. Determine Jurisdiction Code

**BE** (Belgian):
- Courts: Hof van Cassatie, Cour de cassation, Cass., Grondwettelijk Hof, Cour constitutionnelle, Raad van State, Conseil d'État, Hof van Beroep, Cour d'appel, Arbeidshof, Cour du travail, Rechtbank, Tribunal, etc.
- Admin bodies: Gegevensbeschermingsautoriteit, Commission pour la protection de la vie privée, etc.

**EU** (European Union):
- CJUE, Cour de Justice, Hof van Justitie, Court of Justice
- TUE, Tribunal de l'UE, General Court
- Commission européenne (decisions only)

**INT** (International):
- CEDH, EHRM, Cour européenne des droits de l'homme, ECtHR
- CIJ, ICJ, Cour internationale de justice
- Cour pénale internationale, ICC
- Benelux-Gerechtshof

**Rules:**
- Base on court name extracted from text
- Must be BE, EU, or INT (no UNKNOWN allowed)
- If truly ambiguous, skip the citation entirely

### 7. Classify Treatment

Analyze the context around the citation to determine how the current court treats it:

**FOLLOWED** - Court adopts the reasoning/principle:
- FR: "conformément à", "selon la jurisprudence constante", "comme l'a jugé", "dans le même sens", "en application de", "suivant", "appliquant"
- NL: "overeenkomstig", "volgens vaste rechtspraak", "zoals geoordeeld", "in dezelfde zin", "in toepassing van", "volgend"

**DISTINGUISHED** - Court explicitly differentiates:
- FR: "à la différence de", "contrairement à", "se distingue de", "n'est pas applicable au cas d'espèce", "à l'inverse de", "doit être nuancé"
- NL: "in tegenstelling tot", "verschilt van", "onderscheidt zich van", "is niet van toepassing", "in afwijking van", "moet genuanceerd worden"

**OVERRULED** - Court rejects or departs from precedent:
- FR: "revient sur", "écarte", "n'est plus d'application", "abandonne", "rejette", "infirme"
- NL: "wijkt af van", "verwerpt", "is niet meer van toepassing", "verlaat", "herroept"

**CITED** - Simple reference without substantive analysis:
- FR: "voir également", "cf.", "voy.", "voir aussi", "consulter", "se référer à", or neutral mention
- NL: "zie ook", "zie eveneens", "vgl.", "raadpleeg", "verwijs naar", or neutral mention

**UNCERTAIN** - Ambiguous or insufficient context (use sparingly):
- Only when context is genuinely unclear after careful analysis
- Weak indicators or multiple conflicting signals

**Priority order**: OVERRULED > DISTINGUISHED > FOLLOWED > CITED > UNCERTAIN

---

## SCOPE REFERENCE

### Belgian Courts & Bodies (BE)
- Hof van Cassatie, Cour de cassation, Cass.
- Grondwettelijk Hof, Cour constitutionnelle, GwH
- Raad van State, Conseil d'État, RvS
- Hof van Beroep, Cour d'appel
- Arbeidshof, Cour du travail
- Rechtbank van Eerste Aanleg, Tribunal de première instance
- Vredegerecht, Justice de paix
- Kamer van inbeschuldigingstelling, Chambre des mises en accusation
- Gegevensbeschermingsautoriteit, Autorité de protection des données
- Commission pour l'aide financière aux victimes

### EU Courts (EU)
- CJUE, Cour de Justice de l'UE, Hof van Justitie
- TUE, Tribunal de l'UE, Gerecht van de EU
- Commission européenne (decisions)

### International Courts (INT)
- CEDH, EHRM, Cour européenne des droits de l'homme, ECtHR
- CIJ, ICJ, Cour internationale de justice
- CPI, ICC, Cour pénale internationale
- Benelux-Gerechtshof, Cour de justice Benelux

---

## FILTERING & VALIDATION

**Remove citations that:**
1. ❌ Cite {decisionId} itself (self-reference)
2. ❌ Are procedural history events ("werd vrijgelaten door arrest van...")
3. ❌ Are bare court mentions without identifier ("selon la Cour de cassation")
4. ❌ Are legal provisions ("article 31 de la loi")
5. ❌ Are reports/correspondence ("rapport de la Commission")
6. ❌ Cite foreign national courts (French, German, US courts)

**Keep citations even if:**
- ✅ Only one identifier present (date OR case number OR ECLI is enough if court name is clear)
- ✅ From administrative bodies with decision numbers
- ✅ Multiple citations in same region (extract each separately)

---

## OUTPUT SCHEMA

Return ONLY valid JSON:

\`\`\`json
{
  "citedDecisions": [
    {
      "decisionId": null,
      "decisionSequence": 1,
      "courtJurisdictionCode": "BE",
      "courtName": "Hof van Cassatie",
      "date": "2022-03-15",
      "caseNumber": "C.21.0789.N",
      "ecli": "ECLI:BE:CASS:2022:ARR.20220315.1N.4",
      "treatment": "FOLLOWED"
    }
  ]
}
\`\`\`

**Field requirements:**
- **decisionId**: Always null (reserved for database mapping)
- **decisionSequence**: Sequential integers 1, 2, 3... (no gaps)
- **courtJurisdictionCode**: Must be "BE", "EU", or "INT"
- **courtName**: Verbatim from text (10-200 chars)
- **date**: YYYY-MM-DD or null
- **caseNumber**: Verbatim or null (3-100 chars)
- **ecli**: Valid ECLI format or null
- **treatment**: One of: FOLLOWED, DISTINGUISHED, OVERRULED, CITED, UNCERTAIN

**If no valid citations found**: Return \`{"citedDecisions": []}\`

---

## EXAMPLES

### Example 1: High-Confidence ECLI Citation

**Region Text:**
"...La Cour rappelle que, conformément à son arrêt ECLI:BE:CASS:2022:ARR.20220315.1N.4 du 15 mars 2022 (C.21.0789.N), l'obligation de justification objective doit être respectée dans tous les cas. Cette jurisprudence s'applique également aux..."

**Extraction:**
\`\`\`json
{
  "citedDecisions": [
    {
      "decisionId": null,
      "decisionSequence": 1,
      "courtJurisdictionCode": "BE",
      "courtName": "Cass.",
      "date": "2022-03-15",
      "caseNumber": "C.21.0789.N",
      "ecli": "ECLI:BE:CASS:2022:ARR.20220315.1N.4",
      "treatment": "FOLLOWED"
    }
  ]
}
\`\`\`

**Reasoning:**
- Court: "Cass." implicit from ECLI (Hof van Cassatie)
- Date: "15 mars 2022" → 2022-03-15 ✓
- Case number: "C.21.0789.N" in parentheses ✓
- ECLI: Explicitly present ✓
- Jurisdiction: BE (from ECLI:BE:...) ✓
- Treatment: FOLLOWED (indicator: "conformément à son arrêt") ✓

### Example 2: Court+Date Citation (No ECLI)

**Region Text:**
"...Zie ook Hof van Beroep te Antwerpen, arrest van 12 januari 2021, waarbij de rechtbank oordeelde dat de motiveringsplicht van toepassing is op alle bestuurshandelingen..."

**Extraction:**
\`\`\`json
{
  "citedDecisions": [
    {
      "decisionId": null,
      "decisionSequence": 1,
      "courtJurisdictionCode": "BE",
      "courtName": "Hof van Beroep te Antwerpen",
      "date": "2021-01-12",
      "caseNumber": null,
      "ecli": null,
      "treatment": "CITED"
    }
  ]
}
\`\`\`

**Reasoning:**
- Court: "Hof van Beroep te Antwerpen" (includes location) ✓
- Date: "12 januari 2021" → 2021-01-12 ✓
- Case number: Not mentioned → null ✓
- ECLI: Not mentioned → null ✓
- Jurisdiction: BE (Belgian appeal court) ✓
- Treatment: CITED (indicator: "Zie ook" = simple reference) ✓

### Example 3: Multiple Citations in One Region

**Region Text:**
"...La jurisprudence constante du Hof van Cassatie (arrêt du 15/03/2022, C.21.0789.N) et de la Cour de justice de l'UE (arrêt du 20 juin 2018, C-123/17) confirme que..."

**Extraction:**
\`\`\`json
{
  "citedDecisions": [
    {
      "decisionId": null,
      "decisionSequence": 1,
      "courtJurisdictionCode": "BE",
      "courtName": "Hof van Cassatie",
      "date": "2022-03-15",
      "caseNumber": "C.21.0789.N",
      "ecli": null,
      "treatment": "FOLLOWED"
    },
    {
      "decisionId": null,
      "decisionSequence": 2,
      "courtJurisdictionCode": "EU",
      "courtName": "Cour de justice de l'UE",
      "date": "2018-06-20",
      "caseNumber": "C-123/17",
      "ecli": null,
      "treatment": "FOLLOWED"
    }
  ]
}
\`\`\`

**Reasoning:**
- Two separate citations detected ✓
- Both extracted with sequential IDs (1, 2) ✓
- Different jurisdictions (BE, EU) ✓
- Treatment: FOLLOWED (indicator: "confirme que") ✓

### Example 4: False Positive - Procedural History

**Region Text:**
"...Le prévenu fut libéré par arrêt de la Kamer van inbeschuldigingstelling du 12 janvier 2021. La défense a ensuite introduit une demande de mise en liberté..."

**Extraction:**
\`\`\`json
{
  "citedDecisions": []
}
\`\`\`

**Reasoning:**
- This describes an event in the CURRENT case (procedural history) ✗
- "fut libéré par arrêt" = release event, not precedent citation ✗
- No valid precedent citation found → empty array ✓

### Example 5: Administrative Body Decision

**Region Text:**
"...La Commission pour la protection de la vie privée, dans son Advies nr. 07/2013 du 20 février 2013, a considéré que le traitement de données personnelles doit..."

**Extraction:**
\`\`\`json
{
  "citedDecisions": [
    {
      "decisionId": null,
      "decisionSequence": 1,
      "courtJurisdictionCode": "BE",
      "courtName": "Commission pour la protection de la vie privée",
      "date": "2013-02-20",
      "caseNumber": "Advies nr. 07/2013",
      "ecli": null,
      "treatment": "FOLLOWED"
    }
  ]
}
\`\`\`

**Reasoning:**
- Admin body with decision number is valid ✓
- Decision number "Advies nr. 07/2013" is the case number ✓
- Treatment: FOLLOWED (indicator: "a considéré que") ✓

---

## FINAL CHECKLIST

Before outputting, verify:
- ✅ All dates are YYYY-MM-DD or null (no partial dates)
- ✅ All jurisdiction codes are BE, EU, or INT (no UNKNOWN)
- ✅ All court names are verbatim from text (no translation)
- ✅ All case numbers are verbatim or null (no paragraph refs)
- ✅ All ECLI codes match pattern or null
- ✅ All treatment values are valid enum values
- ✅ Sequences are 1, 2, 3... with no gaps
- ✅ No self-references to {decisionId}
- ✅ No procedural history events
- ✅ No bare court mentions without identifiers

**Output JSON only. No markdown fences, no explanations.**
`;
