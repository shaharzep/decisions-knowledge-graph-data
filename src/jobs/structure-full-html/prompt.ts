/**
 * Structure Full HTML Prompt
 *
 * Prompt builder for converting markdown to structured HTML
 * Preserves exact prompt logic from original implementation
 */

import { DecisionMetadata } from './types.js';
import { buildFrontmatter, mapDecisionType } from './helpers.js';

/**
 * Build structured HTML generation prompt
 *
 * This is the exact prompt from the original implementation,
 * only modified to return JSON instead of raw HTML.
 *
 * @param frontmatter YAML frontmatter block
 * @param text Decision full text
 * @returns Complete prompt for LLM
 */
function buildStructuredPrompt(frontmatter: string, text: string): string {
  return `# ROLE
You are an expert legal document formatter specializing in Belgian case law documents.

# TASK
Convert the provided Belgian case law document with metadata into a structured HTML fragment.

# EXECUTION PARAMETERS
- Temperature: 0
- Top_p: 1
- Output format: Raw HTML only (no markdown, no code blocks)

# CRITICAL REQUIREMENTS

## 1. TEXTUAL INTEGRITY (CRITICAL - DO NOT VIOLATE)
- **Absolute fidelity**: Every single word, number, and punctuation mark from the original text MUST be preserved
- **No omissions**: Do not skip ANY content, even if it seems redundant or repetitive
- **No modifications**: Do not add, omit, or alter ANY words
- **No summarization**: Do not condense, shorten, or summarize ANY section
- **Source of truth**: The decision_text after frontmatter is authoritative

**Specifically preserve:**
- ALL numbered paragraph headings (e.g., ## 291, ## 292, ## 293...) - these are NOT errors, they are paragraph numbers
- ALL footnotes and footnote references (e.g., [1], [2], footnote content at bottom)
- ALL repeated or similar-looking sections (e.g., lists of provisions, case citations)
- ALL tables, lists, and structured data
- ALL LaTeX notation (convert to HTML, but preserve the content)

**If the source text is very long (50,000+ characters):**
- You MUST still convert ALL of it - do not truncate
- Break into multiple sections if needed, but preserve everything
- Priority: Completeness over brevity

## 2. OUTPUT FORMAT
- Return ONLY a single top-level <div class="case-document">
- Do NOT include: <!DOCTYPE html>, <html>, <head>, <body>, or <style> tags
- Do NOT wrap in markdown code blocks (\`\`\`html)
- Output raw HTML fragment only

## 3. STYLING RULES
- NO inline styles (style="...")
- Use ONLY the CSS classes specified below
- Unmapped content defaults to <p class="case-section__paragraph">

# HTML STRUCTURE SPECIFICATION

## HEADER GENERATION (Priority Task)

### Step 1: Parse Metadata
Extract from frontmatter block (---) and use these EXACT values:
- court_name → <h1 class="case-header__court"> (use the EXACT court_name from frontmatter, do NOT leave empty)
- decision_type + role_number → <p class="case-header__decision-info">
- date → <p class="case-header__date">

**CRITICAL:** The header MUST contain the court name from metadata. Do NOT generate an empty <h1> tag.

### Step 2: Decision Info Formatting (for header only)
When combining decision_type and role_number in the header:
- If both exist: Format as "{decision_type} n° {role_number}" (French) or "{decision_type} nr. {role_number}" (Dutch)
- If only decision_type exists: Use decision_type alone
- If only role_number exists: Format as "n° {role_number}" (French) or "nr. {role_number}" (Dutch)
- This formatting applies ONLY to the header section, NOT to numbers elsewhere in the document

### Step 3: Date Formatting Rules
Format date based on language field (NO leading zeros for day):

**French (fr)**: YYYY-MM-DD → "du D mois YYYY" (e.g., 2023-02-09 → "du 9 février 2023", NOT "du 09 février 2023")
- Months: janvier, février, mars, avril, mai, juin, juillet, août, septembre, octobre, novembre, décembre

**Dutch (nl)**: YYYY-MM-DD → "van D maand YYYY" (e.g., 2009-07-07 → "van 7 juli 2009", NOT "van 07 juli 2009")
- Months: januari, februari, maart, april, mei, juni, juli, augustus, september, oktober, november, december

### Step 4: Deduplication (CRITICAL)
**Before converting the body text, check if the decision text already contains header information:**

Scan the beginning of the decision text (first 500 characters) for:
- Court name that matches the metadata court_name
- Decision type and/or rol number that matches the metadata
- Date that matches the metadata date

**If found:**
1. Identify the exact text span containing the duplicate header information
2. Remove that text span entirely from the body
3. Only generate the <header> section from metadata
4. Start the body conversion from the text AFTER the duplicate header

**Example:**
- Metadata: court_name="Cour de cassation", decision_type="Arrêt", rol_number="C.22.0264.F", date="2023-02-09"
- Decision text starts with: "Cour de cassation\nArrêt\nC.22.0264.F\n9 février 2023\n\nEn cause de:..."
- **Action:** Remove the first 4 lines, generate header from metadata, start body at "En cause de:"

**If NOT found:**
- Generate header from metadata as normal
- Convert entire decision text to body sections

This ensures no duplicate information appears in both header and body.

## CSS CLASS MAPPING

### Container
- Main wrapper: <div class="case-document">

### Header Section
- Container: <header class="case-header">
- Court name: <h1 class="case-header__court">
- Decision info: <p class="case-header__decision-info">
- Date: <p class="case-header__date">

### Parties Section
- Container: <section class="case-parties">
- Party info: <p class="case-parties__party">
- Labels (TEGEN/CONTRE): <strong class="case-parties__label">

### Body Section
- Container: <section class="case-section">
- Main headings: <h2 class="case-section__title">
- Roman numeral headings: <h2 class="case-section__title case-section__title--centered">
- **Numbered paragraph headings**: <h3 class="case-section__subtitle"> (e.g., "291", "292" - preserve the number)
- Subheadings: <h3 class="case-section__subtitle">
- Paragraphs: <p class="case-section__paragraph">
- Quoted text: <blockquote class="case-quote">
- Tables: <table class="case-table">
- **Footnote references**: <sup><a href="#fn1">[1]</a></sup> (preserve brackets and numbers)
- **Footnotes section**: <section class="case-section case-section--footnotes"> with each footnote as <p id="fn1" class="case-section__paragraph">

### Lists
- Dash-led (-) → <ul> with <li>
- Letter/number (a), 1.) → <ol> with <li>

### Footer Section
- Container: <footer class="case-footer">
- Trigger phrase: <h3 class="case-footer__title">
- Content: <p class="case-footer__paragraph">

## SPECIAL INSTRUCTIONS
- Remove decorative separators (e.g., ***)
- Preserve existing table structures
- Identify footer by trigger phrases (e.g., "PAR CES MOTIFS", "OP DIE GRONDEN", "OM DEZE REDENEN")
- The "n°" formatting applies ONLY to the role_number in the header section
- All other numbers in the document body remain exactly as they appear in the source text

## FOOTNOTES HANDLING (CRITICAL)
If the decision text contains footnotes:

**Footnote references in text:**
- Format: [1], [2], [3], etc. or superscript numbers
- Convert to: <sup><a href="#fn1">[1]</a></sup>
- Preserve the exact reference format from source

**Footnote content:**
- Usually appears at end of document or end of sections
- Common markers: "---", horizontal lines, or just numbered list at bottom
- Wrap all footnotes in: <section class="case-section case-section--footnotes">
- Each footnote: <p id="fn1" class="case-section__paragraph">[1] Footnote text here</p>

**CRITICAL:** Do NOT omit footnotes. They are essential legal citations and must be preserved.

## NUMBERED PARAGRAPH HEADINGS (CRITICAL)
Legal decisions often have numbered paragraphs (e.g., ## 1, ## 2, ## 3... up to ## 500+):
- These are paragraph numbers, NOT errors or duplicates
- Convert each to: <h3 class="case-section__subtitle">1</h3> (preserve the number)
- Do NOT skip any numbers, even if there are hundreds
- Do NOT interpret as markdown errors

## LATEX CONVERSION
The source text may contain LaTeX notation marked with dollar signs (e.g., \\$n^{\\\\circ}\\$, \\$text^{1}\\$).

**Convert LaTeX to HTML:**
- \\$n^{\\\\circ}\\$ → n°
- \\$text^{number}\\$ → text<sup>number</sup>
- \\$text\\$ → text (remove dollar signs)

Do NOT leave dollar signs or LaTeX syntax in the HTML output.

# INPUT DATA

${frontmatter}

DECISION TEXT:
${text}

# OUTPUT INSTRUCTION
Return ONLY valid JSON in this exact format:
{
  "html": "<div class=\"case-document\">...</div>"
}

The html field must contain the complete HTML fragment as a string. No explanations, no markdown code blocks, just the JSON object.

# FINAL CHECKLIST BEFORE RETURNING
Before you return your response, verify:
1. ✅ Did you convert ALL text from the decision (no omissions, no summarization)?
2. ✅ Did you include ALL numbered paragraph headings and footnotes?
3. ✅ Did you convert ALL LaTeX (NO dollar signs in output)?
4. ✅ Did you use only CSS classes (no inline styles)?
5. ✅ Did you generate the header from metadata and remove duplicates from body?
6. ✅ Date format: "du 9 février" NOT "du 09 février" (no leading zeros on day)?

If any answer is NO, go back and fix it before returning. Completeness is more important than speed.`;
}

/**
 * Build complete prompt for HTML structuring
 *
 * Orchestrates metadata extraction and prompt construction
 *
 * @param row Database row with decision data
 * @returns Complete prompt string
 */
export function buildPrompt(row: any): string {
  // Prepare metadata
  const metadata: DecisionMetadata = {
    court_name: row.court_name || '',
    decision_type: row.decision_type_ecli_code
      ? mapDecisionType(row.decision_type_ecli_code, row.language_metadata)
      : '',
    rol_number: row.rol_number || '',
    date: row.decision_date
      ? new Date(row.decision_date).toISOString().split('T')[0]
      : '',
    language: (row.language_metadata?.toLowerCase() === 'fr' ? 'fr' : 'nl') as 'fr' | 'nl'
  };

  // Build frontmatter
  const frontmatter = buildFrontmatter(metadata);

  // Build complete prompt
  const prompt = buildStructuredPrompt(frontmatter, row.full_md || '');

  return prompt;
}
