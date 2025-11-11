# Belgium Case Law Pipeline - Quick Reference

## System at a Glance

**What**: Multi-stage AI extraction pipeline for Belgian court decisions
**Scale**: 64,000 decisions (FR & NL versions)
**Processing**: Concurrent API calls with full-data streaming
**Quality**: 98-100/100 evaluation scores per stage

---

## The 6+ Extraction Agents

| Agent | Stage | Purpose | Input | Output | Model | Score | Status |
|-------|-------|---------|-------|--------|-------|-------|--------|
| 1 | Comprehensive | Core case data | Full markdown | Parties, facts, arguments, court order | gpt-5-mini | 98/100 | ✅ Done |
| 2A | Provisions (Stage 1) | Find provision mentions | Full markdown | Text snippets | gpt-5-mini | 100/100 | ✅ Done |
| 2A | Provisions (Stage 2) | Parse snippets to JSON | Snippets (5-10K) | citedProvisions array | gpt-5-mini | 100/100 | ✅ Done |
| 2B | Enrich Refs | Add CELEX/NUMAC codes | Full markdown | extractedReferences | Regex only | 100/100 | ✅ Done |
| 2C | Interpret Prov | Add interpretation context | Citations from 2B | provisionInterpretation field | gpt-5-mini | TBD | 🔄 WIP |
| 3 | Cited Decisions | Extract precedents | Full markdown | citedDecisions array | gpt-5-mini | 98/100 | ✅ Done |
| 4 | Keywords | Extract search keywords | Full markdown | keywords array | gpt-4.1-mini | - | ✅ Done |
| 5 | Legal Teachings | Extract reusable principles | Full markdown | legalTeachings array | gpt-5 | TBD | 🔄 WIP |

---

## Key Directories

```
src/
├── cli.ts                    # Entry: npm run dev <command>
├── concurrent/               # Direct API processing (NEW)
│   ├── ConcurrentRunner.ts
│   └── ConcurrentProcessor.ts
├── core/                     # Batch API infrastructure (OLD)
├── jobs/
│   ├── configs/              # Job configuration re-exports
│   ├── extract-comprehensive/
│   ├── extract-provisions-2a/
│   ├── enrich-provisions/
│   ├── interpret-provisions/
│   ├── extract-cited-decisions/
│   └── extract-legal-teachings/
└── utils/
    ├── testSetLoader.ts      # 197-decision test set
    └── jobResultLoader.ts    # Cross-job dependency loading

prompts-txts/                 # LLM prompts (markdown format)
├── AI Agent 1.md
├── AI Agent 2A.md
├── AI Agent 2B.md (empty - regex only)
├── AI Agent 2C.md
├── AI Agent 3.md
├── AI Agent 5.md
└── ...

evals/                        # Evaluation framework
├── test-sets/comprehensive-197.csv
├── judge-prompts/            # LLM-as-a-judge evaluation
└── results/                  # Evaluation scores

full-data/                    # Per-decision output JSONs
├── extract-comprehensive/{timestamp}/jsons/
├── extract-provisions-2a/{timestamp}/jsons/
├── enrich-provisions/{timestamp}/jsons/
├── interpret-provisions/{timestamp}/jsons/
├── extract-cited-decisions/{timestamp}/jsons/
└── extract-legal-teachings/{timestamp}/jsons/
```

---

## Command Quick Start

### Concurrent Processing (NEW - Primary Mode)

```bash
# Process all decisions concurrently (streaming to full-data/)
npm run dev concurrent extract-comprehensive
npm run dev concurrent extract-provisions-2a
npm run dev concurrent enrich-provisions
npm run dev concurrent interpret-provisions
npm run dev concurrent extract-cited-decisions

# With custom concurrency
npm run dev concurrent extract-provisions-2a --concurrency 500

# Evaluate on 197-decision test set
npm run eval extract-provisions-2a gpt-5-mini
```

### Batch Processing (OLD - Azure Batch API)

```bash
# Submit batch job
npm run dev submit extract-comprehensive

# Check status
npm run dev status extract-comprehensive

# Process results when completed
npm run dev process extract-comprehensive

# List all jobs
npm run dev list
```

