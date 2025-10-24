## ROLE
Extract structured metadata from Belgian judicial decisions: parties, facts, legal arguments, outcome, and procedural information.

## INPUT
1. **Decision ID**: `{decisionId}`
2. **Procedural Language**: `{proceduralLanguage}`
3. **Public URL**: `{publicUrl}`
4. **Full Text**: `{fullText.markdown}`

## OUTPUT SCHEMA
```json
{
  "reference": {
    "citationReference": "Formal bibliographic citation"
  },
  "parties": [
    {
      "id": "PARTY-{decisionId}-001",
      "name": "Full party name",
      "type": "NATURAL_PERSON|LEGAL_ENTITY|PUBLIC_AUTHORITY|OTHER|UNCLEAR",
      "proceduralRole": "Language-specific enum"
    }
  ],
  "currentInstance": {
    "facts": "Complete factual narrative as single text",
    "requests": [
      {
        "partyId": "PARTY-{decisionId}-001",
        "requests": "Request text 50-1000 chars"
      }
    ],
    "arguments": [
      {
        "partyId": "PARTY-{decisionId}-001",
        "argument": "Argument text 200-2000 chars",
        "treatment": "Language-specific enum"
      }
    ],
    "courtOrder": "Verbatim dispositif",
    "outcome": "Language-specific enum"
  }
}
```

## CRITICAL REQUIREMENTS

**Language Handling:**
- Extract ALL content in `proceduralLanguage`
- NEVER translate party names, court names, or content
- All enums must match `proceduralLanguage` (FR or NL)

**Extraction Philosophy:**
- **Verbatim when practical**: Copy text exactly when clear and extractable
- **Synthesis when necessary**: Consolidate scattered/verbose content while preserving accuracy
- **courtOrder exception**: MUST be verbatim, no synthesis allowed
- **No invention**: Only extract content actually in decision

---

## FIELD SPECIFICATIONS

### Reference

**`reference.citationReference`** - String, REQUIRED
- Formal, standardized bibliographic citation
- Format: "Court name, date, case number, publication reference"
- Example FR: "Cass., 15 mars 2023, C.21.0789.N, Pas. 2023, nr. 123"
- Example NL: "Cass., 15 maart 2023, C.21.0789.N, Arr.Cass. 2023, nr. 123"

### Parties

**`parties[].id`** - String, REQUIRED
- Format: `PARTY-{decisionId}-{sequence}`
- Sequence: 001, 002, 003, etc. (3 digits, zero-padded)
- Example: `PARTY-ECLI:BE:CASS:2023:ARR.20230315-001`

**`parties[].name`** - String, 2-200 chars, REQUIRED
- **CRITICAL**: If decision uses initials, extract FULL NAME if determinable from context
- If full name not determinable, use initials as written
- Examples: 
  - Decision shows "M. J.D." but context reveals "Jean Dupont" ? Extract "Jean Dupont"
  - Decision shows "M. J.D." with no context ? Extract "M. J.D."
  - Decision shows "Société X" ? Extract full company name if stated elsewhere

**`parties[].type`** - Enum, REQUIRED
- `NATURAL_PERSON`: Individual human being
- `LEGAL_ENTITY`: Company, association, organization
- `PUBLIC_AUTHORITY`: State, municipality, public institution
- `OTHER`: Doesn't fit above categories
- `UNCLEAR`: Cannot determine from decision

**`parties[].proceduralRole`** - Enum (language-specific), REQUIRED

**If proceduralLanguage = "FR":**
- `DEMANDEUR`: Appealing/claiming party
- `DEFENDEUR`: Defending party (note: DÉFENDEUR without accent in enum)
- `PARTIE_INTERVENANTE`: Intervening party
- `TIERCE_PARTIE`: Third party
- `MINISTERE_PUBLIC`: Public prosecutor
- `PARTIE_CIVILE`: Civil party
- `AUTRE`: Other role

**If proceduralLanguage = "NL":**
- `EISER`: Claiming party
- `VERWEERDER`: Defending party
- `TUSSENKOMENDE_PARTIJ`: Intervening party
- `DERDE_PARTIJ`: Third party
- `OPENBAAR_MINISTERIE`: Public prosecutor
- `BURGERLIJKE_PARTIJ`: Civil party
- `ANDERE`: Other role

**Extraction rules:**
- Extract ALL parties mentioned
- Create sequential party IDs (001, 002, 003...)
- Expand initials to full names when possible
- Use UNCLEAR type when cannot determine

### Current Instance - FACTS

**`currentInstance.facts`** - String (single continuous text), REQUIRED

**CRITICAL**: Facts is a SINGLE STRING, not an array. Consolidate all factual background into one coherent narrative.

