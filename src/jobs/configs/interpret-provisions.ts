/**
 * Interpret Provisions Job Export - Agent 2C
 *
 * Re-exports the interpret-provisions job configuration for CLI discovery.
 *
 * This is the third and final stage of the provision extraction pipeline:
 * - Agent 2A: Basic provision metadata (extract-provisions-2a)
 * - Agent 2B: URLs and identifiers (enrich-provisions)
 * - Agent 2C: Court interpretation and factual context (interpret-provisions)
 *
 * Usage:
 *   npm run dev submit interpret-provisions
 *   npm run dev concurrent interpret-provisions
 *   npm run dev status interpret-provisions
 *   npm run dev process interpret-provisions
 */

export { default } from '../interpret-provisions/config.js';
