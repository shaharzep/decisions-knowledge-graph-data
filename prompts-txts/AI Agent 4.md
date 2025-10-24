# MISSION

Generate 8-12 short, scannable keywords that allow lawyers to quickly understand what this decision is about when viewing search result cards.

# MODEL OPTIMIZATION

Focus on:
1. Analyzing the decision holistically
2. Selecting most representative keywords
3. Balancing legal and factual concepts
4. Creating scannable, practical keywords

# INPUT

You will receive:

1. **Decision ID**: `{decisionId}`
2. **Procedural Language**: `{proceduralLanguage}`
3. **Facts**: `{facts}` (Array of strings from Stage 1)
4. **Cited Provisions**: `{citedProvisions}` (Array of provision objects from Stages 2A-2C)
5. **Markdown Text**: `{fullText.markdown}`

# CRITICAL: LANGUAGE HANDLING

Write ALL keywords in the procedural language of the input.

- If procedural language is **FR** → write keywords in French
- If procedural language is **NL** → write keywords in Dutch

# OBJECTIVE

Create keywords that answer these questions in 3-4 seconds:
- What area of law?
- What happened (factually)?
- What was disputed?
- Is there anything distinctive?

# KEYWORD FRAMEWORK (8-12 KEYWORDS TOTAL)

Extract keywords across 4 dimensions:

## 1. LEGAL DOMAIN (1 keyword - REQUIRED)

**Purpose:** Broad categorization of area of law

**Examples (FR):**
- Droit du travail
- Droit commercial
- Droit de la consommation
- Droit de la responsabilité
- Discrimination
- Protection des données
- Droit administratif

**Examples (NL):**
- Arbeidsrecht
- Handelsrecht
- Consumentenrecht
- Aansprakelijkheidsrecht
- Discriminatie
- Gegevensbescherming
- Bestuursrecht

## 2. FACTUAL SITUATION (3-5 keywords - PRIORITY)

**Purpose:** Describe what actually happened in concrete, practical terms

**This is your MOST IMPORTANT category - allocate most keywords here**

**What to capture:**
- Type of contract or relationship
- Type of transaction or event
- Parties' roles (generic: "Employeur-travailleur", "Werkgever-werknemer")
- Specific factual scenario
- Industry/sector if relevant
- Nature of the relationship

**Examples (FR):**
- Licenciement
- Contrat de travail
- Offre d'emploi
- Rupture de contrat
- Services bancaires
- Accident de la route
- Contrat de distribution
- Relation commerciale

**Examples (NL):**
- Ontslag
- Arbeidsovereenkomst
- Vacature
- Contractbeëindiging
- Bankdiensten
- Verkeersongeval
- Distributieovereenkomst
- Handelsrelatie

## 3. KEY DISPUTE (3-4 keywords - HIGH PRIORITY)

**Purpose:** Core legal issues, contested concepts, relief sought

**This is your SECOND MOST IMPORTANT category**

**What to capture:**
- Main legal grounds invoked
- Key contested concepts
- Type of rights/obligations disputed
- Relief sought (damages, nullity, injunction)
- Legal defenses raised

**Examples (FR):**
- Discrimination par l'âge
- Critères discriminatoires
- Clause abusive
- Résiliation abusive
- Préavis insuffisant
- Dommages-intérêts
- Nullité du contrat
- Action collective

**Examples (NL):**
- Leeftijdsdiscriminatie
- Discriminerende criteria
- Onredelijk beding
- Onrechtmatige beëindiging
- Ontoereikende opzegtermijn
- Schadevergoeding
- Nietigheid van contract
- Collectieve vordering

## 4. DISTINCTIVE ELEMENT (0-2 keywords - OPTIONAL)

**Purpose:** Notable characteristics that make this case memorable or unusual

**Include procedural distinctiveness:**
- Référé / Kortgeding
- Procédure d'urgence / Spoedprocedure
- Question préjudicielle / Prejudiciële vraag

**Include substantive distinctiveness:**
- Revirement de jurisprudence / Rechtspraakwijziging
- Interprétation nouvelle / Nieuwe interpretatie
- Droit européen / Europees recht

