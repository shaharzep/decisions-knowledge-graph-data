## ROLE
Extract a complete list of all legal provisions cited in a Belgian judicial decision, using pre-extracted context snippets that highlight provision mentions.

## INPUT
1. **Decision ID**: `{decisionId}`
2. **Procedural Language**: `{proceduralLanguage}` (FR or NL)
3. **Provision Contexts**: Array of text snippets, each containing a highlighted provision mention marked as `**[PROVISION: keyword]**`

## INPUT FORMAT
```json
{
  "decision_id": "ECLI:BE:...",
  "total_provision_mentions": 15,
  "contexts": [
    {
      "snippet_id": 1,
      "matched_text": "article",
      "context_text": "Text with **[PROVISION: article]** 31, § 2, de la loi...",
      "start_position": 1250,
      "end_position": 1257,
      "paragraph_index": 5
    }
  ]
}
```

## OUTPUT SCHEMA
```json
{
  "citedProvisions": [
    {
      "internalProvisionId": "ART-{decisionId}-001",
      "provisionNumber": "article 31, § 2, alinéa 1er",
      "provisionNumberKey": "31",
      "parentActName": "Loi du 10 mai 2007 tendant à lutter contre certaines formes de discrimination",
      "parentActType": "LOI",
      "parentActDate": "2007-05-10",
      "internalParentActId": "ACT-{decisionId}-001"
    }
  ]
}
```

## CRITICAL REQUIREMENTS

### 1. COMPLETENESS - ZERO PROVISIONS MISSED
- Process EVERY context snippet in the input array
- Extract EVERY provision mention, even if mentioned multiple times
- If you see `**[PROVISION: article]** 2, §1` in snippet 5 and `**[PROVISION: article]** 2, §3` in snippet 12, extract BOTH
- Never skip a snippet, never assume provisions are duplicates

### 2. CONTEXT-ONLY PARENT ACT IDENTIFICATION
- Use ONLY the text visible in each context snippet to identify parent act
- **NEVER infer or assume parent acts based on proximity or previous mentions**
- If context shows: "`**[PROVISION: article]** 1382 du Code civil`" ? Parent act = Code civil
- If context shows: "`**[PROVISION: article]** 1412`" with NO parent act mentioned ? Parent act = null or "INDÉTERMINÉ"
- If context shows: "`**[PROVISION: l'article]** 31, § 2, de la loi du 10 mai 2007...`" ? Parent act = full law name

### 3. MULTIPLE MENTIONS HANDLING
- Same provision number + different context ? Create separate entries
- Same provision number + same parent act + different snippets ? Deduplicate to ONE entry
- Same provision number + unclear parent act ? Keep as separate entry with null parent

### 4. VERBATIM EXTRACTION
- `provisionNumber`: Extract EXACTLY as written in context
  - "`**[PROVISION: article]** 31, § 2, alinéa 1er`" ? `"article 31, § 2, alinéa 1er"`
  - "`**[PROVISION: art.]** 1382`" ? `"art. 1382"`
- `parentActName`: Extract EXACTLY as written in context
  - "loi du 10 mai 2007 tendant à..." ? Use full name
  - "Code civil" ? Use as written
  - "KB van 12 mei 2019" ? Use as written

### 5. PARENT ACT DEDUPLICATION
- Same parent act across multiple provisions ? Same `internalParentActId`
- Different parent acts ? Different `internalParentActId`
- Example:
  - Snippet 1: "article 31 de la loi du 10 mai 2007" ? ACT-...-001
  - Snippet 5: "article 29 de la loi du 10 mai 2007" ? ACT-...-001 (SAME)
  - Snippet 8: "article 5 du Code civil" ? ACT-...-002 (DIFFERENT)

---

## FIELD SPECIFICATIONS

### `citedProvisions[]` - Array, REQUIRED

**`internalProvisionId`** - String, REQUIRED
- Format: `ART-{decisionId}-{sequence}`
- Sequence: 001, 002, 003, etc. (3 digits, zero-padded)
- Unique for each distinct provision mention

**`provisionNumber`** - String, REQUIRED
- VERBATIM text of the provision as it appears in context
- Include full reference: article number, paragraphs, sub-paragraphs
- Examples:
  - "article 31, § 2, alinéa 1er"
  - "art. 1382"
  - "artikel 10, §3, 2°"
  - "articles 2 à 5" (range is ONE provision entry)

**`provisionNumberKey`** - String, REQUIRED
- Core article number only, no formatting
- Extract the primary number from `provisionNumber`
- Examples:
  - "article 31, § 2" ? "31"
  - "art. 1382" ? "1382"
  - "artikel 10, §3, 2°" ? "10"
  - "articles 2 à 5" ? "2-5"

