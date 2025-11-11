# Belgium Case Law Data Extraction Pipeline - Comprehensive System Analysis

## Executive Summary

This is a sophisticated **multi-stage AI-driven data extraction pipeline** designed to systematically process ~64,000 Belgian court decisions (available in French and Dutch). The system extracts structured legal data through 6+ specialized agents, each targeting different aspects of court decisions, with built-in quality validation and incremental persistence for robustness.

**Key Characteristics:**
- **Modular Agent Architecture**: 6+ independent extraction agents working on composite decisions
- **Hybrid Processing Modes**: Both batch API (Azure OpenAI) and concurrent processing (Claude/OpenAI)
- **Full-Data Pipeline**: Streaming results with per-decision JSON files for fault tolerance
- **Composite Key Matching**: Language-aware decision matching (decision_id + language)
- **Quality Gates**: JSON schema validation, test-set evaluation, and reasoning models for complex tasks

---

## 1. PROJECT STRUCTURE

### Directory Organization

```
/Users/shaharzep/knowledge-graph/
├── src/                          # Main application source code
│   ├── cli.ts                    # CLI entry point (submit, status, process, concurrent)
│   ├── config/                   # Configuration and connections
│   │   ├── database.ts          # PostgreSQL read-only connection pool
│   │   ├── azure.ts             # Azure OpenAI client
│   │   └── openai.ts            # Standard OpenAI client
│   ├── core/                     # Core batch processing infrastructure
│   │   ├── BatchJobGenerator.ts    # JSONL generation from DB + prompt
│   │   ├── AzureBatchClient.ts     # Azure Batch API interactions
│   │   ├── BatchJobRunner.ts       # Orchestrates submit→status→process flow
│   │   ├── JobStatusTracker.ts     # Status JSON persistence
│   │   ├── ResultProcessor.ts      # Validation & result aggregation
│   │   ├── DependencyResolver.ts   # Cross-job dependency loading
│   │   └── providers/              # Provider-specific implementations
│   ├── concurrent/               # Concurrent processing (replaces batch)
│   │   ├── ConcurrentRunner.ts      # Main orchestrator
│   │   ├── ConcurrentProcessor.ts   # Result handling & persistence
│   │   ├── OpenAIConcurrentClient.ts
│   │   └── ClaudeConcurrentClient.ts
│   ├── jobs/                     # Extraction job definitions
│   │   ├── JobConfig.ts          # TypeScript interfaces for job configuration
│   │   ├── extract-comprehensive/  # Agent 1: Core case metadata
│   │   ├── extract-provisions-2a/  # Agent 2A: Cited legal provisions (2-stage)
│   │   ├── enrich-provisions/      # Agent 2B: Reference metadata (regex only)
│   │   ├── interpret-provisions/   # Agent 2C: Provision interpretation
│   │   ├── extract-cited-decisions/# Agent 3: Cited court precedents (2-stage)
│   │   ├── extract-legal-teachings/# Agent 5: Reusable legal principles
│   │   ├── clean-decision-markdown/# Preprocessing: Markdown cleanup
│   │   ├── extract-keywords/       # Agent 4: Search keywords
│   │   ├── extract-micro-summary/  # Summary extraction
│   │   ├── structure-full-html/    # HTML structure conversion
│   │   └── configs/                # Individual job config re-exports
│   └── utils/                    # Shared utilities
│       ├── logger.ts             # Winston logging
│       ├── validators.ts         # JSON schema validation
│       ├── jobResultLoader.ts    # Loading prior job results
│       ├── testSetLoader.ts      # Test set management (197 decisions)
│       └── referenceExtractorN8N.ts # Regex-based legal reference extraction
│
├── prompts-txts/                 # Prompt definitions (markdown format)
│   ├── AI Agent 1.md             # Extract Comprehensive prompt
│   ├── AI Agent 2A.md            # Provisions Stage 1 (agentic snippets)
│   ├── AI Agent 2B.md            # Provisions Stage 2 (parsing)
│   ├── AI Agent 2C.md            # Provisions enrichment
│   ├── AI Agent 3.md             # Cited Decisions (2-stage)
│   ├── AI Agent 4.md             # Keywords extraction
│   ├── AI Agent 5.md             # Legal Teachings (complex)
│   └── AI Agent 6.md             # Additional extraction
│
├── evals/                        # Evaluation framework
│   ├── cli.ts                    # Evaluation runner
│   ├── judge-prompts/            # LLM-as-a-judge scoring prompts
│   ├── scorers/                  # Evaluation scorers
│   ├── config/                   # Evaluation configurations
│   ├── test-sets/                # Curated test sets (197, 50k, etc.)
│   └── results/                  # Evaluation results & summaries
│
├── input/                        # Generated JSONL files for batch submission
├── output/                       # Downloaded JSONL from Azure batch
├── results/                      # Batch processing results (aggregated JSONs)
├── full-data/                    # Full-data pipeline results (per-decision JSONs)
│   ├── extract-comprehensive/
│   ├── extract-provisions-2a/
│   ├── enrich-provisions/
│   ├── interpret-provisions/
│   ├── extract-cited-decisions/
│   └── extract-legal-teachings/
├── status/                       # Job metadata (one JSON per job)
├── logs/                         # Application logs
├── dist/                         # Compiled TypeScript
├── concurrent/                   # Concurrent processing artifacts
├── package.json                  # NPM dependencies
├── tsconfig.json                 # TypeScript configuration
└── .env                          # Database & API credentials

```

### Key Dependency Chain

```
PostgreSQL (decisions1, decisions_md) 
  ↓
cli.ts (command dispatcher)
  ├── batch mode → BatchJobRunner → (submit/status/process)
  └── concurrent mode → ConcurrentRunner → (direct API)
  
ConcurrentRunner
  ├── loads decisions from DB
  ├── applies preprocessRow transformations
  ├── applies DependencyResolver (cross-job linking)
  ├── executes customExecution or promptTemplate → LLM
  ├── validates against outputSchema
  ├── applies postProcessRow transformations
  └── streams/aggregates results
```

---

## 2. DATABASE SCHEMA & DATA FLOW

### Input Tables (PostgreSQL - READ-ONLY)

**decisions1** (Primary decision metadata)
```
- id (serial)
- decision_id (ECLI code, e.g., ECLI:BE:CASS:2001:ARR.20010131.9)
- language_metadata (FR or NL)
- decision_type_ecli_code (ARR, ORD, RECO, etc.)
- court_ecli_code (CASS, GBAPD, CA*, CT*, etc.)
- decision_date (YYYY-MM-DD)
- [other fields]
```

