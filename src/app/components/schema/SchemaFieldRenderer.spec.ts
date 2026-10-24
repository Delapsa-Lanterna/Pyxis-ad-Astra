import { createFieldInputs, provideFieldInputs } from '@/shared/runtime/field-inputs';
import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldSchema } from '@/domain/schema/schema.types';
import { initializeSettingsStore, useSettingsStore } from '@/stores/settings.store';
import { createSettingsFixture } from '@/test/settings';
import SchemaFieldRenderer from './SchemaFieldRenderer.vue';
import { editorUiStubs } from '@/test/ui-stubs';
import { nSelect, nSwitch } from '@/test/ui-stubs';
import { h, nextTick, ref } from 'vue';
import { useEditTargetDraftSession } from '@/app/composables/use-edit-target-draft-session';
import { applySchemaFieldUpdate } from '@/domain/schema/schema-values';

const mocks = vi.hoisted(() => ({
  queryCoreFields: vi.fn(async () => ({})),
  queryCoreGraphics: vi.fn(async () => ['graphics/one.png', 'graphics/two.png']),
}));

vi.mock('@/services/core-assets.service', () => ({
  queryCoreFields: mocks.queryCoreFields,
  queryCoreGraphics: mocks.queryCoreGraphics,
}));

vi.mock('@/services/app-log.service', () => ({
  recordLogBestEffort: vi.fn(),
}));

vi.mock('@/app/composables/use-app-feedback', () => ({
  useAppFeedback: () => ({
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    confirmDanger: vi.fn(),
    confirmWarning: vi.fn(),
    choose: vi.fn(async () => null),
  }),
}));

let wrapper: import('@vue/test-utils').VueWrapper | null = null;

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

function fieldFixture(type: FieldSchema['type'], extra: Partial<FieldSchema> = {}): FieldSchema {
  return { key: 'field', type, label: 'Field', ...extra };
}

function mountField(field: FieldSchema, value: unknown, props: Record<string, unknown> = {}) {
  wrapper = mount(SchemaFieldRenderer, {
    props: { field, value, runtimeContext: null, ...props },
    global: { stubs: editorUiStubs },
  });
  return wrapper!;
}

function mountBoundField(field: FieldSchema, initial: unknown) {
  const inputs = createFieldInputs();
  const value = ref(initial);
  wrapper = mount(
    {
      setup() {
        provideFieldInputs(inputs);
        return () =>
          h(SchemaFieldRenderer, {
            field,
            value: value.value,
            onUpdate: (update) => {
              if (update.kind === 'set') value.value = update.value;
            },
          });
      },
    },
    { global: { stubs: editorUiStubs }, attachTo: document.body },
  );
  return { inputs, value };
}

