# System Architecture - Visual Overview

## High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         BELGIUM CASE LAW EXTRACTION PIPELINE                 │
│                                                                              │
│  Processing: 64,000 Belgian Court Decisions (French & Dutch)                │
│  Quality Target: 98-100/100 evaluation scores                               │
│  Processing Mode: Concurrent API calls with full-data streaming             │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                           DATA SOURCE LAYER                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   PostgreSQL (READ-ONLY)                                                  │
│   ├── decisions1                    (Metadata: ECLI, language, court)     │
│   └── decisions_md                  (Full markdown text: 2K-120K chars)   │
│                                                                             │
│   Characteristics:                                                          │
│   • 64,000 decisions total                                                 │
│   • Each decision has FR and NL versions (composite key)                   │
│   • Markdown stored verbatim (formatting preserved)                        │
│   • Language-specific metadata (court codes, decision types)               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ORCHESTRATION LAYER                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   CLI Entry Point (src/cli.ts)                                            │
│   ├── Command Router                                                       │
│   │   ├── submit      (Batch API mode - legacy)                           │
│   │   ├── status      (Check Azure Batch status)                          │
│   │   ├── process     (Download & validate results)                       │
│   │   ├── concurrent  (Direct API mode - new primary)                     │
│   │   ├── list        (Show all job statuses)                             │
│   │   └── eval        (Run evaluation suite)                              │
│   │                                                                         │
│   Job Loading                                                              │
│   └── loadJobConfig(jobType) → JobConfig interface                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    │                               │
                    ▼                               ▼
