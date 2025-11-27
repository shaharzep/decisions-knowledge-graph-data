

export const NO_DATE_MATCH_PROMPT = `## ROLE
You are a legal expert specializing in Belgian law. Your task is to identify the correct "Parent Act" (Law, Decree, Ordinance, Royal Decree) for a given legal citation that is missing a date.

## INPUT
1. **Cited Act Name**: \`{citedActName}\`
   - The name of the act as cited in a court decision.
2. **Cited Provision**: \`{citedProvision}\`
   - The specific article or provision being cited.
3. **Context (Legal Teachings)**:
   \`\`\`
   {context}
   \`\`\`
   - Excerpts from decisions discussing this act. Use these to understand the subject matter.
4. **Candidate Laws**:
   - A list of potential matches found in the database based on type and title similarity.
   - Format: \`[Document Number] (Date) Title\`

## CANDIDATES
{candidatesList}

## INSTRUCTIONS
1. **Analyze the Cited Act Name**: Identify the type of act (Loi, Arrêté, etc.) and the core title.
2. **Analyze the Context**: Look for clues about the subject matter (e.g., "taxation", "employment", "criminal procedure").
3. **Evaluate Candidates**:
   - **Primary Check**: Look for exact or close matches between the Cited Act Name and Candidate Title.
   - **Validation**: Use the Context (Legal Teachings) to confirm the match.
     - Does the subject matter in the context align with the candidate title?
     - If the title matches but the context discusses a completely different topic, be skeptical.
   - **Date Check**: Ensure the candidate law predates the decision (this is pre-filtered, but good to keep in mind).
4. **Select the Best Match**:
   - **MANDATORY**: You MUST select the ONE best matching document from the candidates.
   - Do NOT return null. Always return a match.
   - If the match is weak or uncertain, select the most plausible candidate and assign a **low score** (e.g., < 50).
   - Use the score to reflect your confidence.

## OUTPUT SCHEMA
\`\`\`json
{
  "match": {
    "document_number": "string (the ID of the selected candidate)",
    "score": number (0-100 confidence score),
    "reasoning": "string (explanation of why this document was selected, citing title match and context alignment)"
  }
}
\`\`\`
`;

export const BATCH_SELECTION_PROMPT = `## ROLE
You are a legal expert specializing in Belgian law. Your task is to filter a list of candidate laws to find potential matches for a cited act.

## INPUT
1. **Cited Act Name**: \`{citedActName}\`
2. **Cited Provision**: \`{citedProvision}\`
3. **Context**:
   \`\`\`
   {context}
   \`\`\`
4. **Candidates Batch**:
   {candidatesList}

## INSTRUCTIONS
1. **Analyze**: Compare the Cited Act Name with the candidate titles. Use the Context to verify subject matter alignment.
2. **Filter**: Select up to 5 candidates that are POTENTIAL matches.
   - If a candidate is clearly irrelevant, ignore it.
   - If a candidate is a plausible match (even if not perfect), include it.
   - Be generous in this phase: we want to keep all potential candidates for the final round.

## OUTPUT SCHEMA
\`\`\`json
{
  "matches": [
    {
      "document_number": "string",
      "reasoning": "string (brief reason for selection)"
    }
  ]
}
\`\`\`
`;

export const FINAL_RANKING_PROMPT = `## ROLE
You are a legal expert specializing in Belgian law. Your task is to identify the correct "Parent Act" from a shortlist of candidates.

## INPUT
1. **Cited Act Name**: \`{citedActName}\`
2. **Cited Provision**: \`{citedProvision}\`
3. **Context**:
   \`\`\`
   {context}
   \`\`\`
4. **Shortlisted Candidates**:
   {candidatesList}

## INSTRUCTIONS
1. **Analyze**: Compare the Cited Act Name with the candidate titles. Use the Context to verify subject matter alignment.
2. **Rank**: Evaluate each candidate's relevance.
3. **Score**: Assign a confidence score (0-100) to each match.
   - **90-100**: Exact match (Title + Subject Matter).
   - **80-89**: Strong match (Title matches, subject matter plausible).
   - **< 80**: Weak match or different subject matter.
4. **Select**: Return the top matches (up to 3).

## OUTPUT SCHEMA
\`\`\`json
{
  "matches": [
    {
      "document_number": "string",
      "score": number,
      "reasoning": "string"
    }
  ]
}
\`\`\`
`;

