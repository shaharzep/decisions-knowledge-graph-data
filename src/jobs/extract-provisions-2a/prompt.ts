export interface ProvisionsPromptContext {
  decisionId: string;
  proceduralLanguage: 'FR' | 'NL';
  fullText: string;
  provisionSnippets: string;
  abbreviationGuide?: string;
  sectionGuide?: string;
  chunkInfo?: {
    index: number;
    total: number;
    label: string;
    charRange: string;
  };
}

interface LanguagePromptConfig {
  template: string;
  chunkInstruction: string;
  abbreviationFallback: string;
  sectionFallback: string;
  snippetFallback: string;
}

const CONFIG_FR: LanguagePromptConfig = {
  template: `## ROLE
Tu es un analyste juridique spécialisé chargé d'extraire les dispositions de lois citées dans des décisions judiciaires belges. Cette tâche correspond à l'étape 2A (métadonnées essentielles).

## OBJECTIF PRINCIPAL
Extraire TOUTE disposition citée avec une exactitude parfaite et une numérotation correcte.

- **COMPLETUDE** : manquer une seule disposition = ECHEC
- **PRECISION** : rattacher une disposition au mauvais acte ou inventer du contenu = ECHEC
- **SEQUENCEMENT** : mauvaise séquence ou absence de déduplication = ECHEC

## CONTEXTE DU CHUNK
{chunkInstruction}
- Contexte: {chunkInfo}

## INPUT
1. **decisionId** : {decisionId}
2. **proceduralLanguage** : {proceduralLanguage}
3. **fullText.markdown** :
{fullText.markdown}
4. **Abréviations connues** :
{abbreviationGuide}
5. **Repères de section** :
{sectionGuide}
6. **Snippets de sécurité** :
{provisionSnippets}

## SCHEMA DE SORTIE
\`\`\`
{
  "citedProvisions": [
    {
      "provisionId": null,
      "parentActId": null,
      "provisionSequence": 1,
      "parentActSequence": 1,
      "provisionNumber": "chaine VERBATIM (avec tous les qualificatifs)",
      "provisionNumberKey": "chaine normalisée",
      "parentActType": "enum française",
      "parentActName": "chaine VERBATIM avec tous les qualificatifs",
      "parentActDate": "YYYY-MM-DD ou null",
      "parentActNumber": "chaine ou null"
    }
  ]
}
\`\`\`

**Note** : Tu fournis uniquement les séquences entières ; les identifiants ART-/ACT- sont générés ensuite.

---

## ⛔ REGLE ANTI-HALLUCINATION

N'extrais une disposition que si :
1. Un numéro d'article est explicitement cité (art./article + numéro)
2. L'instrument est référencé dans la même phrase ou dans le contexte immédiat (1-2 phrases précédentes)

**NE PAS extraire** :
- ❌ Mention d'un acte sans article
- ❌ Citer la convention de base lorsque seul un protocole est mentionné
- ❌ Déductions à partir de « §2, 3° » ⇒ ce n'est PAS « §3 »
- ❌ Références hors contexte d'article (préambules « Vu », « Gelet op » sans article)

### Motifs fréquents
- Le symbole ° introduit un point interne, jamais un numéro de paragraphe.
- Notations décimales :
  - CEDH / GDPR : 8.1 ≠ 8.2 (dispositions distinctes, conserver les décimales)
  - Lois belges « 8.1 » = « art. 8, §1 » (ne crée pas de doublons avec d'autres notations)
- Plages d'articles : « articles 50 à 54 » ⇒ développe chaque article individuellement ; utilise « tot en met / t.e.m. » de façon inclusive.
- Listes : « articles 31, 32 et 35 » ⇒ extrais chaque article ; « art. 31, §§2, 3 et 4 » ⇒ une seule disposition (même article).
- Abréviations : associe chaque sigle à son acte via la table fournie.

## DEDUPLICATION & CLEFS
- Une disposition unique = combinaison {parentActSequence}-{provisionNumberKey}.
- Les décimales des traités / GDPR représentent des articles distincts.
- Garde les suffixes bis/ter/quater dans "provisionNumberKey".
- Retire §, °, a)/b) de "provisionNumberKey" mais conserve-les verbatim dans "provisionNumber".

## ENUMS parentActType (française)
- LOI
- ARRETE_ROYAL
- CODE
- CONSTITUTION
- REGLEMENT_UE
- DIRECTIVE_UE
- TRAITE
- ARRETE_GOUVERNEMENT
- ORDONNANCE
- DECRET
- AUTRE

## RAPPEL : VERBATIM
- "parentActName" doit rester exactement tel qu'écrit (coordonné, modifié, etc.).
- "parentActDate" : uniquement si la date est explicitement indiquée ; sinon null.
- "parentActNumber" : numac, MB/BS, référence officielle si fournie ; sinon null.

## STRATEGIE SYSTEMATIQUE
### Documents courts (≤30k caractères)
1. Balaye de l'entête au dispositif.
2. Associe chaque article à son acte via le contexte immédiat.
3. Développe les plages d'articles et listes.
4. Vérifie les snippets fournis.

### Documents longs (>30k caractères)
1. Passe 1 – cartographie : repère chaque section et les actes mentionnés.
2. Passe 2 – extraction : traite section par section en respectant les règles précédentes.
3. Passe 3 – validation : vérifie chaque snippet fourni ; complète les manquants.

**Pourquoi cela fonctionne pour les longs documents :**
- Pass 1 : couverture systématique sans oubli
- Pass 2 : exactitude grâce au focus sectionnel
- Pass 3 : filet de sécurité via les snippets
`,
  chunkInstruction:
    'Tu traites uniquement le segment indiqué. Ne rapporte que les dispositions présentes dans ce segment.',
  abbreviationFallback:
    '(Aucune abréviation explicite détectée dans les sections précédentes)',
  sectionFallback:
    '(Préambule → Faits → Moyens → Motivation → Dispositif → Notes)',
  snippetFallback:
    '(Aucun snippet détecté — la vérification repose sur le texte complet)',
};

