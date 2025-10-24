# Extract Comprehensive Job

Comprehensive extraction of all core case information from Belgian court decisions in a single analysis.

## Overview

This job processes Belgian legal decisions to extract 7 types of legal data in one comprehensive pass:

1. **Parties** - with enterprise numbers & procedural roles
2. **Citation Reference** - standardized legal citation
3. **Facts** - chronological factual narrative (bilingual)
4. **Requests** - what each party requested (bilingual)
5. **Arguments** - with court treatment classification (bilingual)
6. **Court Orders** - dispositif/operative part (bilingual)
7. **Outcome** - final decision classification

## Database Schema

### Query Logic

Processes decisions that **have full markdown text** (not null or empty):

```sql
SELECT
  d.id,
  d.decision_id,
  d.url_official_publication,
  d.language_metadata,
  dm.full_md
FROM decisions1 d
INNER JOIN decisions_md dm
  ON d.id = dm.decision_id
WHERE dm.full_md IS NOT NULL
  AND dm.full_md != ''
LIMIT 100
```

### Tables Used

- **decisions1**: Main decisions table
- **decisions_md**: Full text markdown storage

### Join Condition

**CRITICAL**: `decisions1.id = decisions_md.decision_id`

## File Structure

```
src/jobs/extract-comprehensive/
├── config.ts          # Job configuration
├── prompt.ts          # Tested prompt (DO NOT MODIFY)
└── README.md          # This file
```

## Key Features

### 1. Enhanced Party Extraction

**New fields:**
- **Enterprise Number**: Belgian enterprise numbers (format: "BE 0123.456.789")
- **Procedural Role**: Party's role in proceedings (DEMANDEUR, APPELANT, etc.)

**Party Types:**
- `NATURAL_PERSON` - Individuals
- `LEGAL_PERSON` - Companies, associations
- `PUBLIC_BODY` - State entities, government bodies

### 2. Court Treatment Classification

Each argument includes how the court treated it:
- `ACCEPTED` - Court explicitly accepts and applies the argument
- `PARTIALLY_ACCEPTED` - Court accepts some aspects but rejects others
- `REJECTED` - Court explicitly rejects the argument
- `NOT_ADDRESSED` - Court does not discuss this argument
- `UNCERTAIN` - Cannot clearly determine court's treatment

### 3. Bilingual Support

Many fields support both French and Dutch:
- `factsFr` / `factsNl`
- `requestFr` / `requestNl`
- `argumentFr` / `argumentNl`
- `courtOrderFr` / `courtOrderNl`

