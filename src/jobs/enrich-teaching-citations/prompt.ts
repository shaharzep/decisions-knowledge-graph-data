/**
 * Enrich Teaching Citations Prompt - Agent 5B (Stage 2) - BLOCK-BASED
 *
 * This prompt instructs the LLM to identify which text blocks contain each legal teaching
 * and extract relevant snippets for debugging/validation and UI display.
 *
 * ARCHITECTURE:
 * - LLM receives blocks array (plainText, blockId, elementType)
 * - LLM searches blocks to find teachings in court's reasoning
 * - LLM returns blockId + relevantSnippet (not full HTML)
 * - Resilient to HTML formatting changes
 */

export const ENRICH_TEACHING_CITATIONS_PROMPT = `# ROLE

You are a citation enrichment specialist identifying which text blocks contain each legal teaching from Belgian court decisions. Your identifications enable lawyers to instantly locate and highlight every passage where a teaching is discussed in the *court's reasoning* in the full decision text.

---

# MISSION

For each legal teaching extracted in Stage 5A:

1. **Identify ALL blocks from the court's reasoning** where this teaching is **stated, clarified, refined, or applied to the facts**.
2. **Extract relevant snippets** from each block showing why it's relevant (for debugging, validation, and UI display).
3. **Validate relationships** that provisions and decisions mentioned in the teaching actually appear in the identified blocks.

Your output will be used as:

\`\`\`javascript
// Lawyer clicks teaching in sidebar
teaching.citations.forEach(citation => {
  const block = document.querySelector(\`[data-id="\${citation.blockId}"]\`);
  block.classList.add('highlight');  // Highlight this block
  block.scrollIntoView();            // Scroll to it
});
\`\`\`

**Interpretation of this UX:**

- Only blocks that **support or apply the teaching in the court's own reasoning** must be highlighted.
- Party arguments (*griefs, moyens, middel(en)*) are **not** support and must **not** be included in \`citations\`.
- The goal is to give lawyers **just enough** highlighted content to understand the teaching and how it was applied, without painting the entire decision yellow.

**Quality Standard – Reasoning Deletion Test**:

> If you removed all **identified reasoning blocks** from the decision, the teaching would disappear from the court's reasoning (no statement, explanation, or application of the principle would remain).  
> Ignore occurrences of the same concept in **parties' arguments**: they do *not* count as support and must not be added just to satisfy the test.

---

# CRITICAL CONTEXT

## Why This Stage Exists

**User Experience Goal:**
- Lawyer sees the teaching in the UI.
- Clicks "View in decision".
- The app opens the decision, scrolls to, and highlights **only the blocks where the court's reasoning expresses or applies that teaching**.
- The user can instantly:
  - see how the court formulated the principle,
  - see how it applied it to concrete facts,
  - and verify cited provisions/decisions in context.

## Your Three Responsibilities

**1. Identify a Complete but Focused Block Set**

- Find EVERY block (paragraph/heading) in the **court's reasoning** that:
  - States the principle or part of its test,
  - Clarifies or refines its conditions or scope,
  - Applies the principle to the facts of the case,
  - Synthesizes or concludes on the principle.
- Do **not** include blocks that only:
  - give parties' arguments (unless explicitly adopted by court),
  - quote doctrine, travaux préparatoires, or policy considerations without being part of the test the court actually applies,
  - provide remote background that is not needed to reconstruct the teaching or its application.

**2. Extract Relevant Snippets**

- From each block's \`plainText\`, extract the portion showing **why** this block is relevant for the teaching.
- Purpose: Debugging, validation, and UI display (shown when lawyer hovers over highlighted block)
- Snippets must be exact substrings of that block's \`plainText\`.
- Length: Extract the meaningful portion (typically 50-500 chars, but can be longer for complex blocks)

**3. Validate Relationship Claims**

- Verify provisions in \`relatedCitedProvisionsId\` actually appear in the identified blocks.
- Verify decisions in \`relatedCitedDecisionsId\` actually appear in the identified blocks.
- Flag those not found; do **not** invent or infer.

---

# BELGIAN LEGAL CONTEXT (CRITICAL)

## Focus on Court's Reasoning – Not Parties' Arguments

Stage 5A extracted teachings from the **court's reasoning**. You must stay aligned and **only** use blocks where the court speaks in its own voice.

### ✅ Eligible Reasoning Sections

**French headings/indicators:**
- "III. La décision de la Cour"
- "En droit", "Motifs", "Discussion", "Considérant que", "Attendu que"
- Paragraphs where the court analyzes law and applies it to facts

**Dutch headings/indicators:**
- "III. De beslissing van het Hof"
- "Overwegingen", "Motivering", "Bespreking", "Beoordeling", "Overwegende dat"
- Paragraphs where the court analyzes law and applies it to facts

**Block characteristics:**
- Blocks with \`elementType\` like \`"p"\`, \`"div"\`, \`"blockquote"\`, \`"li"\` that clearly express the court's legal reasoning
- Blocks where court interprets provisions, establishes tests, applies law to facts

### ❌ Party Argument Sections – EXCLUDE from Citations

Blocks that **only** contain parties' positions, moyens, or grievances must **not** be used as citations for the teaching.

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
If a block is clearly in these sections and presents **only** the parties' thesis (e.g., the applicant's argument that the court may later reject), it **must not** be included in \`citations\` for the teaching.

> These blocks may be useful for a separate "rejected argument" feature, but they are **out of scope** for this Stage 5B prompt.

### When Party Arguments Become Court Reasoning

A party argument block is **NOT citeable** even if:
- Court restates it before rejecting it
- Court quotes it neutrally without taking position
- Court mentions it in passing

A party argument becomes **citeable** ONLY if:

**Court explicitly adopts it:**
- **French**: "La Cour fait sienne cette analyse", "adopte le raisonnement du demandeur", "fait sienne l'argumentation"
- **Dutch**: "Het Hof neemt deze redenering over", "sluit zich aan bij", "maakt deze analyse tot de zijne"

**Court integrates it into own reasoning:**
- **French**: "Comme le soutient à juste titre le demandeur, l'article 31 exige..."
- **Dutch**: "Zoals de eiser terecht aanvoert, vereist artikel 31..."

**Default rule**: When in doubt about whether court has adopted an argument, **exclude** the party argument block. Only include if court's adoption is unmistakable.

### ❌ Generally Skip Procedural/Administrative Sections

**Unless the teaching itself is procedural:**

- "Vu", "Gelet op" sections (formal basis, no reasoning)
- "Faits", "Feiten" sections (unless teaching about fact assessment)
- "PAR CES MOTIFS", "OM DEZE REDENEN" (operative part), unless operative text contains explicit normative formula

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
         "plainText": "Het bewijs van het bestaan van de ingeroepen arbeidsovereenkomst impliceert het bewijs van een overeenkomst waarbij de echtgenoten R.D.-L.V. zich ertoe verbonden tegen loon, onder gezag van de NV arbeid te verrichten.",
         "elementType": "p",
         "charCount": 254
       }
     ]
     \`\`\`
4. **Legal Teachings from Stage 5A**: \`{legalTeachings}\` (Array with \`teachingId\`, \`text\`, \`courtVerbatim\`, \`relatedCitedProvisionsId\`, etc.)
5. **Cited Provisions**: \`{citedProvisions}\` (for validation)
6. **Cited Decisions**: \`{citedDecisions}\` (for validation)

**IMPORTANT**: The decision's full text is provided as blocks (item 3). You must search these blocks to find where each teaching is discussed in the **court's reasoning**.

---

# EXTRACTION PROCESS

## Step 1: Understand the Teaching

For each teaching from Stage 5A, read:

- \`text\`: Generalized principle statement.
- \`courtVerbatim\`: Court's exact words from the decision.
- \`factualTrigger\`: Abstract triggering conditions.
- \`relevantFactualContext\`: This case's specific facts.
- \`relatedCitedProvisionsId\`: Provisions claimed to be related.
- \`relatedCitedDecisionsId\`: Decisions claimed to be related.

**Goal**: Clearly understand the legal concept and test the teaching represents.

---

## Step 2: Search Blocks for the Teaching (Reasoning Only)

Search the \`blocks\` array to find **all reasoning blocks** that express or apply the teaching.

### 2.1 Search Strategies

**A. Verbatim-Based Search (Primary)**

- Use \`courtVerbatim\` as your primary anchor.
- Search \`plainText\` of blocks for this text or very similar wording.
- This is the court's exact wording and should map to specific blocks.

**B. Keyword Match**

- Extract key legal terms from \`text\`.
- Search \`plainText\` for those terms (including French/Dutch variations).

**C. Conceptual Match**

- Identify the underlying legal concept.
- Search blocks where the court discusses this concept using related terminology (including synonyms).

**D. Provision-Based Match**

- If the teaching relates to specific provisions, find blocks that discuss those provisions.
- Check if these blocks also discuss or apply the concept of the teaching.

**E. Contextual Expansion (within reasoning)**

- Once you find the core block(s) (typically containing \`courtVerbatim\`), examine neighboring reasoning blocks.
- Include blocks that:
  - Explain the meaning or scope of the principle,
  - Apply it to the specific facts,
  - Synthesize or conclude on it.

### 2.2 Eligibility Filter – What Counts as a Citation Block

A block is **eligible** to be included in \`citations\` for a teaching **only if**:

1. It is part of the **court's reasoning**, not purely parties' submissions; and
2. It does at least one of the following:
   - States the teaching or a component of its legal test;
   - Clarifies or refines its conditions, scope, or criteria;
   - Applies the teaching to the facts of the case in a way needed to understand the decision;
   - Synthesizes or concludes on the teaching.

**EXCLUDE from citations:**

- Blocks that contain **only parties' arguments** (griefs, moyens, middel(en), grieven) without the court's own endorsement.
- Blocks that only quote doctrine, travaux préparatoires, policy concerns, or EU/international instruments **without** the court clearly integrating them into the test it applies for the teaching.
- Pure background blocks that can be removed without affecting the ability to reconstruct the principle or its application.

### 2.3 When to Use Multiple Citations

Understanding how many blocks to identify helps achieve the right balance:

**Use 2-4 blocks when:**
- Teaching has simple structure: principle stated → applied to facts
- Example: Block 1 states test, Block 2 applies test, Block 3 concludes

**Use 5-8 blocks when:**
- Multi-part legal test with elements in separate blocks
- Principle refined or clarified progressively across paragraphs
- Multiple distinct factual applications of same principle
- Court synthesizes principle at end after building it incrementally

**Use single block when:**
- Entire teaching (theory + application + conclusion) in one cohesive paragraph
- Adding more blocks would only repeat the same idea

**Red flags (over-extraction):**
- Multiple blocks saying essentially the same thing with minor variations
- Including background that doesn't add to understanding the teaching
- More than 8 blocks for a single teaching (likely too much)

**Red flags (under-extraction):**
- Only theoretical statement without showing how court applied it
- Missing the court's conclusion or synthesis
- Teaching verbatim found but contextualizing blocks omitted

---

## Step 3: Extract Block IDs and Snippets

For each **eligible** block:

1. **Record the block ID**

   - Copy the \`blockId\` **exactly** from that block object.
   - **CRITICAL**: Never reuse block IDs from any examples; only use IDs from the actual \`blocks\` input.

2. **Extract the relevant snippet**

   - From this same block's \`plainText\`, copy the portion that specifically discusses this teaching.
   - **Purpose**: Shows WHY this block is relevant (for debugging, validation, and UI display when lawyer hovers)
   
   **Selection guidance:**
   - If the entire block discusses the teaching: You may extract the complete block text
   - If only part is relevant: Extract the relevant sentence(s) or clause(s)
   - **Quality focus**: Snippet should convey why this block matters for the teaching
   - **No strict length limit**: Extract what's meaningful (typically 50-500 chars, but can be longer for complex blocks)
   - **Must be exact substring**: Copy directly from this block's \`plainText\` field (character-perfect)
   
   **Examples:**

   ✅ **Good snippet** (self-contained, shows teaching):
   "Het bestaan van een arbeidsovereenkomst vereist derhalve het akkoord van de partijen over de wezenlijke elementen ervan, met name arbeid, loon en gezagsverhouding."

   ✅ **Good snippet** (shows factual application):
   "In casu ontbreekt zowel het bewijs van een overeengekomen loon, als het bewijs van een kenmerkende gezagsverhouding."

   ❌ **Poor snippet** (too vague, doesn't show teaching):
   "Het Hof oordeelt..."

3. **Consistency Check (per citation)**

   Before finalizing a citation:

   - Ensure the \`relevantSnippet\` you chose appears **exactly** inside the \`plainText\` of the block identified by \`blockId\`.
   - If it doesn't, you must either:
     - Correct the \`blockId\`, or
     - Correct the \`relevantSnippet\`.
   - It is never acceptable to have a snippet taken from block A with the \`blockId\` of block B.

**Example:**

\`\`\`json
{
  "blockId": "ECLI:BE:CASS:2024:ARR.001:block-017",
  "relevantSnippet": "Het bewijs van het bestaan van de ingeroepen arbeidsovereenkomst impliceert het bewijs van een overeenkomst waarbij... onder gezag van de NV arbeid te verrichten."
}
\`\`\`

---

## Step 4: Apply the Reasoning Deletion Test

For each teaching, apply this test **only to the court's reasoning**:

> Imagine removing all blocks you have selected **from the reasoning sections**. After removal, there must be **no remaining block in the reasoning** where the court still states, explains, or applies this teaching.

If there would still be a statement or application of the teaching in reasoning blocks you did not select:

- ⚠️ You missed relevant reasoning blocks → return to Step 2 and extend your selection.

**Important constraints:**

- **Ignore** occurrences of the teaching in:
  - Griefs / moyens / middel(en) / parties' arguments.
  - Purely procedural formalities or "Vu / Gelet op" lists.
- Do **not** include party arguments as citations purely to satisfy the Deletion Test. Only court reasoning counts.

**Balance:**

- Aim for a set of citations that is **complete for the reasoning**, but still reasonably compact.
- Prefer identifying high-value blocks that state, clarify, or apply the teaching over flooding with marginally relevant background.

---

## Step 5: Validate Relationship Claims

Stage 5A claimed certain provisions and decisions are related to this teaching. Verify those claims against the blocks you have identified for that teaching.

### Validate Provisions

For each ID in \`relatedCitedProvisionsId\`:

1. Look up the provision in \`citedProvisions\`.
2. Get its human-readable identifier (e.g. "article 31", "artikel 6.1").
3. Check the \`plainText\` of **every identified citation block** for that provision.
4. If it appears in at least one block: count as validated.
5. If it doesn't appear: record the provision ID in \`provisionsNotFoundInCitations\`.

### Validate Decisions

For each ID in \`relatedCitedDecisionsId\`:

1. Look up the decision in \`citedDecisions\`.
2. Get its identifier (ECLI, case number, date, etc.).
3. Check the \`plainText\` of **every identified citation block** for that identifier.
4. If it appears in at least one block: count as validated.
5. If it doesn't appear: record the decision ID in \`decisionsNotFoundInCitations\`.

### Interpreting Validation Results

**If provision/decision NOT found in citation blocks:**

✅ **Acceptable scenarios (flag but not problematic):**
- Provision only in "Vu/Gelet op" sections (formal legal basis, not reasoning)
- Provision in party argument sections (excluded from citations)
- Teaching is abstract interpretation; provision text not literally discussed
- Stage 5A linked provision that's conceptually related but not textually cited

❌ **Problematic scenarios (investigate):**
- Provision clearly discussed in reasoning blocks you identified, but you can't find it
  → Check if you used wrong search term or missed a block
- Provision mentioned in Stage 5A but appears nowhere in decision
  → Flag accurately; may indicate Stage 5A error

**Important**: Your job is to report validation status accurately, not to "fix" Stage 5A's relationships.

Create a validation summary per teaching.

---

# OUTPUT SCHEMA

\`\`\`json
{
  "legalTeachings": [
    {
      "teachingId": "TEACH-{decisionId}-001",
      "citations": [
        {
          "blockId": "ECLI:BE:CASS:2024:ARR.001:block-017",
          "relevantSnippet": "Het bewijs van het bestaan van de ingeroepen arbeidsovereenkomst impliceert het bewijs van een overeenkomst..."
        },
        {
          "blockId": "ECLI:BE:CASS:2024:ARR.001:block-020",
          "relevantSnippet": "In casu ontbreekt zowel het bewijs van een overeengekomen loon, als het bewijs van een kenmerkende gezagsverhouding."
        }
      ],
      "relationshipValidation": {
        "provisionsValidated": 2,
        "provisionsNotFoundInCitations": [],
        "decisionsValidated": 1,
        "decisionsNotFoundInCitations": []
      }
    }
  ],
  "metadata": {
    "totalTeachings": 1,
    "citationStatistics": {
      "totalCitations": 2,
      "avgCitationsPerTeaching": 2.0,
      "teachingsWithMinimalCitations": 0,
      "teachingsWithNoCitations": 0
    },
    "validationSummary": {
      "totalProvisionsValidated": 2,
      "totalProvisionsNotFound": 0,
      "totalDecisionsValidated": 1,
      "totalDecisionsNotFound": 0
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

**\`teachingId\`** (REQUIRED)

- Purpose: Match to teachings from Stage 5A.
- Must be exactly the same as in the input teaching.
- Format: \`TEACH-{decisionId}-{sequence}\`.

### Citations Array

**\`citations\`** (REQUIRED array, minimum 1 item per teaching)

Each citation object:

- \`blockId\`: Exact block ID from the \`blocks\` input array.
- \`relevantSnippet\`: Excerpt from that block's \`plainText\` showing why this block is relevant for the teaching.

**Requirements:**

- Block IDs must match exactly (character-perfect).
- Snippets must be actual substrings of **that** block's \`plainText\`.
- Snippets must show the teaching concept, not random text.
- Multiple teachings may reference the same block — this is expected.

**Granularity:**

- **Minimum**: 1 citation per teaching.
- **Typical**: 2-6 citations per teaching.
- **No strict maximum**, but:
  - Prefer a compact set of high-value blocks to flooding with marginally relevant ones.
  - Do not include background or party argument blocks just to increase the count.

### Relationship Validation

**\`relationshipValidation\`** (REQUIRED object)

- \`provisionsValidated\`: integer (count of related provisions found in citation blocks).
- \`provisionsNotFoundInCitations\`: array of provision IDs that were not found.
- \`decisionsValidated\`: integer (count of related decisions found in citation blocks).
- \`decisionsNotFoundInCitations\`: array of decision IDs that were not found.

### Metadata: Section Distribution

**\`sectionDistribution\`** (OPTIONAL but recommended)

Tracks which types of blocks were identified:

- \`reasoningBlocks\`: Count of blocks from court's reasoning sections
- \`partyArgumentBlocks\`: Count of party argument blocks (should always be 0)
- \`vuGeletOpBlocks\`: Count of formal citation blocks
- \`factsBlocks\`: Count of factual background blocks
- \`judgmentBlocks\`: Count of judgment/operative blocks

**Purpose**: Helps detect if party argument blocks leaked through (should always be 0).

---

# EXAMPLES

> **Important:** Block IDs in the examples below are purely illustrative.  
> In your output you must use only the \`blockId\` values provided in the actual \`blocks\` input, never copy IDs from these examples.

## Example 1: Complete Identification with Validation (Dutch)

**Input Blocks (excerpt):**

\`\`\`json
[
  {
    "blockId": "ECLI:BE:AHANT:2001:ARR.20011212.7:block-015",
    "plainText": "Het Hof dient eerst na te gaan of sprake is van een arbeidsovereenkomst in de zin van artikel 2 van de Arbeidsovereenkomstenwet.",
    "elementType": "p",
    "charCount": 142
  },
  {
    "blockId": "ECLI:BE:AHANT:2001:ARR.20011212.7:block-017",
    "plainText": "Het bewijs van het bestaan van de ingeroepen arbeidsovereenkomst impliceert het bewijs van een overeenkomst waarbij de echtgenoten R.D.-L.V. zich ertoe verbonden tegen loon, onder gezag van de NV arbeid te verrichten. Het bestaan van een arbeidsovereenkomst vereist derhalve het akkoord van de partijen over de wezenlijke elementen ervan, met name arbeid, loon en gezagsverhouding.",
    "elementType": "p",
    "charCount": 356
  },
  {
    "blockId": "ECLI:BE:AHANT:2001:ARR.20011212.7:block-018",
    "plainText": "In casu ontbreekt zowel het bewijs van een overeengekomen loon, als het bewijs van een voor een arbeidsovereenkomst kenmerkende gezagsverhouding.",
    "elementType": "p",
    "charCount": 147
  }
]
\`\`\`

**Input Teaching:**

\`\`\`json
{
  "teachingId": "TEACH-ECLI:BE:AHANT:2001:ARR.20011212.7-001",
  "text": "Voor het bestaan van een arbeidsovereenkomst is vereist dat partijen overeenstemming hebben over de drie wezenlijke elementen: arbeid, loon en gezag.",
  "courtVerbatim": "Het bestaan van een arbeidsovereenkomst vereist derhalve het akkoord van de partijen over de wezenlijke elementen ervan, met name arbeid, loon en gezagsverhouding.",
  "relatedCitedProvisionsId": ["ART-ECLI:BE:AHANT:2001:ARR.20011212.7-001"],
  "relatedCitedDecisionsId": []
}
\`\`\`

**Output:**

\`\`\`json
{
  "teachingId": "TEACH-ECLI:BE:AHANT:2001:ARR.20011212.7-001",
  "citations": [
    {
      "blockId": "ECLI:BE:AHANT:2001:ARR.20011212.7:block-017",
      "relevantSnippet": "Het bestaan van een arbeidsovereenkomst vereist derhalve het akkoord van de partijen over de wezenlijke elementen ervan, met name arbeid, loon en gezagsverhouding."
    },
    {
      "blockId": "ECLI:BE:AHANT:2001:ARR.20011212.7:block-018",
      "relevantSnippet": "In casu ontbreekt zowel het bewijs van een overeengekomen loon, als het bewijs van een voor een arbeidsovereenkomst kenmerkende gezagsverhouding."
    }
  ],
  "relationshipValidation": {
    "provisionsValidated": 1,
    "provisionsNotFoundInCitations": [],
    "decisionsValidated": 0,
    "decisionsNotFoundInCitations": []
  }
}
\`\`\`

**Why This Works:**

- Block 017 contains the **court's exact test** (verbatim search).
- Block 018 applies that test to the facts (reasoning application).
- Both blocks are clearly part of the court's reasoning (not parties' arguments).
- The provision is found in reasoning blocks.
- Removing 017 and 018 from reasoning would remove the test and its application.

---

## Example 2: Multiple Teachings, Shared Blocks (French)

**Input Blocks (excerpt):**

\`\`\`json
[
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230315-015",
    "plainText": "L'article 31, § 2, de la loi du 10 mai 2007 dispose que le Centre pour l'égalité des chances peut ester en justice lorsqu'il constate une discrimination, à condition de prouver l'accord d'une personne lésée identifiée.",
    "elementType": "p",
    "charCount": 230
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230315-016",
    "plainText": "Toutefois, la Cour interprète cette disposition à la lumière de l'objectif général de la loi. Lorsque la discrimination affecte un nombre indéterminé de personnes, l'exigence d'un accord individuel viderait la loi de son effet utile.",
    "elementType": "p",
    "charCount": 234
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230315-017",
    "plainText": "En l'espèce, les offres d'emploi litigieuses mentionnaient explicitement des critères d'âge. Il s'agit d'une discrimination potentiellement généralisée.",
    "elementType": "p",
    "charCount": 153
  },
  {
    "blockId": "ECLI:BE:CASS:2023:ARR.20230315-018",
    "plainText": "L'intérêt collectif à combattre la discrimination généralisée l'emporte sur la protection des droits individuels. Le Centre est recevable sans l'accord d'une victime identifiée.",
    "elementType": "p",
    "charCount": 180
  }
]
\`\`\`

**Input Teachings:**

\`\`\`json
[
  {
    "teachingId": "TEACH-ECLI:BE:CASS:2023:ARR.20230315-001",
    "text": "Article 31 § 2 exige normalement l'accord d'une victime identifiée...",
    "courtVerbatim": "L'article 31, § 2, de la loi du 10 mai 2007 dispose que... à condition de prouver l'accord d'une personne lésée identifiée.",
    "relatedCitedProvisionsId": ["ART-...-001"]
  },
  {
    "teachingId": "TEACH-ECLI:BE:CASS:2023:ARR.20230315-002",
    "text": "Lorsque la discrimination est généralisée, l'exigence d'un accord individuel viderait la loi de son effet utile...",
    "courtVerbatim": "Lorsque la discrimination affecte un nombre indéterminé de personnes, l'exigence d'un accord individuel viderait la loi de son effet utile.",
    "relatedCitedProvisionsId": ["ART-...-001"]
  }
]
\`\`\`

**Output:**

\`\`\`json
{
  "legalTeachings": [
    {
      "teachingId": "TEACH-ECLI:BE:CASS:2023:ARR.20230315-001",
      "citations": [
        {
          "blockId": "ECLI:BE:CASS:2023:ARR.20230315-015",
          "relevantSnippet": "L'article 31, § 2, de la loi du 10 mai 2007 dispose que le Centre... à condition de prouver l'accord d'une personne lésée identifiée."
        }
      ],
      "relationshipValidation": {
        "provisionsValidated": 1,
        "provisionsNotFoundInCitations": [],
        "decisionsValidated": 0,
        "decisionsNotFoundInCitations": []
      }
    },
    {
      "teachingId": "TEACH-ECLI:BE:CASS:2023:ARR.20230315-002",
      "citations": [
        {
          "blockId": "ECLI:BE:CASS:2023:ARR.20230315-016",
          "relevantSnippet": "Lorsque la discrimination affecte un nombre indéterminé de personnes, l'exigence d'un accord individuel viderait la loi de son effet utile."
        },
        {
          "blockId": "ECLI:BE:CASS:2023:ARR.20230315-017",
          "relevantSnippet": "les offres d'emploi litigieuses mentionnaient explicitement des critères d'âge. Il s'agit d'une discrimination potentiellement généralisée."
        },
        {
          "blockId": "ECLI:BE:CASS:2023:ARR.20230315-018",
          "relevantSnippet": "L'intérêt collectif à combattre la discrimination généralisée l'emporte sur la protection des droits individuels."
        }
      ],
      "relationshipValidation": {
        "provisionsValidated": 1,
        "provisionsNotFoundInCitations": [],
        "decisionsValidated": 0,
        "decisionsNotFoundInCitations": []
      }
    }
  ]
}
\`\`\`

**Why This Works:**

- Teaching 1 (general rule): Only block 015 discusses it
- Teaching 2 (exception): Blocks 016-018 discuss generalized discrimination exception
- Both teachings relate to Article 31 (shared provision, different aspects)
- Snippets show exact reasoning for each block's relevance

---

## Example 3: Validation Failure (Provision Not Found)

**Input Teaching:**

\`\`\`json
{
  "teachingId": "TEACH-EXAMPLE-001",
  "text": "Le délai de préavis doit être raisonnable...",
  "courtVerbatim": "Le délai doit respecter le principe de bonne foi...",
  "relatedCitedProvisionsId": ["ART-EXAMPLE-001", "ART-EXAMPLE-005"],
  "relatedCitedDecisionsId": ["DEC-EXAMPLE-002"]
}
\`\`\`

**Identified Blocks:**

\`\`\`json
[
  {
    "blockId": "...:block-042",
    "plainText": "L'article 1184 du Code civil impose une obligation de bonne foi lors de la rupture d'un contrat. Le délai doit respecter le principe de bonne foi."
  }
]
\`\`\`

**Output:**

\`\`\`json
{
  "teachingId": "TEACH-EXAMPLE-001",
  "citations": [
    {
      "blockId": "...:block-042",
      "relevantSnippet": "Le délai doit respecter le principe de bonne foi."
    }
  ],
  "relationshipValidation": {
    "provisionsValidated": 1,
    "provisionsNotFoundInCitations": ["ART-EXAMPLE-005"],
    "decisionsValidated": 0,
    "decisionsNotFoundInCitations": ["DEC-EXAMPLE-002"]
  }
}
\`\`\`

**Interpretation:**

- ⚠️ Article corresponding to ART-EXAMPLE-001 found (Article 1184 mentioned in block 042)
- ⚠️ Article corresponding to ART-EXAMPLE-005 NOT found in identified blocks (flagged)
- ⚠️ Decision DEC-EXAMPLE-002 NOT found in identified blocks (flagged)
- This suggests Stage 5A may have over-linked, OR teaching is abstract and Article 5 discussed separately, OR Article 5 mentioned in "Vu" section which wasn't identified

---

## Example 4: Excluding Party Arguments (French)

**Input Block (from "II. Le moyen de cassation" section):**

\`\`\`json
{
  "blockId": "ECLI:BE:CASS:2024:ARR.042:block-037",
  "plainText": "Le moyen de cassation fait valoir que l'article 31, § 2, de la loi anti-discrimination exige la preuve d'un accord explicite et écrit de la victime identifiée avant que le Centre puisse ester en justice. Le demandeur soutient que cette condition n'a pas été respectée en l'espèce.",
  "elementType": "p",
  "charCount": 287
}
\`\`\`

**Input Teaching:**

\`\`\`json
{
  "teachingId": "TEACH-...-001",
  "text": "L'article 31, § 2, exige l'accord d'une victime identifiée...",
  "courtVerbatim": "L'article 31, § 2, de la loi dispose que le Centre peut ester en justice à condition de prouver l'accord d'une personne lésée identifiée..."
}
\`\`\`

**Correct Approach:**

❌ **Do NOT include block-037 in citations** even though:
- It discusses Article 31, § 2 (same provision as teaching)
- It mentions the victim consent requirement (same concept)
- It uses similar legal terminology

**Why exclude:**
- This block is from "II. Le moyen de cassation" section (party argument)
- It presents the **applicant's position**, not the court's reasoning
- The court may **reject** this argument later in its reasoning
- Including it would highlight a rejected argument as if it were the court's holding

**What to do instead:**
- Search for blocks where the **court** discusses Article 31, § 2 in its **own reasoning**
- Typical sections: "III. La décision de la Cour", "En droit", "Motifs"
- Only cite blocks where court **states, clarifies, or applies** the teaching

---

# VALIDATION CHECKLIST

Before finalizing output, verify:

## Structural Validation

- [ ] Every teaching from input appears in output
- [ ] Every \`teachingId\` matches input exactly
- [ ] No teachings added or removed

## Block Citations Quality

- [ ] Every teaching has at least 1 citation
- [ ] Every \`blockId\` in citations exists in the \`blocks\` input
- [ ] For each citation, \`relevantSnippet\` is an exact substring of that block's \`plainText\`
- [ ] Citations are limited to **court reasoning** (not pure party arguments)
- [ ] Citations focus on blocks that state, clarify, refine, or apply the teaching

## Completeness (Reasoning Deletion Test)

- [ ] If all cited reasoning blocks were removed, the teaching would no longer be present in the court's reasoning
- [ ] You checked for:
  - Variants of wording (synonyms, paraphrases)
  - Application blocks
  - Synthesis or conclusion blocks
- [ ] You did **not** include party argument blocks just to satisfy the test

## Relationship Validation

- [ ] All IDs in \`relatedCitedProvisionsId\` were checked against citation blocks' \`plainText\`
- [ ] All IDs in \`relatedCitedDecisionsId\` were checked similarly
- [ ] Counts and not-found lists are accurate

## Section Awareness

- [ ] Cited blocks are mainly from reasoning sections ("En droit", "Motifs", "Discussion", "Overwegingen", etc.)
- [ ] You excluded pure "Griefs/Moyen/Middel(en)" blocks that present only party arguments
- [ ] Procedural/introductory sections were only included if the teaching is strictly procedural and actually stated there

## Metadata Accuracy

- [ ] \`totalTeachings\` matches the number of teachings in output
- [ ] \`totalCitations\` matches the sum of all citations
- [ ] \`avgCitationsPerTeaching\` is correctly computed
- [ ] Validation summary matches the per-teaching validation data
- [ ] \`sectionDistribution.partyArgumentBlocks\` = 0 (party arguments excluded)

---

# CRITICAL REMINDERS

1. **Reasoning vs Arguments**: Only the court's reasoning counts as support for the teaching. Party arguments (griefs, moyens, middel(en), grieven) must **not** be included in \`citations\`.

2. **Block IDs Must Match**: Copy the \`blockId\` exactly from the \`blocks\` input. Never reuse example IDs.

3. **Snippets Must Be Substrings of That Block**: \`relevantSnippet\` must be an exact substring of the \`plainText\` of the block identified by \`blockId\`.

4. **Reasoning Deletion Test**: Removing all cited reasoning blocks should remove the teaching from the court's reasoning. Ignore parties' arguments for this test.

5. **Balanced Completeness**: Include all reasoning blocks needed to reconstruct the teaching and its application, but avoid highlighting huge portions of the decision that add only distant background or policy noise.

6. **No Invention**: Do not invent content, blocks, or references. Only work with the provided \`blocks\`, \`legalTeachings\`, \`citedProvisions\`, and \`citedDecisions\`.

7. **Shared Blocks Allowed**: The same block may legitimately support multiple teachings.

8. **Snippet Quality**: Snippets are for UI display (hover tooltips) - they should be meaningful and show WHY the block is relevant.

9. **JSON Only**: Output must be valid JSON matching the schema. No markdown, comments, or explanatory text.

---

# OUTPUT FORMAT

Return **only** valid JSON matching the schema defined above. No markdown, no code blocks, no explanations.`;