┌──────────────────────────────┐    ┌──────────────────────────────────────┐
│    BATCH MODE (Legacy)       │    │  CONCURRENT MODE (New Primary)      │
│    Azure Batch API           │    │  Direct LLM API Calls              │
├──────────────────────────────┤    ├──────────────────────────────────────┤
│ 1. Generate JSONL            │    │ 1. Load decisions from DB          │
│ 2. Upload to Azure           │    │ 2. Setup streaming callback        │
│ 3. Submit batch job          │    │ 3. Process with controlled concurr.│
│ 4. Poll for completion       │    │ 4. Stream to full-data/jsons/      │
│ 5. Download results          │    │ 5. Aggregate summary.json         │
│ 6. Validate & aggregate      │    │ 6. Display metrics                 │
│                              │    │                                     │
│ Pros:                        │    │ Pros:                              │
│ - Cost efficient (50% off)   │    │ - Real-time streaming             │
│ - Handles 100K+ requests     │    │ - Fault tolerant (resume)         │
│                              │    │ - Per-decision tracking            │
│ Cons:                        │    │ - Dependency resolution            │
│ - Long completion (24h max)  │    │                                     │
│ - All-or-nothing results     │    │ Cons:                              │
│ - No in-progress tracking    │    │ - Rate-limited by provider         │
│                              │    │ - Higher per-token cost            │
└──────────────────────────────┘    └──────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         CONCURRENT RUNNER LAYER                             │
├─────────────────────────────────────────────────────────────────────────────┤
│  (This is the heart of the new system)                                      │
│                                                                             │
│   ConcurrentRunner (src/concurrent/ConcurrentRunner.ts)                    │
│   ├── loadDecisions()              Load from PostgreSQL                    │
│   │   └── SELECT from decisions1 + decisions_md                            │
│   │                                                                         │
│   ├── setupStreaming()             Create output directory structure      │
│   │   └── full-data/<job>/<timestamp>/jsons/                              │
│   │                                                                         │
│   └── executeConcurrent()          Process with concurrency control       │
│       │                                                                     │
│       └─→ For each decision (300 concurrent):                              │
│           │                                                                 │
│           ├─ 1. preprocessRow()                                            │
│           │     └── Transform/enrich database row                         │
│           │                                                                 │
│           ├─ 2. DependencyResolver                                        │
│           │     ├── Load results from prior agent                         │
│           │     ├── Match by composite key (decision_id + language)       │
│           │     └── Attach to row.agent2b, row.agent3, etc.              │
│           │                                                                 │
│           ├─ 3. LLM Execution                                             │
│           │     ├── Option A: promptTemplate → LLM → parse               │
│           │     │             (simple jobs)                               │
│           │     │                                                          │
│           │     └── Option B: customExecution(row, client)               │
│           │                  (two-stage jobs)                             │
│           │                                                                 │
│           ├─ 4. outputSchema Validation                                   │
│           │     └── AJV JSON Schema validator                             │
│           │         ├── Type checking                                      │
│           │         ├── Required fields                                    │
│           │         └── Pattern matching                                   │
│           │                                                                 │
│           ├─ 5. postProcessRow()                                          │
│           │     └── Final transformations                                  │
│           │                                                                 │
│           └─ 6. Stream Result                                             │
│               ├── IF useFullDataPipeline = true:                          │
│               │   └─ Write to full-data/<job>/<ts>/jsons/<id>_<lang>.json│
│               │                                                             │
│               └── IF useFullDataPipeline = false:                         │
│                   └─ Aggregate in memory                                   │
│                                                                             │
│   ConcurrentProcessor (src/concurrent/ConcurrentProcessor.ts)             │
│   ├── Handles result streaming                                             │
│   ├── Manages output directory structure                                   │
│   ├── Writes per-decision JSONs                                            │
│   └── Aggregates summary statistics                                        │
│                                                                             │
│   Client Selection                                                         │
│   ├── OpenAIConcurrentClient  (gpt-5, gpt-5-mini, gpt-4.1-mini)          │
│   └── ClaudeConcurrentClient  (claude-opus, claude-haiku)                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        EXTRACTION AGENTS LAYER                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Agent 1: extract-comprehensive (Core Metadata)                           │
│  ├─ Input: Full markdown (2K-120K chars)                                  │
│  ├─ Process: Extract parties, facts, arguments, court order              │
│  ├─ Model: gpt-5-mini (MEDIUM reasoning)                                  │
│  └─ Output: reference, parties[], currentInstance {}                      │
│     Score: 98/100                                                          │
│                                                                             │
│  Agent 2A: extract-provisions (Cited Legal Provisions - Stage 1)          │
│  ├─ Input: Full markdown (2K-120K chars)                                  │
│  ├─ Process: Stage 1 - Find ALL provision mentions → snippets            │
│  │            Stage 2 - Parse snippets → JSON                            │
│  ├─ Model: gpt-5-mini (MEDIUM reasoning)                                  │
│  ├─ Output: citedProvisions[] (10 fields each)                            │
│  └─ Score: 99-100/100                                                     │
│                                                                             │
│  Agent 2B: enrich-provisions (Reference Enrichment - Regex Only)          │
│  ├─ Input: Full markdown + citedProvisions from 2A                       │
│  ├─ Process: Regex extraction (CELEX, NUMAC, URLs)                       │
│  ├─ Model: NONE (pure regex)                                             │
│  ├─ Output: citedProvisions (unchanged) + extractedReferences {}         │
│  └─ Score: 100/100                                                        │
│                                                                             │
│  Agent 2C: interpret-provisions (Interpretative Enrichment)               │
│  ├─ Input: citedProvisions from 2B + full markdown                       │
│  ├─ Process: Add interpretation & factual context to each provision      │
│  ├─ Model: gpt-5-mini (MEDIUM reasoning)                                  │
│  ├─ Output: citedProvisions (12 fields) + extractedReferences            │
│  └─ Score: In development                                                 │
│                                                                             │
│  Agent 3: extract-cited-decisions (Precedents - Regex + LLM)             │
│  ├─ Input: Full markdown (2K-120K chars)                                  │
│  ├─ Process: Stage 1 - Regex extraction (court names, dates, ECLI)       │
│  │            Stage 2 - LLM validation & treatment classification        │
│  ├─ Model: gpt-5-mini (MEDIUM reasoning)                                  │
│  ├─ Output: citedDecisions[] (court, date, ECLI, treatment, jurisdiction)│
│  └─ Score: 98/100                                                         │
│                                                                             │
│  Agent 4: extract-keywords (Search Keywords)                              │
│  ├─ Input: Full markdown                                                  │
│  ├─ Model: gpt-4.1-mini                                                   │
│  └─ Output: keywords[] (taxonomy with categorization)                     │
│                                                                             │
│  Agent 5: extract-legal-teachings (Reusable Principles)                   │
│  ├─ Input: Full markdown (from 197-decision test set)                    │
│  ├─ Process: Complex extraction with quality gates                        │
│  │   - Dual formulations (generalized + verbatim)                         │
│  │   - Hierarchical relationships                                         │
│  │   - Precedential weight assessment                                     │
│  ├─ Model: gpt-5 (HIGH reasoning)                                         │
│  ├─ Output: legalTeachings[] (11+ fields) + metadata                      │
│  └─ Score: In refinement                                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      DEPENDENCY RESOLUTION LAYER                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Purpose: Link outputs from previous agents into current processing       │
│                                                                             │
│  DependencyResolver (src/core/DependencyResolver.ts)                      │
│  ├── Load configuration                                                    │
│  │   └── dependencies: [                                                  │
│  │       { jobId: "extract-provisions-2a", alias: "agent2a" }           │
│  │     ]                                                                   │
│  │                                                                         │
│  ├── Locate results directory                                             │
│  │   └── full-data/extract-provisions-2a/{timestamp}/jsons/              │
│  │                                                                         │
│  ├── Build filepath index                                                 │
│  │   └── Map: "ECLI:BE:CASS:2001:ARR.001||FR" → "/path/to/json"         │
│  │                                                                         │
│  ├── Match current row to dependency                                      │
│  │   ├── Extract composite key: (decision_id, language)                   │
│  │   └── Lookup in map                                                    │
│  │                                                                         │
│  └── Load and attach to row                                               │
│      └── row.agent2a = { citedProvisions: [...], extractedReferences: {} }
│                                                                             │
│  Composite Key Matching:                                                   │
│  ├── Row field: decision_id + language_metadata                           │
│  ├── Dependency field: decision_id + language                             │
│  └── Both required for reliable matching                                   │
│                                                                             │
│  Performance Optimization:                                                 │
│  ├── Build filepath map at startup (O(n) once)                           │
│  ├── Lookup during processing (O(1) per row)                             │
│  └── Cache in memory (Map<string, any>)                                  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OUTPUT & PERSISTENCE LAYER                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  Full-Data Pipeline (useFullDataPipeline: true)                           │
│  ├─ Directory Structure:                                                   │
│  │  full-data/                                                            │
│  │  ├── extract-comprehensive/                                            │
│  │  │   └── 2025-11-10T14-30-00-000Z/                                    │
│  │  │       ├── jsons/                                                    │
│  │  │       │   ├── ECLI:BE:CASS:2001:ARR.001_FR.json                    │
│  │  │       │   ├── ECLI:BE:CASS:2001:ARR.001_NL.json                    │
│  │  │       │   ├── ECLI:BE:CASS:2001:ARR.002_FR.json                    │
│  │  │       │   └── ... (64,000 files)                                    │
│  │  │       ├── summary.json                                              │
│  │  │       └── failures.json                                             │
│  │  │                                                                      │
│  │  └── extract-provisions-2a/                                            │
│  │      └── ... (same structure)                                          │
│  │                                                                         │
│  ├─ Per-Decision JSON Format:                                             │
│  │  {                                                                      │
│  │    "decision_id": "ECLI:BE:CASS:2001:ARR.001",                        │
│  │    "language": "FR",                                                   │
│  │    "id": 12345,                                                        │
│  │    ... [extracted data] ...                                            │
│  │  }                                                                      │
│  │                                                                         │
│  ├─ Benefits:                                                              │
│  │  • Incremental persistence (write as you go)                           │
│  │  • Fault tolerance (resume from failure point)                         │
│  │  • Memory efficiency (stream not buffer)                               │
│  │  • Traceability (see exactly which decision produced result)           │
│  │                                                                         │
│  └─ Cost: ~64k files on disk, 2-3x more I/O than batch                   │
│                                                                             │
│  Aggregated Results Pipeline (useFullDataPipeline: false)                 │
│  ├─ Directory Structure:                                                   │
│  │  concurrent/results/                                                   │
│  │  └── extract-provisions-2a/                                            │
│  │      └── gpt-5-mini-medium/                                            │
│  │          └── 2025-11-10T14-30-00-000Z/                                │
│  │              ├── extracted-data.json       (Array of clean outputs)    │
│  │              ├── successful-results.json   (With metadata)             │
│  │              ├── failures.json              (Error details)            │
│  │              └── summary.json               (Statistics)               │
│  │                                                                         │
│  └─ Use Case: Test set evaluation, dependency resolution                  │
│                                                                             │
│  File Naming Convention:                                                   │
│  ├─ ECLI with colons: ECLI:BE:CASS:2001:ARR.001                          │
│  ├─ Language suffix: _FR or _NL                                           │
│  └─ Full filename: ECLI:BE:CASS:2001:ARR.001_FR.json                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        VALIDATION & QUALITY LAYER                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  JSON Schema Validation (AJV)                                              │
│  ├─ For every LLM output:                                                 │
│  │  1. Parse response                                                     │
│  │  2. Validate against outputSchema                                      │
│  │  3. IF valid → successful-results.json                                 │
│  │  4. IF invalid → failures.json (with error details)                    │
│  │                                                                         │
│  ├─ Validation Checks:                                                     │
│  │  • Type validation (string, array, object, etc.)                       │
│  │  • Required fields (minItems, required properties)                     │
│  │  • Pattern matching (regex for IDs, dates, etc.)                       │
│  │  • Enum validation (allowed values)                                    │
│  │  • Length constraints (minLength, maxLength)                           │
│  │                                                                         │
│  └─ Error Reporting:                                                       │
│     {                                                                       │
│       "keyword": "required",                                               │
│       "dataPath": ".citedProvisions[0].provisionNumber",                  │
│       "message": "must have required property 'provisionNumber'"           │
│     }                                                                       │
│                                                                             │
│  Test Set Evaluation                                                       │
│  ├─ 197-decision curated test set (comprehensive-197.csv)                │
│  ├─ Stratified by:                                                        │
│  │  • Language (FR ~100, NL ~97)                                         │
│  │  • Decision type (ARR, ORD, RECO)                                     │
│  │  • Court level (CASS, Appeal, First Instance)                         │
│  │  • Content length (short, medium, long, very_long)                    │
│  │                                                                         │
│  ├─ Scoring (LLM-as-a-Judge):                                             │
│  │  • Completeness (all items found? 0-100)                              │
│  │  • Accuracy (correct extraction? 0-100)                               │
│  │  • Relevance (important items? 0-100)                                 │
│  │  • Clarity (proper formatting? 0-100)                                 │
│  │  • Consistency (same approach throughout? 0-100)                      │
│  │  • Overall score: Average of dimensions                                │
│  │                                                                         │
│  └─ Results tracked in evals/results/<job>/<model>/                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
                    PostgreSQL Database
                    (decisions1 + decisions_md)
                             │
                             │ SQL Query
                             ▼
        ┌──────────────────────────────────────┐
        │   ConcurrentRunner.loadDecisions()   │
        │   Returns: 64,000 DecisionRow[]      │
        └──────────────────────────────────────┘
                             │
                             │ For each row
                             ▼
        ┌──────────────────────────────────────┐
        │    1. preprocessRow(row)              │
        │       Enrich/transform data           │
        └──────────────────────────────────────┘
                             │
                             ▼
        ┌──────────────────────────────────────┐
        │    2. DependencyResolver              │
        │       Load prior agent outputs        │
        │       Attach to row.agent2a, etc.     │
        └──────────────────────────────────────┘
                             │
                             ▼
        ┌──────────────────────────────────────┐
        │    3. LLM Execution                   │
        │       Option A: promptTemplate → LLM  │
        │       Option B: customExecution()     │
        │       Parse response                  │
        └──────────────────────────────────────┘
                             │
                             ▼
        ┌──────────────────────────────────────┐
        │    4. outputSchema Validation         │
        │       AJV JSON Schema validator       │
        │       Pass/Fail determination         │
        └──────────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
            ┌───────────────┐  ┌──────────────┐
            │ PASS:         │  │ FAIL:        │
            │ Save to JSON  │  │ Log error    │
            │ with metadata │  │ in failures  │
            └───────────────┘  └──────────────┘
                    │                 │
                    └────────┬────────┘
                             │
                             ▼
        ┌──────────────────────────────────────┐
        │    5. postProcessRow(row, result)     │
        │       Final transformations           │
        └──────────────────────────────────────┘
                             │
                             ▼
        ┌──────────────────────────────────────┐
        │    6. Stream/Aggregate Result         │
        │       IF full-data mode:              │
        │       Write JSON to jsons/            │
        │       ELSE: collect in memory         │
        └──────────────────────────────────────┘
                             │
                    ┌────────┴────────┐
                    │                 │
                    ▼                 ▼
        ┌──────────────────────┐  ┌────────────┐
        │ full-data/           │  │ concurrent/│
        │ <job>/               │  │ results/   │
        │ <ts>/jsons/          │  │ <job>/     │
        │ *.json               │  │ *.json     │
        │                      │  │            │
        │ (64,000 files)       │  │ (4 files)  │
        └──────────────────────┘  └────────────┘
                    │                 │
                    └────────┬────────┘
                             │
                             ▼
        ┌──────────────────────────────────────┐
        │     Generate Summary Statistics       │
        │     - Total processed                 │
        │     - Success rate                    │
        │     - Average tokens per request      │
        │     - Processing time                 │
        │     - Cost estimate                   │
        └──────────────────────────────────────┘
