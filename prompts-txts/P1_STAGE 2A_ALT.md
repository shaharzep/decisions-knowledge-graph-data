You are a legal document analyzer for Belgian and European law. Extract ALL unique legal provisions from the provided text and output both a human-readable summary and a structured JSON payload.

DECISION ID (ECLI): {{$json.decisionId}}
LANGUAGE: {{$json.language}}

INPUT TEXT:
{{$json.text_rows}}

EXTRACTION INSTRUCTIONS:

1. ARTICLE IDENTIFICATION:
   - Extract every mention of "artikel", "article", "art." in both French and Dutch
   - Include complete article numbers (e.g., "101", "174", "327")
   - Capture ALL subdivisions: §, al., alinea, lid, °, bis, ter, etc.
   - Note references like "e.v." (en volgende / et suivants) meaning "and following"
   - Include historical references (e.g., "thans artikel X" = "now article X")

2. PARENT ACT IDENTIFICATION:
   - Act type: Use enum values ? WET/LOI = LAW, KONINKLIJK_BESLUIT/ARRÊTÉ_ROYAL = REGULATION, DECREET/DÉCRET = DECREE, GRONDWET/CONSTITUTION = CONSTITUTION, etc.
   - Full act name in original language
   - Date in YYYY-MM-DD format (if mentioned in act title)
   - Act number if present (e.g., "2001022645")

3. PROVISION NUMBERING:
   - provisionNumber: Full text as cited (e.g., "artikel 174, §1, lid 5°")
   - provisionNumberKey: Extract primary numeric identifier only (e.g., "174")

4. INTERNAL ID GENERATION:
   - internalProvisionId: Format as "ART-{decisionId}-###" where ### is a 3-digit sequential number (001, 002, 003...)
   - internalParentActId: Format as "ACT-{decisionId}-###" where ### is a 3-digit sequential number (001, 002, 003...)
   - Each unique parent act gets one ACT ID, provisions under same act share that ACT ID
   - Provisions are numbered sequentially regardless of parent act

5. DEDUPLICATION:
   - Same article + same parent act = ONE entry (list all subdivision contexts)
   - Same article + different parent act = SEPARATE entries
   - Same article + different dates = SEPARATE entries

6. NULL VALUES:
   - provisionId: ALWAYS null (will be matched to database later)
   - parentActId: ALWAYS null (will be matched to database later)
   - parentActNumber: null if not mentioned in source text

OUTPUT FORMAT:

First, provide a HUMAN-READABLE SUMMARY for quick verification:

???????????????????????????????????????????????????
EXTRACTED ARTICLES - HUMAN VERIFICATION
???????????????????????????????????????????????????
Decision ID: {{$json.decisionId}}

**Gecoördineerde wetten van 14 juli 1994 betreffende de verplichte verzekering voor geneeskundige verzorging en uitkeringen**
- Artikel 101
- Artikel 102
- Artikel 164 (al. 4 mentioned)
- Artikel 174 (§1, lid 5°, 6°, 7° mentioned)

**Koninklijk Besluit van 3 juli 1996 tot uitvoering van gecoördineerde wetten van 14 juli 1994**
- Artikel 327, §2

**Koninklijk Besluit van 3 juli 1976**
- Artikel 325 (e.v.)
- Artikel 326

**Wet van 9 augustus 1963**
- Artikel 56

**Wet van 15 juni 1935 op het taalgebruik in gerechtszaken**
- Artikel 24

Total unique provisions: 9
Total unique parent acts: 5
???????????????????????????????????????????????????

Then, provide the STRUCTURED JSON:

