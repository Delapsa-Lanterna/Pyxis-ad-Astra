import { nextTick } from 'vue';
import { createBrowserModel, scenarioNames } from './model';
import { MISC_CONFIG_FILES } from '@/domain/json-editor/misc-config-files';
import { miscConfigFixture } from '../../fixtures/misc-config';
import type { ScenarioOptions } from '../contracts';
export type { ScenarioOptions } from '../contracts';

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

export const scenarios = scenarioNames.map((id) => ({
  id,
  label: {
    settings: '设置',
    json: 'JSON 配置',
    csv: 'CSV 表格',
    ship: '舰船',
    skin: '舰船皮肤',
    weapon: '武器',
    wing: '战机联队',
    variant: '装配',
    weapons: '武器列表',
    wings: '战机联队列表',
    hullmods: '插件列表',
  }[id],
  selector:
    id === 'csv'
      ? '.csv-grid-row[data-row-key]'
      : ['weapons', 'wings', 'hullmods'].includes(id)
        ? '[data-entry-id]'
        : id === 'settings'
          ? '.tool-switch'
          : id === 'json'
            ? '.json-entity-list-item'
            : '.immersive-editor-shell button.immersive-stat-value',
  capabilities: ['settings', 'csv', 'json', 'ship', 'weapon', 'wing', 'variant'].includes(id)
    ? ['查询', '编辑', '保存', '重新读取']
    : ['查询', '选择', '滚动', '资源加载'],
}));

export function createScenario(options: ScenarioOptions, session = 'browser-sample') {
  const model = createBrowserModel(options.scene, options.count, session, options.resourceSize);
  model.saveSettings({ ...model.settings, theme: options.theme, editMode: 'plain', performanceMonitorEnabled: options.monitor });
  if (options.scene === 'json')
    for (const definition of MISC_CONFIG_FILES) {
      const path = model.manifest.modRoot + '/' + definition.path;
      model.miscFiles.push({
        kind: definition.kind,
        path,
        relPath: definition.path,
        data: miscConfigFixture(definition.kind),
        baseVersions: [{ path, fingerprint: 'sample' }],
      });
    }
  return model;
}
