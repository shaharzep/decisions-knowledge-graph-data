/**
 * Micro-Summary Extraction Prompt Template
 *
 * Generates concise micro-summaries with dynamic length scaling based on decision complexity.
 *
 * Length scaling:
 * - Short/Medium (< 10K chars): 50-600 chars, 2-3 sentences
 * - Medium (10K-30K chars): 50-1000 chars, 2-4 sentences
 * - Long (30K-60K chars): 50-1400 chars, 3-5 sentences
 * - Very Long (60K+ chars): 50-1800 chars, 3-6 sentences
 *
 * Model extracts:
 * - Who: Parties involved (generic terms)
 * - What: Core legal issue
 * - Outcome: What the court decided
 * - Key point: Critical legal principle or finding
 */

interface SummaryConstraints {
  minChars: number;
  maxChars: number;
  sentenceRange: string;
}

/**
 * Calculate dynamic summary length constraints based on decision complexity
 *
 * Scales character limits and sentence count with decision length to prevent truncation
 * while maintaining quality and conciseness appropriate to case complexity.
 *
 * @param mdLength - Decision markdown character count
 * @returns Constraints object with min/max chars and sentence range
 */
export function calculateSummaryConstraints(mdLength: number): SummaryConstraints {
  if (mdLength < 10000) {
    return { minChars: 50, maxChars: 600, sentenceRange: "2-3" };
  } else if (mdLength < 30000) {
    return { minChars: 50, maxChars: 1000, sentenceRange: "2-4" };
  } else if (mdLength < 60000) {
    return { minChars: 50, maxChars: 1400, sentenceRange: "3-5" };
  } else {
    return { minChars: 50, maxChars: 1800, sentenceRange: "3-6" };
  }
}