const CONFIG_NL: LanguagePromptConfig = {
  template: `## ROL
Je bent een juridische AI die Belgische rechterlijke uitspraken analyseert. Dit is fase 2A (essentiële metadata).

## HOOFDDOEL
Haal ELKE aangehaalde bepaling met perfecte nauwkeurigheid en juiste volgorde op.

- **VOLLEDIGHEID** : één gemiste bepaling = FALEN
- **NAUWKEURIGHEID** : verkeerde wet of verzonnen inhoud = FALEN
- **VOLGORDE** : verkeerde nummering of geen deduplicatie = FALEN

## CONTEXT VAN DEELSEGMENT
{chunkInstruction}
- Context: {chunkInfo}

## INPUT
1. **decisionId** : {decisionId}
2. **proceduralLanguage** : {proceduralLanguage}
3. **fullText.markdown** :
{fullText.markdown}
4. **Bekende afkortingen** :
{abbreviationGuide}
5. **Sectieoverzicht** :
{sectionGuide}
6. **Snippets (veiligheidsnet)** :
{provisionSnippets}

## UITVOERSCHEMA
\`\`\`
{
  "citedProvisions": [
    {
      "provisionId": null,
      "parentActId": null,
      "provisionSequence": 1,
      "parentActSequence": 1,
      "provisionNumber": "VERBATIM (met alle kwalificaties)",
      "provisionNumberKey": "genormaliseerde kern",
      "parentActType": "Nederlandse enum",
      "parentActName": "VERBATIM naam",
      "parentActDate": "YYYY-MM-DD of null",
      "parentActNumber": "string of null"
    }
  ]
}
\`\`\`

**Opmerking** : je levert enkel de sequenties; ART-/ACT- id's worden nadien opgebouwd.

---

## ⛔ ANTI-HALLUCINATIE REGEL

Extraheer uitsluitend wanneer :
1. Een artikelnumer expliciet wordt genoemd (art./artikel + nummer)
2. Het instrument in dezelfde zin of directe context wordt genoemd (1-2 zinnen).

**NIET extraheren** :
- ❌ Vermelding van een wet zonder artikel
- ❌ Hoofdverdrag wanneer enkel een protocolartikel vermeld wordt
- ❌ Afleidingen uit “§2, 3°” ⇒ dit is GEEN “§3”
- ❌ Verwijzingen buiten artikelcontext (inleidingen “Gelet op...”, zonder artikel)

### Veelvoorkomende patronen
- Het °-teken duidt een onderdeel aan, nooit een nieuw paragrafenummer.
- Decimale notaties :
  - CEDH / GDPR : 8.1 ≠ 8.2 (aparte bepalingen, behoud decimale notatie)
  - Belgische wetten “8.1” ≈ “art. 8, §1” (vermijd dubbele entries bij gemengde notaties)
- Artikelenreeksen : “artikelen 50 tot 54” ⇒ elk artikel afzonderlijk opnemen; “tot en met / t.e.m.” is inclusief.
- Lijsten : “artikelen 31, 32 en 35” ⇒ elk artikel apart; “art. 31, §§2, 3 en 4” ⇒ één bepaling (zelfde artikel).
- Afkortingen : koppel elke afkorting aan de juiste wet via de tabel.

## DEDUPLICATIE & SLEUTELS
- Unieke bepaling = combinatie {parentActSequence}-{provisionNumberKey}.
- Behandel decimale treaty/GDPR artikels als aparte bepalingen.
- Bewaar bis/ter/quater in "provisionNumberKey".
- Verwijder §, °, a)/b) uit de sleutel maar behoud ze VERBATIM in "provisionNumber".

## ENUMS parentActType (Nederlandse lijst)
- WET
- KONINKLIJK_BESLUIT
- WETBOEK
- GRONDWET
- EU_VERORDENING
- EU_RICHTLIJN
- VERDRAG
- BESLUIT_VAN_DE_REGERING
- ORDONNANTIE
- DECREET
- ANDERE

## VERBATIM-BELEID
- "parentActName" blijft exact zoals in de tekst (gecoördineerd, gewijzigd...).
- "parentActDate" enkel wanneer expliciet vermeld; anders null.
- "parentActNumber" : numac, BS/MB, officiële referentie indien aanwezig; anders null.

## SYSTEMATISCHE AANPAK
### Korte documenten (≤30k tekens)
1. Scrol van begin tot dispositief.
2. Koppel elke artikelaanduiding aan het juiste instrument via de directe context.
3. Breid reeksen en lijsten uit.
4. Controleer de snippets.

### Lange documenten (>30k tekens)
1. Fase 1 – kaart : noteer elke sectie en de bijbehorende instrumenten.
2. Fase 2 – extractie : werk sectie per sectie volgens bovenstaande regels.
3. Fase 3 – validatie : controleer elke snippet; vul ontbrekende bepalingen aan.

**Waarom dit werkt voor lange documenten:**
- Fase 1 : volledige dekking zonder gaten
- Fase 2 : nauwkeurigheid door focus per sectie
- Fase 3 : vangnet dankzij snippets
`,
  chunkInstruction:
    'Verwerk enkel het aangegeven segment. Rapport alleen bepalingen die in dit segment staan.',
  abbreviationFallback:
    '(Geen expliciete afkortingen gevonden in eerdere secties)',
  sectionFallback:
    '(Inleiding → Feiten → Middelen → Motivering → Dispositief → Noten)',
  snippetFallback:
    '(Geen snippets gevonden — controleer volledige tekst)',
};

