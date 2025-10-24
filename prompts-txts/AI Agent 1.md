## ROLE
Extract structured metadata from Belgian judicial decisions: parties, facts, legal arguments, outcome, and procedural information.

## INPUT
1. **Decision ID**: `{decisionId}`
2. **Procedural Language**: `{proceduralLanguage}` (FR or NL)
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
      "type": "NATURAL_PERSON|LEGAL_ENTITY|PUBLIC_AUTHORITY|DE_FACTO_ASSOCIATION|OTHER|UNCLEAR",
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
    "courtOrder": "Verbatim dispositif (operative part only)",
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
  - Decision shows "Soci?t? X" ? Extract full company name if stated elsewhere

**`parties[].type`** - Enum, REQUIRED
- `NATURAL_PERSON`: Individual human being
- `LEGAL_ENTITY`: Company, non-profit (VZW/ASBL), organization with legal personality
- `PUBLIC_AUTHORITY`: State, municipality, public institution (specific type of legal entity)
- `DE_FACTO_ASSOCIATION`: Group without legal personality that can be party to proceedings (FR: association de fait, NL: feitelijke vereniging) - e.g., local action committee
- `OTHER`: Doesn't fit above categories
- `UNCLEAR`: Cannot determine from decision

**`parties[].proceduralRole`** - Enum (language-specific), REQUIRED

**If proceduralLanguage = "FR":**
- `DEMANDEUR`: Claimant/Plaintiff
- `DEFENDEUR`: Defendant
- `PLAIGNANT`: Complainant
- `PARTIE_INTERVENANTE`: Intervening party
- `TIERS_OPPOSANT`: Third-party objector
- `APPELANT`: Appellant
- `INTIME`: Respondent (in appeal)
- `DEMANDEUR_EN_CASSATION`: Plaintiff in cassation
- `DEFENDEUR_EN_CASSATION`: Defendant in cassation
- `MINISTERE_PUBLIC`: Public prosecutor
- `PARTIE_CIVILE`: Civil party
- `PREVENU`: Accused/Defendant (criminal)
- `PARTIE_CIVILEMENT_RESPONSABLE`: Civilly liable party
- `AUTRE`: Other role

**If proceduralLanguage = "NL":**
- `EISER`: Claimant/Plaintiff
- `VERWEERDER`: Defendant
- `KLAGER`: Complainant
- `TUSSENKOMENDE_PARTIJ`: Intervening party
- `DERDE_VERZETTENDE`: Third-party objector
- `APPELLANT`: Appellant
- `GE?NTIMEERDE`: Respondent (in appeal)
- `EISER_IN_CASSATIE`: Plaintiff in cassation
- `VERWEERDER_IN_CASSATIE`: Defendant in cassation
- `OPENBAAR_MINISTERIE`: Public prosecutor
- `BURGERLIJKE_PARTIJ`: Civil party
- `BEKLAAGDE`: Accused/Defendant (criminal)
- `BURGERLIJK_AANSPRAKELIJKE_PARTIJ`: Civilly liable party
- `ANDERE`: Other role