---

## Data Flow

```
PostgreSQL (decisions1 + decisions_md)
  ↓
ConcurrentRunner.loadDecisions()
  ↓
For each decision (with 300 concurrent):
  1. preprocessRow() - Enrich/transform
  2. DependencyResolver - Load prior job outputs
  3. LLM - Execute promptTemplate or customExecution
  4. Validate - Check against outputSchema
  5. postProcessRow() - Final transformations
  ↓
Stream to full-data/{job}/{timestamp}/jsons/{decision_id}_{language}.json
```

---

## Output Structure

### Full-Data Pipeline (useFullDataPipeline: true)

Per-decision files:
```
full-data/extract-provisions-2a/2025-11-10T14-30-00-000Z/
├── jsons/
│   ├── ECLI:BE:CASS:2001:ARR.001_FR.json
│   ├── ECLI:BE:CASS:2001:ARR.001_NL.json
│   ├── ECLI:BE:CASS:2001:ARR.002_FR.json
│   └── ... (64k files)
├── summary.json
└── failures.json
```

### Aggregated Results (useFullDataPipeline: false)

Test set evaluation:
```
concurrent/results/extract-provisions-2a/gpt-5-mini-medium/2025-11-10T14-30-00-000Z/
├── extracted-data.json           # Array of clean outputs
├── successful-results.json       # With metadata
├── failures.json                 # Error details
└── summary.json                  # Statistics
```

---

## Key Configuration Patterns

### Simple One-Stage Job

```typescript
// Job config for keyword extraction
promptTemplate: (row) => {
  return KEYWORD_PROMPT.replace("{fullText}", row.full_md);
}
```

### Two-Stage Custom Execution

```typescript
// Agent 2A provisions
customExecution: async (row, client) => {
  // Stage 1: Snippet extraction
  const snippets = await client.complete(stage1Messages);
  
  // Stage 2: JSON parsing
  const result = await client.complete(stage2Messages(snippets));
  
  return result;
}
```

### Dependency Loading

```typescript
// Agent 2C - depends on Agent 2B
preprocessRow: async (row) => {
  const agent2bData = load2BData(row.decision_id, row.language);
  return { ...row, agent2b: agent2bData };
}

promptTemplate: (row) => {
  return PROMPT
    .replace("{citedProvisions}", JSON.stringify(row.agent2b.citedProvisions));
}
```

---

## Database Schema

```sql
decisions1:
  id (serial)
  decision_id (ECLI: ECLI:BE:CASS:2001:ARR.001)
  language_metadata (FR or NL)
  decision_type_ecli_code (ARR, ORD, RECO)
  court_ecli_code (CASS, GBAPD, etc.)
  decision_date
  ...

decisions_md:
  decision_id (FK)
  language (FR or NL)
  full_md (markdown text, 2K-120K chars)
```

---

## Model & Reasoning Configuration

### Temperature & Reasoning

```typescript
// Deterministic extraction (all jobs)
temperature: 0.0          // No randomness

// Reasoning models (gpt-5-mini, gpt-5, o4-mini)
reasoningEffort: 'low' | 'medium' | 'high'
// low:    ~50K reasoning tokens
// medium: ~200K reasoning tokens
// high:   ~400K+ reasoning tokens
```

### Model Selection by Complexity

- Simple: gpt-4.1-mini (cleanup, keywords)
- Medium: gpt-5-mini (provisions, cited decisions)
- Complex: gpt-5 (legal teachings with quality gates)
- Regex: None (Agent 2B reference extraction)

---

## Composite Key Matching (For Bilingual Data)

Each decision has FR and NL versions. Use composite key:

```typescript
// Creating key
key = `${decision_id}||${language}`  // ECLI:BE:CASS:2001:ARR.001||FR

// Filename format
filename = `${decision_id}_${language}.json`  // ECLI:BE:CASS:2001:ARR.001_FR.json

// Dependency matching
matchOn: [
  { row: 'decision_id', dependency: 'decision_id' },
  { row: 'language_metadata', dependency: 'language' }
]
```

