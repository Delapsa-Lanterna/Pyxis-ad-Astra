export interface ScenarioOptions {
  scene: 'csv' | 'ship' | 'skin' | 'weapon' | 'wing' | 'variant' | 'weapons' | 'wings' | 'hullmods' | 'fields' | 'resources' | 'feedback';
  source?: 'mod' | 'core' | 'all';
  count: number;
  resourceSize: number;
  monitor: boolean;
  theme: 'light' | 'dark';
  accent?: import('../../shared/types/app-settings.types').AccentPreset;
  customAccent?: string;
}

export interface RunOptions extends ScenarioOptions {
  scene: 'csv' | 'weapons' | 'wings' | 'hullmods';
  workload: 'benchmark' | 'stress' | 'resources';
  warmup: number;
  rounds: number;
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
export interface RunResult {
  options: RunOptions;
  environment: Record<string, unknown>;
  samples: RoundResult[];
  metrics: Record<string, { n: number; min: number | undefined; max: number | undefined; mean: number; median: number; p95: number }>;
  budgets: { metric: string; statistic: string; actual: number; maximum: number; pass: boolean }[];
  pass: boolean;
}