**Extraction rules:**
- Extract ALL parties mentioned
- Create sequential party IDs (001, 002, 003...)
- Expand initials to full names when possible
- Use UNCLEAR type when cannot determine
- Use DE_FACTO_ASSOCIATION for groups without legal personality

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
"facts": "En 2021, la d?fenderesse a publi? plusieurs offres d'emploi mentionnant des crit?res d'?ge (candidats de 25 ? 35 ans). Le Centre pour l'?galit? des chances a constat? ces pratiques discriminatoires et a introduit une action collective sans obtenir l'accord d'une victime identifi?e. La Cour d'appel de Bruxelles, par arr?t du 12 mai 2021, a d?clar? l'action irrecevable au motif que le Centre n'avait pas prouv? l'accord d'une personne l?s?e."
```

? **NEVER:**
- Create array of facts (must be single string)
- Invent facts not in decision
- Include legal conclusions as facts
- Include procedural history unrelated to substance

### Current Instance - REQUESTS

**`currentInstance.requests`** - Array of objects, OPTIONAL (extract only if present)
```json
{
  "partyId": "PARTY-{decisionId}-001",
  "requests": "Request text"
}
```

**CRITICAL**: 
- Field name is `requests` (plural), not `request`
- **Only extract if parties' requests are explicitly stated in decision**
- **Can be empty array if no requests mentioned** (common in short decisions)
- **Do NOT hallucinate or invent requests if not present**

**`requests[].partyId`** - String, REQUIRED (if request present)
- References `parties[].id`
- Format: `PARTY-{decisionId}-{sequence}`

**`requests[].requests`** - String, 50-1000 chars, REQUIRED (if request present)

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
- Capture ALL substantive requests per party (if present)
- 50-1000 characters (if verbatim exceeds 1000, consolidate)
- Preserve key legal terminology
- Procedural language

? **NEVER:**
- Invent requests not in decision
- Extract requests when decision doesn't mention them
- Confuse requests with arguments

**For short decisions (1-2 pages):** If no explicit requests section or "demande que" language, leave requests array empty rather than inventing.

### Current Instance - ARGUMENTS

**`currentInstance.arguments`** - Array of objects, OPTIONAL (extract only if present)
```json
{
  "partyId": "PARTY-{decisionId}-001",
  "argument": "Argument text",
  "treatment": "ENUM"
}
```

**CRITICAL**: 
- **Only extract if parties' arguments are explicitly stated in decision**
- **Can be empty array if no arguments mentioned** (common in short decisions)
- **Do NOT hallucinate or invent arguments if not present**

**`arguments[].partyId`** - String, REQUIRED (if argument present)
- References `parties[].id`

**`arguments[].argument`** - String, 200-2000 chars, REQUIRED (if argument present)

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
- Invent arguments not in decision
- Extract arguments when decision doesn't mention them
- Confuse party arguments with court reasoning
- Include only legal citations without reasoning
- Make arguments too brief (<200 chars)

**For short decisions (1-2 pages):** If no explicit arguments section or party submissions, leave arguments array empty rather than inventing.

**Consolidation principle:** If party makes comprehensive argument across many paragraphs, consolidate into single coherent argument entry.

**`arguments[].treatment`** - Enum (language-specific), REQUIRED (if argument present)

**If proceduralLanguage = "FR":**
- `ACCEPTE`: Argument accepted
- `PARTIELLEMENT_ACCEPTE`: Partially accepted
- `REJETE`: Rejected (on the merits)
- `RECEVABLE`: Admissible
- `IRRECEVABLE`: Inadmissible (Procedurally barred)
- `SANS_OBJET`: Moot / Without object (No longer needs to be addressed)
- `NON_TRAITE`: Not addressed by court
- `INCERTAIN`: Cannot determine treatment

**If proceduralLanguage = "NL":**
- `AANVAARD`: Accepted
- `GEDEELTELIJK_AANVAARD`: Partially accepted
- `VERWORPEN`: Rejected (on the merits)
- `ONTVANKELIJK`: Admissible
- `NIET-ONTVANKELIJK`: Inadmissible (Procedurally barred)
- `ZONDER_VOORWERP`: Moot / Without object (No longer needs to be addressed)
- `NIET_BEHANDELD`: Not addressed
- `ONZEKER`: Cannot determine treatment

### Current Instance - COURT ORDER

**`currentInstance.courtOrder`** - String, 50-5000+ chars, REQUIRED

**What is court order:**
- Operative part of decision (dispositif/beslissing) ONLY
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

? **STOP EXTRACTION BEFORE:**
- Footnotes (e.g., "Footnotes", "^6", "?")
- Procedural instructions about appeals/recourse
- Signatures and titles (e.g., "(S?). Hielke HUMANS Pr?sident")
- Page breaks or document metadata
- Any content after the operative decision is complete

**Example of what to EXCLUDE:**
```
? DO NOT INCLUDE:
Footnotes
${ }^{6}$ La requ?te contient ? peine de nullit?: $1^{6}$ l'indication...
(S?). Hielke HUMANS Pr?sident de la Chambre Contentieuse
```

**Example of CORRECT extraction:**
```
? CORRECT - Operative part only:
PAR CES MOTIFS,
la Chambre Contentieuse de l'Autorit? de protection des donn?es d?cide de retirer la d?cision 131/2024 du 11 octobre 2024.
Conform?ment ? l'article 108, ? 1 de la LCA, un recours contre cette d?cision peut ?tre introduit, dans un d?lai de trente jours ? compter de sa notification, aupr?s de la Cour des March?s (cour d'appel de Bruxelles), avec l'Autorit? de protection des donn?es comme partie d?fenderesse.
Un tel recours peut ?tre introduit au moyen d'une requ?te interlocutoire qui doit contenir les informations ?num?r?es ? l'article 1034ter du Code judiciaire. La requ?te interlocutoire doit ?tre d?pos?e au greffe de la Cour des March?s conform?ment ? l'article 1034quinquies du C. jud., ou via le syst?me d'information e-Deposit du Minist?re de la Justice (article 32ter du C. jud.).
```

? **NEVER include in courtOrder:**
- Footnote content
- Footnote markers/numbers
- Signatures
- Titles/positions after signatures
- Appeal instructions that are not part of the operative decision
- This field MUST be character-for-character exact for the operative part only

**Why verbatim required:** The courtOrder is the legally binding portion. Unlike descriptive fields (facts/arguments), this has legal force and must be exact.

**Recognition patterns for where to STOP:**
- FR: "Footnotes", "(S?).", "Pr?sident", "Greffier", line with just signature
- NL: "Voetnoten", "(Get.)", "Voorzitter", "Griffier", line with just signature
- Look for: Footnote markers (^, ${}^{number}$, ?), signature blocks, titles after decision text

### Current Instance - OUTCOME

**`currentInstance.outcome`** - Enum (language-specific), REQUIRED

**If proceduralLanguage = "FR":**
- `FONDE`: Granted/Founded
- `NON_FONDE`: Unfounded
- `RECEVABILITE`: Admissibility granted
- `IRRECEVABILITE`: Inadmissibility
- `REJET`: Dismissal
- `CONDAMNATION`: Order/Conviction
- `ACQUITTEMENT`: Acquittal
- `CONFIRMATION`: Confirmation
- `CONFIRMATION_PARTIELLE`: Partial Confirmation
- `REFORMATION`: Reformation/Variation
- `ANNULATION`: Annulment
- `ANNULATION_PARTIELLE`: Partial annulment
- `CASSATION`: Cassation/Quashing
- `CASSATION_PARTIELLE`: Partial cassation
- `RENVOI`: Remand
- `DECHEANCE`: Forfeiture/Lapse
- `DESSAISISSEMENT`: Declining Jurisdiction
- `DESISTEMENT`: Withdrawal
- `RETRAIT`: Retraction
- `SUSPENSION`: Suspension
- `RADIATION`: Striking from the roll
- `NON_LIEU_A_STATUER`: No need to rule
- `REVOCATION`: Revocation
- `AUTRE`: Other outcome

**If proceduralLanguage = "NL":**
- `GEGROND`: Granted/Founded
- `ONGEGROND`: Unfounded
- `ONTVANKELIJKHEID`: Admissibility granted
- `NIET_ONTVANKELIJKHEID`: Inadmissibility
- `AFWIJZING`: Dismissal
- `VEROORDELING`: Order/Conviction
- `VRIJSPRAAK`: Acquittal
- `BEVESTIGING`: Confirmation
- `GEDEELTELIJKE_BEVESTIGING`: Partial Confirmation
- `HERVORMING`: Reformation/Variation
- `VERNIETIGING`: Annulment
- `GEDEELTELIJKE_VERNIETIGING`: Partial annulment
- `CASSATIE`: Cassation
- `GEDEELTELIJKE_CASSATIE`: Partial cassation
- `VERWIJZING`: Remand
- `VERVAL`: Forfeiture/Lapse
- `ONTZEGGING_VAN_RECHTSMACHT`: Declining Jurisdiction
- `AFSTAND`: Withdrawal
- `INTREKKING`: Retraction
- `SCHORSING`: Suspension
- `DOORHALING`: Striking from the roll
- `GEEN_AANLEIDING_TOT_UITSPRAAK`: No need to rule
- `HERROEPING`: Revocation
- `ANDERE`: Other outcome

---

## EXTRACTION PROCESS

**Step 1: Identify sections**
- Header: Court, date, parties
- Facts: "Faits"/"En fait"/"Feiten"/"In feite"
- Requests: Conclusions, petitum, "demande que" (if present)
- Arguments: "Griefs"/"Moyens"/"Middelen" (if present)
- Reasoning: "Motifs"/"En droit"/"Overwegende dat"
- Dispositif: "PAR CES MOTIFS"/"OM DEZE REDENEN"

**Step 2: Extract reference citation**
- Construct formal citation: Court, date, case number, publication
- Follow standard Belgian legal citation format

**Step 3: Extract parties**
- ALL parties mentioned
- Expand initials to full names when possible
- Sequential IDs: 001, 002, 003...
- Determine type (including DE_FACTO_ASSOCIATION) and role for each

**Step 4: Extract facts as single string**
- Consolidate ALL factual background
- Maintain chronological flow
- Verbatim when clear, synthesis when scattered
- Single continuous text (not array)

**Step 5: Extract requests (if present)**
- What each party asks court to decide
- 50-1000 chars per request
- Field name: `requests` (plural)
- **Leave empty if not mentioned in decision**

**Step 6: Extract arguments (if present)**
- Main legal grounds per party
- 200-2000 chars per argument
- Classify treatment
- Consolidate multi-paragraph arguments
- **Leave empty if not mentioned in decision**

**Step 7: Extract court order - VERBATIM, OPERATIVE PART ONLY**
- Find dispositif
- Copy EXACTLY word-for-word
- **STOP before footnotes, signatures, or procedural instructions**
- No modifications whatsoever to operative text

**Step 8: Determine outcome**
- Use language-specific enum
- Match procedural language
- Consider court level and nature of decision

---

## EXAMPLES

### Example 1: Complete Extraction (French)

**Input excerpt:**
```
COUR DE CASSATION DE BELGIQUE
Arr?t du 15 mars 2023
Num?ro de r?le: C.21.0789.N
ECLI:BE:CASS:2023:ARR.20230315

