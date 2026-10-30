import { nextTick } from 'vue';
import { createBrowserModel } from './model';
import { buildModNavigationSections } from '@/domain/workspace/mod-navigation';
import { performanceScenarios } from '../../../../scripts/browser/scenarios.mjs';
import type { ScenarioOptions } from '../contracts';
export type { ScenarioOptions } from '../contracts';
export { performanceScenarios };

export const frame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));
export async function settled() {
  await nextTick();
  await frame();
  await frame();
}
export async function until(predicate: () => boolean, label: string) {
  const deadline = performance.now() + 15000;
  while (!predicate()) {
    if (performance.now() > deadline) throw Error(`等待超时：${label}`);
    await frame();
  }
}
export const immersiveSamples = ['ship', 'skin', 'weapon', 'wing', 'variant'] as const;
export const sampleLabels: Partial<Record<ScenarioOptions['scene'], string>> = {
  ship: '舰船',
  skin: '皮肤',
  weapon: '武器',
  wing: '战机联队',
  variant: '装配',
};
export interface BrowserScenarioEntry {
  id: string;
  label: string;
  selector: string;
  samples: readonly ScenarioOptions['scene'][];
  operations: string[];
}
export const scenarios: BrowserScenarioEntry[] = [
  {
    id: 'workspace',
    label: '完整测试工作区',
    selector: '.browser-workspace-shell',
    samples: [],
    operations: ['正式导航', '保存恢复', '窗口交接'],
  },
  {
    id: 'csv',
    label: 'CSV 表格',
    selector: '.csv-grid-row[data-row-key]',
    samples: ['csv'],
    operations: ['输入与选择', '保存重开', '规模测量'],
  },
  {
    id: 'immersive',
    label: '沉浸式编辑',
    selector: '.immersive-editor-shell',
    samples: immersiveSamples,
    operations: ['编辑', '保存重开', '关联目标'],
  },
  {
    id: 'fields',
    label: '字段与集合',
    selector: '[data-gallery="fields"]',
    samples: ['fields'],
    operations: ['字段输入', '集合操作', '提交与取消'],
  },
  {
    id: 'pickers',
    label: '选择列表',
    selector: '[data-entry-id]',
    samples: ['weapons', 'wings', 'hullmods'],
    operations: ['搜索与筛选', '选择与取消', '规模测量'],
  },
  {
    id: 'resources',
    label: '图片与文字资源',
    selector: '[data-gallery="resources"]',
    samples: ['resources'],
    operations: ['图片状态', '缩略图', '字体与回退'],
  },
  {
    id: 'feedback',
    label: '反馈与浮层',
    selector: '[data-gallery="feedback"]',
    samples: ['feedback'],
    operations: ['消息', '确认与取消', '菜单与提示'],
  },
];
export const workspaceNavigation = buildModNavigationSections(null).flatMap((section) =>
  section.items.map(({ id, label }) => ({ id, label })),
);
export const workspaceEntries = [
  { id: 'workspace', label: '工作区总览', href: import.meta.env.BASE_URL },
  { id: 'global-settings', label: '应用设置', href: import.meta.env.BASE_URL + '?page=settings' },
  { id: 'global-about', label: '关于应用', href: import.meta.env.BASE_URL + '?page=about' },
  ...workspaceNavigation.map((item) => ({
    id: 'navigation-' + item.id,
    label: item.label,
    href: import.meta.env.BASE_URL + '?navigation=' + encodeURIComponent(item.id),
  })),
  ...[
    ['spec', '规格编辑窗口'],
    ['file', '文件编辑窗口'],
    ['immersive', '沉浸式编辑窗口'],
    ['preview', '开火预览窗口'],
  ].map(([id, label]) => ({ id: id + '-window', label: label!, href: import.meta.env.BASE_URL + '?sampleWindow=' + id + '-window' })),
];
export const scenarioHref = (id: string) => import.meta.env.BASE_URL + (id === 'workspace' ? '' : '?scene=' + id);
export function sceneDefinition(sample: ScenarioOptions['scene']) {
  return scenarios.find((scene) => scene.samples.includes(sample))!;
}
export function sampleSelector(sample: ScenarioOptions['scene']) {
  return performanceScenarios.find(({ id }) => id === sample)?.selector ?? sceneDefinition(sample).selector;
}
export function createScenario(options: ScenarioOptions, session = 'browser-sample') {
  const model = createBrowserModel(options.scene, options.count, session, options.resourceSize);
  model.saveSettings({
    ...model.settings,
    theme: options.theme,
    accent: options.accent ?? 'blue',
    customAccent: options.customAccent ?? '#2563eb',
    editMode: ['fields', 'resources', 'feedback'].includes(options.scene) ? 'smart' : 'plain',
    performanceMonitorEnabled: options.monitor,
  });
  if (options.source && options.source !== 'mod')
    for (const kind of ['weapons', 'wings', 'hullmods'] as const) {
      model.catalog(kind).forEach((entry, index) => {
        if (options.source === 'core' || index % 2) entry.source.source = 'core';
      });
    }
  return model;
}