**Only include if truly distinctive - otherwise skip this category**

# KEYWORD REQUIREMENTS

## Length & Format

- **(REQUIRED)** Total keywords: 8-12 (not more, not less)
- **(REQUIRED)** Per keyword: 1-4 words maximum, 3-50 chars
- **Format:** Short phrases, not sentences
- **Language:** Use procedural language of decision

## Style Rules

**DO:** 
✅ Use terms lawyers actually search for
✅ Focus on concrete, practical concepts
✅ Prioritize factual clarity over legal technicality
✅ Use recognizable terms (not obscure jargon)
✅ Think: "What would I want to know in 3 seconds?"
✅ Balance general and specific

**DON'T:** 
❌ Use overly generic terms ("Droit", "Justice", "Wet", "Recht" alone)
❌ Include party names (unless landmark case)
❌ Include specific amounts, dates, or article numbers
❌ Use full sentences
❌ Repeat similar concepts
❌ Exceed 4 words per keyword
❌ Extract more than 12 keywords

## Allocation Strategy

**For simple cases (8 keywords):**
- 1 Legal Domain
- 3 Factual Situation
- 3 Key Dispute
- 1 Distinctive Element

**For standard cases (10 keywords):**
- 1 Legal Domain
- 4 Factual Situation
- 4 Key Dispute
- 1 Distinctive Element

**For complex cases (12 keywords):**
- 1 Legal Domain
- 5 Factual Situation
- 4 Key Dispute
- 2 Distinctive Elements

# EXTRACTION PROCESS

## Step 1: Identify Legal Domain (1 keyword)

Read the decision and determine the broadest applicable legal category.

## Step 2: Extract Factual Keywords (3-5 keywords)

Focus on concrete situations:
- What type of contract/relationship?
- What transaction occurred?
- What roles/parties are involved?
- What sector/industry?
- What specific scenario?

## Step 3: Extract Key Dispute Keywords (3-4 keywords)

Identify legal issues:
- What rights are contested?
- What legal concepts are invoked?
- What relief is sought?
- What defenses are raised?

## Step 4: Check for Distinctive Elements (0-2 keywords)

Only if case has truly notable characteristics:
- Unusual procedural aspects?
- Notable substantive aspects?

## Step 5: Validate

- Total between 8-12 keywords?
- Each keyword 1-4 words?
- Mix of factual and legal?
- Scannable in 3-4 seconds?
- All in procedural language?

# CRITICAL OUTPUT FORMAT REQUIREMENTS

You MUST output valid JSON with TWO purposes:

1. **For the database** (stored): `customKeywords` array only
2. **For self-validation** (discarded after extraction): `metadata` object

The metadata helps you validate your own work but is NOT stored in the database.

## Required Output Structure
```json
{
  "customKeywords": [
    "Legal Domain Keyword",
    "Factual Keyword 1",
    "Factual Keyword 2",
    "Factual Keyword 3",
    "Factual Keyword 4",
    "Dispute Keyword 1",
    "Dispute Keyword 2",
    "Dispute Keyword 3",
    "Distinctive Keyword 1"
  ],
  "metadata": {
    "totalKeywords": 9,
    "keywordBreakdown": {
      "legalDomain": 1,
      "factualSituation": 4,
      "keyDispute": 3,
      "distinctiveElement": 1
    },
    "validationChecks": {
      "keywordCountInRange": true,
      "allKeywordsShort": true,
      "noGenericTerms": true,
      "noPartyNames": true,
      "balancedMix": true
    }
  }
}
```

**IMPORTANT NOTES:**
- **Database storage**: Only `customKeywords` array is stored
- **Metadata purpose**: Self-validation only, discarded after extraction
- **Output format**: Must include both sections for validation purposes
- **No markdown blocks**: Output only the JSON, no code blocks or extra text

## MANDATORY VALIDATION REQUIREMENTS

1. **customKeywords array:** (THIS IS WHAT GETS STORED)
    - **(REQUIRED)** Minimum 8 items, maximum 12 items
    - Each keyword: **(REQUIRED)** min 3 chars, max 50 chars
    - All keywords in procedural language

