/**
 * Item Processor
 *
 * Per-item retry loop with model escalation (gpt-5-mini -> gpt-5.2 on 3rd attempt).
 * Core new abstraction: the extraction pipeline processes 1 item per step,
 * but mapping steps process multiple items (many provisions per decision).
 */

import { OpenAIConcurrentClient } from '../../concurrent/OpenAIConcurrentClient.js';
import { MappingStep, MappingStepState, StepContext } from './types.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const DEFAULT_MODEL = 'gpt-5-mini';
const ESCALATION_MODEL = 'gpt-5.2';

/**
 * Process all items for a step with per-item retry and model escalation.
 *
 * For each item:
 * - Skip if already completed/skipped (resume support)
 * - Attempts 1-2: use gpt-5-mini
 * - Attempt 3: escalate to gpt-5.2
 * - Save state after each item completion (crash recovery)
 * - Continue to next item even if current item fails all retries
 */
export async function processItemsWithRetry(
  items: any[],
  step: MappingStep,
  context: StepContext,
  getClient: (model: string) => OpenAIConcurrentClient,
  stepState: MappingStepState,
  saveState: () => void,
  saveItemResult: (stepId: string, itemId: string, result: any) => void
): Promise<void> {
  for (const item of items) {
    const itemId = String(item.id || item.internal_decision_id || item.internal_parent_act_id);
    const existingState = stepState.items[itemId];

    // Resume support: skip already completed/skipped items
    if (existingState?.status === 'completed' || existingState?.status === 'skipped') {
      continue;
    }

    // Initialize item state if needed
    if (!stepState.items[itemId]) {
      stepState.items[itemId] = {
        itemId,
        status: 'pending',
        attempts: 0,
      };
    }

    const itemState = stepState.items[itemId];
    itemState.status = 'running';
    const itemStart = Date.now();

    let lastError: Error | null = null;
    let succeeded = false;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const useEscalation = attempt === MAX_RETRIES;
      const model = useEscalation ? ESCALATION_MODEL : DEFAULT_MODEL;
      const client = getClient(model);

      itemState.attempts = attempt;
      itemState.model = model;

      try {
        const result = await step.processItem(item, client, context);

        itemState.durationMs = Date.now() - itemStart;

        if (result.skipped) {
          itemState.status = 'skipped';
          itemState.fastPath = true;
          stepState.skippedItems++;
          saveItemResult(step.id, itemId, {
            metadata: { itemId, skipped: true, skipReason: result.skipReason, fastPath: true },
            result: result.data,
          });
        } else {
          itemState.status = 'completed';
          if (result.tokenUsage) {
            itemState.tokenUsage = result.tokenUsage;
          }
          stepState.completedItems++;
          saveItemResult(step.id, itemId, {
            metadata: { itemId, model, attempt, durationMs: itemState.durationMs, tokenUsage: result.tokenUsage },
            result: result.data,
          });
        }

        succeeded = true;
        break;
      } catch (error: any) {
        lastError = error;
        console.log(`      ❌ Item ${itemId} attempt ${attempt}/${MAX_RETRIES} failed: ${error.message}`);

        if (attempt < MAX_RETRIES) {
          await new Promise(resolve => setTimeout(resolve, RETRY_DELAY_MS));
        }
      }
    }

    if (!succeeded) {
      itemState.status = 'failed';
      itemState.error = lastError?.message || 'Unknown error';
      itemState.durationMs = Date.now() - itemStart;
      stepState.failedItems++;
      console.log(`      💥 Item ${itemId} FAILED after ${MAX_RETRIES} attempts: ${itemState.error}`);
    }

    saveState();
  }
}