**decisions_md** (Full markdown text)
```
- decision_id (foreign key to decisions1)
- language (FR or NL)
- full_md (complete markdown text, 2K-120K+ chars)
```

### Data Flow Through Pipeline

```
┌─────────────────────────────────────────────────────────────────┐
│                    Raw Decisions (64k)                          │
│  decisions1 + decisions_md (FR & NL versions per decision)      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
           ┌───────────────┴──────────────────┐
           │                                  │
    ┌──────▼──────────┐              ┌───────▼────────┐
    │  Agent 1 Output │              │  Agent 2a Ouput│
    │  (Structured    │              │  (Cited Legal  │
    │   Case Data)    │              │   Provisions)  │
    └──────┬──────────┘              └───────┬────────┘
           │                                  │
           │                          ┌──────▼──────────┐
           │                          │  Agent 2b Output│
           │                          │  (Enriched with │
           │                          │   References)   │
           │                          └──────┬──────────┘
           │                                  │
           │                          ┌──────▼──────────┐
           │                          │  Agent 2c Output│
           │                          │  (Interpreted   │
           │                          │   Provisions)   │
           │                                  │
           │      ┌────────────────────────┬──┴────┬──────────┐
           │      │                        │       │          │
    ┌──────▼──────────────┐   ┌────────────▼─┐ ┌──▼─────┐ ┌──▼──┐
    │ Agent 3: Cited      │   │Agent 5:      │ │Agent 4:│ │Agent│
    │ Decisions           │   │Legal         │ │Keywords│ │6&7: │
    │ (Precedents)        │   │Teachings     │ │        │ │HTML/│
    │                     │   │(Principles)  │ │        │ │Summ │
    └─────────────────────┘   └──────────────┘ └────────┘ └─────┘
           │                         │
           └──────────┬──────────────┘
                      │
        ┌─────────────▼──────────────┐
        │   Knowledge Graph          │
        │   (Integrated Legal DB)    │
        └────────────────────────────┘
```

---

## 3. PIPELINE STAGES - THE 6+ AGENTS

Each agent targets a specific aspect of case law, with defined inputs/outputs and quality standards.

### STAGE 0: Preprocessing (Optional)

#### clean-decision-markdown (Markdown Cleanup)
- **Purpose**: Fix broken footnote syntax and convert text tables to markdown
- **Input**: Full markdown text with formatting issues
- **Process**: gpt-4.1-mini (temperature=0) for deterministic fixing
- **Output**: Cleaned markdown (same length or slightly shorter)
- **Feature**: Skips documents >120k chars to prevent truncation
- **Status**: In development (working on Stage 2C)

---

### STAGE 1: extract-comprehensive (Core Case Metadata)

**Agent 1 - Comprehensive Extraction**

**Purpose**: Extract all structural case information in single procedural language (monolingual approach)

**Input**:
- Full markdown decision text (2K-120K chars)
- Decision ID (ECLI)
- Procedural language (FR or NL)

**Process**:
- Monolingual extraction (no translation within Agent 1)
- Flexible extraction (verbatim when practical, synthesis when necessary)
- EXCEPT courtOrder which must be strictly verbatim

**Output Schema** (JSON):
```json
{
  "reference": {
    "citationReference": "Formal bibliographic citation"
  },
  "parties": [
    {
      "id": "PARTY-{decisionId}-001",
      "name": "Full party name",
      "type": "NATURAL_PERSON|LEGAL_ENTITY|PUBLIC_AUTHORITY|DE_FACTO_ASSOCIATION|OTHER|UNCLEAR",
      "proceduralRole": "DEMANDEUR|DEFENDEUR|APPELANT|INTIME|..." (FR/NL specific)
    }
  ],
  "currentInstance": {
    "facts": "Complete factual narrative (string)",
    "requests": [{ "partyId": "...", "requests": "Request text" }],
    "arguments": [{ "partyId": "...", "argument": "Arg text", "treatment": "ENUM" }],
    "courtOrder": "VERBATIM dispositif (operative part only)",
    "outcome": "Outcome classification (ENUM)"
  }
}
```

**Configuration**:
- Model: gpt-5-mini (Azure OpenAI)
- Reasoning Effort: MEDIUM
- Concurrency: 300 concurrent requests
- Full-Data Pipeline: TRUE (per-decision JSONs in full-data/extract-comprehensive/)
- Scope: All 64k decisions
- Status: Complete (evaluation score: 98/100+)

---

### STAGE 2A: extract-provisions-2a (Cited Legal Provisions - Stage 1)

**Agent 2A - Agentic Snippet Creation**

**Purpose**: Find EVERY mention of legal provisions cited in decision, synthesizing enriched snippets

**Approach**: Two-stage extraction (Stage 1: snippet creation, Stage 2: parsing)
- Stage 1 achieves 100% RECALL (find all provisions)
- Stage 2 achieves high PRECISION (validate and parse correctly)

**Stage 1 Process**:
- Scans full 2K-120K char markdown
- Finds ALL provision mentions (article 31, artikel 5, etc.)
- Locates parent act context (can be 2000+ chars away)
- Synthesizes enriched snippet combining distant info
- Resolves implicit references ("voormelde artikel")
- Returns plain text list (NOT JSON)

**Stage 2 Process**:
- Parses ONLY enriched snippets (5-10K chars)
- Complex normalization: decimal notation, ranges, lists
- Deduplication (same provision cited multiple times)
- Sequential ordering and expansion
- Returns validated citedProvisions array

**Output Schema** (from Stage 2 parser):
```json
{
  "citedProvisions": [
    {
      "provisionId": null,                    // Reserved for DB mapping
      "parentActId": null,                    // Reserved for DB mapping
      "provisionSequence": 1,                 // Sequential within decision
      "parentActSequence": 1,                 // Parent act ordering
      "internalProvisionId": "ART-{decisionId}-001",
      "internalParentActId": "ACT-{decisionId}-001",
      "provisionNumber": "Art. 31 à 35",      // Verbatim from text
      "provisionNumberKey": "31-35",          // Normalized for matching
      "parentActType": "LOI|ARRETE_ROYAL|CODE|etc.",
      "parentActName": "Law name (FR or NL)",
      "parentActDate": "2001-02-15 or null",
      "parentActNumber": "2001/123 or null"
    }
  ]
}
```

