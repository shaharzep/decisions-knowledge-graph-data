export const PASS_1_CODE_FAMILY_PROMPT = `
You are a legal expert assisting in mapping cited provisions to their correct Code family.

# Goal
Identify the top 3 most likely "Code" families for the cited provision based on the cited name.

# Input
- Cited Name: "{citedActName}"
- Available Codes:
{availableCodesList}

# Instructions
1. Analyze the "Cited Name" and match it to the "Available Codes".
2. Return the top 3 most likely matches.
3. If the cited name is ambiguous (e.g., "Code civil"), include the most relevant specific codes (e.g., "Code civil", "Code judiciaire", etc.) if they are plausible.
4. If there are fewer than 3 plausible matches, return only the plausible ones.

# Output Schema
Return a JSON object with a "matches" array:
{
  "matches": [
    "Code Name 1",
    "Code Name 2",
    "Code Name 3"
  ]
}
`;

export const PASS_2_EXACT_MATCH_PROMPT = `
You are a legal expert assisting in mapping a cited provision to the exact legal document and article.

# Goal
Identify the exact document (law/act) that contains the cited article from the provided candidates.

# Input
- Cited Article Number: "{citedArticle}"
- Cited Act Name (from text): "{citedActName}"
- Context (Legal Teachings):
{context}

# Candidates
{candidatesList}

# Instructions
1. **Analyze Candidates**: Review the list of candidate documents. Each candidate includes:
    - Document Number (ID)
    - Title
    - **Article Content** (The text of the article in that document, if available)

2. **Match Strategy**:
    - **Primary Check (Article Content)**: If "Article Content" is provided, check if it matches the subject matter implied by the "Context" and "Cited Act Name". This is the strongest signal for disambiguation (e.g., distinguishing between different "Code civil" sub-documents).
    - **Secondary Check (Title)**: Does the document title align with the "Cited Act Name"?
    - **Context Validation**: Does the selected document and article make sense given the "Legal Teachings"?

3. **Ambiguity Handling**:
    - If multiple documents have the same article number, use the **Article Content** and **Context** to decide.
    - If the article content is missing for a candidate, rely on the Title and Context.

4. **Selection**:
    - **MANDATORY**: You MUST select the ONE best matching document from the candidates.
    - Do NOT return null. Always return a match.
    - If the match is weak or uncertain, select the most plausible candidate and assign a **low score** (e.g., < 50).
    - Use the score to reflect your confidence, but always provide a selection.

# Output Schema
Return a JSON object:
{
  "match": {
    "document_number": "string (the ID of the selected candidate)",
    "score": number (0-100 confidence score),
    "reasoning": "string (explanation of why this document was selected, citing title, article content match, and context)"
  }
}
`;