describe('SchemaFieldRenderer smart mode', () => {
  it.each([undefined, false, true])('keeps object expansion permission %s independent of its contents', async (allowed) => {
    const definition = fieldFixture('object', {
      allowExtraFields: allowed,
      nested: [{ key: 'known', label: 'Known', type: 'string' }],
    });
    const { value, inputs } = mountBoundField(definition, { known: 'kept', custom: null });
    const extra = wrapper!.findAll('.schema-section').filter((group) => group.text().includes('额外字段'));
    expect(extra).toHaveLength(allowed === true ? 1 : 0);
    await wrapper!.get('input').setValue('updated');
    await inputs.commit();
    expect(value.value).toEqual({ known: 'updated', custom: null });
    value.value = { known: 'updated' };
    await nextTick();
    expect(wrapper!.findAll('.schema-section')).toHaveLength(allowed === true ? 1 : 0);
    if (allowed) {
      await wrapper!.findAll('button').at(-1)!.trigger('click');
      expect(value.value).toEqual({ known: 'updated', newField: null });
    }
  });

  it('keeps list-item and nested-object permissions independent of their open parent', async () => {
    const definition = fieldFixture('object', {
      allowExtraFields: true,
      nested: [
        {
          key: 'items',
          label: 'Items',
          type: 'array',
          item: { key: 'item', label: 'Item', type: 'object', nested: [{ key: 'name', label: 'Name', type: 'string' }] },
        },
      ],
    });
    const { value, inputs } = mountBoundField(definition, { items: [{ name: 'kept', ignored: { private: true } }] });
    expect(wrapper!.text()).not.toContain('ignored');
    await wrapper!.get('input').setValue('updated');
    await inputs.commit();
    expect(value.value).toEqual({ items: [{ name: 'updated', ignored: { private: true } }] });
  });
  it.each([
    ['true', undefined, true],
    ['FALSE', undefined, false],
    [undefined, true, true],
    [undefined, false, false],
  ] as const)('shows the game boolean %s with default %s without writing on mount', async (initial, fallback, enabled) => {
    const { value } = mountBoundField(fieldFixture('boolean', { default: fallback }), initial);
    const toggle = wrapper!.getComponent(nSwitch);
    expect(toggle.props('value')).toBe(enabled);
    expect(value.value).toBe(initial);
    toggle.vm.$emit('update:value', !enabled);
    await nextTick();
    expect(value.value).toBe(!enabled);
  });
  it('rejects an untouched empty required input and focuses it', async () => {
    const { inputs, value } = mountBoundField(fieldFixture('string', { required: true }), '');
    await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(value.value).toBe('');
    expect(document.activeElement).toBe(wrapper!.get('input').element);
    await wrapper!.get('input').setValue('sample-id');
    await inputs.commit();
    expect(value.value).toBe('sample-id');
  });
  it('edits version components in their declared types', async () => {
    const schema = (await import('@/domain/schema/config-schema-registry')).getSchema('mod-info')!;
    const version = schema.sections!.flatMap((section) => section.fields).find((field) => field.key === 'file.version')!;
    const { value, inputs } = mountBoundField(version, { major: 2, minor: '4a', patch: 1 });
    expect(wrapper!.findAll('textarea')).toHaveLength(0);
    await wrapper!
      .findAll('input')
      .find((input) => input.element.value === '2')!
      .setValue('3');
    await inputs.commit();
    expect(value.value).toEqual({ major: 3, minor: '4a', patch: 1 });
    await wrapper!
      .findAll('input')
      .find((input) => input.element.value === '4a')!
      .setValue('5b');
    await inputs.commit();
    expect(value.value).toEqual({ major: 3, minor: '5b', patch: 1 });
  });
  it('creates valid weapon groups and uses numeric engine-slot names', async () => {
    const { getSchema } = await import('@/domain/schema/config-schema-registry');
    const group = getSchema('variant')!
      .sections!.flatMap((section) => section.fields)
      .find((field) => field.key === 'weaponGroups')!;
    const mounted = mountBoundField(group, []);
    await wrapper!.findAll('button').at(-1)!.trigger('click');
    expect(mounted.value.value).toEqual([{ mode: 'LINKED', weapons: {}, autofire: false }]);
    wrapper!.unmount();
    const engines = getSchema('skin')!
      .sections!.flatMap((section) => section.fields)
      .find((field) => field.key === 'engineSlotChanges')!;
    const { value, inputs } = mountBoundField(engines, {});
    await wrapper!.findAll('button').at(-1)!.trigger('click');
    await wrapper!.findAll('button').at(-1)!.trigger('click');
    expect(value.value).toEqual({ '0': {}, '1': {} });
    await wrapper!.findAll('input.field-map-key-editor')[1]!.setValue('-1');
    await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(value.value).toEqual({ '0': {}, '1': {} });
  });
  it('keeps music file and files in one branch when either input is changed', async () => {
    const schema = (await import('@/domain/schema/config-schema-registry')).getSchema('sounds')!;
    const track = schema.root!.nested![0]!.valueSchema!.item!;
    const { value, inputs } = mountBoundField(track, { source: 'sounds/music', file: 'solo.ogg', volume: 1 });
    const files = wrapper!.findAllComponents({ name: 'SchemaCollectionInput' }).find((input) => input.props('field').key === 'files')!;
    await files.findAll('button').at(-1)!.trigger('click');
    expect(value.value).toEqual({ source: 'sounds/music', volume: 1, files: [''] });
    const file = wrapper!.findAllComponents({ name: 'SchemaScalarInput' }).find((input) => input.props('field').key === 'file')!;
    await file.get('input').setValue('other.ogg');
    await inputs.commit();
    expect(value.value).toEqual({ source: 'sounds/music', volume: 1, file: 'other.ogg' });
  });
  it('limits fallback roles and prepares direct root text with the existing input', async () => {
    const { getSchema } = await import('@/domain/schema/config-schema-registry');
    const roles = getSchema('faction')!
      .sections!.flatMap((section) => section.fields)
      .find((field) => field.key === 'file.shipRoles')!;
    mountBoundField(
      roles.valueSchema!.nested!.find((field) => field.key === 'fallback')!,
      { 'sample.role': 1 },
    );
    expect(wrapper!.findAll('button').filter((button) => button.text().startsWith('+'))).toHaveLength(0);
    wrapper!.unmount();
    const { value, inputs } = mountBoundField(getSchema('strings')!.root!, { existing: { line: '001' } });
    await wrapper!
      .findAll('button')
      .find((button) => button.text() === '+ 根级文本')!
      .trigger('click');
    expect(value.value).toEqual({ existing: { line: '001' }, newField: '' });
    const input = wrapper!.findAll('textarea').at(-1)!;
    await input.setValue('123\n $sample');
    await inputs.commit();
    expect(value.value).toEqual({ existing: { line: '001' }, newField: '123\n $sample' });
  });
  it('edits nested text maps without converting strings or overwriting duplicate keys', async () => {
    const schema = (await import('@/domain/schema/config-schema-registry')).getSchema('strings')!.root!;
    const value = ref<import('@/shared/types').RowData>({ first: { line: '001' }, second: {} });
    wrapper = mount(
      {
        setup: () => () =>
          h(SchemaFieldRenderer, {
            field: schema,
            value: value.value,
            onUpdate: (update) => {
              if (update.kind === 'set') value.value = update.value as import('@/shared/types').RowData;
            },
          }),
      },
      { global: { stubs: editorUiStubs } },
    );
    await wrapper.get('textarea').setValue('123\n $token "text" ');
    expect(value.value.first).toEqual({ line: '123\n $token "text" ' });
    const names = () => wrapper!.findAll('input.field-map-key-editor');
    await names()[0]!.setValue('second');
    expect(Object.keys(value.value)).toEqual(['first', 'second']);
    await names()[0]!.setValue('组.一');
    expect(value.value['组.一']).toEqual({ line: '123\n $token "text" ' });
    await names()[1]!.setValue('_句.子');
    expect(value.value['组.一']).toEqual({ '_句.子': '123\n $token "text" ' });
    const add = () => wrapper!.findAll('button').filter((button) => button.text() === '+ 添加项' || button.text() === '+ 文本分组');
    await add().at(-1)!.trigger('click');
    expect(value.value.newField).toEqual({});
    await add()[0]!.trigger('click');
    expect(value.value['组.一']).toEqual({ '_句.子': '123\n $token "text" ', newField: '' });
    await wrapper.findAll('.schema-section')[0]!.findAll('button.compact-icon-button')[1]!.trigger('click');
    expect(value.value['组.一']).toEqual({ newField: '' });
  });
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore(createSettingsFixture());
  });

  it.each([
    ['string', 'before', 'after', 'after'],
    ['text', 'before', '001\n $token "line" ', '001\n $token "line" '],
    ['json', null, '[1,{"flag":true}]', [1, { flag: true }]],
  ] as const)('commits %s once, preserves pending text and cancels with Escape', async (type, initial, raw, expected) => {
    const { value, inputs } = mountBoundField(fieldFixture(type), initial);
    const input = wrapper!.get<HTMLInputElement | HTMLTextAreaElement>(type === 'string' ? 'input' : 'textarea');
    input.element.value = raw;
    await input.trigger('input');
    expect(value.value).toEqual(initial);
    expect(inputs.dirty.value).toBe(true);
    if (type !== 'string') {
      await input.trigger('keydown', { key: 'Enter' });
      expect(value.value).toEqual(initial);
    }
    await input.trigger('keydown', { key: 'Enter', ctrlKey: type !== 'string' });
    expect(value.value).toEqual(expected);
    await input.trigger('blur');
    expect(wrapper!.getComponent(SchemaFieldRenderer).emitted('update')).toHaveLength(1);
    input.element.value = 'pending';
    await input.trigger('input');
    await input.trigger('keydown', { key: 'Escape' });
    expect(value.value).toEqual(expected);
    expect(inputs.dirty.value).toBe(false);
  });

  it.each(['smart', 'plain'] as const)('retains undeclared nested values as JSON text in %s mode', async (mode) => {
    useSettingsStore().setEditMode(mode);
    const initial = { known: 'kept', 'extra.key': { enabled: true, count: 3 }, nil: null };
    const { value, inputs } = mountBoundField(
      fieldFixture('object', { allowExtraFields: true, nested: [{ key: 'known', label: 'Known', type: 'string' }] }),
      initial,
    );
    if (mode === 'smart') {
      expect(wrapper!.find('.n-switch-stub').exists()).toBe(false);
      expect(wrapper!.findAll('textarea').some((input) => input.element.value === 'null')).toBe(true);
      const extra = wrapper!.findAll('textarea').find((input) => input.element.value.includes('enabled'))!;
      await extra.setValue('[1, "001", null]');
      await inputs.commit();
      expect(value.value).toEqual({ ...initial, 'extra.key': [1, '001', null] });
    } else {
      await wrapper!.get('textarea').setValue('[]');
      await expect(inputs.commit()).rejects.toMatchObject({ action: 'commit-field-inputs' });
      expect(value.value).toEqual(initial);
    }
  });

  it('keeps a surviving list input and uses the declared initial value after deleting an equal item', async () => {
    const { value } = mountBoundField(
      fieldFixture('array', { item: { key: 'number', label: 'Number', type: 'integer', default: 7 } }),
      [2, 2],
    );
    const retained = wrapper!.findAll('input')[1]!.element;
    await wrapper!.findAll('button.compact-icon-button')[0]!.trigger('click');
    expect(value.value).toEqual([2]);
    expect(wrapper!.get('input').element).toBe(retained);
    await wrapper!.findAll('button').at(-1)!.trigger('click');
    expect(value.value).toEqual([2, 7]);
  });

  it.each([{ slot: 'one' }, [{ slot: 'one' }, { slot: 'two' }]])(
    'retains the stored dictionary form when renaming an entry',
    async (initial) => {
      const { value } = mountBoundField(
        fieldFixture('object', {
          allowExtraFields: true,
          format: 'array-of-entries',
          valueSchema: { key: 'value', label: 'Value', type: 'string' },
        }),
        initial,
      );
      await wrapper!.findAll('input.field-map-key-editor')[0]!.setValue('renamed.key');
      expect(value.value).toEqual(Array.isArray(initial) ? [{ 'renamed.key': 'one' }, { slot: 'two' }] : { 'renamed.key': 'one' });
    },
  );

  it('expands descriptions without replacing focused input and keeps notices visible', async () => {
    const field = mountField(
      fieldFixture('string', { description: 'Detailed explanation', warning: 'Caution text', danger: 'Risk text' }),
      'raw',
    );
    expect(field.find('.field-description').exists()).toBe(false);
    expect(field.get('.field-warning').text()).toContain('Caution text');
    expect(field.get('.field-danger').text()).toContain('Risk text');
    expect(field.get('.field-label').attributes('title')).toBe('field\nDetailed explanation');
    const input = field.get('input').element;
    document.body.append(field.element);
    input.focus();
    await field.get('input').setValue('pending text');
    const settings = useSettingsStore();
    settings.setExpandFieldDescriptions(true);
    await nextTick();
    expect(field.get('.field-description').text()).toBe('Detailed explanation');
    expect(field.get('.field-label').attributes('title')).toBe('field');
    expect(field.get('input').element).toBe(input);
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('pending text');
    settings.setExpandFieldDescriptions(false);
    await nextTick();
    expect(field.find('.field-description').exists()).toBe(false);
    expect(field.findAll('.field-warning, .field-danger')).toHaveLength(2);
    field.element.remove();
  });

  it.each(['object', 'array', 'object-list'] as const)('applies description display to nested %s fields', async (type) => {
    const nested = fieldFixture('string', {
      key: 'name',
      description: 'Nested explanation',
      warning: 'Nested caution',
      danger: 'Nested risk',
    });
    const field = mountField(
      fieldFixture(
        type === 'object' ? 'object' : 'array',
        type === 'array'
          ? { item: nested }
          : type === 'object'
            ? { nested: [nested] }
            : { item: { key: 'item', type: 'object', label: 'Item', nested: [nested] } },
      ),
      type === 'object' ? { name: 'value' } : type === 'array' ? ['value'] : [{ name: 'value' }],
    );
    expect(field.find('.field-description').exists()).toBe(false);
    expect(field.findAll('.field-warning, .field-danger')).toHaveLength(2);
    expect(field.findAll('.field-label').at(-1)!.attributes('title')).toContain('\nNested explanation');
    useSettingsStore().setExpandFieldDescriptions(true);
    await nextTick();
    expect(field.get('.field-description').text()).toBe('Nested explanation');
    expect(field.findAll('.field-warning, .field-danger')).toHaveLength(2);
  });

  it('preserves object-array input nodes and focus across cloned drafts', async () => {
    wrapper = mount(
      {
        setup() {
          const draft = useEditTargetDraftSession({
            emptyValue: [{ name: 'A' }, { name: 'B' }],
            load: () => ({ target: 'one', baseVersions: [], meta: null, value: [] as { name: string }[] }),
            targetKey: (id: string) => id,
          });
          provideFieldInputs(draft.inputs);
          return () =>
            h(SchemaFieldRenderer, {
              field: fieldFixture('array', {
                item: { key: 'item', type: 'object', label: 'Item', nested: [{ key: 'name', type: 'string', label: 'Name' }] },
              }),
              value: draft.draftValue.value,
              onUpdate: (value) => {
                if (value.kind === 'set') draft.draftValue.value = value.value as { name: string }[];
              },
            });
        },
      },
      { global: { stubs: editorUiStubs }, attachTo: document.body },
    );
    const first = wrapper.get('input');
    first.element.focus();
    await first.setValue('AX');
    expect(wrapper.get('input').element).toBe(first.element);
    expect(document.activeElement).toBe(first.element);
    expect(wrapper.findAll('.schema-section')).toHaveLength(2);
  });

  it('keeps key-value controls attached to the surviving row', async () => {
    const values = ref({ A: 'a', B: 'b', C: 'c' });
    wrapper = mount(
      {
        setup: () => () =>
          h(SchemaFieldRenderer, {
            field: fieldFixture('object', { allowExtraFields: true }),
            value: values.value,
            onUpdate: (value) => {
              if (value.kind === 'set') values.value = value.value as typeof values.value;
            },
          }),
      },
      { global: { stubs: editorUiStubs } },
    );
    const names = () => wrapper!.findAll('input.field-map-key-editor');
    const surviving = names()[1]!.element;
    await wrapper.findAll('.schema-field')[1]!.get('button').trigger('click');
    expect(names().map((input) => (input.element as HTMLInputElement).value)).toEqual(['B', 'C']);
    expect(names()[0]!.element).toBe(surviving);
  });

  it('renders strings as a single-line input and emits text', async () => {
    const field = mountField(fieldFixture('string'), 'hello');
    const input = field.get('input');
    expect((input.element as HTMLInputElement).value).toBe('hello');
    await input.setValue('world');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 'world' }]);
  });

  it.each([
    ['integer', 3, '9', 9],
    ['float', 0.5, '1.5', 1.5],
  ] as const)('emits typed numbers for %s fields', async (type, value, raw, expected) => {
    const field = mountField(fieldFixture(type), value);
    await field.get('input').setValue(raw);
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: expected }]);
  });

  it('toggles boolean fields through the switch stub', async () => {
    const field = mountField(fieldFixture('boolean'), false);
    await field.get('.n-switch-stub').trigger('click');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: true }]);
  });

  it('renders enum options and emits the selected value', async () => {
    const field = mountField(fieldFixture('enum', { options: ['A', 'B'] }), 'A');
    const select = field.get('select');
    const options = select.findAll('option');
    expect(options.map((option) => option.text())).toEqual(['A', 'B']);
    await select.setValue(JSON.stringify('B'));
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 'B' }]);
  });

  it('renders string arrays as a multi picker in smart mode', () => {
    const field = mountField(fieldFixture('string-array'), ['a', 'b']);
    expect(field.find('select').exists()).toBe(true);
  });

  it('routes a numeric tag template to the field custom input and commits the edited value', async () => {
    const inputs = createFieldInputs();
    const value = ref<string[]>([]);
    const runtimeContext = {
      modRoot: 'D:/fixture/mod',
      sessionId: 'session-1',
      querySourceOptions: async () => [
        {
          origin: 'core' as const,
          options: [
            {
              label: 'kinetic* (动能)',
              value: 'kinetic*',
              description: '武器级别',
              resourceRef: null,
              origin: 'core' as const,
              templateValue: 'kinetic0',
              templateMax: 99,
            },
          ],
        },
      ],
    };
    wrapper = mount(
      {
        setup() {
          provideFieldInputs(inputs);
          return () =>
            h(SchemaFieldRenderer, {
              field: fieldFixture('string-array', { source: 'csv:weapons.tags' }),
              value: value.value,
              runtimeContext,
              onUpdate: (update) => {
                if (update.kind === 'set') value.value = update.value as string[];
              },
            });
        },
      },
      { global: { stubs: editorUiStubs } },
    );
    const field = wrapper;
    await flushPromises();
    await nextTick();
    const select = field.findComponent(nSelect);
    expect(select.props('options')).toContainEqual(expect.objectContaining({ label: '数字标签' }));
    await select.vm.$emit('update:value', ['kinetic*']);
    await nextTick();
    expect(inputs.dirty.value).toBe(true);
    inputs.cancel();
    expect(value.value).toEqual([]);
    expect(inputs.dirty.value).toBe(false);
    await nextTick();
    await select.vm.$emit('update:value', ['kinetic*']);
    await nextTick();
    const input = field.findAll('input').at(-1)!;
    expect((input.element as HTMLInputElement).value).toBe('kinetic0');
    (input.element as HTMLInputElement).value = 'kinetic7';
    await input.trigger('input');
    expect(await inputs.commit()).toBe(true);
    expect(value.value).toEqual(['kinetic7']);
    expect(inputs.dirty.value).toBe(false);
  });

  it('edits dictionary names as text and preserves their mapped value', async () => {
    const inputs = createFieldInputs();
    const value = ref<Record<string, number>>({ existing: 3 });
    const runtimeContext = {
      modRoot: 'D:/fixture/mod',
      sessionId: 'session-1',
      querySourceOptions: async () => [
        {
          origin: 'core' as const,
          options: [
            {
              label: 'kinetic* (动能)',
              value: 'kinetic*',
              description: '武器级别',
              resourceRef: null,
              origin: 'core' as const,
              templateValue: 'kinetic0',
              templateMax: 99,
            },
          ],
        },
      ],
    };
    wrapper = mount(
      {
        setup() {
          provideFieldInputs(inputs);
          return () =>
            h(SchemaFieldRenderer, {
              field: fieldFixture('object', { allowExtraFields: true, source: 'csv:ships.tags' }),
              value: value.value,
              runtimeContext,
              onUpdate: (update) => {
                if (update.kind === 'set') value.value = update.value as Record<string, number>;
              },
            });
        },
      },
      { global: { stubs: editorUiStubs } },
    );
    const field = wrapper;
    await flushPromises();
    expect(field.findComponent(nSelect).exists()).toBe(false);
    const input = field.get('input.field-map-key-editor');
    expect((input.element as HTMLInputElement).value).toBe('existing');
    (input.element as HTMLInputElement).value = 'kinetic12';
    await input.trigger('input');
    expect(await inputs.commit()).toBe(true);
    expect(value.value).toEqual({ kinetic12: 3 });
  });

  it('preserves multiline text and emits edits', async () => {
    const field = mountField(fieldFixture('text'), 'multi\nline');
    expect(field.get<HTMLTextAreaElement>('textarea').element.value).toBe('multi\nline');
    await field.get('textarea').setValue('changed');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 'changed' }]);
  });

  it('emits raw path input', async () => {
    const path = mountField(fieldFixture('path'), 'graphics/x.png');
    await path.get('input').setValue('graphics/y.png');
    expect(path.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 'graphics/y.png' }]);
  });

  it('commits color text as RGBA channels', async () => {
    const color = mountField(fieldFixture('color-rgba'), [255, 0, 0, 255]);
    const colorInput = color.get('.color-picker-text-input');
    expect((colorInput.element as HTMLInputElement).value).toBe('255,0,0,255');
    await colorInput.setValue('[1, 2, 3, 4]');
    await colorInput.trigger('keyup.enter');
    expect(color.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: [1, 2, 3, 4] }]);
  });

  it('disables fields flagged as read-only', () => {
    const field = mountField(fieldFixture('string', { editable: false }), 'fixed');
    expect(field.get('input').attributes('disabled')).toBeDefined();
  });
});