**Configuration**:
- Model: gpt-5-mini (Standard OpenAI)
- Reasoning Effort: MEDIUM
- Concurrency: 300 concurrent requests
- Full-Data Pipeline: TRUE
- Scope: All 64k decisions
- Status: Complete (evaluation score: 99-100/100)

---

### STAGE 2B: enrich-provisions (Provision Reference Enrichment)

**Agent 2B - Regex-Only Enrichment**

**Purpose**: Add reference metadata (CELEX, NUMAC, URLs) to provisions extracted by Agent 2A

**Approach**: Pure regex extraction (zero LLM cost, instant processing)

**Process**:
1. Load citedProvisions array from Agent 2A (10 fields per provision)
2. Use ReferenceExtractorN8N regex engine on full markdown
3. Extract EU references (CELEX codes, europa.eu URLs)
4. Extract Belgian references (NUMAC codes, file numbers, ejustice URLs)
5. Merge and pass through

**Output Schema**:
```json
{
  "citedProvisions": [10 fields from Agent 2A, unchanged],
  "extractedReferences": {
    "url": {
      "eu": ["https://eur-lex.europa.eu/..."],
      "be": ["https://www.ejustice.just.fgov.be/..."]
    },
    "reference": {
      "eu": {
        "extracted": ["CELEX candidates that failed"],
        "verified": ["Valid CELEX codes"]
      },
      "be": {
        "extracted": ["Belgian ref candidates"],
        "verifiedNumac": ["Valid NUMAC codes"],
        "verifiedFileNumber": ["Valid file numbers"]
      }
    }
  }
}
```

**Configuration**:
- Model: gpt-5-mini (no LLM calls!)
- Concurrency: 500 (no rate limits)
- Full-Data Pipeline: TRUE
- Scope: All decisions with successful Agent 2A results
- Status: Complete (evaluation score: 100/100)

---

### STAGE 2C: interpret-provisions (Provision Interpretation)

**Agent 2C - Interpretative Enrichment**

**Purpose**: Add court's interpretation and factual context to each provision

**Dependencies**: Agent 2B output (citedProvisions with 10 fields + metadata)

**Process**:
1. Load Agent 2B data (citedProvisions array)
2. LLM analyzes how court interprets/applies each provision
3. Extracts relevant factual context
4. Preserves all 10 fields from Agent 2A unchanged
5. Merges Agent 2B's extractedReferences back into output

**Output Schema** (12 fields per provision):
```json
{
  "citedProvisions": [
    {
      // 10 fields from Agent 2A (unchanged)
      "provisionId": null,
      "parentActId": null,
      "provisionSequence": 1,
      "parentActSequence": 1,
      "internalProvisionId": "ART-{decisionId}-001",
      "internalParentActId": "ACT-{decisionId}-001",
      "provisionNumber": "Art. 31",
      "provisionNumberKey": "31",
      "parentActType": "LOI",
      "parentActName": "...",
      "parentActDate": "2001-02-15",
      "parentActNumber": "2001/123",
      
      // 2 NEW fields from Agent 2C
      "provisionInterpretation": "How court applies this provision (100-1000 chars, or null)",
      "relevantFactualContext": "Case facts relevant to provision (50-500 chars, or null)"
    }
  ],
  "extractedReferences": { ... } // From Agent 2B (passed through)
}
```

**Configuration**:
- Model: gpt-5-mini
- Reasoning Effort: MEDIUM
- Concurrency: 300
- Full-Data Pipeline: TRUE
- Scope: Decisions with successful Agent 2B results
- Status: In development (working on Stage 2C)

---

### STAGE 3: extract-cited-decisions (Cited Court Precedents)

**Agent 3 - Citation Analysis with Regex + LLM Validation**

**Purpose**: Extract judicial decisions cited in the text (precedents, parallel decisions)

**Approach**: Hybrid regex + LLM (fast extraction + validation)

**Stage 1 - Regex Extraction** (instant, zero cost):
- Scans full markdown for patterns matching court citations
- Extracts court names, dates, case numbers, ECLI codes
- Generates 400-char context snippets around citations
- Returns structured JSON with all extracted fields

**Stage 2 - LLM Validation** (gpt-5-mini MEDIUM):
- Validates regex-extracted JSON
- Fixes parsing errors (date normalization, court name completion)
- Classifies treatment based on context (FOLLOWED, DISTINGUISHED, OVERRULED, CITED, UNCERTAIN)
- Filters false positives (paragraph refs, self-citations)

**Output Schema**:
```json
{
  "citedDecisions": [
    {
      "decisionId": null,                          // Reserved for DB mapping
      "citedCourtName": "Cour d'appel de Mons",   // Verbatim, procedural language
      "citedDecisionDate": "2015-03-15 or null",
      "citedCaseNumber": "2014/1234 or null",
      "citedECLI": "ECLI:BE:CAMONS:2015:ARR.0315 or null",
      "treatmentClassification": "FOLLOWED|DISTINGUISHED|OVERRULED|CITED|UNCERTAIN",
      "jurisdiction": "BE|EU|INT",                // Belgian/EU/International
      "contextSnippet": "400-char excerpt with citation",
      "internalDecisionId": "DEC-{decisionId}-001",
      "decisionSequence": 1
    }
  ]
}
```

**Configuration**:
- Model: gpt-5-mini with MEDIUM reasoning
- Concurrency: High (regex is instant)
- Full-Data Pipeline: TRUE
- Scope: All 64k decisions
- Status: Complete (evaluation score: 98/100)

---

### STAGE 4: extract-keywords (Search Keywords)

**Purpose**: Extract searchable keywords for document retrieval

**Output**: Keywords taxonomy with categorization

**Status**: Complete

---

### STAGE 5: extract-legal-teachings (Reusable Legal Principles)

**Agent 5 - Legal Principle Extraction (Complex)**

**Purpose**: Extract production-ready legal principles with quality gates

**Complexity**: HIGH
- Belgian legal document structure awareness
- 5 quality gates per candidate principle (accuracy, attribution, generalizability, completeness, clarity)
- Dual formulations (generalized text + court verbatim)
- Hierarchical relationship mapping (parent-child, rule-exception, conflicts)
- Precedential weight assessment (6 dimensions)