function formatChunkInfo(ctx: ProvisionsPromptContext): string {
  if (!ctx.chunkInfo) {
    return ctx.proceduralLanguage === 'NL'
      ? 'Volledig document (geen segmentatie).'
      : 'Document complet (pas de découpage).';
  }

  const { index, total, label, charRange } = ctx.chunkInfo;
  return ctx.proceduralLanguage === 'NL'
    ? `Segment ${index + 1}/${total} – ${label} (tekens ${charRange})`
    : `Segment ${index + 1}/${total} – ${label} (caractères ${charRange})`;
}

export function buildProvisionsPrompt(ctx: ProvisionsPromptContext): string {
  const language = ctx.proceduralLanguage ?? 'FR';
  const config = language === 'NL' ? CONFIG_NL : CONFIG_FR;

  const replacements: Record<string, string> = {
    '{decisionId}': ctx.decisionId ?? '',
    '{proceduralLanguage}': ctx.proceduralLanguage ?? 'FR',
    '{fullText.markdown}': ctx.fullText ?? '',
    '{abbreviationGuide}':
      ctx.abbreviationGuide?.trim().length
        ? ctx.abbreviationGuide
        : config.abbreviationFallback,
    '{sectionGuide}':
      ctx.sectionGuide?.trim().length
        ? ctx.sectionGuide
        : config.sectionFallback,
    '{provisionSnippets}':
      ctx.provisionSnippets?.trim().length
        ? ctx.provisionSnippets
        : config.snippetFallback,
    '{chunkInfo}': formatChunkInfo(ctx),
    '{chunkInstruction}': config.chunkInstruction,
  };

  let prompt = config.template;
  for (const [token, value] of Object.entries(replacements)) {
    prompt = prompt.replaceAll(token, value);
  }

  return prompt;
}
