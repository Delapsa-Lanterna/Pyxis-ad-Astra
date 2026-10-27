export interface ScenarioOptions {
  scene: 'settings' | 'json' | 'csv' | 'ship' | 'skin' | 'weapon' | 'wing' | 'variant' | 'weapons' | 'wings' | 'hullmods';
  count: number;
  resourceSize: number;
  monitor: boolean;
  theme: 'light' | 'dark';
}

export interface RunOptions extends ScenarioOptions {
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