**Output Schema** (11 required fields per teaching):
```json
{
  "legalTeachings": [
    {
      "teachingId": "TEACH-{decisionId}-001",
      
      // DUAL TEXT FORMULATIONS
      "text": "Generalized principle (100-1000 chars, procedural language)",
      "courtVerbatim": "Court's exact words from reasoning section (100-2000 chars)",
      "courtVerbatimLanguage": "FR|NL",
      
      // DUAL FACTUAL CONTEXT
      "factualTrigger": "Abstract conditions when principle applies (50-300 chars)",
      "relevantFactualContext": "Specific facts of this case (50-500 chars)",
      
      // CATEGORIZATION
      "principleType": "INTERPRETATION_RULE|APPLICATION_STANDARD|LEGAL_TEST|BURDEN_PROOF|BALANCING_TEST|PROCEDURAL_RULE|REMEDIAL_PRINCIPLE",
      "legalArea": "DISCRIMINATION_LAW|DATA_PROTECTION|EMPLOYMENT_LAW|CONTRACT_LAW|etc.",
      
      // HIERARCHICAL RELATIONSHIPS
      "hierarchicalRelationships": {
        "refinesParentPrinciple": "TEACH-...001 or null",
        "refinedByChildPrinciples": ["TEACH-...001", ...],
        "exceptionToPrinciple": "TEACH-...001 or null",
        "exceptedByPrinciples": ["TEACH-...001", ...],
        "conflictsWith": ["TEACH-...001", ...]
      },
      
      // PRECEDENTIAL WEIGHT
      "precedentialWeight": {
        "courtLevel": "CASSATION|APPEAL|FIRST_INSTANCE",
        "binding": true,
        "clarity": "EXPLICIT|IMPLICIT",
        "novelPrinciple": true,
        "confirmsExistingDoctrine": false,
        "distinguishesPriorCase": false
      },
      
      // RELATIONSHIPS TO OTHER MATERIALS
      "relatedLegalIssuesId": [],             // MUST be empty array
      "relatedCitedProvisionsId": [],         // (empty since standalone)
      "relatedCitedDecisionsId": [],          // (empty since standalone)
      
      // SOURCE ATTRIBUTION
      "sourceAuthor": "AI_GENERATED"
    }
  ],
  "metadata": {
    "totalTeachings": 5,
    "teachingTypes": { ... },
    "hierarchicalRelationships": { ... },
    "courtLevelDistribution": { ... },
    "validationChecks": { ... }
  }
}
```

**Configuration**:
- Model: gpt-5 (full model, not mini)
- Reasoning Effort: HIGH
- Concurrency: 150 (complex reasoning intensive)
- Full-Data Pipeline: FALSE (test set only, 197 decisions)
- Scope: 197-decision curated test set
- Status: In active development (scoring methodology being refined)

---

### STAGE 6: structure-full-html (HTML Structuring)

**Purpose**: Convert markdown to structured HTML

**Status**: In development

---

## 4. HOW JOBS ARE CONFIGURED & EXECUTED

### JobConfig Interface (Key Fields)

Every extraction job implements JobConfig with these key sections:

```typescript
interface JobConfig {
  // Identification
  id: string;                           // e.g., "extract-provisions-2a"
  description: string;
  
  // Data Source
  dbQuery: string;                      // SELECT query only (enforced read-only)
  dbQueryParams?: any[];                // Parameters for parameterized queries
  
  // Data Preparation
  preprocessRow?: (row: any) => Promise<any>;  // Enrich/transform before LLM
  rowMetadataFields?: string[];          // Fields to include in output metadata
  dependencies?: JobDependency[];        // Cross-job data linking
  
  // Prompt & Execution
  promptTemplate?: (row: any) => string;         // Generate prompt from row
  customExecution?: (row, client) => Promise<any>;  // Custom multi-stage logic
  
  // Validation
  outputSchema: object;                  // JSON Schema for validation
  outputSchemaName?: string;             // Schema name for structured outputs
  
  // Post-Processing
  postProcessRow?: (row, result) => any | Promise<any>;
  
  // Model Configuration
  provider?: 'azure' | 'openai' | 'anthropic';
  model?: string;                        // Model or deployment name
  maxCompletionTokens?: number;
  temperature?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  
  // Execution Options
  concurrencyLimit?: number;             // Default: 200
  useFullDataPipeline?: boolean;         // Streaming or aggregated results
}
```

### Job Configuration Files

Located in `/src/jobs/configs/` and `/src/jobs/<job-name>/config.ts`:

**Example: extract-provisions-2a/config.ts**
- 300 lines
- Defines two-stage execution via `customExecution`
- Sets full-data pipeline mode
- Specifies composite key matching for dependencies
- Validates against schema with 10 required fields per provision

### Execution Flow

#### Batch Mode (Azure OpenAI Batch API)

```
1. npm run dev submit <job-type>
   ├─ Load JobConfig
   ├─ Execute dbQuery against PostgreSQL
   ├─ For each row: generate prompt via promptTemplate()
   ├─ Create JSONL file (input/<job>-<timestamp>.jsonl)
   ├─ Upload to Azure OpenAI
   ├─ Submit batch job
   └─ Save status to status/<job>.json

2. npm run dev status <job-type>
   ├─ Load status metadata
   ├─ Poll Azure Batch API
   ├─ Update status (validating → in_progress → finalizing → completed)
   └─ Display progress

3. npm run dev process <job-type>
   ├─ Download output JSONL from Azure
   ├─ Parse each response
   ├─ Validate against outputSchema (AJV)
   ├─ Save results/ directory with:
   │  ├─ all-results.json
   │  ├─ successful-results.json
   │  ├─ extracted-data.json
   │  ├─ failures.json
   │  └─ summary.json
   └─ Display metrics (success rate, token usage)
```

#### Concurrent Mode (Direct API Calls - NEW PRIMARY MODE)

```
1. npm run dev concurrent <job-type>
   ├─ Load JobConfig
   ├─ Execute dbQuery against PostgreSQL
   │
   ├─ For each row (with concurrency control):
   │  ├─ Apply preprocessRow transformation
   │  ├─ Apply DependencyResolver (load prior job results if configured)
   │  │
   │  ├─ Option A: Execute promptTemplate → LLM → parse
   │  │           (simple extraction jobs)
   │  │
   │  ├─ Option B: Call customExecution(row, client)
   │  │           (two-stage jobs, conditional logic)
   │  │
   │  ├─ Validate result against outputSchema
   │  ├─ Apply postProcessRow transformation
   │  │
   │  └─ Stream Result to:
   │     ├─ IF useFullDataPipeline=true:
   │     │   └─ Write to full-data/<job>/<timestamp>/jsons/<decision_id>_<language>.json
   │     └─ IF useFullDataPipeline=false:
   │         └─ Aggregate in memory
   │
   └─ Final output:
      ├─ IF useFullDataPipeline=true:
      │   ├─ concurrent/results/<job>/<model>/<timestamp>/
      │   │  ├─ summary.json (quick overview)
      │   │  └─ failures.json (errors only)
      │   └─ full-data/<job>/<timestamp>/
      │      ├─ jsons/ (64k individual JSONs)
      │      ├─ summary.json
      │      └─ failures.json
      │
      └─ IF useFullDataPipeline=false:
          └─ concurrent/results/<job>/<model>/<timestamp>/
             ├─ extracted-data.json (clean outputs)
             ├─ successful-results.json (with metadata)
             ├─ failures.json
             └─ summary.json
```