At least one language must be populated (can't both be null).

## Output Structure

### Complete Example

```json
{
  "id": "12345",
  "decision_id": "ECLI:BE:CASS:2018:ARR.20180611.3",
  "language": "FR",
  "parties": [
    {
      "id": "party001",
      "name": "CENTRE INTERFÉDÉRAL POUR L'ÉGALITÉ DES CHANCES",
      "type": "PUBLIC_BODY",
      "enterpriseNumber": null,
      "proceduralRole": "DEMANDEUR"
    },
    {
      "id": "party002",
      "name": "SA ACME Belgium",
      "type": "LEGAL_PERSON",
      "enterpriseNumber": "BE 0123.456.789",
      "proceduralRole": "DÉFENDEUR"
    }
  ],
  "reference": {
    "citationReference": "Cass., 11 juin 2018, n° S.15.0072.N, ECLI:BE:CASS:2018:ARR.20180611.3"
  },
  "currentInstance": {
    "factsFr": [
      "Le 15 janvier 2015, le Centre a été saisi d'une plainte pour discrimination à l'embauche.",
      "L'employeur a refusé d'embaucher le candidat en raison de son origine.",
      "Le Centre a tenté une conciliation qui a échoué le 20 mars 2015."
    ],
    "factsNl": null,
    "requests": [
      {
        "partyId": "party001",
        "requestFr": "Le Centre demande que la cour condamne le défendeur au paiement de dommages et intérêts pour discrimination.",
        "requestNl": null
      },
      {
        "partyId": "party002",
        "requestFr": "Le défendeur demande le rejet de l'action comme non fondée.",
        "requestNl": null
      }
    ],
    "arguments": [
      {
        "partyId": "party001",
        "argumentFr": "L'article 29 de la loi anti-discrimination permet au Centre d'agir en justice lorsqu'il a l'accord de la victime et que la discrimination affecte plusieurs personnes.",
        "argumentNl": null,
        "courtTreatment": "PARTIALLY_ACCEPTED"
      },
      {
        "partyId": "party001",
        "argumentFr": "Le refus d'embauche constitue une discrimination directe au sens de l'article 7 de la loi.",
        "argumentNl": null,
        "courtTreatment": "ACCEPTED"
      },
      {
        "partyId": "party002",
        "argumentFr": "Le Centre n'a pas qualité pour agir car la discrimination n'affecte qu'une seule personne.",
        "argumentNl": null,
        "courtTreatment": "REJECTED"
      }
    ],
    "courtOrderFr": "La Cour rejette le recours du défendeur. Condamne le défendeur au paiement de 5.000 euros de dommages et intérêts. Condamne le défendeur aux dépens.",
    "courtOrderNl": null,
    "outcome": "GRANTED"
  },
  "metadata": {
    "totalParties": 2,
    "totalRequests": 2,
    "totalArguments": 3,
    "outcomeConfidence": "HIGH",
    "validationChecks": {
      "allPartiesHaveRoles": true,
      "allPartiesHaveRequests": true,
      "allPartiesHaveArguments": true,
      "allArgumentsHaveCourtTreatment": true,
      "noLawyersInParties": true
    }
  }
}
```

Note: `id`, `decision_id`, and `language` are automatically merged from metadata.

## Output Schema Validation

### Required Minimums

- **Parties**: ≥ 1
- **Requests**: ≥ 1
- **Arguments**: ≥ 1
- **Facts**: At least one language populated
- **Court Order**: At least one language populated

### Party Validation

- **ID**: Must match pattern `^party\d{3}$`
- **Name**: ≥ 2 characters
- **Type**: Valid enum (NATURAL_PERSON | LEGAL_PERSON | PUBLIC_BODY)
- **Enterprise Number**: null OR format "BE 0123.456.789"
- **Procedural Role**: ≥ 5 characters

### Request Validation

- **partyId**: Must match party ID pattern
- **Content**: ≥ 30 characters per language (if not null)
- **Requirement**: EVERY party must have a request

### Argument Validation

- **partyId**: Must match party ID pattern
- **Content**: ≥ 50 characters per language (if not null)
- **Court Treatment**: Valid enum (ACCEPTED | PARTIALLY_ACCEPTED | REJECTED | NOT_ADDRESSED | UNCERTAIN)
- **Requirement**: EVERY party must have at least one argument

### Other Validations

- **Facts**: ≥ 20 characters per fact (if not null)
- **Court Order**: ≥ 50 characters (if not null)
- **Citation**: ≥ 20 characters
- **Outcome**: Valid enum (11 options)

## Usage

### Submit Job

```bash
npm run dev submit extract-comprehensive
```

**What happens:**
1. Executes database query (joins decisions1 + decisions_md)
2. Generates comprehensive prompt for each decision
3. Creates JSONL file in `input/`
4. Uploads to Azure OpenAI
5. Submits batch job
6. Saves status to `status/extract-comprehensive.json`

### Check Status

```bash
npm run dev status extract-comprehensive
```

Shows progress, Azure batch status, and record counts.

### Process Results (when complete)

```bash
npm run dev process extract-comprehensive
```

**Output files:**
```
results/extract-comprehensive/<timestamp>/
├── all-results.json           # All responses
├── successful-results.json    # Valid responses only
├── extracted-data.json        # Clean data ⭐ Most useful
├── failures.json              # Failed responses
└── summary.json               # Statistics
```

## Common Procedural Roles

### First Instance
- **DEMANDEUR / EISER**: Plaintiff
- **DÉFENDEUR / VERWEERDER**: Defendant
- **DEMANDEUR RECONVENTIONNEL**: Counterclaim plaintiff
- **INTERVENANT**: Intervenor

### Appellate Level
- **APPELANT / APPELLANT**: Party appealing
- **INTIMÉ / GEÏNTIMEERDE**: Appellee
- **APPELANT INCIDENT**: Cross-appeal

### Cassation
- **DEMANDEUR / VERZOEKER**: Petitioner
- **DÉFENDEUR / VERWEERDER**: Respondent

## Outcome Categories

- **GRANTED**: Court grants plaintiff's/appellant's principal request
- **PARTIALLY_GRANTED**: Court grants some but not all requests
- **DENIED**: Court denies plaintiff's/appellant's requests
- **DISMISSED**: Court finds claim/appeal inadmissible
- **REMANDED**: Cassation court annuls and remands
- **CONFIRMED**: Appellate court confirms lower decision
- **REFORMED**: Appellate court modifies lower decision
- **ANNULLED**: Court annuls a decision/act
- **SETTLED**: Case settled by agreement
- **WITHDRAWN**: Party withdraws claim
- **OTHER**: Doesn't fit above categories

## Validation Checks

The `metadata.validationChecks` object includes:

- **allPartiesHaveRoles**: Every party has a procedural role (≥ 5 chars)
- **allPartiesHaveRequests**: Every party has at least one request
- **allPartiesHaveArguments**: Every party has at least one argument
- **allArgumentsHaveCourtTreatment**: Every argument has court treatment classification
- **noLawyersInParties**: No lawyers/representatives in parties list

All must be `true` for valid extraction.

## Cost & Performance

### Token Usage
- **Average**: ~8,000-12,000 tokens per decision (prompt + completion)
- **Batch API**: 50% cost savings vs standard API
- **100 decisions**: ~$1.00-1.50 USD (estimated)

### Processing Time
- **Azure Processing**: 2-4 hours typical, up to 24 hours max
- **Batch Generation**: ~2-3 seconds per 100 decisions
- **Result Processing**: ~10-15 seconds per 100 decisions

## Troubleshooting

### Issue: No decisions found

**Cause**: No decisions with non-empty `full_md`

**Check:**
```sql
SELECT COUNT(*)
FROM decisions1 d
INNER JOIN decisions_md dm ON d.id = dm.decision_id
WHERE dm.full_md IS NOT NULL AND dm.full_md != '';
```

### Issue: Validation errors

**Check:** `results/extract-comprehensive/<timestamp>/failures.json`

**Common issues:**
- Party counts don't match requests/arguments
- Missing procedural roles
- Enterprise number format incorrect
- Court treatment not classified
- Bilingual fields both null

### Issue: High failure rate

**Possible causes:**
1. Incomplete decisions (missing sections)
2. Unusual decision formats
3. Very short decisions
4. Language detection issues

**Review:** Failed extractions in `failures.json` for patterns

## Important Notes

⚠️ **Prompt is tested and validated** - Do NOT modify `prompt.ts`

⚠️ **Database is READ-ONLY** - No write operations performed

⚠️ **Join Condition**: `decisions1.id = decisions_md.decision_id`

⚠️ **Bilingual Support**: At least one language must be populated for facts/court orders

⚠️ **Court Treatment**: Required for EVERY argument

⚠️ **Completeness**: Every party MUST have requests AND arguments

## Next Steps

1. **Test with small batch** (5-10 decisions)
2. **Review results** for accuracy
3. **Check validation checks** in metadata
4. **Adjust LIMIT** if needed (in config.ts)
5. **Run full batch** when satisfied
6. **Merge results** with other extraction jobs using `id`, `decision_id` fields

## Support

For issues:
1. Check `logs/combined.log`
2. Verify `.env` configuration
3. Test connections: `npm run dev test-connections`
4. Check status file: `status/extract-comprehensive.json`
5. Review failures: `results/extract-comprehensive/<timestamp>/failures.json`
