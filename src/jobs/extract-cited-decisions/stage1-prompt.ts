export const STAGE_1_AGENTIC_SNIPPETS_PROMPT = `## TASK
Extract ALL citations to judicial and quasi-judicial decisions from Belgian, EU, and International bodies. For each citation found, create an enriched snippet containing the citation plus surrounding context.

**Critical**: 100% recall is mandatory. Missing a citation is a failure. Over-extraction is acceptable.

---

## INPUT

1. **decisionId**: {decisionId} — for reference only
2. **proceduralLanguage**: {proceduralLanguage} — FR or NL
3. **fullText.markdown**: The complete decision text

{fullText.markdown}

---

## SCOPE: Which Bodies to Extract From

### Belgian (Jurisdiction: BE)
**Courts:**
- Grondwettelijk Hof, Cour constitutionnelle
- Hof van Cassatie, Cour de cassation
- Raad van State, Conseil d'État
- Hof van beroep, Cour d'appel
- Arbeidshof, Cour du travail
- Hof van assisen, Cour d'assises
- Rechtbank, Tribunal
- Vredegerecht, Justice de paix
- Raadkamer, Chambre du conseil
- Kamer van inbeschuldigingstelling, Chambre des mises en accusation

**Administrative Bodies (with quasi-judicial functions):**
- Commissie voor de bescherming van de persoonlijke levenssfeer, Commission pour la protection de la vie privée
- Gegevensbeschermingsautoriteit, Autorité de protection des données
- Nationale tuchtraad, Conseil national de discipline
- Commissie tot vergoeding voor onwerkzame voorlopige hechtenis, Commission d'indemnisation de la détention préventive inopérante
- Commissie voor financiële hulp aan slachtoffers van opzettelijke gewelddaden, Commission pour l'aide financière aux victimes d'actes intentionnels de violence

### European Union (Jurisdiction: EU)
- Hof van Justitie van de EU, Cour de Justice de l'UE, CJUE
- Gerecht van de EU, Tribunal de l'UE
- Europese Commissie, Commission européenne (decisions only, not regulations)
- Europees Octrooibureau, Office européen des brevets

### International (Jurisdiction: INT)
- Europees Hof voor de Rechten van de Mens, Cour européenne des droits de l'homme, ECtHR, EHRM
- Internationaal Gerechtshof, Cour internationale de justice
- Internationaal Strafhof, Cour pénale internationale
- Benelux-Gerechtshof, Cour de justice Benelux
- VN-Mensenrechtencomité, Comité des droits de l'homme de l'O.N.U.

---

## WHAT TO EXTRACT: The Core Distinction

**Extract: Citations to precedent decisions from other cases**
- Court/body references another case/decision for legal reasoning
- Used to support, distinguish, or reject a legal principle
- Has identifying information (date, case number, decision number, ECLI)

**Do NOT extract:**
1. **Legal provisions**: Laws, regulations, decrees, royal decrees, directives (e.g., "article 31 de la loi du 15 juin 1935", "Verordening (EU) 1099/2009")
2. **Procedural history of current case**: Events in THIS case's timeline (e.g., "werd aangehouden door", "a été libéré par arrêt de")
3. **Bare references**: Body name without identifier (e.g., "volgens het Hof van Cassatie" with no date/case number)
4. **Foreign national courts**: Courts from other countries (French, German, US, etc.)
5. **Administrative documents without decision numbers**: Reports, correspondence, guidance (for administrative bodies, only extract numbered decisions)

**The test**: If you removed the citation, would the legal reasoning lose a precedent reference? If yes → extract. If it's just describing what happened in this case or citing a law → don't extract.

---

## REQUIRED ELEMENTS FOR VALID CITATION

A valid citation must have:
1. ✅ Body name from the scope list above
2. ✅ At least ONE identifier: date, case number, decision number (e.g., "Advies nr. 07/2013"), or ECLI
3. ✅ Context indicating this is a precedent citation (not procedural history or bare reference)

If missing any of these → skip it.

---

## OUTPUT FORMAT

For each citation found, create a snippet with this structure:

\`\`\`
SNIPPET N: [JURISDICTION] XX [COURT] Full body name [DATE] YYYY-MM-DD or null [CASE] Case/decision number or null [ECLI] ECLI code or null — [50-100 words of surrounding context including treatment indicators]
\`\`\`

**Metadata extraction rules:**
- **[JURISDICTION]**: BE, EU, or INT based on which list the body appears in
- **[COURT]**: Full body name exactly as written in text (verbatim, preserve FR/NL)
- **[DATE]**: Convert to YYYY-MM-DD format, or "null" if not mentioned
- **[CASE]**: Case number OR decision number (for administrative bodies) exactly as written, or "null"
- **[ECLI]**: ECLI code if mentioned, otherwise "null"
- **Context**: 50-100 words around citation capturing how it's being used

**Context must include treatment indicators like:**
- FOLLOWED: "conformément à", "overeenkomstig", "selon la jurisprudence", "wordt bevestigd"
- DISTINGUISHED: "à la différence de", "in tegenstelling tot", "se distingue de"
- OVERRULED: "revient sur", "wijkt af van", "écarte"
- CITED: "voir également", "zie ook", simple reference without substantive analysis

---

## EXAMPLES

**✅ Extract:**
\`\`\`
"La Cour rappelle que, conformément à son arrêt du 15 mars 2022 (C.21.0789.N), l'obligation de justification..."
→ Has: court name, date, case number, legal reasoning context
\`\`\`

\`\`\`
"De Commissie verwijst naar haar advies nr. 07/2013 van 20 februari 2013 waarin zij oordeelde dat..."
→ Has: body name, decision number, date, legal reasoning context
\`\`\`

**❌ Don't extract:**
\`\`\`
"artikel 22 van de wet van 15 juni 1935"
→ Legal provision, not a court decision
\`\`\`

\`\`\`
"werd vrijgelaten door arrest van de Kamer van inbeschuldigingstelling van 12 januari 2021"
→ Procedural event in current case (the person's release), not precedent citation
\`\`\`

\`\`\`
"volgens het Hof van Cassatie"
→ Bare reference without identifier
\`\`\`

\`\`\`
"rapport de la Commission pour la protection de la vie privée"
→ Report without decision number, not a formal decision
\`\`\`

---

## SPECIAL CASES

**Multiple citations in one sentence**: Create separate snippet for each.

**Procedural history section**: Be extra careful - these usually describe THIS case's timeline, not precedent citations. Only extract if clearly citing another case as precedent.

**Administrative bodies**: Only extract formal decisions with decision numbers (Advies nr., Décision n°, Beslissing nr.). Skip reports, correspondence, or bare body mentions.

**Same body, different decisions**: If text cites multiple decisions from same body, create separate snippet for each.

---

## OUTPUT

Return only the numbered snippet list:

\`\`\`
SNIPPET 1: [JURISDICTION] ... [COURT] ... [DATE] ... [CASE] ... [ECLI] ... — [context]
SNIPPET 2: [JURISDICTION] ... [COURT] ... [DATE] ... [CASE] ... [ECLI] ... — [context]
...
\`\`\`

If no citations found: \`NO_SNIPPETS_FOUND\`

No explanations, no JSON, no markdown fences. Just the numbered snippets.
`;