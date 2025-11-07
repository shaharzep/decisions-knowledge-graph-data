export const CLEAN_MARKDOWN_PROMPT = `# Task: Clean LaTeX Formatting from Markdown

You are cleaning decision markdown for downstream HTML structuring.

## Inputs
- Decision ID: {decisionId}
- Procedural Language: {proceduralLanguage}
- Full Markdown:
- Full Markdown:
\`\`\`
{fullText.markdown}
\`\`\`

## Instructions
Convert all LaTeX-style formatting to standard markdown. Return ONLY the cleaned markdown with no explanations.

### Required conversions:
1. **Footnotes**: Replace all \`[^0]:\` with sequential numbering \`[^1]:\`, \`[^2]:\`, \`[^3]:\`, etc.
2. **Superscripts**: Remove all superscript numbers (¹, ², ³, ⁴, ⁵, ⁶, ⁷, ⁸, ⁹, ⁰, ¹⁰, ¹¹, etc.) from footnote definitions.
3. **LaTeX commands**: Remove or convert any LaTeX commands (e.g., \`\\textbf{}\`, \`\\emph{}\`, \`\\cite{}\`, etc.) to markdown equivalents.
4. **Math notation**: Convert LaTeX math (\`$...$\`, \`$$...$$\`) to plain text where possible.
5. **Special characters**: Ensure proper encoding of accented characters (é, è, à, ç, ö, ü, etc.).

### Rules:
- Preserve all document structure (headers, lists, paragraphs, quotes).
- Maintain all content exactly as written.
- Keep all URLs intact.
- Number footnotes sequentially from 1 throughout the entire document.
- Return valid, clean markdown only.

Respond with the cleaned markdown now.`;