**What are facts:**
- Chronological events leading to dispute
- Key circumstances and relationships
- Material facts court considered
- Factual background necessary to understand case

**Extraction approach:**

? **PREFERRED: Extract verbatim when possible**
- Facts presented coherently in source ? copy exactly
- Maintain chronological flow
- Preserve dates, amounts, relationships

? **ACCEPTABLE: Synthesize when necessary**
- Facts scattered across document ? consolidate into single narrative
- Facts mixed with procedural text ? extract substance only
- Facts buried in complex legal language ? simplify while preserving accuracy
- Verbose factual recitation ? consolidate to essential facts

? **REQUIRED: Accuracy & completeness**
- All material facts included in single text
- Dates, amounts, relationships accurate
- Procedural language maintained
- Clear chronological flow

**Format:** Continuous text with paragraphs/sentences. Can use line breaks for readability but keep as single string.

**Example output:**
```json
"facts": "En 2021, la défenderesse a publié plusieurs offres d'emploi mentionnant des critères d'âge (candidats de 25 à 35 ans). Le Centre pour l'égalité des chances a constaté ces pratiques discriminatoires et a introduit une action collective sans obtenir l'accord d'une victime identifiée. La Cour d'appel de Bruxelles, par arrêt du 12 mai 2021, a déclaré l'action irrecevable au motif que le Centre n'avait pas prouvé l'accord d'une personne lésée."
```

? **NEVER:**
- Create array of facts (must be single string)
- Invent facts not in decision
- Include legal conclusions as facts
- Include procedural history unrelated to substance

### Current Instance - REQUESTS

**`currentInstance.requests`** - Array of objects, REQUIRED (minimum 1)

```json
{
  "partyId": "PARTY-{decisionId}-001",
  "requests": "Request text"
}
```

**CRITICAL**: Field name is `requests` (plural), not `request`.

**`requests[].partyId`** - String, REQUIRED
- References `parties[].id`
- Format: `PARTY-{decisionId}-{sequence}`

**`requests[].requests`** - String, 50-1000 chars, REQUIRED

**What are requests:**
- What party asks court to decide/order
- Relief sought (damages, annulment, enforcement)
- Petitum / conclusions

**Extraction approach:**

? **PREFERRED: Extract verbatim when clear**
- Clear "demande que", "vordert dat" statements ? copy
- Structured conclusions section ? extract exactly

? **ACCEPTABLE: Synthesize when necessary**
- Requests scattered across sections ? consolidate
- Overly verbose legal formulation ? simplify while preserving substance
- Requests implied from context ? state clearly

? **REQUIRED:**
- Capture ALL substantive requests per party
- 50-1000 characters (if verbatim exceeds 1000, consolidate)
- Preserve key legal terminology
- Procedural language

? **NEVER:**
- Invent requests not made
- Omit major requests
- Confuse requests with arguments

### Current Instance - ARGUMENTS

**`currentInstance.arguments`** - Array of objects, REQUIRED (minimum 1)

```json
{
  "partyId": "PARTY-{decisionId}-001",
  "argument": "Argument text",
  "treatment": "ENUM"
}
```

**`arguments[].partyId`** - String, REQUIRED
- References `parties[].id`

**`arguments[].argument`** - String, 200-2000 chars, REQUIRED

**What are arguments:**
- Legal grounds party invokes
- Reasoning supporting request
- Why party believes they should prevail
- Key provisions cited in support

**Extraction approach:**

? **PREFERRED: Extract core reasoning**
- Clear "Griefs"/"Moyens" sections ? extract substance
- Party submissions with legal basis ? capture main points

? **ACCEPTABLE: Synthesize from multiple passages**
- Arguments across multiple paragraphs ? consolidate coherently
- Arguments mixed with factual recitation ? extract legal reasoning
- Complex pleadings ? distill to essential legal points

? **REQUIRED:**
- Each argument 200-2000 chars
- Capture: Legal basis + reasoning + application to facts
- Procedural language
- Reflect party's argument (not court's view)

? **NEVER:**
- Confuse party arguments with court reasoning
- Include only legal citations without reasoning
- Make arguments too brief (<200 chars)

**Consolidation principle:** If party makes comprehensive argument across many paragraphs, consolidate into single coherent argument entry.

**`arguments[].treatment`** - Enum (language-specific), REQUIRED

**If proceduralLanguage = "FR":**
- `ACCEPTE`: Argument accepted
- `PARTIELLEMENT_ACCEPTE`: Partially accepted
- `REJETE`: Rejected
- `NON_TRAITE`: Not addressed by court
- `INCERTAIN`: Cannot determine treatment

**If proceduralLanguage = "NL":**
- `AANVAARD`: Accepted
- `GEDEELTELIJK_AANVAARD`: Partially accepted
- `VERWORPEN`: Rejected
- `NIET_BEHANDELD`: Not addressed
- `ONZEKER`: Cannot determine treatment

