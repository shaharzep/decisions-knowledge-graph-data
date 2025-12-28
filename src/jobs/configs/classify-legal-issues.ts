/**
 * ULIT Legal Issue Classification Job
 *
 * Classifies legal teachings using Universal Legal Issue Taxonomy.
 * Uses 4-stage pipeline (3 LLM calls + validation).
 *
 * Entity: Legal Teaching (not Decision)
 * Dependency: extract-legal-teachings (full-data)
 * Model: gpt-4.1-mini via standard OpenAI
 */

export { default } from '../classify-legal-issues/config.js';
