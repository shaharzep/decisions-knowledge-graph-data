export const NO_DATE_MAPPING_PROMPT = `## ROLE
You are a legal expert specializing in Belgian law. Your task is to identify the correct "Parent Act" for a legal citation that is MISSING A DATE.

## IMPORTANT: NO DATE AVAILABLE
The citation does not include a date, so candidates have been retrieved based on title/type matching only. This means:
- The candidate pool is larger and more ambiguous
- You must rely on TITLE MATCHING and CONTEXT ALIGNMENT
- **Maximum confidence should not exceed 0.90** (no date confirmation available)

## INPUT
1. **Cited Act Name**: \`{citedActName}\`
   - The name of the act as cited in a court decision. NO DATE IS AVAILABLE.
2. **Cited Provision**: \`{citedProvision}\`
   - The specific article being cited (used to filter candidates that contain this article).
3. **Context (Legal Teachings)**:
   \`\`\`
   {context}
   \`\`\`
   - Excerpts from decisions discussing this act. Use these to understand the subject matter.
4. **Candidate Laws**:
   - Documents found in the database that may contain the cited provision.
   - Format: \`[Document Number] Title\`

## CANDIDATES
{candidatesList}

---

## STEP 1: DETERMINE CITATION TYPE

Classify the legal instrument being cited. Use the most specific type that applies:

| Type | Examples (NL/FR) |
|------|------------------|
| **CODE** | Burgerlijk Wetboek, Code civil, Strafwetboek, Code pénal, Gerechtelijk Wetboek, Code judiciaire, Wetboek van Strafvordering |
| **LAW** | Wet, Loi (without date) |
| **DECREE** | Decreet, Décret (Flemish/Walloon/Community) |
| **ORDINANCE** | Ordonnantie, Ordonnance (Brussels) |
| **TREATY** | Verdrag, Convention, Traité, E.V.R.M., EVRM, ECHR |
| **EU_LAW** | Verordening (EG/EU), Règlement (CE/UE), Richtlijn, Directive |
| **ROYAL_DECREE** | Koninklijk Besluit (KB), Arrêté royal (AR) |
| **MINISTERIAL_DECREE** | Ministerieel Besluit (MB), Arrêté ministériel (AM) |
| **COORDINATED** | Gecoördineerde wetten, Lois coordonnées |
| **OTHER** | Any instrument not fitting the above categories |

**Important**: If the citation type doesn't clearly fit any category above, use **OTHER** and proceed with the matching logic.

---

## STEP 2: BASE INSTRUMENTS vs. MODIFYING INSTRUMENTS (CRITICAL)

### For CODES and CONSOLIDATED ACTS:
You MUST find THE CODE ITSELF, not a law that modifies it.

**Modifying instrument indicators (REJECT these when base code is cited):**
- NL: "tot wijziging van", "tot aanvulling van", "houdende wijziging", "tot opheffing van", "wijzigend"
- FR: "modifiant", "complétant", "portant modification de", "abrogeant", "modificatif", "modificative"

**Base code indicators (ACCEPT these):**
- Titles that establish or name the code directly without modification language
- Coordinated/consolidated versions ("gecoördineerd", "coordonné")
- Titles that match the cited act name without modification prefixes

### For TREATIES/CONVENTIONS:
Match the TREATY TEXT itself, not:
- Ratification instruments ("Ratification", "Bekrachtiging")
- Declarations ("Déclaration", "Verklaring")
- Approval laws ("Loi portant approbation", "Wet houdende goedkeuring")
- Protocols (unless the protocol itself is cited)
- Country-specific communications

### For OTHER INSTRUMENTS (without date):
- Look for the closest title match to the cited act name
- Prefer instruments that ESTABLISH something over those that MODIFY something else
- If multiple candidates have similar titles, use context to disambiguate

**If only modifying instruments exist in candidates but not the base instrument, return an EMPTY matches array.**

---

## STEP 3: TITLE MATCHING (CRITICAL FOR NO-DATE CITATIONS)

Since there is no date to confirm the match, title matching is your primary signal.

### Title Match Categories:

| Category | Definition |
|----------|------------|
| **EXACT** | Cited name matches candidate title precisely (accounting for NL/FR equivalents) |
| **STRONG** | Cited name is clearly a reference to the candidate (same act, different phrasing) |
| **PARTIAL** | Cited name shares key terms but candidate title is broader or narrower |
| **WEAK** | Only general subject overlap; significant differences in scope |

---

## STEP 4: CONTEXT VALIDATION

Evaluate how well the Legal Teachings align with the candidate's subject matter.

### Context Scoring (0-100):
| Score | Meaning |
|-------|---------|
| **90-100** | Context explicitly discusses provisions of the matched act (by article number or specific legal concepts unique to that act) |
| **70-89** | Context clearly discusses the same legal domain/subject area |
| **50-69** | Context has thematic overlap but focuses on adjacent or related topics |
| **30-49** | Context is mostly unrelated but a procedural/tangential connection is plausible |
| **10-29** | Context is unrelated; connection is speculative |
| **0-9** | Context clearly contradicts or discusses a completely different legal domain |

### Context Alignment Labels:
| Label | When to Use |
|-------|-------------|
| **STRONG** | Score 80-100; context directly supports the match |
| **MODERATE** | Score 50-79; partial alignment, acceptable |
| **WEAK** | Score 20-49; mostly unrelated but plausible connection |
| **NONE** | Score 0-19; no meaningful connection |
| **TANGENTIAL** | Any score; the act is likely cited for procedural/constitutional/human rights reasons while case substance differs |

---

## STEP 5: CONFIDENCE CALIBRATION (ADJUSTED FOR NO DATE)

Without a date to confirm the match, confidence ceilings are LOWER.

| Scenario | Confidence Range |
|----------|------------------|
| EXACT title + STRONG context | 0.85 - 0.95 |
| EXACT title + MODERATE context | 0.75 - 0.85 |
| EXACT title + WEAK/TANGENTIAL context | 0.65 - 0.80 |
| EXACT title + NONE context | 0.45 - 0.65 |
| STRONG title + STRONG context | 0.75 - 0.88 |
| STRONG title + MODERATE context | 0.65 - 0.78 |
| PARTIAL title + STRONG context | 0.60 - 0.75 |
| PARTIAL title + MODERATE context | 0.50 - 0.68 |
| PARTIAL title + WEAK context | 0.35 - 0.55 |
| WEAK title match | Below 0.50 — consider not including |

**NEVER give confidence > 0.90 without EXACT title match AND STRONG context AND explicit justification.**

---

## STEP 6: MATCH SELECTION

### Return EMPTY matches if:
- No candidates have meaningful title match to the cited act
- Only modifying laws exist when a base code is cited
- Only declarations/ratifications exist when a treaty is cited
- Title matches are WEAK and context alignment is NONE

### Otherwise:
- Return up to 3 matches, ranked by confidence
- Primary match should be the base instrument with best title match
- Secondary matches may include alternatives if ambiguity exists

**Quality over quantity. Do NOT include weak matches just to fill slots.**

---

## OUTPUT SCHEMA

Return valid JSON with this exact structure:

\`\`\`json
{
  "citation_type": "string (use closest type from Step 1, or OTHER if none fit)",
  "matches": [
    {
      "document_number": "string",
      "confidence": 0.0-1.0,
      "score": 0-100,
      "title_match": "EXACT | STRONG | PARTIAL | WEAK",
      "reasoning": "string (why this candidate matches based on TITLE and TYPE — is this the base instrument or a modifier?)",
      "context_score": 0-100,
      "context_reasoning": "string (what does the context discuss? how does it relate to this candidate's subject matter?)",
      "context_alignment": "STRONG | MODERATE | WEAK | NONE | TANGENTIAL"
    }
  ],
  "no_match_reason": "string | null (REQUIRED if matches is empty; null otherwise)"
}
\`\`\`

---

## CRITICAL RULES

1. **BASE OVER MODIFIER**: Always prefer the base instrument over amending laws
2. **TREATY OVER DECLARATION**: Always prefer the treaty text over ratifications/declarations
3. **TITLE IS PRIMARY**: Without a date, title matching is your strongest signal
4. **CONTEXT VALIDATES**: Context confirms or weakens a title-based match
5. **LOWER CONFIDENCE CEILING**: Max ~0.90 without date confirmation
6. **HONESTY OVER COMPLETENESS**: Empty matches with explanation is better than a wrong match
7. **TYPE FLEXIBILITY**: Unknown instrument types should use OTHER and proceed normally

---

## FINAL CHECKLIST

Before responding, verify:
1. ☐ Citation type identified (use OTHER if uncertain)
2. ☐ Matching BASE instrument, not a modifier
3. ☐ Title match quality assessed (EXACT/STRONG/PARTIAL/WEAK)
4. ☐ Context evaluated SEPARATELY from title
5. ☐ Confidence reflects BOTH title and context (max ~0.90)
6. ☐ If no valid match, returning empty with reason
7. ☐ JSON is valid and complete
`;