describe('SchemaFieldRenderer plain mode', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    initializeSettingsStore(createSettingsFixture({ editMode: 'plain' }));
  });

  it('renders enums as plain text inputs without options', async () => {
    const field = mountField(fieldFixture('enum', { options: ['A'] }), 'A');
    const input = field.get('input');
    expect((input.element as HTMLInputElement).value).toBe('A');
    await input.setValue('B');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 'B' }]);
  });

  it('joins string arrays into a comma list and splits input back', async () => {
    const field = mountField(fieldFixture('string-array'), ['a', 'b']);
    expect((field.get('input').element as HTMLInputElement).value).toBe('a, b');
    await field.get('input').setValue('x, y');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: ['x', 'y'] }]);
  });

  it('wraps tag selections into the game tag format', async () => {
    const field = mountField(fieldFixture('tag-select'), ['tag1']);
    expect((field.get('input').element as HTMLInputElement).value).toBe('tag1');
    await field.get('input').setValue('tag2, tag3');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: ['tag2', 'tag3'] }]);
  });

  it('emits raw numbers without number controls in plain mode', async () => {
    const field = mountField(fieldFixture('integer'), 4);
    await field.get('input').setValue('12');
    expect(field.emitted('update')?.at(-1)).toEqual([{ kind: 'set', value: 12 }]);
  });

  it('keeps incomplete scalar text outside the typed draft and removes optional keys on commit', async () => {
    let session!: ReturnType<typeof useEditTargetDraftSession<Record<string, import('@/shared/types').JsonValue>, string, null>>;
    const save = vi.fn(async (_target: string, value: Record<string, import('@/shared/types').JsonValue>) => ({
      target: 'one',
      baseVersions: [],
      meta: null,
      value,
    }));
    wrapper = mount(
      {
        setup() {
          session = useEditTargetDraftSession({
            emptyValue: {},
            load: () => ({ target: 'one', baseVersions: [], meta: null, value: { count: 4 } }),
            save,
            targetKey: (key: string) => key,
          });
          provideFieldInputs(session.inputs);
          return () =>
            h(SchemaFieldRenderer, {
              field: fieldFixture('integer', { key: 'count' }),
              value: session.draftValue.value.count,
              onUpdate: (update) => session.setDraft(applySchemaFieldUpdate(session.draftValue.value, 'count', update)),
            });
        },
      },
      { global: { stubs: editorUiStubs }, attachTo: document.body },
    );
    await session.loadTarget('one');
    await wrapper.get('input').setValue('-');
    expect(session.draftValue.value.count).toBe(4);
    expect(session.dirty.value).toBe(true);
    await expect(session.saveDraft()).rejects.toMatchObject({ action: 'commit-field-inputs' });
    expect(document.activeElement).toBe(wrapper.get('input').element);
    await wrapper.get('input').setValue('');
    await session.saveDraft();
    expect(save).toHaveBeenCalledWith('one', {}, []);
  });
});