ENTRE:
Le Centre interf?d?ral pour l'?galit? des chances (C.I.E.C.), demandeur en cassation
ET:
Banque Commerciale SA, d?fenderesse en cassation

FAITS:
Il ressort des pi?ces du dossier qu'en 2021, la d?fenderesse a publi?...
(factual narrative continues)

MOYENS:
Le demandeur invoque l'article 31, ? 2, de la loi du 10 mai 2007...

PAR CES MOTIFS,
LA COUR,
Casse partiellement l'arr?t attaqu?;
Renvoie la cause devant la cour d'appel de Bruxelles;
Condamne la d?fenderesse aux d?pens.

(S?). Jean DUPONT
Pr?sident de la Cour
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
      "name": "Centre interf?d?ral pour l'?galit? des chances",
      "type": "PUBLIC_AUTHORITY",
      "proceduralRole": "DEMANDEUR_EN_CASSATION"
    },
    {
      "id": "PARTY-ECLI:BE:CASS:2023:ARR.20230315-002",
      "name": "Banque Commerciale SA",
      "type": "LEGAL_ENTITY",
      "proceduralRole": "DEFENDEUR_EN_CASSATION"
    }
  ],
  "currentInstance": {
    "facts": "En 2021, la d?fenderesse a publi? plusieurs offres d'emploi mentionnant des crit?res d'?ge discriminatoires (candidats de 25 ? 35 ans). Le Centre interf?d?ral pour l'?galit? des chances a constat? ces pratiques et a introduit une action collective sans obtenir l'accord d'une victime identifi?e. La Cour d'appel de Bruxelles, par arr?t du 12 mai 2021, a d?clar? l'action irrecevable au motif que le Centre n'avait pas prouv? l'accord d'une personne l?s?e identifi?e.",
    "requests": [
      {
        "partyId": "PARTY-ECLI:BE:CASS:2023:ARR.20230315-001",
        "requests": "Le demandeur sollicite la cassation de l'arr?t d'appel du 12 mai 2021 qui a d?clar? son action irrecevable, et demande le renvoi de l'affaire devant une autre juridiction."
      }
    ],
    "arguments": [
      {
        "partyId": "PARTY-ECLI:BE:CASS:2023:ARR.20230315-001",
        "argument": "Le demandeur invoque l'article 31, ? 2, de la loi du 10 mai 2007 tendant ? lutter contre certaines formes de discrimination. Il soutient que l'exigence d'un accord individuel d'une personne l?s?e identifi?e ne s'applique pas lorsque la discrimination affecte potentiellement un nombre ind?termin? de personnes, car dans ce cas, l'int?r?t collectif ? combattre la discrimination g?n?ralis?e doit l'emporter sur la protection des droits individuels ? la vie priv?e.",
        "treatment": "ACCEPTE"
      }
    ],
    "courtOrder": "PAR CES MOTIFS,\nLA COUR,\nCasse partiellement l'arr?t attaqu?;\nRenvoie la cause devant la cour d'appel de Bruxelles;\nCondamne la d?fenderesse aux d?pens.",
    "outcome": "CASSATION_PARTIELLE"
  }
}
```

### Example 2: Short Decision - No Requests/Arguments (French)

**Input excerpt:**
```
AUTORIT? DE PROTECTION DES DONN?ES
D?cision du 11 octobre 2024
D?cision 131/2024

