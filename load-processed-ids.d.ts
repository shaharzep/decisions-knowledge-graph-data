/**
 * Load processed (decision_id, language) pairs for SQL exclusion
 *
 * Usage: import { loadProcessedIds } from './load-processed-ids.js'
 */
export interface ProcessedIds {
    decisionIds: string[];
    languages: string[];
}
export declare function loadProcessedIds(csvPath?: string): Promise<ProcessedIds>;
//# sourceMappingURL=load-processed-ids.d.ts.map