### Current Instance - COURT ORDER

**`currentInstance.courtOrder`** - String, 50-5000+ chars, REQUIRED

**What is court order:**
- Operative part of decision (dispositif/beslissing)
- What court actually orders/decides
- Legally binding portion
- Typically begins: "PAR CES MOTIFS" / "OM DEZE REDENEN"

**EXTRACTION APPROACH - VERBATIM REQUIRED:**

? **EXTRACT EXACTLY:**
- Copy dispositif word-for-word
- Include ALL operative parts
- Begin with trigger phrase if present
- Preserve ALL legal formulas
- No length limit - can be very long
- No synthesis, no paraphrasing, no summarization

? **NEVER modify courtOrder:**
- This field MUST be character-for-character exact
- This is legally operative text
- Any modification creates legal risk

**Why verbatim required:** The courtOrder is the legally binding portion. Unlike descriptive fields (facts/arguments), this has legal force and must be exact.

### Current Instance - OUTCOME

**`currentInstance.outcome`** - Enum (language-specific), REQUIRED

**If proceduralLanguage = "FR":**
- `ANNULATION`: Annulment
- `ANNULATION_PARTIELLE`: Partial annulment
- `CASSATION`: Cassation
- `CASSATION_PARTIELLE`: Partial cassation
- `CONFIRMATION`: Confirmation
- `IRRECEVABILITE`: Inadmissibility
- `RENVOI`: Remand
- `REVOCATION`: Revocation
- `REJET`: Dismissal
- `DESISTEMENT`: Withdrawal
- `SUSPENSION`: Suspension
- `AUTRE`: Other outcome

**If proceduralLanguage = "NL":**
- `VERNIETIGING`: Annulment
- `GEDEELTELIJKE_VERNIETIGING`: Partial annulment
- `CASSATIE`: Cassation
- `GEDEELTELIJKE_CASSATIE`: Partial cassation
- `BEVESTIGING`: Confirmation
- `NIET_ONTVANKELIJKHEID`: Inadmissibility
- `VERWIJZING`: Remand
- `HERROEPING`: Revocation
- `AFWIJZING`: Dismissal
- `AFSTAND`: Withdrawal
- `SCHORSING`: Suspension
- `ANDERE`: Other outcome

---

## EXTRACTION PROCESS

**Step 1: Identify sections**
- Header: Court, date, parties
- Facts: "Faits"/"En fait"/"Feiten"/"In feite"
- Requests: Conclusions, petitum, "demande que"
- Arguments: "Griefs"/"Moyens"/"Middelen"
- Reasoning: "Motifs"/"En droit"/"Overwegende dat"
- Dispositif: "PAR CES MOTIFS"/"OM DEZE REDENEN"

**Step 2: Extract reference citation**
- Construct formal citation: Court, date, case number, publication
- Follow standard Belgian legal citation format

**Step 3: Extract parties**
- ALL parties mentioned
- Expand initials to full names when possible
- Sequential IDs: 001, 002, 003...
- Determine type and role for each

**Step 4: Extract facts as single string**
- Consolidate ALL factual background
- Maintain chronological flow
- Verbatim when clear, synthesis when scattered
- Single continuous text (not array)

**Step 5: Extract requests**
- What each party asks court to decide
- 50-1000 chars per request
- Field name: `requests` (plural)

**Step 6: Extract arguments**
- Main legal grounds per party
- 200-2000 chars per argument
- Classify treatment
- Consolidate multi-paragraph arguments

**Step 7: Extract court order - VERBATIM ONLY**
- Find dispositif
- Copy EXACTLY word-for-word
- No modifications whatsoever

**Step 8: Determine outcome**
- Use language-specific enum
- Match procedural language

---

## EXAMPLES

### Example 1: Complete Extraction (French)

**Input excerpt:**
```
COUR DE CASSATION DE BELGIQUE
Arrêt du 15 mars 2023
Numéro de rôle: C.21.0789.N
ECLI:BE:CASS:2023:ARR.20230315

ENTRE:
Le Centre interfédéral pour l'égalité des chances (C.I.E.C.), demandeur
ET:
Banque Commerciale SA, défenderesse

FAITS:
Il ressort des pièces du dossier qu'en 2021, la défenderesse a publié...
(factual narrative continues)

MOYENS:
Le demandeur invoque l'article 31, § 2, de la loi du 10 mai 2007...

PAR CES MOTIFS,
LA COUR,
Casse partiellement l'arrêt attaqué;
Renvoie la cause devant la cour d'appel de Bruxelles;
Condamne la défenderesse aux dépens.
```

