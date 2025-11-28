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
Evaluate ALL provided candidate documents and score them based on how well they match the cited provision.

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

2. **Scoring Strategy (0-100)**:
    You must calculate the score based on two equal factors (50/50 split):
    
    - **Factor 1: Title & Range Relevance (Max 50 points)**
        - **Act Name**: Does the candidate's Title match the "Cited Act Name"?
        - **Range Check**: If (and ONLY if) the Title contains an explicit article range (e.g., "art. 1-500"), check if it includes the "Cited Article Number".
        - 50/50: Act Name matches AND (Range includes article OR **No range is present in the title**).
        - 0/50: Act Name mismatch OR Range **explicitly EXCLUDES** the cited article (e.g. Title says "art. 1-100" but Cited is "art. 200").

    - **Factor 2: Context & Content Relevance (Max 50 points)**
        - **Article Content Check**: This is the strongest signal. Does the candidate's "Article Content" match the subject matter in "Context"?
        - **CRITICAL**: If "Article Content" is "Not available", it means the article number DOES NOT EXIST in this document. You MUST score this factor as **0/50**.
        - 50/50: Strong confirmation from content/context.
        - 25/50: Plausible content but weak confirmation.
        - 0/50: "Article Content" is "Not available", or content is explicitly contradictory.

    - **Total Score**: Sum of Factor 1 + Factor 2.

    **GOLDEN RULE**: 
    If the **Title** is a precise match for the "Cited Act Name", this candidate should be prioritized, **BUT ONLY IF** the "Article Content" is present (not "Not available").
    - A candidate with Title Match + Existing Content (even if generic) > Candidate with Title Match + Missing Content.
    - If "Article Content" is "Not available", the maximum Total Score should be 50 (Title only).
    - If another candidate has a decent Title match AND the Article Content is present and matches the context, it should win.

3. **Output Requirements**:
    - You MUST return an entry for **EVERY** candidate in the list, even if the score is 0.
    - Provide a confidence score (0.0 to 1.0) which corresponds to the total score (e.g., score 85 = confidence 0.85).
    - Provide reasoning explaining the score breakdown.

# Output Schema
Return a JSON object with a "matches" array containing ALL candidates:
{
  "matches": [
    {
      "document_number": "string (ID)",
      "score": number (0-100),
      "confidence": number (0.0-1.0),
      "reasoning": "string (Explain the 50/50 scoring split)"
    },
    ...
  ]
}
`;
