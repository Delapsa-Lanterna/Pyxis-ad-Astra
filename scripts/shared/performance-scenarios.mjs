/** @typedef {'ship'|'skin'|'weapon'|'wing'|'variant'} ImmersiveKind */
/** @type {{kind:ImmersiveKind,id:string,label:string,file:string,field:string}[]} */
export const immersiveTargets = [
  { kind: 'ship', id: 'ship_0', label: '舰船名称', file: 'data/hulls/ship_data.csv', field: 'name' },
  { kind: 'skin', id: 'sample_skin', label: '舰船名称', file: 'data/hulls/skins/sample.skin', field: 'hullName' },
  { kind: 'weapon', id: 'weapon_0', label: '武器名称', file: 'data/weapons/weapon_data.csv', field: 'name' },
  { kind: 'wing', id: 'sample_wing', label: '战机联队名称', file: 'data/variants/fighter.variant', field: 'displayName' },
  { kind: 'variant', id: 'sample_variant', label: '装配名称', file: 'data/variants/sample.variant', field: 'displayName' },
];
/** @typedef {'csv'|'weapons'|'wings'|'hullmods'|'code-editor'|'text-editor'|'java-queries'|ImmersiveKind} PerformanceScene */
/** @typedef {{id:PerformanceScene,label:string,counts:number[],selector:string,rowHeight:number,scale:'rows'|'entries'|'files',fileBytes?:number[],textShapes?:Array<'multiline'|'long-line'>,keyboard?:'editors',immersive?:boolean}} PerformanceScenario */
/** @type {PerformanceScenario[]} */
export const performanceScenarios = [
  { id: 'csv', label: 'CSV 表格', counts: [50, 300, 2000], selector: '.csv-grid-row[data-row-key]', rowHeight: 24, scale: 'rows' },
  { id: 'weapons', label: '武器列表', counts: [30, 100, 800], selector: '[data-entry-id]', rowHeight: 78, scale: 'entries' },
  { id: 'wings', label: '战机联队列表', counts: [30, 100, 800], selector: '[data-entry-id]', rowHeight: 78, scale: 'entries' },
  { id: 'hullmods', label: '插件列表', counts: [30, 100, 800], selector: '[data-entry-id]', rowHeight: 36, scale: 'entries' },
  .../** @type {const} */ (['code-editor', 'text-editor']).map((id) => ({
    id,
    label: id === 'code-editor' ? '代码编辑器' : '文本编辑器',
    counts: id === 'code-editor' ? [1, 10, 50] : [1],
    selector: id === 'code-editor' ? '.code-editor' : '.text-editor-page',
    rowHeight: 0,
    scale: /** @type {const} */ ('files'),
    keyboard: /** @type {const} */ ('editors'),
    fileBytes: [102400, 1048576, 10485760],
    textShapes: /** @type {Array<'multiline'|'long-line'>} */ (['multiline', 'long-line']),
  })),
  ...immersiveTargets.map(({ kind }) => ({
    id: kind,
    label: { ship: '舰船', skin: '皮肤', weapon: '武器', wing: '战机联队', variant: '装配' }[kind] + '沉浸式编辑器',
    counts: [50],
    selector: '.immersive-editor-shell',
    rowHeight: 0,
    scale: /** @type {const} */ ('files'),
    immersive: true,
  })),
];
