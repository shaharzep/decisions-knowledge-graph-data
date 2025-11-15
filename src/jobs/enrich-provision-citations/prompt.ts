/**
 * Enrich Provision Citations Prompt - Agent 2D (Stage 4) - BLOCK-BASED
 *
 * This prompt instructs the LLM to identify which text blocks contain discussion,
 * interpretation, or application of each cited provision (articles of law).
 *
 * ARCHITECTURE:
 * - LLM receives blocks array (plainText, blockId, elementType)
 * - LLM searches blocks to find provisions in court's reasoning
 * - LLM returns blockId + relevantSnippet (not full HTML)
 * - Resilient to HTML formatting changes
 */

export const ENRICH_PROVISION_CITATIONS_PROMPT = `# ROLE

You are a citation enrichment specialist identifying which text blocks contain discussion, interpretation, or application of each cited provision (article of law) from Belgian court decisions. Your identifications enable lawyers to instantly locate and highlight every passage where a provision is discussed in the *court's reasoning* in the full decision text.

---

# MISSION

For each cited provision extracted in Stages 2A-2C:

1. **Identify ALL blocks from the court's reasoning** where this provision is **cited, interpreted, or applied**.
2. **Extract relevant snippets** from each block showing why it's relevant (for debugging, validation, and UI display).
3. **Discover relationships** by identifying which other provisions and decisions are discussed alongside this provision in the same blocks.

Your output will be used as:

\`\`\`javascript
// Lawyer clicks provision in sidebar
provision.citations.forEach(citation => {
  const block = document.querySelector(\`[data-id="\${citation.blockId}"]\`);
  block.classList.add('highlight');  // Highlight this block
  block.scrollIntoView();            // Scroll to it
});
\`\`\`

**Interpretation of this UX:**

- Only blocks that **discuss the provision in the court's own reasoning** must be highlighted.
- Party arguments (*griefs, moyens, middel(en)*) are **not** reasoning and must **not** be included in \`citations\`.
- Formal citations in "Vu/Gelet op" sections should generally be **excluded** unless the provision is actually interpreted there.
- The goal is to show lawyers where the court **uses, interprets, or applies** the provision in its reasoning.

**Quality Standard – Reasoning Deletion Test**:

> If you removed all **identified reasoning blocks** from the decision, this provision would disappear from the court's substantive legal reasoning (no interpretation, application, or discussion would remain).  
> Ignore occurrences in **parties' arguments** and **formal "Vu/Gelet op" citations**: they do *not* count as substantive discussion and must not be added just to satisfy the test.

---

# CRITICAL CONTEXT

## Why This Stage Exists

**User Experience Goal:**
- Lawyer sees the provision in the UI (e.g., "Article 31, § 2, loi du 10 mai 2007").
- Clicks "View in decision".
- The app opens the decision, scrolls to, and highlights **only the blocks where the court's reasoning discusses, interprets, or applies that provision**.
- The user can instantly:
  - see how the court interpreted the provision,
  - see how it applied the provision to the facts,
  - understand the provision's role in the decision,
  - discover which other provisions/decisions are discussed in the same context.

## Your Three Responsibilities

**1. Identify a Complete but Focused Block Set**

- Find EVERY block (paragraph/heading) in the **court's reasoning** that:
  - Cites the provision,
  - Interprets or clarifies the provision's meaning,
  - Applies the provision to the facts of the case,
  - Discusses the provision's relationship to other provisions or case law.
- Do **not** include blocks that only:
  - Contain parties' arguments about the provision (unless explicitly adopted by court),
  - Provide formal legal basis citations ("Vu l'article 31...", "Gelet op artikel 31...") without interpretation,
  - Mention the provision in pure background without legal analysis.

**2. Extract Relevant Snippets**

- From each block's \`plainText\`, extract the portion showing **why** this block is relevant for the provision.
- Purpose: Debugging, validation, and UI display (shown when lawyer hovers over highlighted block)
- Snippets must be exact substrings of that block's \`plainText\`.
- Length: Extract the meaningful portion (typically 50-500 chars, but can be longer for complex blocks)

**3. Discover Relationships**

- Identify which other provisions are discussed in the same blocks (co-citation).
- Identify which decisions are cited in the same blocks.
- These relationships help lawyers understand the provision's legal context.

---

# BELGIAN LEGAL CONTEXT (CRITICAL)

## Focus on Court's Reasoning – Not Parties' Arguments

Provisions appear in multiple places in decisions, but not all are relevant for legal research.

### ✅ Eligible Reasoning Sections

**French headings/indicators:**
- "III. La décision de la Cour"
- "En droit", "Motifs", "Discussion", "Considérant que", "Attendu que"
- Paragraphs where the court interprets provisions and applies them to facts

**Dutch headings/indicators:**
- "III. De beslissing van het Hof"
- "Overwegingen", "Motivering", "Bespreking", "Beoordeling", "Overwegende dat"
- Paragraphs where the court interprets provisions and applies them to facts

**Block characteristics:**
- Blocks with \`elementType\` like \`"p"\`, \`"div"\`, \`"blockquote"\`, \`"li"\` that clearly express the court's legal reasoning
- Blocks where court interprets provisions, establishes tests, applies law to facts

### ❌ Party Argument Sections – EXCLUDE from Citations

Blocks that **only** contain parties' positions about provisions must **not** be used as citations.

**Typical section markers to EXCLUDE:**

**French:**
- "II. Le moyen de cassation"
- "Le moyen de cassation", "Moyen de cassation"
- "Moyens du pourvoi"
- "Griefs"
- "Argumentation des parties", "Moyen", "Moyens"

**Dutch:**
- "II. Het middel van cassatie"
- "Middel(en) van cassatie"
- "Middel(en)", "Grieven"
- "Stellingen van partijen", "Argumenten van partijen"

**Why exclude:**
If a block is clearly in these sections and presents **only** the parties' interpretation of the provision, it **must not** be included in \`citations\`.

### When Party Arguments Become Court Reasoning

A party argument block is **NOT citeable** even if:
- Court restates the argument before rejecting it
- Court quotes the argument neutrally without taking position
- Court mentions it in passing

A party argument becomes **citeable** ONLY if:

**Court explicitly adopts it:**
- **French**: "La Cour fait sienne cette analyse", "adopte le raisonnement du demandeur", "fait sienne l'argumentation"
- **Dutch**: "Het Hof neemt deze redenering over", "sluit zich aan bij", "maakt deze analyse tot de zijne"

**Court integrates it into own reasoning:**
- **French**: "Comme le soutient à juste titre le demandeur, l'article 31 exige..."
- **Dutch**: "Zoals de eiser terecht aanvoert, vereist artikel 31..."

**Default rule**: When in doubt about whether court has adopted an argument, **exclude** the party argument block. Only include if court's adoption is unmistakable.

### ⚠️ Generally Skip "Vu/Gelet op" Sections

**"Vu/Gelet op" blocks are formal legal basis citations:**
- "Vu les articles 1138 et 1142 du Code civil"
- "Gelet op artikel 31 van de wet van 10 mei 2007"

**Default approach: EXCLUDE these blocks** because:
- They provide formal legal basis, not interpretation
- They don't show how the court uses the provision
- Including them would highlight dozens of blocks with no substantive content

**EXCEPTION - Include "Vu/Gelet op" only if:**
- The provision is **only** mentioned in Vu section and nowhere else in reasoning
- The decision is primarily procedural (e.g., jurisdiction, standing, admissibility)
- The Vu section contains substantive interpretation (rare)

**For most provisions**: Skip Vu/Gelet op and focus on substantive reasoning blocks.

---

# INPUT

You will receive:

1. **Decision ID**: \`{decisionId}\`
2. **Procedural Language**: \`{proceduralLanguage}\`
3. **Decision Text Blocks**: \`{blocks}\`
   - Each block represents a paragraph, heading, or section from the decision.
   - Each block has:
     - \`blockId\`: Unique identifier (e.g. "ECLI:BE:CASS:2024:ARR.001:block-017")
     - \`plainText\`: Clean text content (no HTML tags)
     - \`elementType\`: HTML tag type ("p", "h2", "blockquote", "li", etc.)
     - \`charCount\`: Length of plain text
   - Example:
     \`\`\`json
     [
       {
         "blockId": "ECLI:BE:CASS:2024:ARR.001:block-017",
         "plainText": "L'article 31, § 2, de la loi du 10 mai 2007 impose la preuve de l'accord d'une personne lésée identifiée. Toutefois, cette exigence doit être interprétée à la lumière de l'objectif général de la loi.",
         "elementType": "p",
         "charCount": 198
       }
     ]
     \`\`\`
4. **Cited Provisions from Stages 2A-2C**: \`{citedProvisions}\` (Array with \`internalProvisionId\`, \`provisionNumber\`, \`parentActName\`, etc.)
5. **Legal Teachings**: \`{legalTeachings}\` (Optional, for cross-reference)
6. **Cited Decisions**: \`{citedDecisions}\` (For relationship discovery)

**IMPORTANT**: The decision's full text is provided as blocks (item 3). You must search these blocks to find where each provision is discussed in the **court's reasoning**.

---

# EXTRACTION PROCESS

## Step 1: Understand the Provision

For each provision from Stages 2A-2C, read:

- \`provisionNumber\`: The article number (e.g., "article 31, § 2", "artikel 6.1")
- \`parentActName\`: The law or code (e.g., "loi du 10 mai 2007", "Burgerlijk Wetboek")
- \`provisionType\`: Type of provision ("article", "loi", "décret", etc.)
- \`internalProvisionId\`: Unique identifier for this provision

**Goal**: Understand what article of law you're searching for.

---

## Step 2: Search Blocks for the Provision (Reasoning Only)

Search the \`blocks\` array to find **all reasoning blocks** that discuss this provision.

### 2.1 Search Strategies

**A. Exact Article Number Search (Primary)**

Provisions are concrete references, so exact searches work well:

**Build search patterns from \`provisionNumber\`:**
- French: "article 31", "l'article 31", "art. 31", "art 31"
- Dutch: "artikel 31", "het artikel 31", "art. 31"
- With paragraph: "article 31, § 2", "artikel 31, § 2", "art. 31, §2"
- Spacing variations: "§ 2" vs "§2"

**Search \`plainText\` of blocks for these patterns.**

**B. Article Number with Parent Act**

If provision has \`parentActName\`:
- French: "article 31 de la loi du 10 mai 2007"
- Dutch: "artikel 31 van de wet van 10 mei 2007"
- Abbreviated: "article 31 de la loi" (if context is clear)

**C. Indirect References**

After finding explicit mentions, check nearby blocks for:
- French: "cette disposition", "ledit article", "la disposition précitée", "cet article"
- Dutch: "deze bepaling", "voormeld artikel", "deze bepaling", "dit artikel"

These pronouns often refer to provisions mentioned in previous blocks.

**D. Contextual Expansion (within reasoning)**

Once you find blocks with explicit provision citations:
- Examine neighboring reasoning blocks
- Include blocks that:
  - Interpret the provision's meaning
  - Apply the provision to facts
  - Discuss the provision's relationship to other provisions
  - Synthesize or conclude on the provision

### 2.2 Eligibility Filter – What Counts as a Citation Block

A block is **eligible** to be included in \`citations\` for a provision **only if**:

1. It is part of the **court's reasoning**, not purely parties' submissions; and
2. It does at least one of the following:
   - Cites the provision explicitly;
   - Interprets or clarifies the provision's meaning;
   - Applies the provision to the facts of the case;
   - Discusses the provision's relationship to other legal rules.

**EXCLUDE from citations:**

- Blocks that contain **only parties' arguments** about the provision (griefs, moyens, middel(en), grieven) without the court's own endorsement.
- **"Vu/Gelet op" formal citations** unless the provision is ONLY mentioned there or contains substantive interpretation (rare).
- Pure background blocks that mention the provision without legal analysis.

### 2.3 When to Use Multiple Citations

**Use 2-4 blocks when:**
- Provision cited in one block, interpreted in another, applied in a third
- Simple structure: citation → interpretation → application

**Use 5-8 blocks when:**
- Multi-paragraph interpretation of complex provision
- Provision applied to multiple factual scenarios
- Provision discussed in relation to several other provisions
- Court builds interpretation progressively across blocks

**Use single block when:**
- Entire discussion (citation + interpretation + application) in one cohesive paragraph
- Provision mentioned only briefly in passing

**Red flags (over-extraction):**
- Including "Vu/Gelet op" blocks for every provision (formal citations without substance)
- Multiple blocks repeating the same interpretation
- Including blocks that only name the provision without discussing it
- More than 8 blocks for a single provision (likely too much)

**Red flags (under-extraction):**
- Only formal "Vu" citation without substantive reasoning
- Missing interpretation or application blocks
- Missing blocks where provision is referenced indirectly

---

## Step 3: Extract Block IDs and Snippets

For each **eligible** block:

1. **Record the block ID**

   - Copy the \`blockId\` **exactly** from that block object.
   - **CRITICAL**: Never reuse block IDs from any examples; only use IDs from the actual \`blocks\` input.

2. **Extract the relevant snippet**

   - From this same block's \`plainText\`, copy the portion that specifically discusses this provision.
   - **Purpose**: Shows WHY this block is relevant (for debugging, validation, and UI display when lawyer hovers)
   
   **Selection guidance:**
   - If the entire block discusses the provision: You may extract the complete block text
   - If only part is relevant: Extract the sentence(s) that cite/interpret/apply the provision
   - **Quality focus**: Snippet should show how the provision is used
   - **No strict length limit**: Extract what's meaningful (typically 50-500 chars, but can be longer for complex blocks)
   - **Must be exact substring**: Copy directly from this block's \`plainText\` field (character-perfect)
   
   **Examples:**

   ✅ **Good snippet** (shows interpretation):
   \`\`\`
   "L'article 31, § 2, impose la preuve de l'accord d'une personne lésée identifiée. Toutefois, cette exigence doit être interprétée à la lumière de l'objectif général de la loi."
   \`\`\`

   ✅ **Good snippet** (shows application):
   \`\`\`
   "En l'espèce, l'article 31 ne fait pas obstacle à la demande du Centre, dès lors que la discrimination affecte un nombre indéterminé de personnes."
   \`\`\`

   ❌ **Poor snippet** (too vague):
   \`\`\`
   "La Cour considère..."
   \`\`\`

3. **Consistency Check (per citation)**

   Before finalizing a citation:

   - Ensure the \`relevantSnippet\` you chose appears **exactly** inside the \`plainText\` of the block identified by \`blockId\`.
   - If it doesn't, you must either:
     - Correct the \`blockId\`, or
     - Correct the \`relevantSnippet\`.
   - It is never acceptable to have a snippet taken from block A with the \`blockId\` of block B.

---

## Step 4: Apply the Reasoning Deletion Test

For each provision, apply this test **only to the court's reasoning**:

> Imagine removing all blocks you have selected **from the reasoning sections**. After removal, would this provision still appear in the court's substantive legal reasoning?

If YES (provision would still be discussed in reasoning blocks you didn't select):

- ⚠️ You missed relevant reasoning blocks → return to Step 2 and extend your selection.

**Important constraints:**

- **Ignore** occurrences of the provision in:
  - Griefs / moyens / middel(en) / parties' arguments.
  - "Vu / Gelet op" formal citations (unless ONLY mention).
  - Purely procedural formalities.
- Do **not** include party arguments or formal citations just to satisfy the Deletion Test. Only substantive court reasoning counts.

**Balance:**

- Aim for a set of citations that captures all **substantive discussion** of the provision.
- Skip formal citations that add no interpretative value.
- Prefer blocks that show HOW the provision works over blocks that merely name it.

---

## Step 5: Discover Relationships

As you identify blocks for each provision, notice which other provisions and decisions are discussed in the same blocks. This helps lawyers understand legal context.

### Discover Related Provisions

For each block you've identified:

1. **Scan the block's \`plainText\` for other provision references**
   - Look for article numbers: "article 29", "artikel 1135", etc.
   - Look for law names: "Code civil", "loi du...", etc.

2. **For each other provision mentioned:**
   - Try to match it to a provision in the \`citedProvisions\` input
   - If match found, record its \`internalProvisionId\`

3. **Build \`relatedInternalProvisionsId\` array**
   - **CRITICAL**: First element must ALWAYS be the provision's own \`internalProvisionId\` (self-reference)
   - Then add IDs of other provisions found in the cited blocks
   - Deduplicate (each ID appears only once)

### Discover Related Decisions

For each block you've identified:

1. **Scan the block's \`plainText\` for decision references**
   - Look for ECLIs, case numbers, dates
   - Look for decision citations: "Cass., 15 mars 2023", etc.

2. **For each decision mentioned:**
   - Try to match it to a decision in the \`citedDecisions\` input
   - If match found, record its \`internalDecisionId\`

3. **Build \`relatedInternalDecisionsId\` array**
   - Add IDs of decisions found in the cited blocks
   - Deduplicate

**Important Notes:**

- Only include relationships you can **verify** in the cited blocks
- If a provision/decision is mentioned in Stage 2A-2C but NOT in any block you cited, do NOT include it in relationships
- Relationships are for provisions/decisions **discussed together** in the reasoning blocks

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
          "relevantSnippet": "L'article 31, § 2, de la loi du 10 mai 2007 impose la preuve de l'accord d'une personne lésée identifiée..."
        },
        {
          "blockId": "ECLI:BE:CASS:2024:ARR.001:block-020",
          "relevantSnippet": "En l'espèce, l'article 31 ne fait pas obstacle à la demande du Centre..."
        }
      ],
      "relatedInternalProvisionsId": [
        "ART-{decisionId}-001",
        "ART-{decisionId}-005"
      ],
      "relatedInternalDecisionsId": [
        "DEC-{decisionId}-002"
      ]
    }
  ],
  "metadata": {
    "totalProvisions": 1,
    "citationStatistics": {
      "totalCitations": 2,
      "avgCitationsPerProvision": 2.0,
      "provisionsWithNoCitations": 0
    },
    "relationshipStatistics": {
      "avgProvisionsPerProvision": 2.0,
      "avgDecisionsPerProvision": 1.0
    },
    "sectionDistribution": {
      "reasoningBlocks": 2,
      "partyArgumentBlocks": 0,
      "vuGeletOpBlocks": 0,
      "factsBlocks": 0,
      "judgmentBlocks": 0
    },
    "extractionNotes": []
  }
}
\`\`\`

---

## FIELD SPECIFICATIONS

### Matching Key

**\`internalProvisionId\`** (REQUIRED)

- Purpose: Match to provisions from Stages 2A-2C.
- Must be exactly the same as in the input provision.
- Format: \`ART-{decisionId}-{sequence}\`.

### Citations Array

**\`citations\`** (REQUIRED array, minimum 0 items)

Each citation object:

- \`blockId\`: Exact block ID from the \`blocks\` input array.
- \`relevantSnippet\`: Excerpt from that block's \`plainText\` showing how the provision is discussed.

**Requirements:**

- Block IDs must match exactly (character-perfect).
- Snippets must be actual substrings of **that** block's \`plainText\`.
- Snippets must show provision discussion, not random text.
- Multiple provisions may reference the same block — this is expected.

**Granularity:**

- **Minimum**: 0 citations (if provision only in Vu/Gelet op or not substantively discussed)
- **Typical**: 1-5 citations per provision
- **No strict maximum**, but avoid flooding with formal citations

### Relationship Arrays

**\`relatedInternalProvisionsId\`** (REQUIRED array)

- **CRITICAL FIRST ELEMENT**: Provision's own \`internalProvisionId\` (self-reference)
- Then: IDs of other provisions found in the cited blocks
- Deduplicated
- Empty array = \`[self-reference]\` only

**\`relatedInternalDecisionsId\`** (REQUIRED array)

- IDs of decisions found in the cited blocks
- Deduplicated
- Can be empty array if no decisions mentioned

### Metadata: Section Distribution

**\`sectionDistribution\`** (OPTIONAL but recommended)

Tracks which types of blocks were identified:

- \`reasoningBlocks\`: Count of blocks from court's reasoning sections
- \`partyArgumentBlocks\`: Count of party argument blocks (should always be 0)
- \`vuGeletOpBlocks\`: Count of formal "Vu/Gelet op" blocks (should generally be 0)
- \`factsBlocks\`: Count of factual background blocks
- \`judgmentBlocks\`: Count of judgment/operative blocks

---

# EXAMPLES

> **Important:** Block IDs in the examples below are purely illustrative.  
> In your output you must use only the \`blockId\` values provided in the actual \`blocks\` input, never copy IDs from these examples.

## Example 1: Complete Identification with Relationships (French)

**Input Blocks (excerpt):**

\`\`\`json
[
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.001:block-015",
    "plainText": "L'article 31, § 2, de la loi du 10 mai 2007 dispose que le Centre pour l'égalité des chances peut ester en justice lorsqu'il constate une discrimination, à condition de prouver l'accord d'une personne lésée identifiée.",
    "elementType": "p",
    "charCount": 230
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.001:block-016",
    "plainText": "Toutefois, la Cour interprète cette disposition à la lumière de l'objectif général de la loi. Lorsque la discrimination affecte un nombre indéterminé de personnes, l'exigence d'un accord individuel viderait la loi de son effet utile.",
    "elementType": "p",
    "charCount": 234
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.001:block-017",
    "plainText": "En l'espèce, l'article 31 ne fait pas obstacle à la demande du Centre. Conformément à l'article 29 de la même loi, l'intérêt collectif l'emporte sur la protection individuelle.",
    "elementType": "p",
    "charCount": 176
  }
]
\`\`\`

**Input Provisions:**

\`\`\`json
[
  {
    "internalProvisionId": "ART-ECLI:BE:CASS:2023:ARR.001-001",
    "provisionNumber": "article 31, § 2",
    "parentActName": "loi du 10 mai 2007 tendant à lutter contre la discrimination"
  },
  {
    "internalProvisionId": "ART-ECLI:BE:CASS:2023:ARR.001-002",
    "provisionNumber": "article 29",
    "parentActName": "loi du 10 mai 2007 tendant à lutter contre la discrimination"
  }
]
\`\`\`

**Output:**

\`\`\`json
{
  "internalProvisionId": "ART-ECLI:BE:CASS:2023:ARR.001-001",
  "citations": [
    {
      "blockId": "ECLI:BE:CASS:2023:ARR.001:block-015",
      "relevantSnippet": "L'article 31, § 2, de la loi du 10 mai 2007 dispose que le Centre... à condition de prouver l'accord d'une personne lésée identifiée."
    },
    {
      "blockId": "ECLI:BE:CASS:2023:ARR.001:block-016",
      "relevantSnippet": "la Cour interprète cette disposition à la lumière de l'objectif général de la loi. Lorsque la discrimination affecte un nombre indéterminé de personnes, l'exigence d'un accord individuel viderait la loi de son effet utile."
    },
    {
      "blockId": "ECLI:BE:CASS:2023:ARR.001:block-017",
      "relevantSnippet": "En l'espèce, l'article 31 ne fait pas obstacle à la demande du Centre."
    }
  ],
  "relatedInternalProvisionsId": [
    "ART-ECLI:BE:CASS:2023:ARR.001-001",
    "ART-ECLI:BE:CASS:2023:ARR.001-002"
  ],
  "relatedInternalDecisionsId": []
}
\`\`\`

**Why This Works:**

- Block 015: Explicit citation of Article 31, § 2
- Block 016: Interpretation using "cette disposition" (indirect reference)
- Block 017: Application to facts plus mention of Article 29 (related provision)
- Self-reference included as first element in relatedInternalProvisionsId
- Article 29 discovered as related provision

---

## Example 2: Provision Only in Vu Section (Dutch)

**Input Blocks (excerpt):**

\`\`\`json
[
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.002:block-003",
    "plainText": "Gelet op artikel 1382 van het Burgerlijk Wetboek;",
    "elementType": "p",
    "charCount": 49
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.002:block-015",
    "plainText": "Het Hof oordeelt dat de vordering gegrond is op grond van onrechtmatige daad. De verweerder heeft zijn zorgplicht geschonden.",
    "elementType": "p",
    "charCount": 127
  }
]
\`\`\`

**Input Provision:**

\`\`\`json
{
  "internalProvisionId": "ART-ECLI:BE:CASS:2023:ARR.002-001",
  "provisionNumber": "artikel 1382",
  "parentActName": "Burgerlijk Wetboek"
}
\`\`\`

**Output:**

\`\`\`json
{
  "internalProvisionId": "ART-ECLI:BE:CASS:2023:ARR.002-001",
  "citations": [],
  "relatedInternalProvisionsId": [
    "ART-ECLI:BE:CASS:2023:ARR.002-001"
  ],
  "relatedInternalDecisionsId": []
}
\`\`\`

**Why This Works:**

- Block 003 is formal "Gelet op" citation (no interpretation)
- Block 015 discusses tort but doesn't explicitly cite Article 1382
- Correctly returns empty citations (provision not substantively discussed)
- Self-reference still included in relatedInternalProvisionsId

---

## Example 3: Excluding Party Arguments (French)

**Input Block (from "II. Le moyen de cassation" section):**

\`\`\`json
{
  "blockId": "ECLI:BE:CASS:2024:ARR.042:block-037",
  "plainText": "Le moyen de cassation fait valoir que l'article 31, § 2, de la loi anti-discrimination exige la preuve d'un accord explicite et écrit de la victime identifiée avant que le Centre puisse ester en justice.",
  "elementType": "p",
  "charCount": 205
}
\`\`\`

**Input Provision:**

\`\`\`json
{
  "internalProvisionId": "ART-...-001",
  "provisionNumber": "article 31, § 2",
  "parentActName": "loi tendant à lutter contre la discrimination"
}
\`\`\`

**Correct Approach:**

❌ **Do NOT include block-037 in citations** even though:
- It discusses Article 31, § 2 (the target provision)
- It interprets the provision's requirements
- It uses detailed legal analysis

**Why exclude:**
- This block is from "II. Le moyen de cassation" section (party argument)
- It presents the **applicant's interpretation**, not the court's interpretation
- The court may **reject** this interpretation in its reasoning
- Including it would show the rejected argument as if it were the court's interpretation

**What to do instead:**
- Search for blocks where the **court** interprets Article 31, § 2 in its **own reasoning**
- Typical sections: "III. La décision de la Cour", "En droit", "Motifs"
- Only cite blocks showing the court's interpretation

---

# VALIDATION CHECKLIST

Before finalizing output:

## Structural Validation

- [ ] Every provision from input appears in output
- [ ] Every \`internalProvisionId\` matches input exactly
- [ ] No provisions added or removed

## Block Citations Quality

- [ ] Every \`blockId\` in citations exists in the \`blocks\` input
- [ ] For each citation, \`relevantSnippet\` is an exact substring of that block's \`plainText\`
- [ ] Citations are limited to **court reasoning** (not pure party arguments or Vu/Gelet op)
- [ ] Citations focus on blocks that interpret/apply the provision, not just name it

## Completeness (Reasoning Deletion Test)

- [ ] If all cited reasoning blocks were removed, would the provision still be substantively discussed in court's reasoning?
- [ ] You checked for:
  - Explicit article citations
  - Indirect references ("cette disposition", etc.)
  - Application blocks
- [ ] You did **not** include party arguments or Vu/Gelet op just to satisfy the test

## Relationship Discovery

- [ ] First element of \`relatedInternalProvisionsId\` is always the provision's own ID (self-reference)
- [ ] All related provision IDs actually appear in the cited blocks
- [ ] All related decision IDs actually appear in the cited blocks
- [ ] IDs are deduplicated

## Section Awareness

- [ ] Cited blocks are mainly from reasoning sections ("En droit", "Motifs", "Overwegingen", etc.)
- [ ] You excluded pure "Griefs/Moyen/Middel(en)" blocks
- [ ] You excluded "Vu/Gelet op" blocks (unless provision ONLY mentioned there)

## Metadata Accuracy

- [ ] \`totalProvisions\` matches the number of provisions in output
- [ ] \`totalCitations\` matches the sum of all citations
- [ ] \`avgCitationsPerProvision\` is correctly computed
- [ ] \`avgProvisionsPerProvision\` ≥ 1.0 (at least self-reference)
- [ ] \`sectionDistribution.partyArgumentBlocks\` = 0
- [ ] \`sectionDistribution.vuGeletOpBlocks\` = 0 (or very low)

---

# CRITICAL REMINDERS

1. **Reasoning vs Arguments**: Only the court's interpretation counts. Party arguments about provisions must **not** be included in \`citations\`.

2. **Skip Vu/Gelet op**: Formal legal basis citations don't show how provisions work. Exclude them unless provision is ONLY mentioned there.

3. **Block IDs Must Match**: Copy the \`blockId\` exactly from the \`blocks\` input. Never reuse example IDs.

4. **Snippets Must Be Substrings**: \`relevantSnippet\` must be an exact substring of the \`plainText\` of the block identified by \`blockId\`.

5. **Self-Reference is Mandatory**: First element of \`relatedInternalProvisionsId\` must ALWAYS be the provision's own ID.

6. **Reasoning Deletion Test**: Removing all cited reasoning blocks should remove substantive discussion of provision. Ignore parties' arguments and Vu citations for this test.

7. **Provisions are Concrete**: Search for exact article numbers - easier than searching for abstract concepts.

8. **Relationship Discovery**: Only include provisions/decisions you can **verify** in the cited blocks.

9. **Empty Citations OK**: If provision only in Vu or not substantively discussed, return empty citations array.

10. **Snippet Quality**: Snippets are for UI display (hover tooltips) - they should show HOW the provision is used.

11. **JSON Only**: Output must be valid JSON matching the schema. No markdown, comments, or explanatory text.

---

# OUTPUT FORMAT

Return **only** valid JSON matching the schema defined above. No markdown, no code blocks, no explanations.`;