/**
 * Item Processor
 *
 * Processes items concurrently (up to step.concurrencyLimit) with per-item
 * retry and model escalation (gpt-5-mini -> gpt-5.2 on 3rd attempt).
 * Uses a sliding-window pattern so a new item starts as soon as one finishes.
 */

import { OpenAIConcurrentClient } from '../../concurrent/OpenAIConcurrentClient.js';
import { MappingStep, MappingStepState, StepContext } from './types.js';

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;
const DEFAULT_MODEL = 'gpt-5-mini';
const ESCALATION_MODEL = 'gpt-5.2';

/**
 * Process a single item with retry and model escalation.
 */
async function processSingleItem(
  item: any,
  step: MappingStep,
  context: StepContext,
  getClient: (model: string) => OpenAIConcurrentClient,
  stepState: MappingStepState,
  saveItemResult: (stepId: string, itemId: string, result: any) => void
): Promise<void> {
  const itemId = String(item.id || item.internal_decision_id || item.internal_parent_act_id);
  const existingState = stepState.items[itemId];

  // Resume support: skip already completed/skipped items
  if (existingState?.status === 'completed' || existingState?.status === 'skipped') {
    return;
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
}

/**
 * Process all items for a step concurrently (up to step.concurrencyLimit)
 * with per-item retry and model escalation.
 *
 * Uses a sliding-window pattern: as soon as one item finishes, the next
 * pending item starts — no idle slots waiting for a slow batch member.
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
  const limit = step.concurrencyLimit;
  let nextIdx = 0;
  let activeTasks = 0;
  let savedSinceLastFlush = 0;

  // Debounced state save: flush at most every 500ms or every 10 items
  const STATE_SAVE_INTERVAL_MS = 500;
  const STATE_SAVE_ITEM_THRESHOLD = 10;
  let lastSaveTime = Date.now();

  function maybeSaveState(force = false): void {
    savedSinceLastFlush++;
    const elapsed = Date.now() - lastSaveTime;
    if (force || savedSinceLastFlush >= STATE_SAVE_ITEM_THRESHOLD || elapsed >= STATE_SAVE_INTERVAL_MS) {
      saveState();
      savedSinceLastFlush = 0;
      lastSaveTime = Date.now();
    }
  }

  return new Promise<void>((resolve) => {
    function startNext(): void {
      while (activeTasks < limit && nextIdx < items.length) {
        const item = items[nextIdx++];
        activeTasks++;

        processSingleItem(item, step, context, getClient, stepState, saveItemResult)
          .then(() => {
            activeTasks--;
            maybeSaveState();
            startNext();
          })
          .catch(() => {
            // processSingleItem handles its own errors and never rejects,
            // but guard against unexpected throws
            activeTasks--;
            maybeSaveState();
            startNext();
          });
      }

      // All items dispatched and all tasks finished
      if (activeTasks === 0 && nextIdx >= items.length) {
        maybeSaveState(true); // Final flush
        resolve();
      }
    }

    startNext();
  });
}
