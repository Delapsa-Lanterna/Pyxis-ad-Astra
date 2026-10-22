import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { h, ref, shallowRef, shallowReactive } from 'vue';
import { NInput, NSelect, NButton } from 'naive-ui';
import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import type { JointVariantEntry } from '@/shared/types';
import VariantPicker from './VariantPicker.vue';
import VariantImmersivePanel from './VariantImmersivePanel.vue';
import { variantJointFixture } from '@/test/variant-joint-edit';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import type { useImmersiveVariantEditor } from '@/app/composables/immersive-editor/variant/use-immersive-variant-editor';
import { jointObject } from '@/domain/joint-edit';
const deckMedia = vi.hoisted(() => ({ replaceCollection: vi.fn(), releaseCollection: vi.fn(), dataUrl: vi.fn(() => '') }));
vi.mock('@/app/composables/use-resource-media-registry', () => ({ useResourceMediaRegistry: () => deckMedia }));
const mocks = vi.hoisted(() => ({ entries: [] as JointVariantEntry[] }));
vi.mock('@/app/composables/use-thumbnail-preload', () => ({ useThumbnailPreload: () => ({ prepare: vi.fn(), url: () => '' }) }));
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(234);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    queueMicrotask(() => callback(performance.now()));
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
vi.mock('@/app/composables/immersive-editor/variant/use-variant-catalog', () => ({
  useVariantCatalog: () => ({
    entries: shallowRef(mocks.entries),
    snapshot: shallowRef(null),
    loading: ref(false),
    errorText: ref(''),
    load: vi.fn(),
  }),
}));
vi.mock('@/app/composables/use-visible-resource-media', () => ({
  useVisibleResourceMedia: () => ({ setMediaRoot: () => {}, mediaRef: () => () => {}, mediaSrc: () => '' }),
}));
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: vi.fn() }) }));
function harness(
  kind: 'weapons' | 'wings' = 'weapons',
  count = 2,
  systemHints = false,
  costs: (number | null)[] = [],
  currentId = 'compatible',
  inPanel = false,
  emptyDeck = false,
) {
  const source = { source: 'mod' as const, root: 'M:/mod', path: 'M:/mod/table.csv', relPath: 'table.csv' };
  mocks.entries = [
    {
      id: 'compatible',
      label: '能量炮',
      data: { id: 'compatible', name: '能量炮', OPs: '10', cost_cruiser: '15', 'tech/manufacturer': 'High Tech', uiTags: 'Weapons' },
      spec: { size: 'SMALL', type: 'ENERGY' },
      specSource: null,
      specVersion: null,
      source,
      sourceVersion: { path: source.path, fingerprint: 'v' },
      resourceRefs: {},
      preview: null,
      projectile: null,
      primaryRole: null,
    },
    {
      id: 'incompatible',
      label: '实弹炮',
      data: { id: 'incompatible', name: '实弹炮', OPs: '5' },
      spec: { size: 'SMALL', type: 'BALLISTIC' },
      specSource: null,
      specVersion: null,
      source,
      sourceVersion: { path: source.path, fingerprint: 'v' },
      resourceRefs: {},
      preview: null,
      projectile: null,
      primaryRole: null,
    },
  ];
  if (count > 2)
    mocks.entries = Array.from({ length: count }, (_, index) => ({ ...mocks.entries[0]!, id: 'entry_' + index, label: '候选 ' + index }));
  if (costs.length)
    mocks.entries = costs.map((cost, index) => ({
      ...mocks.entries[0]!,
      id: 'entry_' + index,
      label: '候选 ' + index,
      data: { OPs: cost, 'op cost': cost, cost_cruiser: cost, cost_frigate: index },
    }));
  if (systemHints)
    mocks.entries.push({
      ...mocks.entries[0]!,
      id: 'system',
      label: '系统武器',
      data: { id: 'system', hints: ' PD, SYSTEM , ANTI_FTR ' },
      spec: { type: 'ENERGY', size: 'SMALL' },
    });
  mocks.entries.push({ ...mocks.entries[0]!, id: '', label: '', data: {} });
  mocks.entries = shallowReactive(mocks.entries);
  const inputs = createFieldInputs(ref('variant'));
  const current = ref(currentId);
  const commitManual = vi.fn(async () => true);
  const snapshot = variantJointFixture();
  const values = Object.fromEntries(snapshot.records.map((record) => [record.key, record.value]));
  if (emptyDeck) values.variant = { state: 'present', value: { ...jointObject(values.variant), wings: [''] } };
  const displaySnapshot = shallowRef(snapshot);
  const cancelVariantAction = vi.fn();
  const vm = {
    displaySnapshot,
    joint: { currentTarget: ref(snapshot.root), saving: ref(false) },
    referenceChanging: ref(false),
    variantActionPending: ref(false),
    commitVariantInputs: vi.fn(async () => true),
    cancelVariantAction,
  } as unknown as ReturnType<typeof useImmersiveVariantEditor>;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const wrapper = mount(
    {
      setup() {
        provideFieldInputs(inputs);
        return () =>
          inPanel
            ? h(VariantImmersivePanel, {
                panel: projectVariantPanel(snapshot, values),
                vm,
                render: { mode: 'readonly', root: snapshot.root, records: snapshot.records, mediaUrl: () => '' },
              })
            : h(VariantPicker, {
                root: { sessionId: 's', modRoot: 'M:/mod', kind: 'variant', id: 'variant' },
                kind,
                weaponSlot: { type: 'ENERGY', size: 'MEDIUM' },
                currentId: current.value,
                commitManual,
                anchor: { x: 400, y: 300 },
              });
      },
    },
    {
      attachTo: document.body,
      global: {
        components: { NInput, NSelect, NButton },
        stubs: {
          ImmersiveText: { props: ['text'], template: '<span>{{text}}</span>' },
          ImmersivePanelRow: true,
          VariantWingIcon: true,
          VariantRefitStats: true,
          ImmersiveHullScene: {
            emits: ['slot', 'blank'],
            template:
              '<div><button class="test-slot" @click="$emit(\'slot\', 1, {x: 400, y: 300})">槽位</button><button class="test-blank" @click="$emit(\'blank\')">空白网格</button></div>',
          },
          VariantCandidateDetails: { props: ['id'], template: '<aside>{{id}}</aside>' },
          VariantCandidateCard: {
            props: ['entry'],
            emits: ['select', 'hover', 'leave'],
            template:
              '<button class="variant-candidate-card" @click="$emit(\'select\')" @mouseenter="$emit(\'hover\', $event)" @mouseleave="$emit(\'leave\', $event)" @focus="$emit(\'hover\', $event)" @blur="$emit(\'leave\', $event)">{{entry.label}}</button>',
          },
        },
      },
    },
  );
  return { wrapper, inputs, current, commitManual, cancelVariantAction, displaySnapshot, picker: wrapper.findComponent(VariantPicker) };
}
describe('variant candidate picker', () => {
  it('retains filtered candidate nodes with hidden visibility', async () => {
    const own = harness();
    await flushPromises();
    await own.wrapper.find('[aria-label=实弹]').trigger('click');
    await flushPromises();
    const card = own.wrapper.get('[data-entry-id=incompatible]');
    await own.wrapper.find('input').setValue('能量');
    await flushPromises();
    expect(card.isVisible(), own.wrapper.html()).toBe(false);
    own.wrapper.unmount();
  });
  it('replaces the empty deck graphic with its source while retaining the slot button', async () => {
    const own = harness('wings', 2, false, [], '', true, true);
    await flushPromises();
    const slot = own.wrapper.find('.variant-wing-tile');
    expect(slot.find('img[alt="空置战机甲板"]').exists()).toBe(true);
    const resource = {
      source: 'core' as const,
      ownerKind: 'ship' as const,
      ownerId: 'refit-ui',
      key: 'fighterButtonBlank',
      relPath: 'deck.png',
    };
    const snapshot = own.displaySnapshot.value;
    deckMedia.dataUrl.mockReturnValue('deck.png');
    own.displaySnapshot.value = {
      ...snapshot,
      referenceSettings: { ...snapshot.referenceSettings, resources: { fighterButtonBlank: resource } },
    };
    await flushPromises();
    expect(deckMedia.replaceCollection).toHaveBeenLastCalledWith('s', 'empty-decks', [resource]);
    expect(slot.find('img').attributes('src')).toBe('deck.png');
    own.displaySnapshot.value = snapshot;
    await flushPromises();
    expect(own.wrapper.find('.variant-wing-tile').element).toBe(slot.element);
    expect(slot.find('img[alt="空置战机甲板"]').exists()).toBe(true);
    own.wrapper.unmount();
    deckMedia.dataUrl.mockReturnValue('');
  });
  it.each(['weapons', 'wings'] as const)('closes the %s panel from an empty scene hit and cancels its pending action', async (kind) => {
    const own = harness(kind, 2, false, [], '', true);
    await flushPromises();
    await own.wrapper.find(kind === 'weapons' ? '.test-slot' : '.variant-wing-tile').trigger('click');
    await flushPromises();
    expect(own.wrapper.find('.variant-picker').exists()).toBe(true);
    await own.wrapper.find('footer input').setValue('unfinished');
    expect(own.inputs.dirty.value).toBe(true);
    await own.wrapper.find('.test-blank').trigger('click');
    await flushPromises();
    expect(own.wrapper.find('.variant-picker').exists()).toBe(false);
    expect(own.inputs.dirty.value).toBe(false);
    expect(own.cancelVariantAction).toHaveBeenCalled();
    own.wrapper.unmount();
  });
  it('shows the six defaults and lets a manually enabled large size expand the result', async () => {
    const own = harness();
    mocks.entries.push({ ...mocks.entries[0]!, id: 'large', label: '大型能量', spec: { type: 'ENERGY', size: 'LARGE' } });
    await flushPromises();
    expect(own.wrapper.findAll('[role=checkbox]')).toHaveLength(6);
    expect(own.wrapper.findAll('[role=checkbox][aria-checked=true]').map((box) => box.attributes('aria-label'))).toEqual([
      '能量',
      '小型',
      '中型',
    ]);
    expect(own.wrapper.find('[data-entry-id=large]').exists()).toBe(false);
    await own.wrapper.find('[aria-label=大型]').trigger('click');
    await flushPromises();
    expect(own.wrapper.find('[data-entry-id=large]').exists()).toBe(true);
    await own.wrapper.find('[aria-label=能量]').trigger('click');
    expect(own.wrapper.findAll('.variant-picker-list .variant-candidate-card').filter((row) => row.isVisible())).toHaveLength(0);
    own.wrapper.unmount();
  });
  it('awaits manual confirmation and keeps rejected raw ID registered for save', async () => {
    const own = harness();
    await flushPromises();
    own.commitManual.mockResolvedValue(false);
    await own.wrapper.find('footer input').setValue('missing');
    expect(await own.inputs.commit()).toBe(false);
    expect(own.inputs.dirty.value).toBe(true);
    expect((own.wrapper.find('footer input').element as HTMLInputElement).value).toBe('missing');
    own.wrapper.unmount();
  });
  it.each(['weapons', 'wings'] as const)('shows only named candidates when the %s slot is empty', async (kind) => {
    const own = harness(kind);
    await flushPromises();
    expect(own.wrapper.find('.variant-current-title').text()).toContain('当前装备');
    own.current.value = '';
    await flushPromises();
    expect(own.wrapper.find('.variant-current-title').exists()).toBe(false);
    expect(own.wrapper.find('.variant-picker-tooltip').exists()).toBe(false);
    const cards = own.wrapper.findAll('.variant-picker-list [data-entry-id]').filter((row) => row.isVisible());
    expect(cards.map((card) => card.attributes('data-entry-id'))).toEqual(
      kind === 'weapons' ? ['compatible'] : ['compatible', 'incompatible'],
    );
    await cards[0]!.trigger('mouseenter');
    expect(own.wrapper.find('.variant-picker-tooltip aside').text()).toBe('compatible');
    await cards[0]!.trigger('click');
    expect(own.picker.emitted('select')).toEqual([['compatible', 'normal']]);
    own.wrapper.unmount();
  });
  it.each(['weapons', 'wings'] as const)('orders %s by descending OP through search, filtering and scrolling', async (kind) => {
    const own = harness(kind, 2, false, [5, 20, 10, 20, null, 0]);
    await flushPromises();
    const list = own.wrapper.find('.variant-picker-list');
    Object.defineProperty(list.element, 'clientHeight', { value: 468, configurable: true });
    await list.trigger('scroll');
    const ids = () =>
      own.wrapper
        .findAll('.variant-picker-list [data-entry-id]')
        .filter((row) => row.isVisible())
        .map((row) => row.attributes('data-entry-id'));
    const descending = ['entry_1', 'entry_3', 'entry_2', 'entry_0', 'entry_5', 'entry_4'];
    expect(ids()).toEqual(descending);
    await own.wrapper.find('input').setValue('候选');
    expect(ids()).toEqual(descending);
    if (kind === 'weapons') {
      await own.wrapper.find('[aria-label=大型]').trigger('click');
      expect(ids()).toEqual(descending);
    }
    await own.wrapper.find('input').setValue('entry_0');
    expect(ids()).toEqual(['entry_0']);
    await own.wrapper.find('input').setValue('');
    expect(ids()).toEqual(descending);
    list.element.scrollTop = 234;
    await list.trigger('scroll');
    list.element.scrollTop = 0;
    await list.trigger('scroll');
    expect(ids()).toEqual(descending);
    own.wrapper.unmount();
  });
  it('applies system hints when showing all weapons and searching', async () => {
    const own = harness('weapons', 2, true);
    await flushPromises();
    expect(own.wrapper.findAll('.variant-picker-list .variant-candidate-card').filter((row) => row.isVisible())).toHaveLength(1);
    await own.wrapper.find('[aria-label=实弹]').trigger('click');
    await flushPromises();
    expect(own.wrapper.findAll('.variant-picker-list .variant-candidate-card').filter((row) => row.isVisible()).length).toBeLessThan(20);
    await own.wrapper.find('input').setValue('system');
    await flushPromises();
    expect(own.wrapper.findAll('.variant-picker-list .variant-candidate-card').filter((row) => row.isVisible())).toHaveLength(0);
    own.wrapper.unmount();
  });
  it('mounts only the list window and focuses the last candidate through keyboard navigation', async () => {
    const own = harness('weapons', 200);
    await flushPromises();
    expect(own.wrapper.findAll('.variant-picker-list .variant-candidate-card').filter((row) => row.isVisible()).length).toBeLessThan(20);
    const list = own.wrapper.find('.variant-picker-list');
    Object.defineProperty(list.element, 'clientHeight', { value: 234, configurable: true });
    await list.trigger('scroll');
    await flushPromises();
    expect(own.wrapper.findAll('.variant-picker-list .variant-candidate-card').filter((row) => row.isVisible()).length).toBeLessThan(20);
    await own.wrapper.find('.variant-picker-list .variant-candidate-card').trigger('keydown', { key: 'End' });
    await flushPromises();
    expect(
      own.wrapper
        .findAll('.variant-picker-list .variant-candidate-card')
        .filter((row) => row.isVisible())
        .at(-1)!
        .text(),
    ).toBe('候选 199');
    own.wrapper.unmount();
  });
  it('defaults to compatible entries and searches formal ID and Chinese names', async () => {
    const own = harness();
    await flushPromises();
    expect(own.wrapper.findAll('.variant-picker-list .variant-candidate-card').filter((row) => row.isVisible())).toHaveLength(1);
    await own.wrapper.find('[aria-label=实弹]').trigger('click');
    await flushPromises();
    expect(own.wrapper.findAll('.variant-picker-list .variant-candidate-card').filter((row) => row.isVisible()).length).toBeLessThan(20);
    await own.wrapper.find('input').setValue('  INCOMPATIBLE  ');
    await flushPromises();
    expect(own.wrapper.findAll('.variant-picker-list .variant-candidate-card').filter((row) => row.isVisible())).toHaveLength(1);
    expect(own.wrapper.find('.variant-picker-list .variant-candidate-card').text()).toContain('实弹炮');
    await own.wrapper.find('input').setValue('能量');
    await flushPromises();
    expect(own.wrapper.find('.variant-picker-list .variant-candidate-card').text()).toContain('能量炮');
    own.wrapper.unmount();
  });
  it('registers unfinished manual input and cancels it through the owner', async () => {
    const own = harness();
    await flushPromises();
    const manual = own.wrapper.find('footer input');
    await manual.setValue('missing_id');
    expect(own.inputs.dirty.value).toBe(true);
    await own.inputs.commit();
    expect(own.commitManual).toHaveBeenCalledWith('missing_id');
    expect(own.inputs.dirty.value).toBe(false);
    await manual.setValue('cancelled');
    own.picker.vm.cancel();
    expect(own.inputs.dirty.value).toBe(false);
    expect(own.commitManual).toHaveBeenCalledTimes(1);
    own.wrapper.unmount();
  });
  it.each(['weapons', 'wings'] as const)('cancels the %s selector and unfinished ID through its blank-area entry', async (kind) => {
    const own = harness(kind);
    await flushPromises();
    expect(own.wrapper.find('header button.variant-cut-button').exists()).toBe(false);
    await own.wrapper.find('footer input').setValue('cancelled');
    await own.wrapper.find('input').trigger('click');
    await own.wrapper.find('.variant-picker-filters').trigger('click');
    await own.wrapper.find('.variant-picker-list .variant-candidate-card').trigger('mouseenter');
    await own.wrapper.find('.variant-picker-tooltip').trigger('click');
    expect(own.picker.emitted('close')).toBeUndefined();
    own.picker.vm.cancel();
    expect(own.picker.emitted('close')).toEqual([[]]);
    expect(own.inputs.dirty.value).toBe(false);
    expect(own.commitManual).not.toHaveBeenCalled();
    own.wrapper.unmount();
    expect(own.inputs.dirty.value).toBe(false);
  });
  it('commits clicked candidates and keeps Ctrl comparison within the picker', async () => {
    const own = harness();
    await flushPromises();
    await own.wrapper.find('.variant-picker-list .variant-candidate-card').trigger('click');
    expect(own.picker.emitted('select')).toEqual([['compatible', 'normal']]);
    await own.wrapper.find('[aria-label=实弹]').trigger('click');
    await flushPromises();
    await own.wrapper
      .findAll('.variant-picker-list .variant-candidate-card')
      .filter((row) => row.isVisible())[1]!
      .trigger('mouseenter');
    await own.wrapper.find('.variant-picker').trigger('keydown', { key: 'Control', ctrlKey: true });
    await flushPromises();
    expect(own.wrapper.findAll('.variant-picker-tooltip aside')).toHaveLength(2);
    await own.wrapper.find('input').setValue('能量');
    await flushPromises();
    expect(own.wrapper.findAll('.variant-picker-tooltip aside')).toHaveLength(0);
    own.wrapper.unmount();
  });
});
