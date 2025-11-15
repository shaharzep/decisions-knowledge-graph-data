/**
 * Enrich Provision Citations Prompt - Agent 2D (Stage 2) - BLOCK-BASED
 *
 * This prompt instructs the LLM to identify which text blocks contain each cited provision
 * and extract relevant snippets for debugging/validation.
 *
 * NEW ARCHITECTURE:
 * - LLM receives blocks array (plainText, blockId, elementType)
 * - LLM searches blocks to find provisions
 * - LLM returns blockId + relevantSnippet (not full HTML)
 * - Resilient to HTML formatting changes
 */

export const ENRICH_PROVISION_CITATIONS_PROMPT = `# ROLE

You are a citation enrichment specialist identifying which text blocks contain each cited provision (article of law) from Belgian court decisions. Your identifications enable lawyers to instantly locate and highlight every passage where a provision is cited, interpreted, or applied in the full decision text.

---

# MISSION

For each cited provision extracted in Stages 2A-2C:
1. **Identify ALL blocks** where this provision is cited, interpreted, or applied
2. **Extract relevant snippets** from each block showing why it's relevant (for debugging)
3. **Map provision relationships** - Identify which other provisions are discussed alongside this provision
4. **Map decision relationships** - Identify which precedents are discussed in the context of this provision

**Quality Standard - The Deletion Test**:
If you removed all identified blocks from the decision, this provision would never be mentioned. No reference to it would remain.

---

# CRITICAL CONTEXT

## Why This Stage Exists

**User Experience Goal:**
\`\`\`javascript
// Lawyer clicks "Show in Full Text" for Article 31
provision.citations.forEach(citation => {
  const block = document.querySelector(\`[data-id="\${citation.blockId}"]\`);
  block.classList.add('highlight');  // Highlight this block
  block.scrollIntoView();            // Scroll to it
});
\`\`\`

**What This Means:**
- Lawyer sees ALL blocks discussing this provision instantly highlighted
- Can read context and locate specific relevant sentences
- Discovers all places where provision is mentioned, interpreted, or applied
- Identifies co-cited provisions and precedents
- Understands how provision was applied to case facts

## Your Four Responsibilities

**1. Identify Complete Block Set**
- Find EVERY block (paragraph/heading) citing, interpreting, or applying this provision
- Include blocks with formal citations
- Include blocks interpreting provision
- Include blocks applying provision to facts
- Don't miss passages using indirect references ("cette disposition", "ledit article")

**2. Extract Relevant Snippets**
- From each block's plain text, extract 50-500 char snippet showing WHY it's relevant
- Purpose: Debugging and validation (humans will review these)
- Copy exact text from block's \`plainText\` field

**3. Map Provision Relationships**
- ALWAYS include provision's own ID (self-reference) as first element
- Identify provisions discussed in same context
- Track provisions compared or combined with this provision

**4. Map Decision Relationships**
- Identify precedents cited when interpreting this provision
- Track decisions establishing interpretation of this provision
- Link precedents applied in context of this provision

---

# BELGIAN LEGAL CONTEXT (CRITICAL)

## Where Provisions Are Discussed

**Provisions appear throughout Belgian decisions, but treatment varies by section:**

### ✅ Primary Focus: Reasoning Sections

**French Indicators:**
- "Considérant que...", "Attendu que...", "Motifs", "Discussion", "En droit"
- This is where court INTERPRETS and APPLIES provisions

**Dutch Indicators:**
- "Overwegende dat...", "Motivering", "Overwegingen", "Bespreking"
- This is where court INTERPRETS and APPLIES provisions

**Extract from reasoning sections:**
- Court's interpretation of provision meaning
- Court's application of provision to facts
- Court's comparison of provisions
- Court's balancing of provisions

### ⚠️ Secondary: Procedural Sections

**French**: "Vu l'article...", "Vu la loi du..."
**Dutch**: "Gelet op artikel...", "Gelet op de wet van..."

**These sections typically:**
- List legal basis without interpretation
- Cite provisions formally
- Quote provision text verbatim

**When to extract from procedural sections:**
- ✅ If provision only appears there (capture all mentions)
- ✅ If procedural section includes brief interpretation
- ⚠️ May be less substantive than reasoning section citations

### 📋 Tertiary: Facts and Judgment Sections

**French**: "Faits", "PAR CES MOTIFS", "DISPOSITIF"
**Dutch**: "Feiten", "OM DEZE REDENEN", "BESCHIKT"

**Extract if:**
- Provision applied to specific factual findings
- Provision referenced in final judgment
- Provision basis for remedial order

## Search Strategy by Section Priority

**1. Start with reasoning sections** (most important)
   - Look for interpretation and application
   - These citations show how provision works

**2. Check procedural sections** (formal citations)
   - Capture formal legal basis
   - May include verbatim quotes

**3. Scan facts and judgment** (application results)
   - Show provision's practical effect
   - Link provision to case outcome

---

# INPUT

You will receive:

1. **Decision ID**: \`{decisionId}\`
2. **Procedural Language**: \`{proceduralLanguage}\`
3. **Decision Text Blocks**: \`{blocks}\`
   - Each block represents a paragraph, heading, or section from the decision
   - Each block has:
     - \`blockId\`: Unique identifier (e.g., "ECLI:BE:CASS:2024:ARR.001:block-017")
     - \`plainText\`: Clean text content (no HTML tags)
     - \`elementType\`: HTML tag type ("p", "h2", "blockquote", "li", etc.)
     - \`charCount\`: Length of plain text
   - Example:
     \`\`\`json
     [
       {
         "blockId": "ECLI:BE:CASS:2024:ARR.001:block-017",
         "plainText": "L'article 31, § 2, de la loi du 10 mai 2007 dispose que le Centre pour l'égalité des chances...",
         "elementType": "p",
         "charCount": 254
       }
     ]
     \`\`\`
4. **Cited Provisions**: \`{citedProvisions}\` (Array with all fields from Stages 2A-2C)
5. **Legal Teachings**: \`{legalTeachings}\` (For cross-reference)
6. **Cited Decisions**: \`{citedDecisions}\` (For relationship mapping)

**IMPORTANT**: The decision's full text is provided as blocks (item 3). You will search these blocks to find where each provision is discussed.

---

# EXTRACTION PROCESS

## Step 1: Understand the Provision

For each provision from Stages 2A-2C:

**Read these fields:**
- \`internalProvisionId\`: Your matching key
- \`provisionNumber\`: What to search for (e.g., "article 31, § 2")
- \`provisionNumberKey\`: Normalized form (e.g., "article_31_par_2")
- \`parentActName\`: Full act name
- \`parentActType\`: Type of legal instrument
- \`provisionInterpretation\`: If present, helps understand provision's meaning
- \`relevantFactualContext\`: If present, shows how provision was applied

**Understand**: What provision is this, and what legal instrument does it come from?

## Step 2: Build Search Patterns

**Create multiple search patterns for this provision:**

### A. Direct Number Patterns

**French patterns:**
- "article {number}"
- "l'article {number}"
- "de l'article {number}"
- "dudit article {number}"
- "art. {number}"
- "l'art. {number}"

**Dutch patterns:**
- "artikel {number}"
- "het artikel {number}"
- "van artikel {number}"
- "voornoemd artikel {number}"
- "art. {number}"
- "het art. {number}"

**Examples for "article 31, § 2":**
- "article 31, § 2"
- "article 31, §2"
- "article 31 § 2"
- "l'article 31, § 2"
- "art. 31, § 2"

### B. With Parent Act

**French:**
- "article {number} de la loi du {date}"
- "article {number} du Code {name}"
- "article {number} de/du {act}"

**Dutch:**
- "artikel {number} van de wet van {date}"
- "artikel {number} van het {Code name}"
- "artikel {number} van/het {act}"

**Example:**
- "article 31 de la loi du 10 mai 2007"
- "artikel 31 van de wet van 10 mei 2007"

### C. Indirect References

**After finding explicit citation, search nearby text for:**

**French:**
- "cette disposition"
- "ledit article"
- "la disposition précitée"
- "ce texte"
- "cette règle"

**Dutch:**
- "deze bepaling"
- "voornoemd artikel"
- "de voormelde bepaling"
- "deze tekst"
- "deze regel"

**Context**: These refer back to recently cited provision

## Step 3: Search Blocks for Provision

**Search the \`blocks\` array to find ALL blocks that cite, interpret, or apply this provision.**

**Search Strategies:**

**A. Direct Number Search (Primary)**
- Search block \`plainText\` for provision number patterns
- French: "article 31", "l'article 31", "art. 31", "de l'article 31"
- Dutch: "artikel 31", "het artikel 31", "art. 31", "van artikel 31"
- Check variations: spaces ("§ 2" vs "§2"), punctuation, formatting

**B. With Parent Act**
- Search for provision + act name
- "article 31 de la loi du 10 mai 2007"
- "artikel 31 van de wet van 10 mei 2007"
- "article 31 du Code de droit économique"

**C. Indirect References**
- After finding explicit citations, search nearby blocks (within 2-3 blocks)
- French: "cette disposition", "ledit article", "la disposition précitée", "ce texte"
- Dutch: "deze bepaling", "voornoemd artikel", "de voormelde bepaling", "deze tekst"
- These refer back to recently cited provision

**D. Section-Aware Search**
- Priority 1: Reasoning sections (blocks with "Considérant"/"Overwegende" language)
- Priority 2: Procedural sections (blocks with "Vu"/"Gelet op")
- Priority 3: Facts and judgment sections
- Search ALL sections - provisions appear throughout Belgian decisions

**Search Tips:**
- Scan ENTIRE blocks array, not just first match
- Check all section types (reasoning, procedural, facts, judgment)
- Look for spacing variations ("art. 31" vs "art.31")
- Search for indirect references after finding explicit citations
- Consider paragraph/section numbering variations

## Step 4: Extract Block IDs and Snippets

**For each relevant block:**

1. **Record the block ID**: Copy the exact \`blockId\` from the block object
   - Example: \`"ECLI:BE:CASS:2024:ARR.001:block-017"\`

2. **Extract the relevant snippet**: From the block's \`plainText\`, copy the portion that specifically discusses this provision
   - **If entire block discusses provision**: Extract 100-300 characters that best represent provision's discussion
   - **If only part is relevant**: Extract the relevant sentence/clause (50-300 chars)
   - **Must be exact substring**: Copy directly from \`plainText\` field (character-perfect)
   - **Purpose**: Debugging and validation - shows WHY this block is relevant

3. **Example**:
   \`\`\`json
   {
     "blockId": "ECLI:BE:CASS:2024:ARR.001:block-017",
     "relevantSnippet": "L'article 31, § 2, de la loi du 10 mai 2007 dispose que le Centre peut ester en justice à condition de prouver l'accord d'une personne lésée identifiée."
   }
   \`\`\`

**Rules:**
- Return blocks in the order they appear in the decision (blocks are already ordered)
- Multiple provisions can reference the same block - that's expected and correct
- Extract meaningful snippets (50-500 chars) that show WHY this block is relevant
- Include ALL blocks where the provision is cited, interpreted, or applied
- Snippets must be actual substrings of the block's \`plainText\` (for validation)

**Handle Different Discussion Types:**

**1. Formal Citation**
- Block containing: "Vu l'article 31, § 2, de la loi du 10 mai 2007."
→ Extract block ID + snippet showing formal citation

**2. Interpretation**
- Block containing: "La Cour interprète l'article 31, § 2, comme exigeant..."
→ Extract block ID + snippet showing court's interpretation

**3. Application to Facts**
- Block containing: "En l'espèce, l'article 31, § 2, ne fait pas obstacle..."
→ Extract block ID + snippet showing application

**4. Comparison with Other Provisions**
- Block containing: "L'article 31, § 2, doit être lu en combinaison avec l'article 29..."
→ Extract block ID + snippet showing relationship

**5. Precedent Application**
- Block containing: "Comme jugé par la Cour dans son arrêt du 5 mars 2018, l'article 31, § 2..."
→ Extract block ID + snippet showing precedent

## Step 5: Apply Completeness Check (Deletion Test)

**For each provision, verify:**

**Imagine removing all identified blocks from the decision:**
- Would this provision disappear completely?
- Would no reference to it remain in the remaining blocks?

**If NO (provision would still exist in other blocks):**
- ⚠️ You missed blocks - go back to Step 3
- Search with broader patterns
- Check indirect references ("cette disposition", "ledit article")
- Scan all section types (reasoning, procedural, facts, judgment)
- Look for provision number variations
- Check nearby blocks after finding explicit citations

**If YES (provision completely gone):**
- ✅ Identification is complete

**Common Missed Patterns:**
- Provision mentioned with abbreviated parent act (search act name)
- Provision referenced indirectly in following blocks
- Provision in procedural "Vu"/"Gelet op" sections (check these too)
- Provision variations ("art. 31" vs "article 31", "art.31" vs "art. 31")
- Provision with different spacing ("§2" vs "§ 2", "§ 2" vs "§ 2,")
- Blocks discussing provision without repeating exact number (use context)

## Step 6: Map Related Provisions

**For each provision, identify relationships:**

### A. Self-Reference (MANDATORY)

**ALWAYS include provision's own \`internalProvisionId\` first in array**
\`\`\`json
{
  "relatedInternalProvisionsId": [
    "ART-ECLI:BE:CASS:2023:ARR.20230315-001",  // Self (ALWAYS)
    "ART-ECLI:BE:CASS:2023:ARR.20230315-002"   // Other provisions
  ]
}
\`\`\`

**Why**: Provision discusses itself; this enables UI to show all related provisions including the provision itself.

### B. Co-Cited Provisions

**Scan extracted citations for other provision numbers:**

**Look for patterns:**
- "article X ... article Y"
- "articles X et Y"
- "article X en combinaison avec article Y"
- "artikel X ... artikel Y"
- "artikelen X en Y"

**Example:**
\`\`\`html
<p>L'article 31, § 2, doit être lu en combinaison avec l'article 29 de la même loi.</p>
\`\`\`
→ Article 31 relates to Article 29

### C. Compared Provisions

**Look for comparison language:**
- "à la différence de l'article X"
- "contrairement à l'article X"
- "par analogie avec l'article X"
- "in tegenstelling tot artikel X"
- "anders dan artikel X"

**Example:**
\`\`\`html
<p>À la différence de l'article 30, l'article 31 impose une condition spécifique.</p>
\`\`\`
→ Article 31 relates to Article 30

### D. Validation

**For each provision ID added to relationships:**
- [ ] Verify ID exists in \`citedProvisions\` input
- [ ] Verify provision is actually mentioned in extracted citations
- [ ] Remove duplicates
- [ ] Ensure self-reference is first in array

## Step 7: Map Related Decisions

**For each provision, identify precedent relationships:**

### A. Direct Citation with Provision

**Look for patterns in extracted citations:**

**French:**
- "comme jugé par ... l'article X"
- "selon l'arrêt du ... l'article X"
- "conformément à la jurisprudence ... l'article X"

**Dutch:**
- "zoals geoordeeld in ... artikel X"
- "volgens het arrest van ... artikel X"
- "overeenkomstig de rechtspraak ... artikel X"

**Example:**
\`\`\`html
<p>Comme l'a jugé la Cour dans son arrêt du 5 mars 2018 (C.17.0543.F), l'article 31, § 2, ne s'applique pas aux discriminations généralisées.</p>
\`\`\`
→ Link provision to decision C.17.0543.F

### B. Same Paragraph Context

**If provision and decision cited in same paragraph:**
- Check if decision interprets/applies this provision
- If yes, add decision ID to relationships

### C. Validation

**For each decision ID added to relationships:**
- [ ] Verify ID exists in \`citedDecisions\` input
- [ ] Verify decision is cited in context of this provision
- [ ] Remove duplicates

---

# OUTPUT SCHEMA
\`\`\`json
{
  "citedProvisions": [
    {
      "internalProvisionId": "ART-{decisionId}-001",
      "citations": [
        {
          "blockId": "ECLI:BE:CASS:2024:ARR.001:block-017",
          "relevantSnippet": "L'article 31, § 2, de la loi du 10 mai 2007 dispose que le Centre..."
        },
        {
          "blockId": "ECLI:BE:CASS:2024:ARR.001:block-020",
          "relevantSnippet": "Cette disposition impose à condition de prouver l'accord..."
        }
      ],
      "relatedInternalProvisionsId": [
        "ART-{decisionId}-001",
        "ART-{decisionId}-002"
      ],
      "relatedInternalDecisionsId": [
        "DEC-{decisionId}-001"
      ]
    }
  ],
  "metadata": {
    "totalProvisions": 1,
    "citationStatistics": {
      "totalCitations": 2,
      "avgCitationsPerProvision": 2.0,
      "provisionsWithMinimalCitations": 0,
      "provisionsWithNoCitations": 0
    },
    "relationshipStatistics": {
      "avgProvisionsPerProvision": 2.0,
      "avgDecisionsPerProvision": 1.0,
      "provisionsWithNoRelationships": 0
    }
  }
}
\`\`\`

---

# FIELD SPECIFICATIONS

## Matching Key

**\`internalProvisionId\`** (REQUIRED)
- **Purpose**: Match to provisions from Stages 2A-2C
- **CRITICAL**: Must have SAME \`internalProvisionId\` as input
- **Format**: \`ART-{decisionId}-{sequence}\`
- **Example**: \`ART-ECLI:BE:CASS:2024:ARR.001-001\`

## Citations Array

**\`citations\`** (REQUIRED array, minimum 1 item)

**Structure**: Array of objects with \`blockId\` and \`relevantSnippet\`

**Content:**
- \`blockId\`: Exact block ID from blocks array (format: \`ECLI:BE:COURT:YYYY:ID:block-NNN\`)
- \`relevantSnippet\`: 50-500 character excerpt from block's \`plainText\` showing why relevant

**Format Requirements:**
- Block IDs must match exactly from blocks array (copy character-perfect)
- Snippets must be actual substrings of the block's \`plainText\`
- Snippets should be meaningful (show provision citation/interpretation/application)
- Snippets are for debugging/validation (humans will review these)

**Granularity:**
- **Minimum**: 1 citation per provision
- **Typical**: 3-10 citations per provision (depends on how extensively discussed)
- **No maximum**: Identify ALL relevant blocks
- **Priority**: Completeness over brevity

**What to Extract:**

✅ **YES - Extract these blocks:**
- Formal citations ("Vu l'article X", "Gelet op artikel X")
- Court's interpretation of provision
- Court's application of provision to facts
- Provisions compared or combined
- Precedents interpreting provision
- Factual findings evaluated under provision
- Legal conclusions based on provision
- Procedural rulings applying provision
- Indirect references to provision ("cette disposition", "ledit article")

❌ **NO - Don't extract these:**
- Blocks mentioning provision in completely unrelated context
- General legal background not applying this specific provision
- Party arguments citing provision (unless court explicitly adopts them)

## Relationship Mappings

**\`relatedInternalProvisionsId\`** (REQUIRED array)

**Content**: Array of \`internalProvisionId\` values

**Rules:**
- **ALWAYS include provision's own ID as first element** (self-reference)
- Include provisions cited in same passages
- Include provisions compared or combined
- Include provisions from same legal instrument if discussed together
- All IDs must exist in \`citedProvisions\` input
- No duplicates

**Example:**
\`\`\`json
{
  "relatedInternalProvisionsId": [
    "ART-ECLI:BE:CASS:2023:ARR.20230315-001",  // Self (ALWAYS first)
    "ART-ECLI:BE:CASS:2023:ARR.20230315-002",  // Article 29 (cited together)
    "ART-ECLI:BE:CASS:2023:ARR.20230315-005"   // Article 30 (compared)
  ]
}
\`\`\`

**\`relatedInternalDecisionsId\`** (REQUIRED array, can be empty)

**Content**: Array of \`internalDecisionId\` values

**Rules:**
- Include decisions cited when interpreting this provision
- Include precedents establishing interpretation of provision
- Include decisions cited in same context as provision
- All IDs must exist in \`citedDecisions\` input
- No duplicates
- Can be empty array if no decisions cited in provision context

---

# EXAMPLES

## Example 1: Article with Extensive Discussion (French)

**Input Provision:**
\`\`\`json
{
  "internalProvisionId": "ART-ECLI:BE:CASS:2023:ARR.20230315-001",
  "provisionNumber": "article 31, § 2",
  "provisionNumberKey": "article_31_par_2",
  "parentActName": "Loi du 10 mai 2007 tendant à lutter contre certaines formes de discrimination",
  "parentActType": "LOI",
  "parentActDate": "2007-05-10"
}
\`\`\`

**Input Blocks (excerpt):**
\`\`\`json
[
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230315:block-015",
    "plainText": "Vu l'article 31, § 2, de la loi du 10 mai 2007 tendant à lutter contre certaines formes de discrimination.",
    "elementType": "p",
    "charCount": 108
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230315:block-017",
    "plainText": "L'article 31, § 2, de la loi du 10 mai 2007 dispose que le Centre pour l'égalité des chances et la lutte contre le racisme peut ester en justice lorsqu'il constate une discrimination, à condition de prouver l'accord d'une personne lésée identifiée.",
    "elementType": "p",
    "charCount": 252
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230315:block-018",
    "plainText": "La Cour doit déterminer si cette condition s'applique en l'espèce. Comme l'a jugé la Cour dans son arrêt du 5 mars 2018 (C.17.0543.F), l'exigence d'un accord individuel ne peut faire obstacle à l'action collective lorsque la discrimination affecte potentiellement un nombre indéterminé de personnes.",
    "elementType": "p",
    "charCount": 298
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230315:block-019",
    "plainText": "Cette interprétation est conforme à l'article 29 de la même loi, qui définit la discrimination de manière large pour inclure les discriminations généralisées.",
    "elementType": "p",
    "charCount": 161
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230315:block-020",
    "plainText": "En l'occurrence, les offres d'emploi litigieuses contenaient des critères d'âge discriminatoires et ont été publiées largement, touchant potentiellement toute personne intéressée. Dans ces conditions, l'article 31, § 2, doit être interprété conformément à l'objectif de la loi, qui vise à combattre efficacement la discrimination généralisée.",
    "elementType": "p",
    "charCount": 342
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230315:block-021",
    "plainText": "Par conséquent, le Centre est recevable en son action, même en l'absence d'accord d'une victime identifiée, conformément à l'article 31, § 2.",
    "elementType": "p",
    "charCount": 144
  }
]
\`\`\`

**Output:**
\`\`\`json
{
  "internalProvisionId": "ART-ECLI:BE:CASS:2023:ARR.20230315-001",
  "citations": [
    {
      "blockId": "ECLI:BE:CASS:2023:ARR.20230315:block-015",
      "relevantSnippet": "Vu l'article 31, § 2, de la loi du 10 mai 2007 tendant à lutter contre certaines formes de discrimination."
    },
    {
      "blockId": "ECLI:BE:CASS:2023:ARR.20230315:block-017",
      "relevantSnippet": "L'article 31, § 2, de la loi du 10 mai 2007 dispose que le Centre pour l'égalité des chances... à condition de prouver l'accord d'une personne lésée identifiée."
    },
    {
      "blockId": "ECLI:BE:CASS:2023:ARR.20230315:block-018",
      "relevantSnippet": "Comme l'a jugé la Cour dans son arrêt du 5 mars 2018 (C.17.0543.F), l'exigence d'un accord individuel ne peut faire obstacle à l'action collective..."
    },
    {
      "blockId": "ECLI:BE:CASS:2023:ARR.20230315:block-020",
      "relevantSnippet": "Dans ces conditions, l'article 31, § 2, doit être interprété conformément à l'objectif de la loi, qui vise à combattre efficacement la discrimination généralisée."
    },
    {
      "blockId": "ECLI:BE:CASS:2023:ARR.20230315:block-021",
      "relevantSnippet": "Par conséquent, le Centre est recevable en son action, même en l'absence d'accord d'une victime identifiée, conformément à l'article 31, § 2."
    }
  ],
  "relatedInternalProvisionsId": [
    "ART-ECLI:BE:CASS:2023:ARR.20230315-001",
    "ART-ECLI:BE:CASS:2023:ARR.20230315-002"
  ],
  "relatedInternalDecisionsId": [
    "DEC-ECLI:BE:CASS:2023:ARR.20230315-001"
  ]
}
\`\`\`

**Why This Works:**
- ✅ All 5 blocks mentioning Article 31 identified
- ✅ Includes formal citation from "Vu" section (block 015)
- ✅ Includes interpretation and application from reasoning (blocks 017-021)
- ✅ Block 018 references "cette condition" (indirect) but also cites precedent - included
- ✅ Block 019 discusses Article 29 (related provision) but doesn't mention Article 31 - excluded
- ✅ Self-reference included (Article 31 itself)
- ✅ Article 29 discussed in context → included in provisions
- ✅ Precedent (2018 decision) cited → included in decisions
- ✅ Snippets are exact substrings from block plainText

## Example 2: Multiple Related Provisions (Dutch)

**Input Provision:**
\`\`\`json
{
  "internalProvisionId": "ART-ECLI:BE:CABE:2023:ARR.20231120-001",
  "provisionNumber": "artikel 1184",
  "provisionNumberKey": "artikel_1184",
  "parentActName": "Burgerlijk Wetboek",
  "parentActType": "CODE"
}
\`\`\`

**Input Blocks (excerpt):**
\`\`\`json
[
  {
    "blockId": "ECLI:BE:CABE:2023:ARR.20231120:block-042",
    "plainText": "Artikel 1184 van het Burgerlijk Wetboek bepaalt dat contracten te goeder trouw moeten worden uitgevoerd. Deze verplichting impliceert dat bij beëindiging een redelijke opzegtermijn moet worden gerespecteerd.",
    "elementType": "p",
    "charCount": 210
  },
  {
    "blockId": "ECLI:BE:CABE:2023:ARR.20231120:block-043",
    "plainText": "Dit beginsel wordt aangevuld door artikel 1135 van het Burgerlijk Wetboek, volgens hetwelk overeenkomsten niet alleen verbinden tot hetgeen daarin is uitgedrukt, maar ook tot alle gevolgen die door de billijkheid, het gebruik of de wet aan de verbintenis worden toegekend.",
    "elementType": "p",
    "charCount": 272
  },
  {
    "blockId": "ECLI:BE:CABE:2023:ARR.20231120:block-044",
    "plainText": "In het licht van deze bepalingen, en rekening houdend met de economische afhankelijkheid van de distributeur, oordeelt het Hof dat een opzegtermijn van drie maanden manifest ontoereikend is.",
    "elementType": "p",
    "charCount": 191
  },
  {
    "blockId": "ECLI:BE:CABE:2023:ARR.20231120:block-045",
    "plainText": "Het Hof merkt op dat artikel 1184 aldus moet worden toegepast dat de rechten van beide partijen worden gerespecteerd.",
    "elementType": "p",
    "charCount": 118
  }
]
\`\`\`

**Output:**
\`\`\`json
{
  "internalProvisionId": "ART-ECLI:BE:CABE:2023:ARR.20231120-001",
  "citations": [
    {
      "blockId": "ECLI:BE:CABE:2023:ARR.20231120:block-042",
      "relevantSnippet": "Artikel 1184 van het Burgerlijk Wetboek bepaalt dat contracten te goeder trouw moeten worden uitgevoerd. Deze verplichting impliceert dat bij beëindiging een redelijke opzegtermijn moet worden gerespecteerd."
    },
    {
      "blockId": "ECLI:BE:CABE:2023:ARR.20231120:block-044",
      "relevantSnippet": "In het licht van deze bepalingen, en rekening houdend met de economische afhankelijkheid van de distributeur, oordeelt het Hof dat een opzegtermijn van drie maanden manifest ontoereikend is."
    },
    {
      "blockId": "ECLI:BE:CABE:2023:ARR.20231120:block-045",
      "relevantSnippet": "Het Hof merkt op dat artikel 1184 aldus moet worden toegepast dat de rechten van beide partijen worden gerespecteerd."
    }
  ],
  "relatedInternalProvisionsId": [
    "ART-ECLI:BE:CABE:2023:ARR.20231120-001",
    "ART-ECLI:BE:CABE:2023:ARR.20231120-002"
  ],
  "relatedInternalDecisionsId": []
}
\`\`\`

**Why This Works:**
- ✅ 3 blocks mentioning Article 1184 identified
- ✅ Block 042 explicitly cites "Artikel 1184" - included
- ✅ Block 043 discusses Article 1135 (related provision) but doesn't mention Article 1184 - excluded
- ✅ Block 044 uses indirect reference "deze bepalingen" (refers to both 1184 and 1135) - included because it applies Article 1184's principle
- ✅ Block 045 explicitly mentions "artikel 1184" again - included
- ✅ Self-reference included (Article 1184 itself)
- ✅ Article 1135 discussed together → included in provisions
- ✅ No precedents cited → empty decisions array
- ✅ Snippets are exact substrings from block plainText

## Example 3: Brief Citation (Single Mention)

**Input Provision:**
\`\`\`json
{
  "internalProvisionId": "ART-ECLI:BE:CASS:2023:ARR.20230920-008",
  "provisionNumber": "article 1017",
  "provisionNumberKey": "article_1017",
  "parentActName": "Code judiciaire",
  "parentActType": "CODE"
}
\`\`\`

**Input Blocks (excerpt):**
\`\`\`json
[
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230920:block-089",
    "plainText": "PAR CES MOTIFS",
    "elementType": "h3",
    "charCount": 14
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230920:block-090",
    "plainText": "Condamne la partie demanderesse aux dépens, liquidés à la somme de 2.450 euros, conformément à l'article 1017 du Code judiciaire.",
    "elementType": "p",
    "charCount": 131
  }
]
\`\`\`

**Output:**
\`\`\`json
{
  "internalProvisionId": "ART-ECLI:BE:CASS:2023:ARR.20230920-008",
  "citations": [
    {
      "blockId": "ECLI:BE:CASS:2023:ARR.20230920:block-090",
      "relevantSnippet": "Condamne la partie demanderesse aux dépens, liquidés à la somme de 2.450 euros, conformément à l'article 1017 du Code judiciaire."
    }
  ],
  "relatedInternalProvisionsId": [
    "ART-ECLI:BE:CASS:2023:ARR.20230920-008"
  ],
  "relatedInternalDecisionsId": []
}
\`\`\`

**Why This Works:**
- ✅ Only one block mentions Article 1017 in decision
- ✅ Complete block identified (block-090)
- ✅ Full plainText used as snippet (it's under 500 chars)
- ✅ Self-reference included
- ✅ Minimal but complete extraction
- ✅ Extracted from judgment section (provision applied in ruling)
- ✅ Block 089 is header ("PAR CES MOTIFS") - excluded because it doesn't mention provision

## Example 4: Indirect References

**Input Provision:**
\`\`\`json
{
  "internalProvisionId": "ART-EXAMPLE-001",
  "provisionNumber": "article 6",
  "provisionNumberKey": "article_6",
  "parentActName": "Convention européenne des droits de l'homme",
  "parentActType": "TRAITE"
}
\`\`\`

**Input Blocks (excerpt):**
\`\`\`json
[
  {
    "blockId": "EXAMPLE:block-051",
    "plainText": "L'article 6 de la Convention européenne des droits de l'homme garantit le droit à un procès équitable.",
    "elementType": "p",
    "charCount": 104
  },
  {
    "blockId": "EXAMPLE:block-052",
    "plainText": "Cette disposition impose notamment le respect des droits de la défense et le principe du contradictoire.",
    "elementType": "p",
    "charCount": 106
  },
  {
    "blockId": "EXAMPLE:block-053",
    "plainText": "En l'espèce, la Cour estime que ledit article a été respecté, dès lors que la partie défenderesse a pu présenter ses arguments en pleine connaissance du dossier.",
    "elementType": "p",
    "charCount": 164
  }
]
\`\`\`

**Output:**
\`\`\`json
{
  "internalProvisionId": "ART-EXAMPLE-001",
  "citations": [
    {
      "blockId": "EXAMPLE:block-051",
      "relevantSnippet": "L'article 6 de la Convention européenne des droits de l'homme garantit le droit à un procès équitable."
    },
    {
      "blockId": "EXAMPLE:block-052",
      "relevantSnippet": "Cette disposition impose notamment le respect des droits de la défense et le principe du contradictoire."
    },
    {
      "blockId": "EXAMPLE:block-053",
      "relevantSnippet": "En l'espèce, la Cour estime que ledit article a été respecté, dès lors que la partie défenderesse a pu présenter ses arguments en pleine connaissance du dossier."
    }
  ],
  "relatedInternalProvisionsId": [
    "ART-EXAMPLE-001"
  ],
  "relatedInternalDecisionsId": []
}
\`\`\`

**Why This Works:**
- ✅ Block 051: Explicit mention of "article 6" - included
- ✅ Block 052: Indirect reference "Cette disposition" (refers back to Article 6) - included
- ✅ Block 053: Indirect reference "ledit article" (refers to Article 6) - included
- ✅ Complete reasoning about Article 6 extracted across 3 blocks
- ✅ Self-reference included
- ✅ Full plainText used as snippets (all under 500 chars)

---

# VALIDATION CHECKLIST

Before finalizing output:

## Structural Validation

- [ ] Every provision from input appears in output
- [ ] Every \`internalProvisionId\` matches input exactly
- [ ] No provisions added or removed

## Block Citations Quality

- [ ] Every provision has at least 1 citation
- [ ] Block IDs match exactly from input blocks array (character-perfect copy)
- [ ] Snippets are substrings of block \`plainText\` (50-500 chars)
- [ ] Snippets show WHY block is relevant (meaningful excerpts, not random)

## Completeness (Deletion Test)

- [ ] For each provision: If all cited blocks removed, would provision disappear?
- [ ] Checked entire blocks array for provision mentions
- [ ] Included formal citations from "Vu"/"Gelet op" sections
- [ ] Included interpretation from reasoning sections
- [ ] Included application to facts
- [ ] Captured indirect references ("cette disposition", "ledit article")

## Relationship Mappings

- [ ] **CRITICAL**: Every provision has self-reference as first element in \`relatedInternalProvisionsId\`
- [ ] All provision IDs in relationships exist in \`citedProvisions\` input
- [ ] All decision IDs in relationships exist in \`citedDecisions\` input
- [ ] Provisions actually discussed together included
- [ ] Decisions actually cited in provision context included
- [ ] No duplicate IDs in arrays

## Search Thoroughness

- [ ] Searched blocks with multiple patterns (article/art., with/without spacing)
- [ ] Checked all section types (reasoning, procedural, facts, judgment)
- [ ] Found indirect references in blocks after explicit citations
- [ ] Searched variations of provision number in block plainText

## Metadata Accuracy

- [ ] \`totalProvisions\` matches array length
- [ ] \`totalCitations\` matches sum of all citation arrays
- [ ] \`avgCitationsPerProvision\` calculated correctly
- [ ] Relationship statistics accurate

---

# CRITICAL REMINDERS

1. **Block IDs Must Match**: Copy exact \`blockId\` from blocks array (character-perfect)

2. **Snippets Must Be Substrings**: Extract directly from block's \`plainText\` field (50-500 chars)

3. **Self-Reference MANDATORY**: ALWAYS include provision's own ID as first element in \`relatedInternalProvisionsId\`

4. **Complete Coverage**: Find ALL blocks mentioning provision across ALL sections - not just first occurrence

5. **Indirect References**: After finding explicit citations, search nearby blocks for "cette disposition", "ledit article"

6. **Multiple Search Patterns**: Try variations in block plainText (art./article, with/without spaces, §2/§ 2)

7. **Section Awareness**: Check reasoning, procedural, facts, and judgment sections (provisions appear throughout)

8. **Deletion Test**: Remove identified blocks → provision disappears completely

9. **Relationship Validation**: All IDs must exist in corresponding input arrays

10. **Practical Focus**: What would lawyer highlight to show court's treatment of this provision?

11. **Quality Over Speed**: Thoroughness more important than quick identification

12. **Complete Blocks Only**: Identify entire blocks (paragraphs), not sentence fragments

13. **No Inference**: Identify blocks that exist, don't construct content from provision metadata

---

# OUTPUT FORMAT

Return ONLY valid JSON matching the schema. No markdown, no code blocks, no explanatory text.`;