**`parentActName`** - String, REQUIRED (null if not determinable)
- VERBATIM name of the parent legal act from context
- Use the EXACT formulation in the context snippet
- If not mentioned in snippet ? null or "INDÉTERMINÉ"
- Examples:
  - "Loi du 10 mai 2007 tendant à lutter contre certaines formes de discrimination"
  - "Code civil"
  - "Règlement (UE) 2016/679"
  - "KB van 12 mei 2019 betreffende..."

**`parentActType`** - Enum (language-specific), REQUIRED

**If proceduralLanguage = "FR":**
- `LOI`: Loi/Law
- `CODE`: Code
- `ARRETE_ROYAL`: Arrêté royal
- `ARRETE_GOUVERNEMENT`: Arrêté du gouvernement
- `DECRET`: Décret
- `ORDONNANCE`: Ordonnance
- `REGLEMENT_EU`: Règlement européen
- `DIRECTIVE_EU`: Directive européenne
- `CONSTITUTION`: Constitution
- `TRAITE`: Traité
- `AUTRE`: Other
- `INDETERMINE`: Cannot determine from context

**If proceduralLanguage = "NL":**
- `WET`: Wet/Law
- `WETBOEK`: Wetboek
- `KONINKLIJK_BESLUIT`: Koninklijk besluit
- `BESLUIT_REGERING`: Besluit van de regering
- `DECREET`: Decreet
- `ORDONNANTIE`: Ordonnantie
- `VERORDENING_EU`: Europese verordening
- `RICHTLIJN_EU`: Europese richtlijn
- `GRONDWET`: Grondwet
- `VERDRAG`: Verdrag
- `ANDERE`: Other
- `ONBEPAALD`: Cannot determine from context

**`parentActDate`** - String (YYYY-MM-DD), OPTIONAL
- Date of parent act if mentioned in context
- Format: "2007-05-10"
- null if not mentioned in context

**`internalParentActId`** - String, REQUIRED
- Format: `ACT-{decisionId}-{sequence}`
- Sequence: 001, 002, 003, etc. (3 digits, zero-padded)
- **CRITICAL**: Same parent act ? Same ID

---

## EXTRACTION PROCESS

### Step 1: Process Each Context Snippet
- Read each snippet in `contexts` array
- Locate the `**[PROVISION: keyword]**` marker
- Extract the provision number immediately following the marker

### Step 2: Extract Provision Number
- Capture everything from marker to next punctuation that ends the reference
- Include: paragraph symbols (§), sub-sections (alinéa, 1°, 2°)
- Stop at: period not part of abbreviation, comma separating clauses, "de la", "du", "van", "of"

### Step 3: Identify Parent Act (Context Only)
- Search ONLY within the current snippet text
- Look for parent act indicators:
  - FR: "du Code civil", "de la loi du", "du Règlement", "de l'arrêté royal"
  - NL: "van het Wetboek", "van de wet van", "van de verordening", "van het KB"
- If found ? Extract full parent act name
- If NOT found ? Set parentActName = null, parentActType = INDETERMINE

### Step 4: Classify Parent Act Type
- Based on extracted `parentActName`:
  - Contains "loi"/"wet" ? LOI/WET
  - Contains "code"/"wetboek" ? CODE/WETBOEK
  - Contains "arrêté royal"/"koninklijk besluit" ? ARRETE_ROYAL/KONINKLIJK_BESLUIT
  - Contains "règlement"/"verordening" ? REGLEMENT_EU/VERORDENING_EU
  - etc.
- If no parent act name ? INDETERMINE/ONBEPAALD

### Step 5: Deduplicate Parent Acts
- Compare `parentActName` across all extracted provisions
- Identical names ? Assign same `internalParentActId`
- Different names ? Assign different IDs
- null/INDETERMINÉ ? Each gets separate ID (cannot deduplicate unknowns)

### Step 6: Deduplicate Provisions
- Compare across all extracted provisions:
  - Same `provisionNumber` + Same `parentActName` ? Keep only ONE
  - Same `provisionNumber` + Different `parentActName` ? Keep BOTH
  - Same `provisionNumber` + One with parent, one without ? Keep BOTH

### Step 7: Assign Sequential IDs
- Provisions: ART-{decisionId}-001, 002, 003...
- Parent Acts: ACT-{decisionId}-001, 002, 003...

---

## EXAMPLES

### Example 1: Clear Parent Act Context

