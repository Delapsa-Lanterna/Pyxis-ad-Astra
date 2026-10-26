import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount, type VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import OverviewPage from '@/app/components/OverviewPage.vue';
import { nButton } from '@/test/unit/ui-stubs';
import { useWorkspaceStore } from '@/stores/workspace.store';
import type { GameOverviewData, GameScanWarning, ModOpeningFailure } from '@/shared/types';

vi.mock('@/app/composables/use-workspace-navigation-actions', () => ({
  useWorkspaceNavigationActions: () => ({ navigateToModOverview: vi.fn() }),
}));

vi.mock('@/app/composables/config/use-create-mod-view-model', async () => {
  const { ref } = await import('vue');
  return {
    useCreateModViewModel: () => ({
      beginCreateMod: vi.fn(),
      destinationText: ref('D:\\mods'),
      saving: ref(false),
      submitCreateMod: vi.fn(),
      template: ref({ id: '', name: '', version: '', gameVersion: '' }),
      visible: ref(false),
    }),
  };
});

let wrapper: VueWrapper | null = null;

beforeEach(() => setActivePinia(createPinia()));

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('OverviewPage external Mod opening failures', () => {
  it.each([false, true])('dismisses notices until the next detection with game overview %s', async (game) => {
    const workspace = useWorkspaceStore();
    const failure: ModOpeningFailure = {
      diagnostic: { code: 'parse.csv', message: 'raw CSV detail', location: null },
      modRoot: 'D:\\mods\\broken',
      message: '解析 CSV 失败',
      file: { path: 'D:\\mods\\broken\\data.csv', line: 3 },
    };
    workspace.setModOpeningFailure(failure);
    const warning: GameScanWarning = {
      code: 'scan.mods_missing',
      message: 'Missing mods',
      path: 'D:/game/mods',
      location: null,
      editTarget: null,
    };
    const overview: GameOverviewData = {
      starsectorRoot: 'D:/game',
      modsDir: 'D:/game/mods',
      coreAvailable: true,
      mods: [],
      warnings: [warning],
    };
    if (game) workspace.setGameOverview(overview);

    wrapper = mount(OverviewPage, {
      global: {
        stubs: {
          LoadedModsPanel: true,
          'n-button': nButton,
          'n-input': true,
          'n-modal': true,
        },
      },
    });

    expect(wrapper.get('.overview-header').text()).toContain(game ? '0 个 Mod 可用' : '1 个 Mod 打开失败');
    expect(wrapper.get('.mod-opening-failure-item').text()).toContain('解析 CSV 失败');
    const buttons = wrapper.findAll('button').map((button) => button.text());
    expect(buttons).toContain('打开文件');
    expect(buttons).toContain('关闭提示');
    await wrapper.get('.mod-opening-failure-item button').trigger('click');
    expect(wrapper.emitted('edit-failure-file')).toEqual([[failure]]);
    workspace.setModOpeningFailure({ ...failure, modRoot: 'D:/mods/other' });
    await wrapper.vm.$nextTick();
    await wrapper.get('.mod-opening-failure-item').findAll('button')[1]!.trigger('click');
    expect(wrapper.findAll('.mod-opening-failure-item')).toHaveLength(1);
    if (!game) expect(wrapper.get('.overview-header').text()).toContain('1 个 Mod 打开失败');
    await wrapper.get('.mod-opening-failure-item').findAll('button')[1]!.trigger('click');
    expect(wrapper.find('.mod-opening-failure-list').exists()).toBe(false);
    if (game) {
      workspace.setGameOverview({ ...overview, warnings: [warning, { ...warning, message: 'Another warning' }] });
      await wrapper.vm.$nextTick();
      await wrapper.get('.game-warning-item button').trigger('click');
      expect(wrapper.findAll('.game-warning-item')).toHaveLength(1);
      expect(workspace.toPersistedState().gameWarnings.map((item) => item.message)).toEqual(['Another warning']);
      await wrapper.get('.game-warning-item button').trigger('click');
      expect(wrapper.find('.game-warning-list').exists()).toBe(false);
      workspace.setGameOverview({ ...overview, warnings: [{ ...warning }] });
      await wrapper.vm.$nextTick();
      expect(wrapper.findAll('.game-warning-item')).toHaveLength(1);
    } else {
      expect(wrapper.find('.overview-header').exists()).toBe(false);
      expect(wrapper.get('.overview-empty-state').text()).toContain('打开目录');
    }
    workspace.setModOpeningFailure(failure);
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.mod-opening-failure-item')).toHaveLength(1);
  });
});