2. **metadata.totalKeywords:** (FOR VALIDATION ONLY)
    - **(REQUIRED)** Integer between 8-12 (must match array length)

3. **metadata.keywordBreakdown:** (FOR VALIDATION ONLY - ALL REQUIRED)
    - legalDomain: integer, must be 1
    - factualSituation: integer, min 3, max 5
    - keyDispute: integer, min 3, max 4
    - distinctiveElement: integer, min 0, max 2
    - **Sum must equal totalKeywords**

4. **metadata.validationChecks:** (FOR VALIDATION ONLY - ALL REQUIRED, ALL MUST BE BOOLEAN)
    - keywordCountInRange: true/false
    - allKeywordsShort: true/false (each keyword 1-4 words)
    - noGenericTerms: true/false
    - noPartyNames: true/false
    - balancedMix: true/false

5. **Output ONLY the JSON** - no explanations, no markdown blocks, no extra text

# EXAMPLES

## Example 1: Employment Discrimination (French Decision, 10 keywords)

**Context:** Equality body sues over age discriminatory job posting

**Output:**
```json
{
  "customKeywords": [
    "Droit du travail",
    "Offre d'emploi",
    "Recrutement",
    "Critères d'âge",
    "Secteur bancaire",
    "Discrimination par l'âge",
    "Action collective",
    "Recevabilité",
    "Cassation partielle",
    "Renvoi"
  ],
  "metadata": {
    "totalKeywords": 10,
    "keywordBreakdown": {
      "legalDomain": 1,
      "factualSituation": 4,
      "keyDispute": 3,
      "distinctiveElement": 2
    },
    "validationChecks": {
      "keywordCountInRange": true,
      "allKeywordsShort": true,
      "noGenericTerms": true,
      "noPartyNames": true,
      "balancedMix": true
    }
  }
}
```

**Keyword breakdown:**
- Legal Domain (1): "Droit du travail"
- Factual Situation (4): "Offre d'emploi", "Recrutement", "Critères d'âge", "Secteur bancaire"
- Key Dispute (3): "Discrimination par l'âge", "Action collective", "Recevabilité"
- Distinctive Element (2): "Cassation partielle", "Renvoi"

## Example 2: Contract Dispute (Dutch Decision, 8 keywords)

**Context:** Breach of distribution agreement

**Output:**
```json
{
  "customKeywords": [
    "Handelsrecht",
    "Distributieovereenkomst",
    "Contractbeëindiging",
    "Leverancier-distributeur",
    "Onrechtmatige beëindiging",
    "Schadevergoeding",
    "Opzegtermijn",
    "Kortgeding"
  ],
  "metadata": {
    "totalKeywords": 8,
    "keywordBreakdown": {
      "legalDomain": 1,
      "factualSituation": 3,
      "keyDispute": 3,
      "distinctiveElement": 1
    },
    "validationChecks": {
      "keywordCountInRange": true,
      "allKeywordsShort": true,
      "noGenericTerms": true,
      "noPartyNames": true,
      "balancedMix": true
    }
  }
}
```

**Keyword breakdown:**
- Legal Domain (1): "Handelsrecht"
- Factual Situation (3): "Distributieovereenkomst", "Contractbeëindiging", "Leverancier-distributeur"
- Key Dispute (3): "Onrechtmatige beëindiging", "Schadevergoeding", "Opzegtermijn"
- Distinctive Element (1): "Kortgeding"

## Example 3: Consumer Protection (French Decision, 12 keywords)

**Context:** Bank liable for unauthorized transactions

**Output:**
```json
{
  "customKeywords": [
    "Droit de la consommation",
    "Services bancaires",
    "Transactions en ligne",
    "Carte bancaire",
    "Opérations non autorisées",
    "Relation banque-client",
    "Responsabilité bancaire",
    "Obligation de vigilance",
    "Remboursement",
    "Préjudice moral",
    "Interprétation stricte",
    "Protection du consommateur"
  ],
  "metadata": {
    "totalKeywords": 12,
    "keywordBreakdown": {
      "legalDomain": 1,
      "factualSituation": 5,
      "keyDispute": 4,
      "distinctiveElement": 2
    },
    "validationChecks": {
      "keywordCountInRange": true,
      "allKeywordsShort": true,
      "noGenericTerms": true,
      "noPartyNames": true,
      "balancedMix": true
    }
  }
}
```

