/**
 * Extract Legal Teachings Job Export - Agent 5
 *
 * Re-exports the extract-legal-teachings job configuration for CLI discovery.
 *
 * SCOPE: Production-grade extraction of reusable legal principles
 *
 * FEATURES:
 * - Belgian legal document structure awareness (reasoning vs procedural sections)
 * - 5 quality gates per principle (accuracy, attribution, generalizability, completeness, clarity)
 * - Dual formulations (generalized text + court verbatim)
 * - Dual contexts (abstract trigger + specific facts)
 * - Hierarchical relationship mapping (parent-child, rule-exception, conflicts)
 * - Precedential weight assessment (6 dimensions)
 * - Granularity control (Goldilocks test)
 *
 * COMPLEXITY: HIGH
 * - Uses gpt-5 (full model) with HIGH reasoning effort
 * - 11 required fields per teaching
 * - Nested objects: hierarchicalRelationships (5 fields), precedentialWeight (6 fields)
 * - Enhanced metadata with relationship counts and 9 validation checks
 *
 * Usage:
 *   npm run dev concurrent extract-legal-teachings
 *   npm run dev status extract-legal-teachings
 *   npm run dev process extract-legal-teachings
 */

export { default } from '../extract-legal-teachings/config.js';
