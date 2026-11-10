import type { AccentPreset } from '../../shared/types/app-settings.types.js';
import type { TestRun } from '../../../scripts/shared/test-report.mjs';
export interface ScenarioOptions {
  scene:
    | 'csv'
    | 'ship'
    | 'skin'
    | 'weapon'
    | 'wing'
    | 'variant'
    | 'weapons'
    | 'wings'
    | 'hullmods'
    | 'fields'
    | 'resources'
    | 'feedback'
    | 'code-editor'
    | 'text-editor';
  source?: 'mod' | 'core' | 'all';
  count: number;
  resourceSize: number;
  monitor: boolean;
  theme: 'light' | 'dark';
  accent?: AccentPreset;
  customAccent?: string;
}

export interface RunOptions extends ScenarioOptions {
  scene: 'csv' | 'weapons' | 'wings' | 'hullmods' | 'code-editor' | 'text-editor';
  workload: 'benchmark' | 'stress' | 'resources';
  warmup: number;
  rounds: number;
  fileBytes?: number;
  textShape?: 'multiline' | 'long-line';
}
export interface Assertion {
  name: string;
  pass: boolean;
  actual: string | number | boolean;
  expected: string | number | boolean;
}
export interface RoundResult {
  iteration: number;
  phase: 'warmup' | 'measurement' | 'first';
  metrics: Record<string, number>;
  assertions: Assertion[];
  error?: string;
}
export interface RunResult extends TestRun {
  options: RunOptions;
}
