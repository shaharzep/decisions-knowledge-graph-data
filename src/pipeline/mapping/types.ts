/**
 * Mapping Pipeline Type Definitions
 *
 * Per-item state tracking for mapping steps that process multiple items per decision.
 */

import { OpenAIConcurrentClient } from '../../concurrent/OpenAIConcurrentClient.js';

// ============================================================================
// Per-Item State
// ============================================================================

export interface ItemState {
  itemId: string;
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'failed';
  attempts: number;
  model?: string;
  error?: string;
  fastPath?: boolean;
  durationMs?: number;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

// ============================================================================
// Per-Step State
// ============================================================================

export interface MappingStepState {
  status: 'pending' | 'running' | 'completed' | 'failed';
  totalItems: number;
  completedItems: number;
  skippedItems: number;
  failedItems: number;
  durationMs?: number;
  items: Record<string, ItemState>;
}

// ============================================================================
// Full Pipeline State
// ============================================================================

export interface MappingPipelineState {
  decisionId: string;
  language: string;
  startedAt: string;
  status: 'running' | 'completed' | 'failed';
  currentStep: string | null;
  steps: Record<string, MappingStepState>;
  completedAt?: string;
  totalDurationMs?: number;
  totalTokens?: number;
}

// ============================================================================
// Step Context (shared across all steps)
// ============================================================================

export interface StepContext {
  decisionId: string;
  language: string;
  decisionDate: string | null;
  sourceMarkdown: string | null;
  relatedCitations: Map<string, string>;  // internal_provision_id -> relevant_snippet
  teachingTexts: string[];
}

// ============================================================================
// Item Processing Result
// ============================================================================

export interface ItemResult {
  success: boolean;
  data?: any;
  skipped?: boolean;
  skipReason?: string;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

// ============================================================================
// Mapping Step Interface
// ============================================================================

export interface MappingStep {
  id: string;
  dependsOn: string[];
  concurrencyLimit: number;
  loadItems: (decisionId: string, language: string) => Promise<any[]>;
  processItem: (item: any, client: OpenAIConcurrentClient, context: StepContext) => Promise<ItemResult>;
}