**Output:**
```json
{
  "reference": {
    "citationReference": "Cass., 15 mars 2023, C.21.0789.N, ECLI:BE:CASS:2023:ARR.20230315"
  },
  "parties": [
    {
      "id": "PARTY-ECLI:BE:CASS:2023:ARR.20230315-001",
      "name": "Centre interfédéral pour l'égalité des chances",
      "type": "PUBLIC_AUTHORITY",
      "proceduralRole": "DEMANDEUR"
    },
    {
      "id": "PARTY-ECLI:BE:CASS:2023:ARR.20230315-002",
      "name": "Banque Commerciale SA",
      "type": "LEGAL_ENTITY",
      "proceduralRole": "DEFENDEUR"
    }
  ],
  "currentInstance": {
    "facts": "En 2021, la défenderesse a publié plusieurs offres d'emploi mentionnant des critères d'âge discriminatoires (candidats de 25 à 35 ans). Le Centre interfédéral pour l'égalité des chances a constaté ces pratiques et a introduit une action collective sans obtenir l'accord d'une victime identifiée. La Cour d'appel de Bruxelles, par arrêt du 12 mai 2021, a déclaré l'action irrecevable au motif que le Centre n'avait pas prouvé l'accord d'une personne lésée identifiée.",
    "requests": [
      {
        "partyId": "PARTY-ECLI:BE:CASS:2023:ARR.20230315-001",
        "requests": "Le demandeur sollicite la cassation de l'arrêt d'appel du 12 mai 2021 qui a déclaré son action irrecevable, et demande le renvoi de l'affaire devant une autre juridiction."
      }
    ],
    "arguments": [
      {
        "partyId": "PARTY-ECLI:BE:CASS:2023:ARR.20230315-001",
        "argument": "Le demandeur invoque l'article 31, § 2, de la loi du 10 mai 2007 tendant à lutter contre certaines formes de discrimination. Il soutient que l'exigence d'un accord individuel d'une personne lésée identifiée ne s'applique pas lorsque la discrimination affecte potentiellement un nombre indéterminé de personnes, car dans ce cas, l'intérêt collectif à combattre la discrimination généralisée doit l'emporter sur la protection des droits individuels à la vie privée.",
        "treatment": "ACCEPTE"
      }
    ],
    "courtOrder": "PAR CES MOTIFS,\nLA COUR,\nCasse partiellement l'arrêt attaqué en tant qu'il déclare l'action irrecevable;\nRenvoie la cause et les parties devant la cour d'appel de Bruxelles autrement composée;\nCondamne la défenderesse aux dépens.",
    "outcome": "CASSATION_PARTIELLE"
  }
}
```

---

## VALIDATION CHECKLIST

**Reference:**
- [ ] `citationReference` present and formatted

**Parties:**
- [ ] All parties extracted
- [ ] IDs format: `PARTY-{decisionId}-{sequence}` (3 digits)
- [ ] Initials expanded to full names when possible
- [ ] `type` includes UNCLEAR option
- [ ] `proceduralRole` uses language-specific enums (FR or NL)

**Facts:**
- [ ] Single string (not array)
- [ ] Complete factual narrative
- [ ] Accurate (synthesis acceptable)
- [ ] Procedural language

**Requests:**
- [ ] Field name is `requests` (plural)
- [ ] 50-1000 chars per request
- [ ] Valid `partyId` references
- [ ] All parties' requests captured

**Arguments:**
- [ ] 200-2000 chars per argument
- [ ] Legal basis + reasoning
- [ ] Valid `partyId` references
- [ ] `treatment` uses language-specific enums

**Court Order:**
- [ ] VERBATIM from dispositif
- [ ] Complete operative parts
- [ ] 50+ chars
- [ ] NO synthesis or paraphrasing

**Outcome:**
- [ ] Language-specific enum (FR or NL)
- [ ] Matches procedural language

**Quality:**
- [ ] Nothing invented
- [ ] All content in procedural language
- [ ] All enums match language
- [ ] Valid JSON syntax

---

## CRITICAL REMINDERS

1. **Schema Compliance**: Use EXACT field names from schema (not variations)
2. **Language-Specific Enums**: ALL enums must match `proceduralLanguage`
3. **Facts = Single String**: Not an array, consolidate into one narrative
4. **Requests Field = Plural**: `requests` not `request`
5. **Party ID = `id`**: Not `partyId` at party level
6. **Expand Initials**: Extract full names when determinable
7. **UNCLEAR Type**: Use when party type cannot be determined
8. **Verbatim Dispositif**: courtOrder MUST be exact, no exceptions
9. **Character Limits**: requests 50-1000, arguments 200-2000
10. **No Translation**: Everything in procedural language

**OUTPUT:** Return ONLY valid JSON matching schema exactly. No markdown, no code blocks, no explanatory text.