/**
 * Enrich Teaching Citations Job Export - Agent 5B (Stage 2)
 *
 * Re-exports the enrich-teaching-citations job configuration for CLI discovery.
 *
 * SCOPE: Citation enrichment for legal teachings with UI highlighting support
 *
 * FEATURES:
 * - Extracts exact HTML passages where each teaching is discussed
 * - Validates provision/decision relationships claimed by Agent 5A
 * - Character-perfect HTML for string.includes() matching in UI
 * - Completeness checks (deletion test) to ensure no passages missed
 * - Section-aware extraction (reasoning vs procedural sections)
 *
 * COMPLEXITY: MEDIUM-HIGH
 * - Semantic understanding of legal concepts required
 * - Character-perfect HTML extraction (no modifications allowed)
 * - Relationship validation across 3 dependency sources
 * - Belgian legal document structure awareness
 *
 * DEPENDENCIES (all required):
 * - Agent 5A (extract-legal-teachings): Source teachings
 * - Agent 2C (interpret-provisions): Provisions for validation
 * - Agent 3 (extract-cited-decisions): Decisions for validation
 *
 * Usage:
 *   npm run dev concurrent enrich-teaching-citations
 *   npm run dev status enrich-teaching-citations
 */

export { default } from '../enrich-teaching-citations/config.js';