### Dependency Resolution

JobConfig supports cross-job data linking via DependencyResolver:

```typescript
// Example: Agent 2C depends on Agent 2B
dependencies: [
  {
    jobId: 'enrich-provisions',     // Agent 2B job
    alias: 'agent2b',               // Field name on row
    required: false,                // Skip if missing
    source: 'concurrent',           // Load from concurrent/results/
    matchOn: [                       // Composite key matching
      { row: 'decision_id', dependency: 'decision_id' },
      { row: 'language_metadata', dependency: 'language' }
    ]
  }
]
```

**Loading Process**:
1. After preprocessRow, before promptTemplate
2. For each dependency, locate results directory
3. Build cache index from extracted-data.json or full-data/ directory
4. Match current row to dependency result using matchOn fields
5. Attach resolved data to row (under alias)
6. Available in promptTemplate and postProcessRow

---

## 5. FULL-DATA PIPELINE (NEW FEATURE)

### Problem Solved

Large extraction jobs (64k decisions × gpt-5-mini) can take 2-8 hours. If one fails 90% through:
- Batch mode: Start over from scratch
- Concurrent mode (old): All results in memory lost on crash

### Solution: Full-Data Pipeline

**When useFullDataPipeline = true**:

```
concurrent/results/<job>/<model>/<timestamp>/
├── summary.json                        # Quick overview
└── failures.json                       # Error details

full-data/<job>/<timestamp>/
├── jsons/                              # Individual decision results
│   ├── ECLI:BE:CASS:2001:ARR.001_FR.json
│   ├── ECLI:BE:CASS:2001:ARR.001_NL.json
│   ├── ECLI:BE:GBAPD:2015:ARR.200_FR.json
│   └── ... (one per decision + language)
│
├── summary.json                        # Aggregate statistics
└── failures.json                       # All failures with metadata
```

**Benefits**:
- Incremental persistence (results written as completed)
- Fault tolerance (restart from failure point)
- Memory efficiency (streaming rather than buffering 64k decisions)
- Traceability (see exactly which decision produced which result)

**Configuration**:
```typescript
useFullDataPipeline: true,        // Enable full-data mode
concurrencyLimit: 300,            // Process 300 in parallel
```

### Filename Format

Decision files are named: `{ECLI_CODE_WITH_COLONS_AS_SLASHES}_{LANGUAGE}.json`

Example:
- `ECLI:BE:CASS:2001:ARR.001_FR.json`
- Readable from filename: ECLI code + language
- Can parse from file content: `data.decision_id` + `data.language`

---

## 6. DEPENDENCY SYSTEM (CROSS-JOB LINKING)

### Problem

Different agents process the same decisions:
- Agent 1 extracts case metadata
- Agent 2A extracts provisions
- Agent 3 extracts cited decisions
- Agent 5 extracts legal teachings

**Challenge**: How to link them together?

### Solution: Composite Key Matching

Use (decision_id, language) as composite primary key across all jobs.

### Example Flow

```
Agent 2A Output:
  full-data/extract-provisions-2a/2025-11-10T14-30-00-000Z/jsons/
    ECLI:BE:CASS:2001:ARR.001_FR.json
    {
      "decision_id": "ECLI:BE:CASS:2001:ARR.001",
      "language": "FR",
      "citedProvisions": [
        { "provisionId": null, "internalProvisionId": "ART-ECLI:BE:CASS:2001:ARR.001-001", ... },
        { "provisionId": null, "internalProvisionId": "ART-ECLI:BE:CASS:2001:ARR.001-002", ... }
      ]
    }

Agent 2C Dependency Resolution:
  1. Load Agent 2B config (enrich-provisions)
  2. Locate latest full-data results: full-data/enrich-provisions/{timestamp}/jsons/
  3. Build filepath map: key = "ECLI:BE:CASS:2001:ARR.001||FR" → filepath
  4. When processing ECLI:BE:CASS:2001:ARR.001 (FR):
     ├─ Extract (decision_id, language) from row
     ├─ Look up in map: "ECLI:BE:CASS:2001:ARR.001||FR"
     ├─ Read Agent 2B JSON file
     ├─ Attach citedProvisions to row.agent2b.citedProvisions
     └─ Use in Agent 2C LLM prompt

Agent 2C Output:
  Same 2B data + new interpretation fields merged
  {
    "citedProvisions": [
      { 
        ...fields from 2A...,
        "provisionInterpretation": "How court interprets...",
        "relevantFactualContext": "Case facts..."
      }
    ],
    "extractedReferences": { ... }  # From 2B
  }
```

---

## 7. QUALITY VALIDATION & EVALUATION FRAMEWORK

### JSON Schema Validation

Every LLM output validated immediately against outputSchema using **AJV** (JSON Schema validator):

```typescript
// Example: provisions must have 10+ required fields
outputSchema: {
  type: "object",
  required: ["citedProvisions"],
  additionalProperties: false,
  properties: {
    citedProvisions: {
      type: "array",
      items: {
        type: "object",
        required: [
          "provisionNumber",
          "provisionNumberKey",
          "parentActType",
          "parentActName",
          "internalProvisionId",
          // ... 5 more required fields
        ],
        properties: { ... }
      }
    }
  }
}
```

**Validation Flow**:
```
1. Parse LLM response
2. Validate against schema
3. IF valid → Add to successful-results.json
4. IF invalid → Add to failures.json with error details
```

### Test Set Evaluation

**197-Decision Curated Test Set** (`evals/test-sets/comprehensive-197.csv`)

Stratified by:
- Language (FR: ~100, NL: ~97)
- Decision type (ARR, ORD, RECO)
- Court level (CASS, Appeal, First Instance)
- Content length (short, medium, long, very_long)