export const MICRO_SUMMARY_PROMPT_TEMPLATE = `# MISSION

Create a concise micro-summary of this court decision for quick reference.

# MODEL OPTIMIZATION

Focus on:
1. Identifying the most essential elements of the case
2. Creating a clear, scannable summary
3. Ensuring professional legal language
4. Making it self-contained and understandable

# INPUT

You will receive:

1. **Decision ID**: {decisionId}
2. **Procedural Language**: {proceduralLanguage}
3. **Markdown Text**: The complete decision text below

{fullText.markdown}

# CRITICAL: LANGUAGE HANDLING

Write the summary in the procedural language of the input markdown file.

- If procedural language is **FR** → write summary in French
- If procedural language is **NL** → write summary in Dutch

# TASK

Write ONE micro-summary in the procedural language of the decision.

## Content Requirements

The micro-summary must include:

1. **Who**: Parties involved (generic terms: "le demandeur", "la société", "de eiser", "de vennootschap")
2. **What**: Core legal issue or dispute
3. **Outcome**: What the court decided
4. **Key point**: One critical legal principle or finding

## Style Guidelines

- **Length:** {sentenceRange} sentences (approximately 60-150 words)
- **(REQUIRED)** {minCharacters}-{maxCharacters} characters
- **Tone:** Formal legal language
- **Clarity:** Clear and scannable
- **Completeness:** Self-contained (readable without full decision)
- **Neutrality:** Objective legal description
- **Language:** In procedural language only

**Note:** The character limit scales with decision complexity - longer, more complex decisions warrant more detailed summaries to capture essential elements without truncation.

## Party Term Guidelines

Use generic terms appropriate to the party type:

**French:**
- Natural persons: "le demandeur", "le défendeur", "l'employé", "le travailleur"
- Legal entities: "la société", "l'entreprise", "l'employeur"
- Public authorities: "l'État", "l'administration", "le Centre"

**Dutch:**
- Natural persons: "de eiser", "de verweerder", "de werknemer"
- Legal entities: "de vennootschap", "de onderneming", "de werkgever"
- Public authorities: "de Staat", "de overheid", "het Centrum"

**When to be more specific:**
- Use role-specific terms when relevant: "l'employeur/de werkgever", "le distributeur/de distributeur"
- Use institutional names when party type is distinctive: "un organisme de promotion de l'égalité", "een gelijkheidsorgaan"

# QUALITY STANDARDS

## Good Micro-Summary Example (French):
\`\`\`
Un organisme de promotion de l'égalité a introduit une action collective concernant
des offres d'emploi comportant des critères d'âge discriminatoires. La Cour casse
partiellement l'arrêt d'appel qui avait déclaré l'action irrecevable, jugeant que
l'absence d'accord d'une victime identifiée n'est pas requise lorsque la discrimination
affecte potentiellement un nombre indéterminé de personnes. L'affaire est renvoyée
devant la cour d'appel pour examen au fond.
\`\`\`

**Why this is good:**
- ✅ Identifies who: "Un organisme de promotion de l'égalité"
- ✅ Explains what: "action collective concernant des offres d'emploi comportant des critères d'âge discriminatoires"
- ✅ States outcome: "La Cour casse partiellement l'arrêt d'appel"
- ✅ Gives key point: Reasoning about victim consent requirement
- ✅ 3 sentences, professional tone, self-contained

## Good Micro-Summary Example (Dutch):
\`\`\`
Een werknemer vordert een opzeggingsvergoeding wegens ontoereikende opzegtermijn
na een dienstverband van vijf jaar. Het Arbeidshof verklaart de vordering gegrond
en oordeelt dat de opzegtermijn van drie maanden manifest ontoereikend is gezien
de duur en intensiteit van de arbeidsrelatie. De werkgever wordt veroordeeld tot
betaling van een aanvullende opzeggingsvergoeding.
\`\`\`

**Why this is good:**
- ✅ Identifies who: "Een werknemer" and "De werkgever"
- ✅ Explains what: Dispute over insufficient notice period
- ✅ States outcome: "Het Arbeidshof verklaart de vordering gegrond"
- ✅ Gives key point: Reasoning about proportionality of notice period
- ✅ 3 sentences, professional tone, clear

## Poor Micro-Summary Examples:

**❌ Too vague:**
\`\`\`
Un demandeur a introduit une action contre une société. La cour a tranché en faveur
du demandeur. L'affaire concernait des questions de droit du travail.
\`\`\`
*Problem: No specific legal issue, no key principle, could describe any case*

**❌ Too detailed:**
\`\`\`
Monsieur Jean Dupont, né le 15 mars 1965, résidant à Bruxelles, a introduit une
action le 3 janvier 2022 contre la SA BelgoCorp, société anonyme dont le siège
social est situé rue de la Loi 123 à 1000 Bruxelles...
\`\`\`
*Problem: Unnecessary specific details (names, dates, addresses), too long*

**❌ Procedural focus only:**
\`\`\`
L'affaire a été introduite en première instance puis portée en appel. La cour
d'appel a confirmé le jugement. Le délai de cassation n'a pas été respecté.
\`\`\`
*Problem: Only procedural history, no substance, no legal issue*

# CRITICAL OUTPUT FORMAT REQUIREMENTS

You MUST output ONLY valid JSON in this EXACT structure. Do not include any text before or after the JSON. No markdown code blocks, no explanations.
\`\`\`json
{
  "microSummary": "Summary text in procedural language ({minCharacters}-{maxCharacters} chars)"
}
\`\`\`

## MANDATORY VALIDATION REQUIREMENTS

1. **microSummary:**
    - **(REQUIRED)** String type (not null, not empty)
    - **(REQUIRED)** Minimum {minCharacters} characters
    - **(REQUIRED)** Maximum {maxCharacters} characters
    - **(REQUIRED)** In procedural language
    - Must be {sentenceRange} sentences
    - Approximately 60-150 words

2. **Structure:**
    - Root object contains only \`microSummary\` field
    - Direct string value (not nested object)

3. **Content:**
    - Includes who (parties)
    - Includes what (legal issue)
    - Includes outcome (court decision)
    - Includes key point (legal principle or finding)

4. **Language:**
    - All text in procedural language (FR or NL)
    - No English
    - Professional legal language

5. **Output format:**
    - ONLY the JSON object
    - No markdown code blocks (no \`\`\`json)
    - No explanations before or after
    - Properly escaped quotes within strings
    - Valid JSON syntax

# EXTRACTION GUIDELINES

## Step 1: Identify Key Elements

Review the decision text to identify:
- **Who is involved** (use generic terms)
- **What happened** (core factual scenario)
- **What the court decided** (outcome)
- **Key legal reasoning or principle**

## Step 2: Draft Summary

Write {sentenceRange} sentences that cover:
1. **Sentence 1:** Who + What (party + legal issue)
2. **Sentence 2:** Outcome + Key reasoning
3. **Sentence 3+ (if needed):** Additional key points or procedural outcome

## Step 3: Validate

Check:
- [ ] {minCharacters}-{maxCharacters} characters?
- [ ] {sentenceRange} sentences?
- [ ] Approximately 60-150 words?
- [ ] Includes who, what, outcome, key point?
- [ ] In procedural language?
- [ ] Generic party terms used?
- [ ] Self-contained and clear?
- [ ] Professional legal language?

## Step 4: Format as JSON

- Create valid JSON with single \`microSummary\` string field
- Ensure proper quote escaping
- No line breaks within the string value
- No markdown code blocks

# EXAMPLE OUTPUTS

## Example 1: French Decision - Employment Discrimination

**Context:** Equality body sues over age criteria in job postings
\`\`\`json
{
  "microSummary": "Un organisme de promotion de l'égalité a introduit une action collective concernant des offres d'emploi comportant des critères d'âge discriminatoires. La Cour casse partiellement l'arrêt d'appel qui avait déclaré l'action irrecevable, jugeant que l'absence d'accord d'une victime identifiée n'est pas requise lorsque la discrimination affecte potentiellement un nombre indéterminé de personnes. L'affaire est renvoyée devant la cour d'appel pour examen au fond."
}
\`\`\`

## Example 2: Dutch Decision - Employment Termination

**Context:** Employee claims insufficient notice period
\`\`\`json
{
  "microSummary": "Een werknemer vordert een opzeggingsvergoeding wegens ontoereikende opzegtermijn na een dienstverband van vijf jaar. Het Arbeidshof verklaart de vordering gegrond en oordeelt dat de opzegtermijn van drie maanden manifest ontoereikend is gezien de duur en intensiteit van de arbeidsrelatie. De werkgever wordt veroordeeld tot betaling van een aanvullende opzeggingsvergoeding."
}
\`\`\`

## Example 3: French Decision - Contract Dispute

**Context:** Distributor claims abusive termination
\`\`\`json
{
  "microSummary": "Un distributeur conteste la rupture d'un contrat de distribution de longue durée avec un préavis de trois mois. La cour d'appel juge que ce préavis est manifestement insuffisant compte tenu de la dépendance économique du distributeur et de la durée de la relation commerciale. Le fournisseur est condamné à payer des dommages-intérêts pour rupture abusive."
}
\`\`\`

## Example 4: Dutch Decision - Bankruptcy

**Context:** Appeal regarding bankruptcy declaration
\`\`\`json
{
  "microSummary": "Een vennootschap vraagt de opening van een gerechtelijke reorganisatieprocedure, maar wordt in faillissement verklaard. Het hof van beroep moet beoordelen of aan de voorwaarden voor faillissement was voldaan op het moment dat de eerste rechter zijn beslissing nam, zonder rekening te houden met latere omstandigheden. Het vonnis wordt bevestigd."
}
\`\`\`

# VALIDATION CHECKLIST

Before submitting your output, verify:

**Structure:**
- [ ] Output is pure JSON (no \`\`\`json markers, no extra text)
- [ ] Single field: \`microSummary\` with string value
- [ ] No nested objects (direct string value)
- [ ] Valid JSON syntax
- [ ] Properly escaped quotes if needed

**Content:**
- [ ] Summary is {minCharacters}-{maxCharacters} characters
- [ ] Summary is {sentenceRange} sentences
- [ ] Summary is approximately 60-150 words
- [ ] Includes who (generic party terms)
- [ ] Includes what (core legal issue)
- [ ] Includes outcome (court decision)
- [ ] Includes key point (legal principle/finding)

**Language:**
- [ ] All text in procedural language
- [ ] No English
- [ ] Professional legal language
- [ ] Generic party terms (not specific names)

**Quality:**
- [ ] Self-contained (understandable without context)
- [ ] Clear and scannable
- [ ] Neutral and objective
- [ ] Complete sentences
- [ ] Coherent narrative

# CRITICAL REMINDERS

1. **Output ONLY JSON** - No markdown code blocks, no explanations, no extra text
2. **Direct string value** - \`{"microSummary": "text..."}\` NOT \`{"microSummary": {"text": "..."}}\`
3. **Language consistency** - Summary in procedural language only
4. **Valid JSON** - Properly escaped quotes, valid syntax
5. **Exact structure** - Must match the format exactly
6. **Complete sentences** - Summary must be complete and coherent
7. **Self-contained** - Readable without additional context
8. **Generic terms** - Use "le demandeur", "de werkgever", not specific names
9. **Character limit** - {minCharacters}-{maxCharacters} characters (REQUIRED)
10. **Sentence limit** - {sentenceRange} sentences (REQUIRED)

---

## OUTPUT FORMAT

Return ONLY valid JSON matching the schema. No markdown, no code blocks, no explanatory text.
`;

/**
 * Create micro-summary extraction prompt with dynamic length constraints
 *
 * Calculates appropriate summary length based on decision complexity,
 * fills template with decision metadata and injects calculated constraints.
 *
 * @param row Database row with decision data (must include full_md)
 * @returns Filled prompt string with dynamic length requirements
 */
export function createMicroSummaryPrompt(row: any): string {
  const decisionId = row.decision_id || "";
  const proceduralLanguage = row.language_metadata || "FR";
  const fullText = row.full_md || "";
  const mdLength = fullText.length;

  const constraints = calculateSummaryConstraints(mdLength);

  return MICRO_SUMMARY_PROMPT_TEMPLATE
    .replaceAll("{decisionId}", decisionId)
    .replaceAll("{proceduralLanguage}", proceduralLanguage)
    .replaceAll("{fullText.markdown}", fullText)
    .replaceAll("{minCharacters}", String(constraints.minChars))
    .replaceAll("{maxCharacters}", String(constraints.maxChars))
    .replaceAll("{sentenceRange}", constraints.sentenceRange);
}