```

## Configuration Pattern Examples

### Pattern 1: Simple One-Stage Job

```
Job Config → promptTemplate (generate prompt)
           → LLM API call
           → Parse response
           → Validate schema
           → Save result
```

### Pattern 2: Two-Stage Custom Execution

```
Job Config → customExecution(row, client)
           ├─ Stage 1: client.complete(messages1)
           │           → Process result 1
           ├─ Stage 2: client.complete(messages2)
           │           → Generate stage 2 input
           └─ Return final result
           → Validate schema
           → Save result
```

### Pattern 3: Dependency-Based Job

```
Job Config → preprocessRow(row)
           → DependencyResolver
           │  ├─ Load prior agent results
           │  ├─ Match by composite key
           │  └─ Attach to row.agent2b
           → promptTemplate (uses row.agent2b)
           → LLM API call
           → postProcessRow (merge dependency data)
           → Validate schema
           → Save result
```

## Technology Stack

```
Runtime Environment
├── Node.js + TypeScript (ES modules)
└── npm for dependency management

Database
├── PostgreSQL (read-only connection pool)
└── SQL queries parameterized

LLM Providers
├── Azure OpenAI (batch API + concurrent API)
├── OpenAI (standard concurrent API)
└── Anthropic Claude (concurrent API)

Validation
├── AJV (JSON Schema validation)
└── Custom validators (regex, date, enum)

Logging
├── Winston (colored console + file output)
└── logs/combined.log + logs/error.log

Concurrency
├── p-limit for controlled parallel processing
└── Default: 300 concurrent requests

Utilities
├── Markdown parsing/manipulation
├── File system operations (streams)
└── Error tracking and reporting
```

---

This visual architecture shows the complete flow of data from PostgreSQL through multiple extraction agents to final JSON outputs with comprehensive validation and error handling.