**Evaluation Methodology** (LLM-as-a-Judge):
```
evals/judge-prompts/
├── llm-as-a-judge_STAGE 1.md      # Comprehensive extraction evaluation
├── llm-as-a-judge_STAGE 2A.md     # Provisions extraction
├── llm-as-a-judge_STAGE 2C.md     # Provision interpretation
├── llm-as-a-judge_STAGE 3.md      # Cited decisions
├── llm-as-a-judge_STAGE 5.md      # Legal teachings
└── ... (other stages)

Scoring Dimensions:
├─ Completeness (all items found?)
├─ Accuracy (correct extraction?)
├─ Relevance (important items?)
├─ Clarity (proper formatting?)
└─ Consistency (same approach throughout?)

Score Range: 0-100 (LLM judges each output)
```

**Recent Results**:
- Agent 1 (extract-comprehensive): 98/100
- Agent 2A (provisions): 99-100/100
- Agent 2B (enrich-provisions): 100/100
- Agent 3 (cited decisions): 98/100
- Agent 2C (interpret-provisions): In development

---

## 8. DATABASE SCHEMA DETAILS

### decisions1 Table

```sql
CREATE TABLE decisions1 (
  id SERIAL PRIMARY KEY,
  decision_id VARCHAR(255) UNIQUE,        -- ECLI code
  language_metadata VARCHAR(2),            -- 'FR' or 'NL'
  decision_type_ecli_code VARCHAR(10),    -- 'ARR', 'ORD', 'RECO'
  court_ecli_code VARCHAR(10),            -- 'CASS', 'GBAPD', etc.
  decision_date DATE,
  official_url TEXT,
  ... other fields
);
```

### decisions_md Table

```sql
CREATE TABLE decisions_md (
  id SERIAL PRIMARY KEY,
  decision_id VARCHAR(255),                -- FK to decisions1
  language VARCHAR(2),                     -- 'FR' or 'NL'
  full_md BYTEA,                           -- Full markdown text
  md_length INTEGER,                       -- Character count
  ... other fields
);
```

### Result Structure (Output)

**Batch Results** (`results/<job>/<timestamp>/`):
```
all-results.json
├─ success: true/false
├─ status: "completed"
├─ totalProcessed: 1234
├─ results: [
│   {
│     "request_id": "extract-parties-001",
│     "status": 200,
│     "result": { ... LLM output ... },
│     "validationPassed": true
│   }
│ ]

successful-results.json
├─ results: [ ... (validation passed only) ... ]
├─ totalSuccessful: 1234
├─ totalFailed: 0

extracted-data.json
├─ Array of just the extracted data (no metadata)
├─ Used for dependency resolution

failures.json
├─ results: [ ... (validation failed only) ... ]
├─ errors: [ error details ... ]

summary.json
├─ totalRecords: 1234
├─ successful: 1234
├─ failed: 0
├─ successRate: "100%"
├─ avgTokensPerRequest: 245
├─ estimatedCost: "$12.34"
```

---

## 9. MODEL SELECTION & REASONING EFFORT

### Model Tiers

**Standard OpenAI**:
- gpt-5 (full reasoning model, highest cost, best quality)
- gpt-5-mini (faster reasoning model, lower cost)
- gpt-4.1-mini (lightweight, for simple cleaning tasks)

**Azure OpenAI** (same models as standard, deployed):
- o4-mini (reasoning model, enterprise)
- gpt-4o (standard, enterprise)

**Claude** (Anthropic):
- claude-opus-4.1 (highest reasoning)
- claude-haiku-4.5 (lightweight)

### Reasoning Effort Configuration

```typescript
// Disabled for models without reasoning
temperature: 0.0,           // Deterministic extraction

// For reasoning models only
reasoningEffort: 'low' | 'medium' | 'high',
// low: 50k reasoning tokens per request
// medium: 200k reasoning tokens per request
// high: 400k+ reasoning tokens per request

// Verbosity (gpt-5 reasoning models)
verbosity: 'minimal' | 'low' | 'medium' | 'high'
```

### Job-Specific Choices

| Agent | Complexity | Model | Effort | Justification |
|-------|-----------|-------|--------|---------------|
| 1 (Comprehensive) | HIGH | gpt-5-mini | MEDIUM | Structural extraction needs reasoning |
| 2A (Provisions Stage 1) | HIGH | gpt-5-mini | MEDIUM | Find ALL mentions (100% recall) |
| 2B (Enrich) | NONE | - | - | Regex only, no LLM |
| 2C (Interpret) | MEDIUM | gpt-5-mini | MEDIUM | Parse snippets + reasoning |
| 3 (Cited Decisions) | MEDIUM | gpt-5-mini | MEDIUM | Classification + validation |
| 4 (Keywords) | LOW | gpt-4.1-mini | - | Simple categorization |
| 5 (Legal Teachings) | VERY HIGH | gpt-5 | HIGH | Quality gates, hierarchies, verbatim |

---

## 10. PROMPT ENGINEERING STRATEGY

### Location & Format

All prompts stored as **markdown files** in `prompts-txts/`:

```
prompts-txts/
├── AI Agent 1.md          # export const COMPREHENSIVE_PROMPT = `...`
├── AI Agent 2A.md         # export const STAGE_1_AGENTIC_SNIPPETS_PROMPT = `...`
├── AI Agent 2B.md         # (regex, no prompt needed)
├── AI Agent 2C.md         # export const INTERPRET_PROVISIONS_PROMPT = `...`
├── AI Agent 3.md          # Two-stage prompts for extraction + validation
├── AI Agent 4.md
├── AI Agent 5.md          # Complex prompt with detailed quality gates
└── AI Agent 6.md
```

### Template Variables

Prompts use `{variable}` substitution (NOT `${variable}`):

```typescript
// In promptTemplate function:
COMPREHENSIVE_PROMPT
  .replace("{decisionId}", row.decision_id || "")
  .replace("{proceduralLanguage}", row.language_metadata || "FR")
  .replace("{fullText.markdown}", row.full_md || "")
```

### Prompt Design Principles

1. **Role Definition**: Clear what the AI is doing
2. **Input Specification**: Exactly what data will be provided
3. **Output Schema**: JSON structure expected
4. **Critical Requirements**: Language handling, extraction philosophy
5. **Field Specifications**: Detailed rules for each field
6. **Examples**: Real examples from case law
7. **Quality Gates**: Validation rules (for complex tasks)
8. **Enum Values**: Explicit list of allowed values (bilingual for Belgian law)

### Language Handling Strategy

