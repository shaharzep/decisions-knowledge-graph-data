/**
 * Mapping Pipeline Orchestrator
 *
 * Runs a single decision through all 4 mapping steps sequentially.
 * Each step processes multiple items with per-item retry and model escalation.
 * Adapted from PipelineOrchestrator.ts with per-item state tracking.
 */

import fs from 'fs';
import path from 'path';
import { OpenAIConcurrentClient } from '../../concurrent/OpenAIConcurrentClient.js';
import { MAPPING_STEPS } from './steps.js';
import { MappingPipelineState, MappingStepState, StepContext } from './types.js';
import { processItemsWithRetry } from './item-processor.js';
import { loadRelatedContext, loadSourceMarkdown, loadDecisionDate, clearProvisionCache } from './data-loader.js';

// ============================================================================
// Mapping Orchestrator
// ============================================================================

export class MappingOrchestrator {
  private state: MappingPipelineState;
  private stateDir: string;
  private outputDir: string;
  private clients: Map<string, OpenAIConcurrentClient> = new Map();

  constructor(
    private decisionId: string,
    private language: string,
    stateBaseDir?: string,
    outputBaseDir?: string
  ) {
    const safeId = decisionId.replace(/:/g, '_');
    this.stateDir = path.join(
      stateBaseDir || path.join(process.cwd(), 'src', 'pipeline', 'mapping', 'state'),
      `${safeId}_${language}`
    );
    this.outputDir = path.join(
      outputBaseDir || path.join(process.cwd(), 'src', 'pipeline', 'mapping', 'output'),
      `${safeId}_${language}`
    );

    this.state = {
      decisionId,
      language,
      startedAt: new Date().toISOString(),
      status: 'running',
      currentStep: null,
      steps: {},
    };

    // Initialize step states
    for (const step of MAPPING_STEPS) {
      this.state.steps[step.id] = {
        status: 'pending',
        totalItems: 0,
        completedItems: 0,
        skippedItems: 0,
        failedItems: 0,
        items: {},
      };
    }
  }

  /**
   * Get or create an OpenAIConcurrentClient for a model
   */
  private getClient(model: string): OpenAIConcurrentClient {
    if (!this.clients.has(model)) {
      this.clients.set(model, new OpenAIConcurrentClient('mapping-pipeline', {
        openaiProvider: 'azure',
        model,
        maxConcurrentApiCalls: 5,
      }));
    }
    return this.clients.get(model)!;
  }

  /**
   * Load state from a previous run for resume
   */
  async loadState(stateFilePath?: string): Promise<boolean> {
    const statePath = stateFilePath || path.join(this.stateDir, 'state.json');

    if (!fs.existsSync(statePath)) {
      return false;
    }

    try {
      const savedState = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      this.state = savedState;
      console.log(`\n   Resuming from state file: ${statePath}`);
      console.log(`   Status: ${savedState.status}, Current step: ${savedState.currentStep}`);

      for (const [stepId, stepState] of Object.entries(this.state.steps)) {
        const s = stepState as MappingStepState;
        if (s.status === 'completed') {
          console.log(`   Loaded: ${stepId} (${s.completedItems} completed, ${s.skippedItems} skipped, ${s.failedItems} failed)`);
        }
      }

      return true;
    } catch (error) {
      console.warn(`   Warning: Failed to load state: ${error}`);
      return false;
    }
  }

