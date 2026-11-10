import { mount, flushPromises } from '@vue/test-utils';
import { nextTick, ref, shallowRef } from 'vue';
import { describe, expect, it, vi, onTestFinished } from 'vitest';
import { CONFIG_FIELD_SOURCES } from '@/domain/schema/schema-source-definitions';
import { projectChangeFixture } from '@/test/unit/project-changes';
vi.mock('@/orchestrators/project-sync.orchestrator', () => import('@/test/unit/project-changes'));
import { useFieldSourceOptions } from './use-field-source-options';
import type { FieldEditorContext } from '@/domain/field-editor/field-editor-context';

const errors = vi.hoisted(() => vi.fn());
vi.mock('@/app/composables/use-app-feedback', () => ({ useAppFeedback: () => ({ error: errors }) }));

describe('schema source query lifecycle', () => {
  it.each(Object.entries(CONFIG_FIELD_SOURCES))('reloads %s from the saved resource scope', async (sourceId, relPath) => {
    const query = vi.fn(async () => [
      {
        origin: 'mod' as const,
        options: [{ label: 'Current', value: 'current', origin: 'mod' as const, description: null, resourceRef: null }],
      },
    ]);
    const wrapper = mount({
      setup() {
        useFieldSourceOptions({
          field: () => ({ key: 'id', label: 'ID', type: 'enum', source: sourceId }),
          value: () => '',
          runtimeContext: () => ({ sessionId: 'catalog', modRoot: 'M:/mod', querySourceOptions: query }),
        });
        return () => null;
      },
    });
    onTestFinished(() => wrapper.unmount());
    await flushPromises();
    expect(query).toHaveBeenCalledTimes(1);
    await projectChangeFixture('catalog', {
      paths: [],
      tables: [],
      entities: [],
      queryScopes: [],
      resources: [{ source: 'mod', relPath }],
      session: false,
    });
    expect(query).toHaveBeenCalledTimes(2);
    wrapper.unmount();
    await projectChangeFixture('catalog', {
      paths: [],
      tables: [],
      entities: [],
      queryScopes: [],
      resources: [{ source: 'mod', relPath }],
      session: false,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });
  it('revokes a pending source when the field no longer declares a source', async () => {
    errors.mockClear();
    let finish!: (value: []) => void;
    let signal!: AbortSignal;
    const field = ref({ key: 'id', label: 'ID', type: 'enum' as const, source: 'csv:weapons.id' });
    const query = vi.fn((_source: string, current?: AbortSignal) => {
      signal = current!;
      return new Promise<[]>((resolve) => {
        finish = resolve;
      });
    });
    let source!: ReturnType<typeof useFieldSourceOptions>;
    const wrapper = mount({
      setup() {
        source = useFieldSourceOptions({
          field: () => field.value,
          value: () => '',
          runtimeContext: () => ({ sessionId: 's1', modRoot: 'M:/A', querySourceOptions: query }),
        });
        return () => null;
      },
    });
    field.value.source = '';
    await nextTick();
    expect(signal.aborted).toBe(true);
    finish([]);
    await flushPromises();
    expect(source.sourceOptions.value).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it.each([
    'csv:weapons.id',
    'config:sounds',
    'config:designTypes',
    'config:hullStyles',
    'config:engineStyles',
    'hull:weaponSlots',
    'hull:moduleSlots',
  ])('reloads %s across targets, failures and retry', async (catalog) => {
    errors.mockClear();
    const query = vi.fn(async () => [
      { origin: 'mod' as const, options: [{ label: 'A', value: 'a', origin: 'mod' as const, description: null, resourceRef: null }] },
    ]);
    const context = shallowRef<FieldEditorContext>({ sessionId: 's1', modRoot: 'M:/A', querySourceOptions: query });
    let source!: ReturnType<typeof useFieldSourceOptions>;
    const wrapper = mount({
      setup() {
        source = useFieldSourceOptions({
          field: () => ({ key: 'id', label: 'ID', type: 'enum', source: catalog }),
          value: () => '',
          runtimeContext: () => context.value,
        });
        return () => null;
      },
    });
    await flushPromises();
    expect(source.sourceOptions.value[0]?.children?.[0]?.value).toBe('a');
    query.mockRejectedValueOnce(new Error('query failed'));
    context.value = { ...context.value, sessionId: 's2', modRoot: 'M:/B' };
    await flushPromises();
    expect(source.sourceOptions.value).toEqual([]);
    expect(errors).toHaveBeenCalledTimes(1);
    await source.reloadSourceOptions();
    expect(source.sourceOptions.value[0]?.children?.[0]?.value).toBe('a');
    wrapper.unmount();
  });

  it('keeps source refresh completion and failure owned by the saved-content delivery', async () => {
    const query = vi.fn(async () => [
      {
        origin: 'mod' as const,
        options: [{ label: 'Initial', value: 'initial', origin: 'mod' as const, description: null, resourceRef: null }],
      },
    ]);
    let source!: ReturnType<typeof useFieldSourceOptions>;
    const wrapper = mount({
      setup() {
        source = useFieldSourceOptions({
          field: () => ({ key: 'id', label: 'ID', type: 'enum', source: 'config:sounds' }),
          value: () => '',
          runtimeContext: () => ({ sessionId: 'delivery', modRoot: 'M:/mod', querySourceOptions: query }),
        });
        return () => null;
      },
    });
    onTestFinished(() => wrapper.unmount());
    await flushPromises();
    const invalidation = {
      paths: [],
      tables: [],
      entities: [],
      queryScopes: [],
      resources: [{ source: 'mod' as const, relPath: CONFIG_FIELD_SOURCES['config:sounds'] }],
      session: false,
    };
    let finish!: (value: []) => void;
    const waiting = new Promise<[]>((resolve) => {
      finish = resolve;
    });
    onTestFinished(async () => {
      finish([]);
      await flushPromises();
    });
    query.mockImplementationOnce(async () => waiting);
    let completed = false;
    const delivery = projectChangeFixture('delivery', invalidation).then(() => {
      completed = true;
    });
    await flushPromises();
    expect(query).toHaveBeenCalledTimes(2);
    expect(completed).toBe(false);
    finish([]);
    await delivery;
    expect(completed).toBe(true);
    expect(source.sourceOptions.value).toEqual([]);
    const failure = new Error('source read failed');
    query.mockRejectedValueOnce(failure);
    await expect(projectChangeFixture('delivery', invalidation)).rejects.toBe(failure);
    expect(query).toHaveBeenCalledTimes(3);
    await source.reloadSourceOptions();
    expect(query).toHaveBeenCalledTimes(4);
    expect(source.sourceOptions.value[0]?.children?.[0]?.value).toBe('initial');
    wrapper.unmount();
    await projectChangeFixture('delivery', invalidation);
    expect(query).toHaveBeenCalledTimes(4);
  });
});
