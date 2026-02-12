/**
 * Pipeline Orchestrator
 *
 * Runs a single decision through all extraction steps sequentially.
 * Handles retry logic, model escalation (gpt-5-mini -> gpt-5.2),
 * state persistence for crash recovery, and result aggregation.
 */

import fs from 'fs';
import path from 'path';
import { OpenAIConcurrentClient } from '../concurrent/OpenAIConcurrentClient.js';
import { PIPELINE_STEPS, PipelineStep } from './steps.js';

// ============================================================================
// Types
// ============================================================================

export interface StepState {
  status: 'pending' | 'running' | 'completed' | 'failed';
  attempts: number;
  model?: string;
  error?: string;
  durationMs?: number;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

export interface PipelineState {
  decisionId: string;
  language: string;
  startedAt: string;
  status: 'running' | 'completed' | 'failed';
  currentStep: string | null;
  steps: Record<string, StepState>;
  completedAt?: string;
  totalDurationMs?: number;
  totalTokens?: number;
}

export interface StepResult {
  success: boolean;
  data?: any;
  model?: string;
  attempt?: number;
  error?: Error;
  tokenUsage?: { prompt: number; completion: number; total: number };
}

// ============================================================================
// Pipeline Orchestrator
// ============================================================================

export class PipelineOrchestrator {
  private state: PipelineState;
  private stepResults: Map<string, any> = new Map();
  private stateDir: string;
  private clients: Map<string, OpenAIConcurrentClient> = new Map();

