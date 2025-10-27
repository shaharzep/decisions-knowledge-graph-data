#!/usr/bin/env python3
"""
Simple Provision Snippet Extractor for Belgian Legal Decisions
Extracts 250-character windows around provision keywords.

Called from Node.js preprocessing pipeline via stdin/stdout.
Input: JSON with {decision_id, markdown_text, language}
Output: JSON with {decisionId, language, text_rows: [...]}
"""

import re
import json
import sys


# Keywords to search for (bilingual FR/NL)
KEYWORDS = [
    "article", "articles", "artikel", "artikels",
    "artikelen", r"art\.", r"artt\.", r"arts\."
]

# Compile regex pattern
PATTERN = re.compile(
    r'\b(?:' + '|'.join(KEYWORDS) + r')\b',
    re.IGNORECASE
)

# Context window size (chars on each side)
CONTEXT_WINDOW_SIZE = 250


def extract_snippets(text):
    """
    Finds all provision keywords in text and extracts clean context snippets.

    Returns list of unique snippets with 250-char windows around each keyword.
    Cleans boundaries to avoid cut-off words.
    """
    snippets = []

    # Find all keyword occurrences
    for match in PATTERN.finditer(text):
        match_start = match.start()
        match_end = match.end()

        # Calculate raw window
        raw_start = max(0, match_start - CONTEXT_WINDOW_SIZE)
        raw_end = min(len(text), match_end + CONTEXT_WINDOW_SIZE)

        # Clean boundaries to avoid cut-off words
        # Find last space before raw_start
        clean_start = text.rfind(' ', 0, raw_start) + 1
        if clean_start == 0 and raw_start > 0:
            clean_start = raw_start  # No space found, use raw

        # Find first space after raw_end
        clean_end = text.find(' ', raw_end)
        if clean_end == -1:
            clean_end = len(text)

        # Extract snippet
        snippet = text[clean_start:clean_end]

        # Normalize whitespace (collapse multiple spaces/newlines)
        snippet = re.sub(r'\s+', ' ', snippet).strip()

        if snippet:  # Only add non-empty snippets
            snippets.append(snippet)

    # Deduplicate (same snippet may appear multiple times)
    return list(set(snippets))


def main():
    """Main entry point for stdin/stdout processing."""
    try:
        # Read JSON input from stdin
        input_data = json.load(sys.stdin)

        decision_id = input_data.get('decision_id', '')
        markdown_text = input_data.get('markdown_text', '')
        language = input_data.get('language', 'FR')

        if not markdown_text:
            # Return empty result for empty input
            result = {
                "decisionId": decision_id,
                "language": language,
                "text_rows": []
            }
        else:
            # Extract provision snippets
            snippets = extract_snippets(markdown_text)

            result = {
                "decisionId": decision_id,
                "language": language,
                "text_rows": snippets
            }

        # Write JSON output to stdout
        json.dump(result, sys.stdout, ensure_ascii=False)
        sys.stdout.flush()

    except Exception as e:
        # Write error to stderr
        error_msg = {
            "error": str(e),
            "type": type(e).__name__
        }
        json.dump(error_msg, sys.stderr, ensure_ascii=False)
        sys.stderr.flush()
        sys.exit(1)


if __name__ == "__main__":
    main()
