# Belgium Case Law Extraction Pipeline - Documentation Index

## Overview

This repository contains a sophisticated multi-stage AI extraction pipeline for processing 64,000 Belgian court decisions (French & Dutch). Three comprehensive analysis documents have been created to help you understand the entire system.

## Documents

### 1. CODEBASE-ANALYSIS.md (1,549 lines, 50KB)
**Deep Technical Analysis - Start Here for Understanding**

Comprehensive coverage of:
- System architecture and design patterns
- Project directory structure
- Database schema (decisions1, decisions_md)
- All 6+ extraction agents with detailed specifications:
  - Agent 1: extract-comprehensive (98/100 score)
  - Agent 2A: extract-provisions Stage 1 & 2 (99-100/100)
  - Agent 2B: enrich-provisions (100/100, regex-only)
  - Agent 2C: interpret-provisions (in development)
  - Agent 3: extract-cited-decisions (98/100)
  - Agent 4: extract-keywords
  - Agent 5: extract-legal-teachings (in refinement)
- Full JobConfig interface documentation
- Execution flow (batch vs concurrent modes)
- Dependency system with composite key matching
- Full-data pipeline architecture (per-decision JSONs)
- Quality validation and evaluation framework
- Prompt engineering strategy
- Model selection and reasoning effort
- Complete command reference

**Best for**: Understanding how everything works, system design decisions, detailed technical specifications

### 2. PIPELINE-QUICK-REFERENCE.md (424 lines, 11KB)
**Quick Reference Guide - Use During Development**

Quick lookup guide:
- Agent summary table (6+ agents at a glance)
- Key directory structure
- Command quick start (concurrent & batch modes)
- Data flow summary
- Output structure (full-data vs aggregated)
- Configuration patterns (simple, two-stage, dependency-based)
- Database schema summary
- Model & reasoning configuration
- Composite key matching examples
- Output schemas for each agent
- Evaluation results and metrics
- Troubleshooting guide
- Development notes
- Next steps

**Best for**: Daily development, quick lookups, command reference, configuration patterns

### 3. SYSTEM-ARCHITECTURE.md (503 lines, 38KB)
**Visual Architecture Diagrams - See the Big Picture**

Visual representations:
- High-level architecture diagram
- Data flow through all layers:
  - Data source layer (PostgreSQL)
  - Orchestration layer (CLI)
  - Batch vs concurrent processing modes
  - Concurrent runner layer
  - Extraction agents layer
  - Dependency resolution layer
  - Output & persistence layer
  - Validation & quality layer
- Detailed data flow diagram
- Configuration pattern examples
- Technology stack overview

**Best for**: Understanding system flow, explaining to others, visual learners, architecture decisions

## Key Findings Summary

### System Characteristics
- **Scale**: 64,000 decisions (FR & NL versions = ~128K language variants)
- **Quality**: 98-100/100 evaluation scores per stage
- **Processing**: Concurrent API calls with real-time streaming
- **Bilingual**: Language-aware extraction (FR and NL)
- **Modular**: 6+ independent extraction agents

### Architectural Innovations

1. **Two-Stage Extraction** (Agents 2A, 3)
   - Stage 1: Find everything (100% recall)
   - Stage 2: Parse everything precisely (high precision)
   - Result: 99-100/100 accuracy vs ~85/100 single-stage

2. **Regex-Only Agent** (Agent 2B)
   - Zero LLM cost, instant processing
   - Perfect for structured reference extraction (CELEX, NUMAC)
   - 100% evaluation score

3. **Full-Data Pipeline**
   - Per-decision JSON files (full-data/<job>/<timestamp>/jsons/)
   - Incremental persistence (64,000 individual files)
   - Fault tolerance (resume capability)

4. **Composite Key Matching**
   - (decision_id, language) as universal identifier
   - Handles bilingual data seamlessly
   - Enables reliable cross-job dependency linking

5. **DependencyResolver**
   - Automatically links outputs from previous agents
   - Loads and matches by composite key
   - Available for downstream agents

### Processing Modes

**Batch Mode** (Legacy - Azure OpenAI Batch API)
- Cost efficient (50% off standard pricing)
- Handles 100K+ requests
- Long completion time (up to 24 hours)

**Concurrent Mode** (New Primary - Direct API)
- Real-time streaming results
- Fault tolerant with per-decision tracking
- Dependency resolution
- Rate-limited by provider

### Quality Framework

**Validation**:
- JSON Schema validation on every output (AJV)
- Type checking, required fields, pattern matching
- Detailed error reporting

**Evaluation**:
- 197-decision curated test set (stratified)
- LLM-as-a-judge scoring framework
- Dimensions: Completeness, Accuracy, Relevance, Clarity, Consistency

### Model Selection
- Simple: gpt-4.1-mini (cleanup, keywords)
- Medium: gpt-5-mini (provisions, cited decisions, medium reasoning)
- Complex: gpt-5 (legal teachings, high reasoning)
- Regex: None (Agent 2B reference extraction)