  constructor(
    private decisionId: string,
    private language: string,
    private row: any,
    stateBaseDir?: string
  ) {
    const safeId = decisionId.replace(/:/g, '_');
    this.stateDir = path.join(
      stateBaseDir || path.join(process.cwd(), 'src', 'pipeline', 'state'),
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
    for (const step of PIPELINE_STEPS) {
      this.state.steps[step.id] = {
        status: 'pending',
        attempts: 0,
      };
    }
  }

  /**
   * Get or create an OpenAIConcurrentClient for a model
   */
  private getClient(model: string): OpenAIConcurrentClient {
    if (!this.clients.has(model)) {
      this.clients.set(model, new OpenAIConcurrentClient('pipeline', {
        openaiProvider: 'azure',
        model,
        maxConcurrentApiCalls: 5, // Single decision, low concurrency
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
      console.log(`\n📂 Resuming from state file: ${statePath}`);
      console.log(`   Status: ${savedState.status}, Current step: ${savedState.currentStep}`);

      // Load completed step results
      for (const [stepId, stepState] of Object.entries(this.state.steps)) {
        if ((stepState as StepState).status === 'completed') {
          const resultPath = path.join(this.stateDir, `step-${stepId}.json`);
          if (fs.existsSync(resultPath)) {
            this.stepResults.set(stepId, JSON.parse(fs.readFileSync(resultPath, 'utf-8')));
            console.log(`   ✅ Loaded result for ${stepId}`);
          }
        }
      }

      return true;
    } catch (error) {
      console.warn(`⚠️  Failed to load state: ${error}`);
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
   * Persist a step result to disk
   */
  private saveStepResult(stepId: string, data: any): void {
    fs.mkdirSync(this.stateDir, { recursive: true });
    fs.writeFileSync(
      path.join(this.stateDir, `step-${stepId}.json`),
      JSON.stringify(data, null, 2)
    );
  }

  /**
   * Build upstream results map for a step
   */
  private getUpstreamResults(step: PipelineStep): Record<string, any> {
    const results: Record<string, any> = {};
    for (const depId of step.dependsOn) {
      const data = this.stepResults.get(depId);
      if (!data) {
        throw new Error(`Missing upstream result for ${depId} (required by ${step.id})`);
      }
      results[depId] = data;
    }
    return results;
  }

  /**
   * Execute a single step with retry and model escalation
   */
  private async executeStepWithRetry(step: PipelineStep): Promise<StepResult> {
    const maxRetries = step.requiresLLM ? 3 : 2;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const useEscalation = step.requiresLLM && attempt === 3;
      const model = useEscalation ? 'gpt-5.2' : 'gpt-5-mini';
      const client = this.getClient(model);

      const upstreamResults = this.getUpstreamResults(step);

      try {
        const rawResult = await step.execute(this.row, upstreamResults, client);

        // Apply postProcess if defined
        const result = step.postProcess
          ? step.postProcess(this.row, upstreamResults, rawResult)
          : rawResult;

        return {
          success: true,
          data: result,
          model,
          attempt,
          tokenUsage: rawResult?._tokenUsage,
        };
      } catch (error: any) {
        console.log(`   ❌ Step ${step.id} attempt ${attempt}/${maxRetries} failed: ${error.message}`);
        if (attempt === maxRetries) {
          return { success: false, error, model, attempt };
        }
        // Brief delay before retry
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }

    // Should not reach here
    return { success: false, error: new Error('Retry exhausted') };
  }

  /**
   * Run the full pipeline
   */
  async run(): Promise<{
    success: boolean;
    aggregated: any;
    summary: PipelineState;
  }> {
    const pipelineStart = Date.now();
    let totalTokens = 0;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`🚀 Pipeline starting for ${this.decisionId} (${this.language})`);
    console.log(`${'='.repeat(80)}\n`);

    for (const step of PIPELINE_STEPS) {
      const stepState = this.state.steps[step.id];

      // Skip completed steps (resume)
      if (stepState.status === 'completed') {
        console.log(`⏭️  Skipping ${step.id} (already completed)`);
        continue;
      }

      // Check dependencies
      for (const depId of step.dependsOn) {
        if (this.state.steps[depId]?.status !== 'completed') {
          console.log(`⚠️  Skipping ${step.id}: dependency ${depId} not completed`);
          stepState.status = 'failed';
          stepState.error = `Dependency ${depId} not completed`;
          this.state.status = 'failed';
          this.saveState();
          return { success: false, aggregated: null, summary: this.state };
        }
      }

      // Execute step
      console.log(`\n▶️  Step: ${step.id}`);
      this.state.currentStep = step.id;
      stepState.status = 'running';
      this.saveState();

      const stepStart = Date.now();
      const result = await this.executeStepWithRetry(step);
      const stepDuration = Date.now() - stepStart;

      stepState.attempts = result.attempt || 1;
      stepState.model = result.model;
      stepState.durationMs = stepDuration;

      if (result.success) {
        stepState.status = 'completed';
        if (result.tokenUsage) {
          stepState.tokenUsage = result.tokenUsage;
          totalTokens += result.tokenUsage.total;
        }
        this.stepResults.set(step.id, result.data);
        this.saveStepResult(step.id, result.data);
        console.log(`   ✅ Completed in ${(stepDuration / 1000).toFixed(1)}s (attempt ${result.attempt}, model: ${result.model})`);
      } else {
        stepState.status = 'failed';
        stepState.error = result.error?.message || 'Unknown error';
        this.state.status = 'failed';
        this.saveState();
        console.log(`   💥 FAILED after ${result.attempt} attempts: ${stepState.error}`);
        return { success: false, aggregated: null, summary: this.state };
      }

      this.saveState();
    }

    // All steps completed - aggregate results
    const aggregated = this.aggregateResults();
    const totalDuration = Date.now() - pipelineStart;

    this.state.status = 'completed';
    this.state.completedAt = new Date().toISOString();
    this.state.totalDurationMs = totalDuration;
    this.state.totalTokens = totalTokens;
    this.state.currentStep = null;
    this.saveState();

    // Write aggregated output
    const outputDir = path.join(process.cwd(), 'src', 'pipeline', 'output');
    fs.mkdirSync(outputDir, { recursive: true });
    const safeId = this.decisionId.replace(/:/g, '_');
    const outputPath = path.join(outputDir, `${safeId}_${this.language}.json`);
    fs.writeFileSync(outputPath, JSON.stringify(aggregated, null, 2));

    console.log(`\n${'='.repeat(80)}`);
    console.log(`✅ Pipeline completed in ${(totalDuration / 1000).toFixed(1)}s`);
    console.log(`   Total tokens: ${totalTokens.toLocaleString()}`);
    console.log(`   Output: ${outputPath}`);
    console.log(`${'='.repeat(80)}\n`);

    return { success: true, aggregated, summary: this.state };
  }

  /**
   * Aggregate all step results into a single decision JSON
   *
   * Follows the same field mapping as src/utils/aggregator/jobMappings.ts
   */
  private aggregateResults(): any {
    const base = {
      decision_id: this.decisionId,
      language: this.language,
    };

    // Map step results to output fields (matching jobMappings.ts)
    const fieldMap: Record<string, string> = {
      'extract-comprehensive': 'comprehensive',
      'enrich-provisions': 'extractedReferences',
      'interpret-provisions': 'citedProvisions',
      'extract-cited-decisions': 'citedDecisions',
      'extract-keywords': 'customKeywords',
      'extract-legal-teachings': 'legalTeachings',
      'extract-micro-summary': 'microSummary',
      'enrich-provision-citations': 'relatedCitationsLegalProvisions',
      'enrich-teaching-citations': 'relatedCitationsLegalTeachings',
      'classify-legal-issues': 'legalIssueClassifications',
    };

    const aggregated: any = { ...base };

    for (const [stepId, outputField] of Object.entries(fieldMap)) {
      const data = this.stepResults.get(stepId);
      if (data !== undefined) {
        aggregated[outputField] = data;
      }
    }

    return aggregated;
  }
}