  /**
   * Persist current state to disk
   */
  private saveState(): void {
    fs.mkdirSync(this.stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.stateDir, 'state.json'),
      JSON.stringify(this.state, null, 2)
    );
  }

  /**
   * Save individual item result to disk
   */
  private saveItemResult(stepId: string, itemId: string, data: any): void {
    const stepDir = path.join(this.outputDir, stepId);
    fs.mkdirSync(stepDir, { recursive: true });
    const safeItemId = itemId.replace(/[:/\\]/g, '_');
    fs.writeFileSync(
      path.join(stepDir, `${safeItemId}.json`),
      JSON.stringify(data, null, 2)
    );
  }

  /**
   * Save step result (array of all item results) to disk
   */
  private saveStepResult(stepId: string, items: any[]): void {
    fs.mkdirSync(this.outputDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.outputDir, `step-${stepId}.json`),
      JSON.stringify(items, null, 2)
    );
  }

  /**
   * Collect all item results for a step from the output directory
   */
  private collectStepResults(stepId: string): any[] {
    const stepDir = path.join(this.outputDir, stepId);
    if (!fs.existsSync(stepDir)) return [];

    const files = fs.readdirSync(stepDir).filter(f => f.endsWith('.json'));
    return files.map(f => {
      try {
        return JSON.parse(fs.readFileSync(path.join(stepDir, f), 'utf-8'));
      } catch {
        return null;
      }
    }).filter(Boolean);
  }

  /**
   * Run the full mapping pipeline
   */
  async run(): Promise<{
    success: boolean;
    summary: MappingPipelineState;
  }> {
    const pipelineStart = Date.now();
    let totalTokens = 0;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`Mapping pipeline starting for ${this.decisionId} (${this.language})`);
    console.log(`${'='.repeat(80)}\n`);

    // Clear caches from any previous run
    clearProvisionCache();

    // Load shared context once
    console.log('   Loading shared context...');
    const [relatedContext, sourceMarkdown, decisionDate] = await Promise.all([
      loadRelatedContext(this.decisionId),
      loadSourceMarkdown(this.decisionId, this.language),
      loadDecisionDate(this.decisionId),
    ]);

    const context: StepContext = {
      decisionId: this.decisionId,
      language: this.language,
      decisionDate,
      sourceMarkdown,
      relatedCitations: relatedContext.citations,
      teachingTexts: relatedContext.teachingTexts,
    };

    console.log(`   Context loaded: ${relatedContext.citations.size} citation paragraphs, ${relatedContext.teachingTexts.length} teaching texts`);
    if (sourceMarkdown) {
      console.log(`   Source markdown: ${sourceMarkdown.length} chars`);
    }

    for (const step of MAPPING_STEPS) {
      const stepState = this.state.steps[step.id];

      // Skip completed steps (resume)
      if (stepState.status === 'completed') {
        console.log(`\n   Skipping ${step.id} (already completed)`);
        // Count tokens from completed step
        for (const itemState of Object.values(stepState.items)) {
          if (itemState.tokenUsage) {
            totalTokens += itemState.tokenUsage.total;
          }
        }
        continue;
      }

      // Execute step
      console.log(`\n   Step: ${step.id}`);
      this.state.currentStep = step.id;
      stepState.status = 'running';
      this.saveState();

      const stepStart = Date.now();

      // Load items for this step
      const items = await step.loadItems(this.decisionId, this.language);
      stepState.totalItems = items.length;

      if (items.length === 0) {
        stepState.status = 'completed';
        stepState.durationMs = Date.now() - stepStart;
        this.saveStepResult(step.id, []);
        console.log(`   Completed (0 items)`);
        this.saveState();
        continue;
      }

      console.log(`   Processing ${items.length} items...`);

      // Process items with retry
      await processItemsWithRetry(
        items,
        step,
        context,
        (model) => this.getClient(model),
        stepState,
        () => this.saveState(),
        (stepId, itemId, result) => this.saveItemResult(stepId, itemId, result)
      );

      stepState.durationMs = Date.now() - stepStart;

      // Mark step as completed (even with some item failures)
      stepState.status = 'completed';

      // Count tokens from this step
      for (const itemState of Object.values(stepState.items)) {
        if (itemState.tokenUsage) {
          totalTokens += itemState.tokenUsage.total;
        }
      }

      // Collect and save step-level result file
      const stepResults = this.collectStepResults(step.id);
      this.saveStepResult(step.id, stepResults);

      const duration = (stepState.durationMs / 1000).toFixed(1);
      console.log(`   Completed in ${duration}s: ${stepState.completedItems} completed, ${stepState.skippedItems} skipped, ${stepState.failedItems} failed`);

      this.saveState();
    }

    // Pipeline complete
    const totalDuration = Date.now() - pipelineStart;

    this.state.status = 'completed';
    this.state.completedAt = new Date().toISOString();
    this.state.totalDurationMs = totalDuration;
    this.state.totalTokens = totalTokens;
    this.state.currentStep = null;
    this.saveState();

    console.log(`\n${'='.repeat(80)}`);
    console.log(`Mapping pipeline completed in ${(totalDuration / 1000).toFixed(1)}s`);
    console.log(`   Total tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   Output: ${this.outputDir}`);
    console.log(`${'='.repeat(80)}\n`);

    return { success: true, summary: this.state };
  }
}
