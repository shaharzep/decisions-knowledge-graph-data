/**
 * Enrich Provision Citations Job Configuration - Agent 2D (Stage 2)
 *
 * ARCHITECTURE: BLOCK-BASED (v2)
 *
 * Enriches cited provisions from Agent 2C with block-based citations for UI highlighting.
 * Maps relationships between provisions and decisions cited in same context.
 *
 * CRITICAL FEATURES:
 * - Block-based citations: Returns block IDs + snippets instead of HTML strings
 * - Self-reference MANDATORY: Every provision MUST include its own ID as first element
 *   in relatedInternalProvisionsId array
 * - Robust UI highlighting via CSS selectors: querySelector([data-id="..."])
 * - Provision-to-provision relationship mapping (co-cited, compared, combined)
 * - Provision-to-decision relationship mapping (precedents interpreting provisions)
 * - Comprehensive search: reasoning, procedural, facts, and judgment sections
 *
 * DEPENDENCIES (all required):
 * - interpret-provisions (Agent 2C): Source of provisions to enrich
 * - extract-legal-teachings (Agent 5A): For cross-reference
 * - extract-cited-decisions (Agent 3): For relationship mapping
 *
 * EXECUTION: Evaluation mode on comprehensive-197.csv test set
 */

export { default } from "../enrich-provision-citations/config.js";