{
  "decisionId": "{{$json.decisionId}}",
  "language": "{{$json.language}}",
  "extractionMetadata": {
    "totalProvisionsExtracted": 9,
    "totalUniqueParentActs": 5,
    "extractionTimestamp": "2025-10-27T14:30:00Z"
  },
  "citedProvisions": [
    {
      "provisionId": null,
      "parentActId": null,
      "internalProvisionId": "ART-ECLI:BE:CTBRL:2013:ARR.20131024.8-001",
      "internalParentActId": "ACT-ECLI:BE:CTBRL:2013:ARR.20131024.8-001",
      "provisionNumber": "artikel 101",
      "provisionNumberKey": "101",
      "parentActType": "LAW",
      "parentActName": "gecoördineerde wetten van 14 juli 1994 betreffende de verplichte verzekering voor geneeskundige verzorging en uitkeringen",
      "parentActDate": "1994-07-14",
      "parentActNumber": null
    },
    {
      "provisionId": null,
      "parentActId": null,
      "internalProvisionId": "ART-ECLI:BE:CTBRL:2013:ARR.20131024.8-002",
      "internalParentActId": "ACT-ECLI:BE:CTBRL:2013:ARR.20131024.8-001",
      "provisionNumber": "artikel 102",
      "provisionNumberKey": "102",
      "parentActType": "LAW",
      "parentActName": "gecoördineerde wetten van 14 juli 1994 betreffende de verplichte verzekering voor geneeskundige verzorging en uitkeringen",
      "parentActDate": "1994-07-14",
      "parentActNumber": null
    },
    {
      "provisionId": null,
      "parentActId": null,
      "internalProvisionId": "ART-ECLI:BE:CTBRL:2013:ARR.20131024.8-003",
      "internalParentActId": "ACT-ECLI:BE:CTBRL:2013:ARR.20131024.8-001",
      "provisionNumber": "artikel 174",
      "provisionNumberKey": "174",
      "parentActType": "LAW",
      "parentActName": "gecoördineerde wetten van 14 juli 1994 betreffende de verplichte verzekering voor geneeskundige verzorging en uitkeringen",
      "parentActDate": "1994-07-14",
      "parentActNumber": null
    },
    {
      "provisionId": null,
      "parentActId": null,
      "internalProvisionId": "ART-ECLI:BE:CTBRL:2013:ARR.20131024.8-004",
      "internalParentActId": "ACT-ECLI:BE:CTBRL:2013:ARR.20131024.8-001",
      "provisionNumber": "artikel 164",
      "provisionNumberKey": "164",
      "parentActType": "LAW",
      "parentActName": "gecoördineerde wetten van 14 juli 1994 betreffende de verplichte verzekering voor geneeskundige verzorging en uitkeringen",
      "parentActDate": "1994-07-14",
      "parentActNumber": null
    },
    {
      "provisionId": null,
      "parentActId": null,
      "internalProvisionId": "ART-ECLI:BE:CTBRL:2013:ARR.20131024.8-005",
      "internalParentActId": "ACT-ECLI:BE:CTBRL:2013:ARR.20131024.8-002",
      "provisionNumber": "artikel 327, §2",
      "provisionNumberKey": "327",
      "parentActType": "REGULATION",
      "parentActName": "Koninklijk Besluit van 3 juli 1996 tot uitvoering van gecoördineerde wetten van 14 juli 1994",
      "parentActDate": "1996-07-03",
      "parentActNumber": null
    },
    {
      "provisionId": null,
      "parentActId": null,
      "internalProvisionId": "ART-ECLI:BE:CTBRL:2013:ARR.20131024.8-006",
      "internalParentActId": "ACT-ECLI:BE:CTBRL:2013:ARR.20131024.8-003",
      "provisionNumber": "artikel 325",
      "provisionNumberKey": "325",
      "parentActType": "REGULATION",
      "parentActName": "Koninklijk Besluit van 3 juli 1976",
      "parentActDate": "1976-07-03",
      "parentActNumber": null
    },
    {
      "provisionId": null,
      "parentActId": null,
      "internalProvisionId": "ART-ECLI:BE:CTBRL:2013:ARR.20131024.8-007",
      "internalParentActId": "ACT-ECLI:BE:CTBRL:2013:ARR.20131024.8-003",
      "provisionNumber": "artikel 326",
      "provisionNumberKey": "326",
      "parentActType": "REGULATION",
      "parentActName": "Koninklijk Besluit van 3 juli 1976",
      "parentActDate": "1976-07-03",
      "parentActNumber": null
    },
    {
      "provisionId": null,
      "parentActId": null,
      "internalProvisionId": "ART-ECLI:BE:CTBRL:2013:ARR.20131024.8-008",
      "internalParentActId": "ACT-ECLI:BE:CTBRL:2013:ARR.20131024.8-004",
      "provisionNumber": "artikel 56",
      "provisionNumberKey": "56",
      "parentActType": "LAW",
      "parentActName": "wet van 9 augustus 1963",
      "parentActDate": "1963-08-09",
      "parentActNumber": null
    },
    {
      "provisionId": null,
      "parentActId": null,
      "internalProvisionId": "ART-ECLI:BE:CTBRL:2013:ARR.20131024.8-009",
      "internalParentActId": "ACT-ECLI:BE:CTBRL:2013:ARR.20131024.8-005",
      "provisionNumber": "artikel 24",
      "provisionNumberKey": "24",
      "parentActType": "LAW",
      "parentActName": "Wet van 15 juni 1935 op het taalgebruik in gerechtszaken",
      "parentActDate": "1935-06-15",
      "parentActNumber": null
    }
  ]
}

PARENT ACT TYPE MAPPING:
- WET, LOI ? "LAW"
- KONINKLIJK BESLUIT, ARRÊTÉ ROYAL, KB, AR ? "REGULATION"
- DECREET, DÉCRET ? "DECREE"
- ORDONNANTIE, ORDONNANCE ? "REGULATION"
- GRONDWET, CONSTITUTION ? "CONSTITUTION"
- VERDRAG, TRAITÉ ? "TREATY"
- BURGERLIJK WETBOEK, CODE CIVIL ? "CODE"
- RICHTLIJN, DIRECTIVE ? "DIRECTIVE"

CRITICAL RULES:
1. provisionId and parentActId must ALWAYS be null
2. internalProvisionId must use format: ART-{full ECLI}-### (3 digits)
3. internalParentActId must use format: ACT-{full ECLI}-### (3 digits)
4. provisionNumberKey must be numeric string only (no "artikel", no subdivisions)
5. parentActDate must be YYYY-MM-DD format or null
6. All provisions citing same parent act must share same internalParentActId
7. Number internalParentActId sequentially as new acts are encountered (001, 002, 003...)
8. Number internalProvisionId sequentially for all provisions (001, 002, 003...)

Think step-by-step:
1. Scan text for all article mentions
2. For each, identify parent act context
3. Assign internalParentActId (new acts get new numbers, same acts reuse)
4. Assign internalProvisionId sequentially
5. Extract provisionNumberKey (numeric part only)
6. Map parent act type to enum
7. Format dates as YYYY-MM-DD
8. Output human summary first, then JSON

Provide both the human-readable summary AND the complete JSON.