## Database Schema

**decisions1** (Metadata)
- id, decision_id (ECLI), language_metadata
- decision_type_ecli_code, court_ecli_code
- decision_date, [other fields]

**decisions_md** (Full Text)
- decision_id, language (FR/NL)
- full_md (2K-120K chars markdown)

**Access**: READ-ONLY (enforced via PostgreSQL connection pool)

## Configuration System

Every extraction job uses **JobConfig interface**:

```typescript
{
  id: "job-name",
  description: "...",
  dbQuery: "SELECT ...",           // READ-ONLY
  preprocessRow: async (row) => {},
  promptTemplate: (row) => string,
  customExecution: async (row, client) => {},
  outputSchema: {},
  provider: 'azure'|'openai'|'anthropic',
  model: "gpt-5-mini",
  concurrencyLimit: 300,
  useFullDataPipeline: true
}
```

## Output Examples

**Agent 1** → reference, parties[], currentInstance
**Agent 2A** → citedProvisions[] (10 fields)
**Agent 2B** → citedProvisions + extractedReferences
**Agent 2C** → citedProvisions (12 fields) + extractedReferences
**Agent 3** → citedDecisions[]
**Agent 5** → legalTeachings[] + metadata

## Command Quick Start

```bash
# Concurrent processing (new primary mode)
npm run dev concurrent extract-comprehensive
npm run dev concurrent extract-provisions-2a
npm run eval extract-provisions-2a gpt-5-mini

# Batch processing (legacy)
npm run dev submit extract-comprehensive
npm run dev status extract-comprehensive
npm run dev process extract-comprehensive
```

## Recent Development Status

**Completed Agents**:
- Agent 1: extract-comprehensive (98/100)
- Agent 2A: extract-provisions (99-100/100)
- Agent 2B: enrich-provisions (100/100)
- Agent 3: extract-cited-decisions (98/100)
- Agent 4: extract-keywords (complete)

**In Development**:
- Agent 2C: interpret-provisions
- Agent 5: extract-legal-teachings (refining quality gates)

**Next Phase**:
1. Complete Agent 2C
2. Refine Agent 5 scoring
3. Process full 64k dataset
4. Integrate into knowledge graph
5. Add HTML structuring (Agent 6)

## File Locations

All documents are in the project root:

```
/Users/shaharzep/knowledge-graph/
├── CODEBASE-ANALYSIS.md           (This - 1549 lines)
├── PIPELINE-QUICK-REFERENCE.md    (Quick reference - 424 lines)
├── SYSTEM-ARCHITECTURE.md         (Visual diagrams - 503 lines)
├── ANALYSIS-INDEX.md              (This index file)
├── src/                           (Source code)
├── prompts-txts/                  (LLM prompts)
├── evals/                         (Evaluation framework)
└── full-data/                     (Per-decision outputs)
```

## How to Use These Documents

### For Understanding the System
1. Start with **SYSTEM-ARCHITECTURE.md** (visual overview)
2. Read **CODEBASE-ANALYSIS.md** sections 1-5 (structure, database, stages)
3. Deep dive into specific agents (sections 3.1-3.7)

### For Development
1. Bookmark **PIPELINE-QUICK-REFERENCE.md** for daily use
2. Reference command quick start when running jobs
3. Consult configuration patterns for new jobs

### For Troubleshooting
1. Check troubleshooting section in PIPELINE-QUICK-REFERENCE.md
2. Review specific agent configuration in CODEBASE-ANALYSIS.md
3. Look at output schemas for validation issues

### For Communication
1. Use SYSTEM-ARCHITECTURE.md diagrams when explaining to others
2. Show pipeline stages table from PIPELINE-QUICK-REFERENCE.md
3. Point to specific agent sections in CODEBASE-ANALYSIS.md

## Key Insights

1. **Bilingual Strategy**: Extract in original language, defer translation
2. **Two-Stage Approach**: Wide-net extraction + precise parsing = high accuracy
3. **Regex-Only Processing**: Perfect for structured references (zero cost)
4. **Composite Key Matching**: (decision_id, language) enables bilingual linking
5. **Fault Tolerance**: Full-data pipeline with incremental persistence

## Technology Stack

- Runtime: Node.js + TypeScript (ES modules)
- Database: PostgreSQL (read-only)
- LLM APIs: Azure OpenAI, OpenAI, Anthropic Claude
- Validation: AJV (JSON Schema)
- Logging: Winston
- Concurrency: p-limit

## Next Steps

1. Read SYSTEM-ARCHITECTURE.md for visual understanding
2. Review CODEBASE-ANALYSIS.md section 3 for agent details
3. Keep PIPELINE-QUICK-REFERENCE.md open while developing
4. Run your first concurrent job: `npm run dev concurrent extract-comprehensive`

---

**Created**: November 10, 2025
**Total Lines of Analysis**: 2,476 lines
**Total Size**: ~100KB of comprehensive documentation

These documents represent a complete understanding of the Belgium Case Law Extraction Pipeline system.