**Keyword breakdown:**
- Legal Domain (1): "Droit de la consommation"
- Factual Situation (5): "Services bancaires", "Transactions en ligne", "Carte bancaire", "Opérations non autorisées", "Relation banque-client"
- Key Dispute (4): "Responsabilité bancaire", "Obligation de vigilance", "Remboursement", "Préjudice moral"
- Distinctive Element (2): "Interprétation stricte", "Protection du consommateur"

# QUALITY CRITERIA

Before finalizing, verify:

**Count & Length:**
- ✅ 8-12 keywords total
- ✅ Each keyword 3-50 chars
- ✅ Each keyword 1-4 words
- ✅ Readable in 3-4 seconds

**Distribution:**
- ✅ 1 Legal Domain keyword
- ✅ 3-5 Factual Situation keywords
- ✅ 3-4 Key Dispute keywords
- ✅ 0-2 Distinctive keywords (if applicable)

**Quality:**
- ✅ Mix of factual (50%) and legal (40%) and distinctive (10%)
- ✅ Concrete and practical (not overly technical)
- ✅ Searchable terms (lawyers would use these)
- ✅ No generic terms ("Droit", "Justice", "Wet" alone)
- ✅ No party names
- ✅ No specific dates/amounts/article numbers
- ✅ Balanced coverage of case essence
- ✅ All in procedural language

**Scanning Test:**
- ✅ Can understand case type in 3-4 seconds?
- ✅ Clear what happened factually?
- ✅ Clear what was disputed legally?
- ✅ Keywords differentiate this from other cases?

**Validation:**
- ✅ metadata.totalKeywords matches customKeywords array length
- ✅ metadata.keywordBreakdown sums to totalKeywords
- ✅ All metadata.validationChecks are true

# CRITICAL REMINDERS

1. **Language:** ALL keywords in procedural language (FR or NL)
2. **Prioritize factual clarity** - Extra keywords go to Factual Situation first
3. **Keep it scannable** - Must read in 3-4 seconds max
4. **Balance facts and law** - Roughly 50% factual, 40% legal, 10% distinctive
5. **No procedural stage keywords** - Court level shown elsewhere (don't use "Appel", "Cassation", "Beroep" as keywords unless truly distinctive procedural aspect)
6. **Short phrases only** - 1-4 words per keyword maximum
7. **8-12 keywords always** - Not more, not less
8. **Think search card** - What helps lawyer decide relevance quickly?
9. **Output format** - Include both customKeywords (stored) and metadata (validation only)
10. **No markdown** - Output only JSON, no code blocks

# VALIDATION CHECKLIST

Before submitting your output, verify:

**Structure:**
- [ ] JSON has `customKeywords` array
- [ ] JSON has `metadata` object with all required fields
- [ ] No markdown code blocks, no explanatory text

**Keywords Array:**
- [ ] Contains 8-12 keywords
- [ ] Each keyword is 3-50 characters
- [ ] Each keyword is 1-4 words
- [ ] All keywords in procedural language
- [ ] No party names
- [ ] No dates, amounts, or article numbers
- [ ] No overly generic terms

**Metadata (for self-validation):**
- [ ] totalKeywords matches array length
- [ ] keywordBreakdown.legalDomain = 1
- [ ] keywordBreakdown.factualSituation = 3-5
- [ ] keywordBreakdown.keyDispute = 3-4
- [ ] keywordBreakdown.distinctiveElement = 0-2
- [ ] Sum of breakdown equals totalKeywords
- [ ] All validationChecks are boolean
- [ ] All validationChecks are true

---

## OUTPUT FORMAT

Return ONLY valid JSON matching the schema. No markdown, no code blocks, no explanatory text.