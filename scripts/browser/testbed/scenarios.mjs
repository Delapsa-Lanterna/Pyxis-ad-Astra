/** @typedef {{id:import('../../../src/test/browser/contracts.js').RunOptions['scene'],label:string,counts:number[],selector:string,rowHeight:number,scale:'rows'|'entries'|'files',fileBytes?:number[],textShapes?:Array<'multiline'|'long-line'>,keyboard?:'editors'}} PerformanceScenario */
/** @type {PerformanceScenario[]} */
export const performanceScenarios = [
  { id: 'csv', label: 'CSV 表格', counts: [50, 300, 2000], selector: '.csv-grid-row[data-row-key]', rowHeight: 24, scale: 'rows' },
  { id: 'weapons', label: '武器列表', counts: [30, 100, 800], selector: '[data-entry-id]', rowHeight: 78, scale: 'entries' },
  { id: 'wings', label: '战机联队列表', counts: [30, 100, 800], selector: '[data-entry-id]', rowHeight: 78, scale: 'entries' },
  { id: 'hullmods', label: '插件列表', counts: [30, 100, 800], selector: '[data-entry-id]', rowHeight: 36, scale: 'entries' },
  {
    id: 'code-editor',
    label: '代码编辑器',
    counts: [1, 10, 50],
    selector: '.code-editor',
    rowHeight: 0,
    scale: 'files',
    keyboard: 'editors',
    fileBytes: [102400, 1048576, 10485760],
    textShapes: ['multiline', 'long-line'],
  },
  {
    id: 'text-editor',
    label: '文本编辑器',
    counts: [1],
    selector: '.text-editor-page',
    rowHeight: 0,
    scale: 'files',
    keyboard: 'editors',
    fileBytes: [102400, 1048576, 10485760],
    textShapes: ['multiline', 'long-line'],
  },
];
