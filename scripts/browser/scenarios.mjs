export const performanceScenarios = [
  { id: 'csv', label: 'CSV 表格', counts: [50, 300, 2000], selector: '.csv-grid-row[data-row-key]', rowHeight: 24 },
  { id: 'weapons', label: '武器列表', counts: [30, 100, 800], selector: '[data-entry-id]', rowHeight: 78 },
  { id: 'wings', label: '战机联队列表', counts: [30, 100, 800], selector: '[data-entry-id]', rowHeight: 78 },
  { id: 'hullmods', label: '插件列表', counts: [30, 100, 800], selector: '[data-entry-id]', rowHeight: 36 },
];