**Bilingual Enums**:
```
"proceduralRole": "DEMANDEUR|DEFENDEUR|APPELANT|INTIME|..." (FR)
  vs.
"proceduralRole": "EISSER|VERWEERDER|APPELLANT|VERWEERDER IN CASSATIE|..." (NL)

Same enum name, different values based on procedural language
```

**No Translation Within Agents**:
- Agent 1 extracts in FR or NL (same as decision)
- Translation deferred to downstream workflow
- Preserves legal accuracy (terminology can't be freely translated)

---

## 11. CONCURRENT PROCESSING ENGINE

### ConcurrentRunner Architecture

```typescript
class ConcurrentRunner {
  // Main orchestration
  async run(): Promise<void>
    → loadDecisions()
    → setupStreaming() [if useFullDataPipeline]
    → executeConcurrent()
    → processResults()
    → displaySummary()

  // Load decisions from database
  async loadDecisions(): Promise<DecisionRow[]>

  // Process all decisions with controlled concurrency
  async executeConcurrent(
    decisions: DecisionRow[],
    streamingCallback?: ResultCallback
  ): Promise<ProcessedResult[]>
    → Uses p-limit for concurrency control
    → For each decision:
        ├─ Apply preprocessRow
        ├─ Load dependencies via DependencyResolver
        ├─ Execute customExecution or promptTemplate → LLM
        ├─ Validate against outputSchema
        ├─ Apply postProcessRow
        ├─ Stream to callback (if enabled)
        └─ Collect results

  // Handle streaming to full-data directory
  async createStreamingCallback(): Promise<ResultCallback>
    → Opens write stream to full-data/<job>/<timestamp>/jsons/
    → For each result: write <decision_id>_<language>.json
    → Track failures separately
    → Flush after each result (durability)
}
```

### OpenAIConcurrentClient vs ClaudeConcurrentClient

Both implement same `ConcurrentClient` interface:

```typescript
interface ConcurrentClient {
  complete(
    messages: Message[],
    responseFormat: ResponseFormat,
    settings: CompletionSettings
  ): Promise<Completion>
}
```

**OpenAIConcurrentClient**:
- Uses standard OpenAI SDK
- Supports gpt-5, gpt-5-mini, gpt-4.1-mini
- Supports reasoning_effort parameter
- Can use Azure OpenAI deployment

**ClaudeConcurrentClient**:
- Uses Anthropic SDK
- Supports claude-opus-4.1, claude-haiku-4.5
- Uses thinking tokens for reasoning
- Uses extended thinking budget

---

## 12. ERROR HANDLING & LOGGING

### Winston Logger

```typescript
logger.info(message, metadata?)      // Informational
logger.warn(message, metadata?)      // Warnings
logger.error(message, metadata?)     // Errors
```

**Log Output**:
- Console: Colored, formatted output
- logs/combined.log: All logs
- logs/error.log: Errors only

### Result Logging

Every result tracked:
```
{
  custom_id: "extract-parties-001",
  status: "success" | "validation_failed" | "api_error",
  error?: { message, code, details },
  validationError?: { path, keyword, message },
  result?: { ... }
}
```

### Failure Categories

**API Errors** (network, rate limit, timeout):
```json
{
  "custom_id": "extract-parties-001",
  "status": "api_error",
  "error": {
    "type": "rate_limit_exceeded",
    "message": "429 Too Many Requests",
    "retryAfter": 60
  }
}
```

**Validation Errors** (schema mismatch):
```json
{
  "custom_id": "extract-parties-001",
  "status": "validation_failed",
  "error": {
    "type": "schema_validation",
    "keyword": "required",
    "dataPath": ".parties[0]",
    "message": "must have required property 'id'"
  }
}
```

**Parsing Errors** (invalid JSON response):
```json
{
  "custom_id": "extract-parties-001",
  "status": "parsing_error",
  "error": {
    "type": "json_parse",
    "message": "Unexpected token < in JSON at position 0"
  }
}
```

---

## 13. CONFIGURATION MANAGEMENT

### Environment Variables (.env)

```bash
# PostgreSQL (READ-ONLY)
PGHOST=13.39.114.68
PGUSER=postgres
PGPASSWORD=***
PGDATABASE=postgres
PGPORT=5433

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://shacharsopenai.openai.azure.com/
AZURE_OPENAI_API_KEY=***
AZURE_OPENAI_DEPLOYMENT=o4-mini
AZURE_API_VERSION=2024-11-20

# Standard OpenAI
OPENAI_API_KEY=***

# Anthropic (Claude)
ANTHROPIC_API_KEY=***

# Logging
LOG_LEVEL=info
```

### Job-Level Configuration

JobConfig interface allows per-job overrides:

```typescript
// Job uses different provider
provider: 'anthropic',

// Job uses different model
model: 'claude-opus-4.1',

// Job uses different concurrency
concurrencyLimit: 500,

// Job uses different reasoning effort
reasoningEffort: 'high',

// Job uses full-data pipeline
useFullDataPipeline: true
```

---

## 14. TESTING & EVALUATION WORKFLOW

### Manual Testing

```bash
# Test single decision processing
npm run test-decision

# Test Agent 1 only
npm run dev concurrent extract-comprehensive

# Test with 197-decision test set
npm run dev concurrent clean-decision-markdown
```

### Evaluation Pipeline

```bash
# Run evaluation suite
npm run eval <job-type> <model> <test-set>

# Examples:
npm run eval extract-provisions-2a gpt-5-mini-medium 197
npm run eval extract-cited-decisions gpt-5-mini-medium 197

# Analyze results
npm run analyze-results
```

**Evaluation Output** (`evals/results/<job>/<model>/`):
```
├── evaluations.json       # Detailed scores per decision
├── summary.json           # Aggregate metrics
├── failures.json          # Failed decisions
├── reviews.json           # Qualitative feedback
└── metadata.json          # Test configuration
```

### Metrics Tracked

Per evaluation:
- Completeness Score (0-100)
- Accuracy Score (0-100)
- Relevance Score (0-100)
- Clarity Score (0-100)
- Consistency Score (0-100)
- Overall Score (average)
- Failure Rate (%)
- Token Efficiency (tokens/decision)

---

## 15. KEY INSIGHTS & ARCHITECTURAL DECISIONS

### 1. Two-Stage Extraction for High-Complexity Tasks

**Why Two Stages?**
- Stage 1 (Agentic Snippets): LLM works on full 80K-char decision
  - Large context window allows finding everything
  - Natural language output (snippets) easier to generate than perfect JSON
  - Can resolve distant references ("voormelde artikel" from 2000+ chars earlier)

- Stage 2 (Deterministic Parsing): LLM works on 5-10K-char snippets only
  - Clearer input format (pre-extracted snippets vs raw decision)
  - Complex parsing rules (ranges, deduplication, sequencing)
  - 8-16x smaller context → better precision

**Result**: 99-100/100 accuracy (vs ~85/100 single-stage)

### 2. Regex-Only for Low-Complexity Tasks (Agent 2B)

**Why Regex for Reference Extraction?**
- CELEX codes follow rigid patterns (CELEX:32019L0790)
- NUMAC codes follow rigid patterns (2020-12-10)
- URLs have specific formats (europa.eu, ejustice)
- Zero cost (no API calls)
- Instant (no rate limits)
- 100% deterministic (no LLM variability)

**Result**: Can process all 64k decisions in seconds

### 3. Composite Key Matching for Bilingual Data

**Why Composite Key?**
- Each decision has FR and NL versions
- Different text, different extractions, different teachings
- Must link them properly (decision_id alone is insufficient)
- Use (decision_id, language) as primary key throughout

**Implementation**:
- Filename: `ECLI:BE:CASS:2001:ARR.001_FR.json`
- Filepath map: `"ECLI:BE:CASS:2001:ARR.001||FR" → "/path/to/json"`
- Query parameter: Array of IDs + array of languages (unnest)

### 4. Full-Data Pipeline for 64K-Decision Datasets

**Why Full-Data?**
- Processing 64k decisions takes 2-8 hours
- In-memory aggregation: all results lost on crash
- Full-data: incremental persistence, resume capability

**Cost**:
- ~65k individual JSON files (one per decision+language)
- Directory structure: full-data/<job>/<timestamp>/jsons/
- 2-3x more disk I/O than batch mode
- Worth it for fault tolerance

### 5. DependencyResolver for Cross-Agent Linking

**Why Not Merge Results?**
- Agents run independently at different times
- Agent 2A might complete while Agent 2C is running
- Need to load Agent 2B results without waiting

**Implementation**:
1. Build filepath map at job startup
2. Match row to dependency using composite key
3. Lazy-load JSON on demand
4. Cache in memory (Map<string, any>)
5. Available in promptTemplate

### 6. Bilingual Enum Values vs Translation

**Why Keep Content in Original Language?**
- Legal terminology doesn't translate perfectly
- "DEMANDEUR" ≠ "plaintiff" in all contexts
- Belgian law uses specific language conventions
- Translation deferred to separate workflow

**How**: Enum values support both FR and NL
- Same enum name: "proceduralRole"
- FR values: DEMANDEUR, DEFENDEUR, APPELANT, INTIME
- NL values: EISSER, VERWEERDER, APPELLANT, VERWEERDER IN CASSATIE

### 7. JSON Schema Validation over Post-Processing

**Why Schema Validation?**
- Immediate feedback on LLM quality
- Traceable failure reasons (which field failed?)
- Automated categorization (validation passed vs failed)
- Used for evaluation metrics

**Implementation**: AJV (JSON Schema validator)
- Fast (~1ms per result)
- Detailed error reporting
- Supports complex nested schemas

---

## 16. DEVELOPMENT PROGRESSION (Git History)

Based on recent commits, the system evolved through stages:

```
Phase 1: Core Infrastructure
├─ Azure Batch API foundation
├─ JobConfig interface design
└─ PostgreSQL read-only connection

Phase 2: Single-Agent Extraction
├─ Agent 1: extract-comprehensive (case metadata)
├─ Agent 4: extract-keywords
└─ Evaluation framework setup

Phase 3: Multi-Stage Agents
├─ Agent 2A: two-stage provision extraction (99/100)
├─ Agent 2B: regex-only enrichment (100/100)
├─ Agent 3: two-stage cited decisions (98/100)
└─ Concurrent processing mode added

Phase 4: Dependent Agents
├─ Agent 2C: interpret-provisions (in development)
├─ DependencyResolver implementation
├─ Full-data pipeline for 64k decisions
└─ Language-aware composite key matching

Phase 5: Advanced Extraction
├─ Agent 5: legal teachings (complex principles)
├─ LLM-as-a-judge evaluation framework
├─ Markdown cleaning (Agent 0)
└─ HTML structuring (Agent 6)

Current Phase: Production Optimization
├─ Score optimizations (targeting 98+/100)
├─ Full dataset processing (64k decisions)
├─ Cross-agent dependency stability
└─ Cost efficiency improvements
```

**Recent Milestones**:
- ✅ extract-comprehensive: 98/100
- ✅ extract-provisions-2a: 99-100/100
- ✅ enrich-provisions: 100/100 (regex)
- ✅ extract-cited-decisions: 98/100
- 🔄 interpret-provisions-2c: In development
- 🔄 extract-legal-teachings: Quality gate refinement

---

## 17. COMMAND REFERENCE

### Batch Mode (Azure OpenAI Batch API)

```bash
# List all jobs
npm run dev list

# Submit a batch job
npm run dev submit extract-comprehensive
npm run dev submit extract-comprehensive --wait    # Wait for completion

# Check job status
npm run dev status extract-comprehensive

# Process completed results
npm run dev process extract-comprehensive

# Test connections
npm run dev test-connections
```

### Concurrent Mode (NEW - Direct API)

```bash
# Process concurrently with streaming
npm run dev concurrent extract-comprehensive

# With custom concurrency
npm run dev concurrent extract-provisions-2a --concurrency 500

# Evaluate on test set
npm run eval extract-provisions-2a gpt-5-mini-medium

# Analyze results
npm run analyze-results
```

### Development

```bash
# Build TypeScript
npm run build

# Type checking
npm run type-check

# Linting
npm run lint

# Debug single decision
npm run test-decision

# Analyze cited provisions
npm run analyze:citations
```

---

## CONCLUSION

This is a **production-grade legal data extraction system** with:

- **Modular Design**: 6+ independent agents, each with clear input/output
- **Quality-First**: JSON schema validation, test-set evaluation, reasoning models
- **Scalability**: Full-data pipeline for 64k decision processing
- **Fault Tolerance**: Incremental persistence, dependency resolution, error categorization
- **Flexibility**: Supports multiple providers (Azure, OpenAI, Claude), models, and reasoning levels
- **Traceability**: Comprehensive logging, per-decision JSONs, detailed failure analysis

The system represents months of iterative refinement toward production-quality extraction (98-100/100 evaluation scores) of Belgian case law knowledge across two languages.