La Chambre Contentieuse d?cide de retirer la d?cision 131/2024.

PAR CES MOTIFS,
la Chambre Contentieuse de l'Autorit? de protection des donn?es d?cide de retirer la d?cision 131/2024 du 11 octobre 2024.
```

**Output:**
```json
{
  "reference": {
    "citationReference": "APD, 11 octobre 2024, D?cision 131/2024"
  },
  "parties": [],
  "currentInstance": {
    "facts": "La Chambre Contentieuse a pris une d?cision portant le num?ro 131/2024 qu'elle a d?cid? de retirer.",
    "requests": [],
    "arguments": [],
    "courtOrder": "PAR CES MOTIFS,\nla Chambre Contentieuse de l'Autorit? de protection des donn?es d?cide de retirer la d?cision 131/2024 du 11 octobre 2024.",
    "outcome": "RETRAIT"
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
- [ ] `type` includes DE_FACTO_ASSOCIATION option
- [ ] `proceduralRole` uses language-specific enums

**Facts:**
- [ ] Single string (not array)
- [ ] Complete factual narrative
- [ ] Accurate (synthesis acceptable)
- [ ] Procedural language

**Requests (OPTIONAL):**
- [ ] Field name is `requests` (plural)
- [ ] 50-1000 chars per request (if present)
- [ ] Valid `partyId` references
- [ ] Empty array if not mentioned in decision
- [ ] NOT invented/hallucinated

**Arguments (OPTIONAL):**
- [ ] 200-2000 chars per argument (if present)
- [ ] Legal basis + reasoning
- [ ] Valid `partyId` references
- [ ] `treatment` uses language-specific enums
- [ ] Empty array if not mentioned in decision
- [ ] NOT invented/hallucinated

**Court Order:**
- [ ] VERBATIM from dispositif (operative part only)
- [ ] Complete operative parts
- [ ] 50+ chars
- [ ] NO footnotes, signatures, or procedural instructions
- [ ] NO synthesis or paraphrasing

**Outcome:**
- [ ] Language-specific enum (FR or NL)
- [ ] Matches procedural language
- [ ] Appropriate for decision type

**Quality:**
- [ ] Nothing invented
- [ ] All content in procedural language
- [ ] All enums match language
- [ ] Valid JSON syntax

---

## CRITICAL REMINDERS

1. **Schema Compliance**: Use EXACT field names from schema
2. **Updated Enums**: Use revised comprehensive enums
3. **Facts = Single String**: Not an array, consolidate into one narrative
4. **Requests = OPTIONAL**: Empty array if not in decision, DO NOT invent
5. **Arguments = OPTIONAL**: Empty array if not in decision, DO NOT invent
6. **Party Types**: Include DE_FACTO_ASSOCIATION option
7. **Court Order = Operative Part ONLY**: Stop before footnotes/signatures
8. **Expand Initials**: Extract full names when determinable
9. **Character Limits**: requests 50-1000, arguments 200-2000
10. **No Translation**: Everything in procedural language

**OUTPUT:** Return ONLY valid JSON matching schema exactly. No markdown, no code blocks, no explanatory text.