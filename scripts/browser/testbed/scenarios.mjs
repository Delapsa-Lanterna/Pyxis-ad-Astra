import { performanceScenarios as sharedScenarios } from '../../shared/performance-scenarios.mjs';
/** @typedef {import('../../shared/performance-scenarios.mjs').PerformanceScenario} PerformanceScenario */
/** @type {PerformanceScenario[]} */
export const performanceScenarios = [
  ...sharedScenarios,
  {
    id: 'java-queries',
    label: 'Java 查询交接（浏览器样本）',
    counts: [1],
    selector: '.code-editor',
    rowHeight: 0,
    scale: 'files',
    keyboard: 'editors',
    fileBytes: [102400],
    textShapes: ['multiline'],
  },
];
