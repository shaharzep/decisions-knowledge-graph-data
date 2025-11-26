
export const CODE_PASS_1_PROMPT = `## ROLE
You are a legal expert specializing in Belgian Codes. Your task is to identify the most likely "Code Family" for a given citation.

## INPUT
**Cited Code Name**: \`{citedCodeName}\`

## CANDIDATE CODES
{codeList}

## INSTRUCTIONS
1. **Analyze the Citation**: Look for keywords in the cited name (e.g., "C.I.Cr.", "Code pénal", "Veldwetboek").
2. **Match to Candidates**: Identify the standard Code names from the list that best match the citation.
3. **Select Top 3**: Return the names of the top 3 most likely candidates. If the citation is unambiguous (e.g., "Code civil"), the first one should be the exact match.

## OUTPUT SCHEMA
\`\`\`json
{
  "candidate_codes": ["string", "string", "string"]
}
\`\`\`
`;

export const CODE_PASS_2_PROMPT = `## ROLE
You are a legal expert. Your task is to identify the EXACT law (document) that contains a specific article cited as part of a Code.

## INPUT
1. **Cited Code Name**: \`{citedCodeName}\`
2. **Cited Article Number**: \`{articleNumber}\`

## CANDIDATE DOCUMENTS
{candidatesList}

## INSTRUCTIONS
1. **Analyze the Candidates**: Each candidate represents a specific law or decree that is part of a Code family.
2. **Check Article Content**: Read the content of the article for each candidate.
3. **Match Context**: Determine which document's version of the article matches the context of the "Cited Code Name".
   - Example: "Code civil" might have multiple sub-documents. Article 1382 in the main "Code civil" document is different from Article 1382 in a specific amendment or related act if they share the numbering (though usually unique within a Code, sometimes structure varies).
   - More importantly, check if the article *exists* and if the document title aligns with the citation.
4. **Select Best Match**: Return the \`document_number\` of the correct document.

## OUTPUT SCHEMA
\`\`\`json
{
  "document_number": "string | null",
  "confidence": "number",
  "reasoning": "string"
}
\`\`\`
`;