**Input:**
```json
{
  "snippet_id": 3,
  "context_text": "Le demandeur invoque **[PROVISION: l'article]** 31, § 2, de la loi du 10 mai 2007 tendant à lutter contre certaines formes de discrimination pour soutenir sa demande."
}
```

**Output:**
```json
{
  "internalProvisionId": "ART-ECLI:BE:...-001",
  "provisionNumber": "article 31, § 2",
  "provisionNumberKey": "31",
  "parentActName": "Loi du 10 mai 2007 tendant à lutter contre certaines formes de discrimination",
  "parentActType": "LOI",
  "parentActDate": "2007-05-10",
  "internalParentActId": "ACT-ECLI:BE:...-001"
}
```

### Example 2: No Parent Act in Context

**Input:**
```json
{
  "snippet_id": 8,
  "context_text": "En application de **[PROVISION: l'article]** 1412, les parties doivent comparaître en personne devant le tribunal."
}
```

**Output:**
```json
{
  "internalProvisionId": "ART-ECLI:BE:...-005",
  "provisionNumber": "article 1412",
  "provisionNumberKey": "1412",
  "parentActName": null,
  "parentActType": "INDETERMINE",
  "parentActDate": null,
  "internalParentActId": "ACT-ECLI:BE:...-005"
}
```

### Example 3: Same Provision, Different Contexts

**Input Snippet 2:**
```json
{
  "snippet_id": 2,
  "context_text": "Conformément à **[PROVISION: l'article]** 1382 du Code civil, toute personne est responsable du dommage qu'elle cause."
}
```

**Input Snippet 9:**
```json
{
  "snippet_id": 9,
  "context_text": "Le tribunal rappelle que **[PROVISION: l'article]** 1382 constitue le fondement de la responsabilité civile en droit belge."
}
```

**Output (Deduplicated to ONE entry):**
```json
{
  "internalProvisionId": "ART-ECLI:BE:...-002",
  "provisionNumber": "article 1382",
  "provisionNumberKey": "1382",
  "parentActName": "Code civil",
  "parentActType": "CODE",
  "parentActDate": null,
  "internalParentActId": "ACT-ECLI:BE:...-002"
}
```

### Example 4: Same Number, Different Parent Acts

**Input Snippet 4:**
```json
{
  "snippet_id": 4,
  "context_text": "En vertu de **[PROVISION: l'article]** 2 de la loi du 10 mai 2007, la discrimination fondée sur l'âge est interdite."
}
```

**Input Snippet 11:**
```json
{
  "snippet_id": 11,
  "context_text": "Conformément à **[PROVISION: l'article]** 2 du Règlement (UE) 2016/679, les principes du RGPD s'appliquent."
}
```

**Output (TWO separate entries):**
```json
[
  {
    "internalProvisionId": "ART-ECLI:BE:...-003",
    "provisionNumber": "article 2",
    "provisionNumberKey": "2",
    "parentActName": "Loi du 10 mai 2007",
    "parentActType": "LOI",
    "parentActDate": "2007-05-10",
    "internalParentActId": "ACT-ECLI:BE:...-001"
  },
  {
    "internalProvisionId": "ART-ECLI:BE:...-004",
    "provisionNumber": "article 2",
    "provisionNumberKey": "2",
    "parentActName": "Règlement (UE) 2016/679",
    "parentActType": "REGLEMENT_EU",
    "parentActDate": null,
    "internalParentActId": "ACT-ECLI:BE:...-003"
  }
]
```

---

## VALIDATION CHECKLIST

- [ ] Processed ALL context snippets (count = input total_provision_mentions)
- [ ] Every `**[PROVISION: ...]**` marker resulted in extraction
- [ ] No parent acts inferred from other snippets
- [ ] Provision numbers verbatim from context
- [ ] Parent act names verbatim from context
- [ ] Same parent act ? Same internalParentActId
- [ ] Same provision + same parent ? Deduplicated
- [ ] Same provision + different/null parent ? Separate entries
- [ ] All IDs follow format (ART-...-001, ACT-...-001)
- [ ] No invented information

---

## CRITICAL REMINDERS

1. **Zero Misses**: Process every single context snippet
2. **Context Only**: Never infer parent acts from other mentions
3. **Verbatim**: Copy provision numbers and parent act names exactly
4. **Deduplication**: Same provision + same parent = ONE entry
5. **Ambiguity**: When parent act unclear ? null/INDÉTERMINÉ
6. **No Assumptions**: Article 1382 in Code civil + Article 1412 alone ? Article 1412 in Code civil
7. **Marker Attention**: `**[PROVISION: ...]**` is your guide to each mention

**OUTPUT:** Return ONLY valid JSON matching schema exactly. No markdown, no code blocks, no explanatory text.