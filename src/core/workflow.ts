import type { StateStore } from '../persistence/store.js';
import type { WorkflowStepState } from './types.js';

export class WorkflowRunner {
  constructor(private readonly store: StateStore, readonly runId: string) {}

  async step<T>(name: string, operation: () => Promise<{ state?: 'succeeded' | 'warning'; value?: T; effects?: string[] }>): Promise<T | undefined> {
    this.store.recordStep(this.runId, { name, state: 'running', attempts: 1, effects: [], safeResult: {} });
    const result = await operation();
    const state: WorkflowStepState = result.state ?? 'succeeded';
    this.store.recordStep(this.runId, { name, state, attempts: 1, effects: result.effects ?? [], safeResult: result.value ?? {} });
    return result.value;
  }

  fail(name: string, error: unknown): void {
    this.store.recordStep(this.runId, { name, state: 'failed', attempts: 1, effects: [], safeResult: {}, error });
    this.store.completeWorkflow(this.runId, 'failed');
  }
}