---

## Output Schemas Summary

### Agent 1 - Comprehensive
```json
{
  "reference": { "citationReference": "..." },
  "parties": [{ "id", "name", "type", "proceduralRole" }],
  "currentInstance": {
    "facts", "requests", "arguments", "courtOrder", "outcome"
  }
}
```

### Agent 2A - Provisions
```json
{
  "citedProvisions": [{
    "provisionNumber", "provisionNumberKey",
    "parentActType", "parentActName", "parentActDate",
    "internalProvisionId", "internalParentActId",
    "provisionSequence", "parentActSequence"
  }]
}
```

### Agent 2B - Enrich (Adds)
```json
{
  "citedProvisions": [...from 2A...],
  "extractedReferences": {
    "url": { "eu": [...], "be": [...] },
    "reference": {
      "eu": { "extracted", "verified" },
      "be": { "extracted", "verifiedNumac", "verifiedFileNumber" }
    }
  }
}
```

### Agent 2C - Interpret (Adds)
```json
{
  "citedProvisions": [{
    ...[10 fields from 2A]...,
    "provisionInterpretation",      // NEW
    "relevantFactualContext"        // NEW
  }],
  "extractedReferences": {...from 2B...}
}
```

### Agent 3 - Cited Decisions
```json
{
  "citedDecisions": [{
    "citedCourtName", "citedDecisionDate", "citedCaseNumber",
    "citedECLI", "treatmentClassification",
    "jurisdiction", "contextSnippet",
    "internalDecisionId", "decisionSequence"
  }]
}
```

### Agent 5 - Legal Teachings
```json
{
  "legalTeachings": [{
    "teachingId",
    "text", "courtVerbatim", "courtVerbatimLanguage",
    "factualTrigger", "relevantFactualContext",
    "principleType", "legalArea",
    "hierarchicalRelationships": { ... },
    "precedentialWeight": { ... },
    "relatedCitedProvisionsId", "relatedCitedDecisionsId"
  }],
  "metadata": { "totalTeachings", "teachingTypes", ... }
}
```

---

## Evaluation Results

### Test Set: 197 Curated Decisions

Stratified by:
- Language: FR (~100), NL (~97)
- Decision Type: ARR, ORD, RECO
- Court Level: CASS, Appeal, First Instance
- Length: short, medium, long, very_long

### Scoring (LLM-as-a-Judge)

Dimensions: Completeness, Accuracy, Relevance, Clarity, Consistency (0-100)

**Recent Scores**:
- Agent 1 (extract-comprehensive): 98/100
- Agent 2A (provisions): 99-100/100
- Agent 2B (enrich-provisions): 100/100 (regex)
- Agent 3 (cited-decisions): 98/100
- Agent 5 (legal-teachings): In refinement

---

## Troubleshooting

### Job Stuck in Processing

```bash
# Check logs
tail -f logs/combined.log

# Check status
npm run dev list

# Look for failures
cat concurrent/results/<job>/<model>/latest/failures.json
```

### Missing Dependency Data

```bash
# Verify prior job completed
ls full-data/extract-provisions-2a/*/jsons/ | head -20

# Rebuild filepath map
# (Automatic in dependency resolver, just restart job)
```

### Schema Validation Errors

Look at:
```
concurrent/results/<job>/<model>/<timestamp>/failures.json

# Shows exact field that failed validation
```

---

## Development Notes

- All extraction in procedural language (FR or NL)
- No translation within agents
- Bilingual enum values (same enum, different values per language)
- Verbatim extraction (except synthesis when necessary)
- Reserved null fields for database mapping (provisionId, parentActId, etc.)
- Internal sequential IDs (PARTY-...-001, ART-...-001, DEC-...-001)
- Incremental persistence for large jobs

---

## Next Steps

1. Complete Agent 2C (interpret-provisions) - currently in development
2. Refine Agent 5 (legal-teachings) quality gates and scoring
3. Process full 64k dataset with optimized concurrency
4. Integrate results into knowledge graph database
5. Add HTML structuring (Agent 6)

