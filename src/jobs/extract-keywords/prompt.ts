/**
 * Keywords Extraction Prompt
 *
 * IMPORTANT: This prompt is tested and validated. DO NOT MODIFY.
 *
 * Template variables to replace:
 * - {{decisionId}}
 * - {{fullTextMarkdown}}
 * - {{factsFr}}
 * - {{citedProvisions}}
 * - {{proceduralLanguage}}
 * - {{keywordsUtu}}
 */

export const KEYWORDS_PROMPT = `# MISSION
You are a legal indexing specialist for Belgian jurisprudence. Your task is to (1) generate a set of custom keywords that capture the essence of the decision, and (2) identify the relevant legal issues from a provided taxonomy.

# INPUT
- Decision ID: {{decisionId}}
- Markdown Text: {{fullTextMarkdown}}
- Facts: {{factsFr}}
- Cited Provisions: {{citedProvisions}}
- Procedural Language: {{proceduralLanguage}}
- Legal Issues Taxonomy: {{keywordsUtu}}

# UNDERSTANDING EXCELLENT KEYWORD GENERATION

**Purpose of custom keywords:**
- Provide users with a quick, scannable overview of the decision's content
- Facilitate search and discovery of relevant decisions
- Capture both factual and legal dimensions
- Enable connection between similar cases

**Characteristics of excellent keywords:**
1. **Specificity**: Prefer specific terms over generic ones
   - Good: "contrat de distribution exclusive", "préavis de résiliation", "dépendance économique"
   - Poor: "contrat", "résiliation", "obligations"

2. **Balance**: Include both factual and legal keywords
   - Factual: type of contract, parties type, subject matter, amounts if significant
   - Legal: causes of action, defenses, legal principles, procedural issues

3. **Relevance**: Keywords should all be directly relevant to the decision
   - Include only concepts that are actually addressed in the decision
   - Don't include tangential mentions

4. **Comprehensiveness**: Cover all major aspects
   - Primary legal issues (2-4 keywords)
   - Factual context (2-4 keywords)
   - Procedural aspects if significant (0-2 keywords)
   - Outcomes/remedies (0-2 keywords)

5. **Multilingual awareness**:
   - Keywords should be in the procedural language of the decision
   - Use standard legal terminology
   - Align with Belgian legal vocabulary

6. **Optimal count**: 8-15 keywords typically ideal
   - Too few: insufficient indexing
   - Too many: dilutes relevance

**Keyword categories to consider:**
- **Subject matter**: What is the case about? (e.g., "distribution commerciale", "contrat de travail", "responsabilité civile")
- **Legal fields**: What areas of law? (e.g., "droit commercial", "droit du travail", "droit des contrats")
- **Specific legal concepts**: What doctrines/principles? (e.g., "bonne foi contractuelle", "abus de droit", "force majeure")
- **Parties type**: Who are the parties? (e.g., "société commerciale", "consommateur", "travailleur")
- **Procedural stage**: What type of proceeding? (e.g., "appel", "référé", "cassation")
- **Remedies**: What relief? (e.g., "dommages et intérêts", "résolution", "exécution forcée")

# TASK 1: GENERATE CUSTOM KEYWORDS

Generate an array of 8-15 keywords in the procedural language of the decision.

## Process:
1. Read the entire decision, with emphasis on:
   - Facts section
   - Legal issues addressed
   - Provisions cited
   - Court's reasoning
   - Dispositif

2. Identify the core themes and legal questions

3. Generate keywords following the excellence criteria above

4. Review to ensure:
   - No redundancy
   - Appropriate specificity
   - Balanced coverage
   - Correct language

# TASK 2: MAP TO LEGAL ISSUES TAXONOMY

**Your task**: Match the decision to relevant entries in the provided Legal Issues Taxonomy.

## Process:
1. Review the taxonomy structure (organized hierarchically by legal field)

2. Identify all relevant legal issues that apply to this decision:
   - Start broad (main legal field)
   - Then identify specific sub-issues
   - Consider all issues addressed, not just the primary one

3. For each match, extract:
   - \`id\`: The unique identifier from the taxonomy
   - \`keywordsSequenceFr\`: The French keyword sequence from the taxonomy
   - \`keywordsSequenceNl\`: The Dutch keyword sequence from the taxonomy

4. Quality control:
   - Typically 2-8 legal issues per decision
   - Must all be actually addressed in the decision
   - Include both primary and secondary legal issues
   - Prefer more specific classifications when available

## Matching Guidelines:
- **Over-classification is better than under-classification**: If uncertain, include the legal issue
- **Include procedural issues if significant**: e.g., competence, admissibility, burden of proof
- **Consider the dispositif**: What did the court actually decide?
- **Check party arguments**: What legal theories were advanced?

# OUTPUT REQUIREMENTS
Return a JSON object:
{
  "index": {
    "customKeywords": ["array of 8-15 keywords in procedural language"],
    "legalIssues": [
      {
        "id": "[taxonomy id]",
        "keywordsSequenceFr": "[French sequence from taxonomy]",
        "keywordsSequenceNl": "[Dutch sequence from taxonomy]"
      }
    ]
  },
  "metadata": {
    "keywordCount": [integer],
    "legalIssueCount": [integer],
    "primaryLegalField": "[main area of law]",
    "indexingConfidence": "HIGH|MEDIUM|LOW"
  }
}

# QUALITY CRITERIA
- Keywords must be specific, relevant, and comprehensive
- All keywords must be in the procedural language
- Legal issues must be accurately matched to taxonomy
- All significant legal issues in the decision must be represented
- No irrelevant or tangential classifications`;
