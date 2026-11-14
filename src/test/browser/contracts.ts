import type { JointEditKind } from '../../shared/types/joint-target.types.js';
import type { AccentPreset, AppTheme } from '../../shared/types/app-settings.types.js';
import type { TestRun } from '../../../scripts/shared/test-report.mjs';
export interface ScenarioOptions {
  scene:
    | 'csv'
    | JointEditKind
    | 'weapons'
    | 'wings'
    | 'hullmods'
    | 'fields'
    | 'resources'
    | 'feedback'
    | 'code-editor'
    | 'java-queries'
    | 'text-editor';
  source?: 'mod' | 'core' | 'all';
  count: number;
  resourceSize: number;
  monitor: boolean;
  theme: AppTheme;
  accent?: AccentPreset;
  customAccent?: string;
}

export interface RunOptions extends ScenarioOptions {
  scene: 'csv' | 'weapons' | 'wings' | 'hullmods' | 'code-editor' | 'text-editor' | 'java-queries' | JointEditKind;
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
  resources?: Record<string, unknown>;
  error?: string;
}
export interface RunResult extends TestRun {
  options: RunOptions;
}
