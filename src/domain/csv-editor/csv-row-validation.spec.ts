import { describe, expect, it } from 'vitest';
import { TABLE_KEYS, type CsvTableKey, type RowData, type CsvValidationContext, type CsvDraftRow } from '@/shared/types';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import { csvRowProblems } from './csv-row-validation';
import { csvValidationRequest } from './csv-rule-context';
import { csvValueError } from '@/domain/schema/csv-value-validation';
import { createEditorProblems } from '@/shared/runtime/editor-problems';
import { createFieldInputs } from '@/shared/runtime/field-inputs';

function sample(table: CsvTableKey, values: RowData = {}): CsvDraftRow {
  const columns = getCsvColumnSchemas(table);
  const data: RowData = Object.fromEntries(
    columns.map((c) => [c.key, c.required ? (c.control === 'number' ? '1' : (c.options?.[0] ?? 'sample')) : '']),
  );
  return { rowKey: 'entry', isComment: false, data: { ...data, id: 'entry', name: 'Sample', ...values } };
}
function check(table: CsvTableKey, values: RowData, context: CsvValidationContext | null = null) {
  return csvRowProblems(
    table,
    [sample(table, values)],
    getCsvColumnSchemas(table).map((c) => c.key),
    context,
  );
}
function context(table: CsvTableKey, values: RowData): CsvValidationContext {
  const row = sample(table, values),
    request = csvValidationRequest(table, [row]);
  return {
    complete: true,
    entities: Object.fromEntries(request.entities.map(({ kind, id }) => [`${kind}:${id}`, {}])),
    sources: Object.fromEntries(
      request.sources.flatMap((source) => [
        [source, Object.values(row.data).map(String)],
        [`external:${source}`, []],
      ]),
    ),
    files: Object.fromEntries(request.files.map((path) => [path, true])),
    classes: Object.fromEntries(request.classes.map((name) => [name, true])),
  };
}
describe('CSV declared types and complete row rules', () => {
  it('keeps disabled skill records outside checks and dependency requests', () => {
    const row = { rowKey: 'archived', isComment: false, data: { id: '#archived', order: '' } };
    expect(csvRowProblems('skills', [row], ['id', 'order'], context('skills', {}))).toEqual([]);
    expect(csvValidationRequest('skills', [row]).entities).toEqual([]);
    expect(row.data.id).toBe('#archived');
  });
  it.each(['ships', 'weapons', 'shipSystems'] as const)('reports an unapplied %s row as a warning', (table) => {
    const ctx = context(table, {});
    ctx.entities = {};
    expect(check(table, {}, ctx).filter((issue) => issue.code === 'csv.spec_missing')).toMatchObject([
      { severity: 'warning', message: expect.stringContaining('游戏会警告并跳过此行') },
    ]);
  });
  it.each([
    ['SHIP', 'ship', 0],
    ['SHIP', 'skin', 0],
    ['SHIP', 'variant', 1],
    ['WEAPON', 'weapon', 0],
    ['WEAPON', 'skin', 1],
    ['SHIP_SYSTEM', 'system', 0],
    ['FACTION', 'faction', 0],
  ] as const)('matches description type %s against %s with %s warnings', (type, kind, count) => {
    const values = { type, text1: 'Sample description' };
    const ctx = context('descriptions', values);
    ctx.entities = { [`${kind}:entry`]: {} };
    expect(check('descriptions', values, ctx)).toHaveLength(count);
    ctx.entities = {};
    expect(check('descriptions', values, ctx)).toEqual([
      expect.objectContaining({ code: 'csv.description_reference', path: 'entry/id', severity: 'warning' }),
    ]);
  });
  it.each(TABLE_KEYS)('preserves annotation rows in %s', (table) => {
    const columns = getCsvColumnSchemas(table),
      row = sample(table, Object.fromEntries(columns.map((column) => [column.key, 'Section']))),
      header = columns.map((column) => column.key);
    row.data[table === 'simOpponents' ? 'variant id' : 'id'] = '';
    expect(csvRowProblems(table, [row], header, null)).toEqual([]);
    expect(csvValidationRequest(table, [row])).toEqual({ entities: [], sources: [], files: [], classes: [] });
  });
  it.each(TABLE_KEYS)('accepts the declared required values of %s', (table) => {
    expect(check(table, {}).filter((issue) => issue.severity === 'error')).toEqual([]);
  });
  it.each([
    ['ships', 'mass', 'broken'],
    ['ships', 'shield type', 'invalid'],
    ['ships', 'hints', 'UNKNOWN_HINT'],
    ['weapons', 'ammo', '1.25'],
    ['weapons', 'range', 'Infinity'],
    ['weapons', 'hints', 'UNKNOWN_HINT'],
    ['wings', 'num', '1.5'],
    ['wings', 'refit', ''],
    ['wings', 'formation', 'invalid'],
    ['hullmods', 'cost_frigate', ''],
    ['hullmods', 'script', ''],
    ['skills', 'order', 'NaN'],
    ['shipSystems', 'noFiring', 'yes'],
    ['abilities', 'unlockedAtStart', '1'],
    ['commodities', 'price variability', '4.5'],
    ['commodities', 'baseRaidDanger', '4'],
    ['industries', 'disruptDanger', '4'],
    ['specialItems', 'baseRaidDanger', '4'],
    ['submarkets', 'order', 'broken'],
    ['marketConditions', 'planetary', '1'],
    ['descriptions', 'type', 'invalid'],
  ] as const)('blocks %s / %s = %s as a type error', (table, key, value) => {
    expect(check(table, { [key]: value })).toEqual(
      expect.arrayContaining([expect.objectContaining({ severity: 'error', code: 'csv.value_invalid', path: `entry/${key}` })]),
    );
  });
  it.each([
    ['ships', '', '', 1],
    ['ships', '', 'Cruiser', 0],
    ['ships', 'Sample', '', 0],
    ['ships', 'Sample', 'Cruiser', 0],
    ['weapons', '', 'Cruiser', 1],
    ['weapons', 'Sample', '', 0],
  ] as const)('checks %s display name %j and designation %j', (table, name, designation, count) => {
    const warnings = check(table, { name, designation }).filter((issue) => issue.path === 'entry/name' && issue.severity === 'warning');
    expect(warnings).toHaveLength(count);
    if (table === 'ships' && count) expect(warnings[0]!.message).toContain('名称与定位均为空');
  });
  it('accepts finite Java-style numbers, boolean case and the full damage enum', () => {
    expect(csvValueError({ key: 'amount', control: 'number', valueType: 'integer' }, '2e2')).toBeNull();
    expect(csvValueError({ key: 'amount', control: 'number', valueType: 'float' }, '1.5f')).toBeNull();
    expect(csvValueError({ key: 'amount', control: 'number', valueType: 'integer' }, '2147483648')).toContain('32 位');
    expect(csvValueError({ key: 'flag', control: 'boolean' }, 'FALSE')).toBeNull();
    expect(check('weapons', { type: 'OTHER' }).filter((i) => i.severity === 'error')).toEqual([]);
    for (const type of ['TOGGLE', 'DURATION', 'custom'])
      expect(check('abilities', { type }).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it.each(['beam', 'projectile', null])('uses the declared burst size type with associated spec %s', (specClass) => {
    expect(getCsvColumnSchemas('weapons').find((column) => column.key === 'burst size')!.valueType).toBe('float');
    for (const [value, count] of [
      ['2.625', 0],
      ['7e1', 0],
      ['invalid', 1],
    ] as const) {
      const row = sample('weapons', { 'burst size': value });
      const ctx = specClass ? context('weapons', row.data) : null;
      if (ctx) ctx.entities['weapon:entry'] = { specClass };
      const issues = csvRowProblems(
        'weapons',
        [row],
        getCsvColumnSchemas('weapons').map((column) => column.key),
        ctx,
      );
      expect(issues.filter((issue) => issue.code === 'csv.value_invalid' && issue.path === 'entry/burst size')).toHaveLength(count);
      expect(row.data['burst size']).toBe(value);
    }
  });
  it('requires actual columns and skips comments and completely empty records', () => {
    expect(csvRowProblems('ships', [sample('ships')], ['id'], null)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'csv.column_missing', path: 'mass' }),
        expect.objectContaining({ code: 'csv.column_missing', path: 'shield type' }),
      ]),
    );
    expect(
      csvRowProblems(
        'ships',
        [
          { rowKey: 'blank', isComment: false, data: {} },
          { ...sample('ships', { mass: 'bad' }), isComment: true },
        ],
        [],
        null,
      ),
    ).toEqual([]);
  });
  it.each([
    ['PD_ALSO', '兼用点防御'],
    ['PD_ONLY,PD_ALSO', '专用条件'],
    ['CONSERVE_2,CONSERVE_4', '优先采用 CONSERVE_2'],
    ['CONSERVE_3,DO_NOT_CONSERVE', '跳过多项'],
    ['RANGE_FROM_TARGETING_OVAL,RANGE_FROM_SHIP_RADIUS', '目标轮廓'],
    ['GROUP_LINKED,GROUP_ALTERNATING', '编组偏好'],
    ['IMPORTANT,NO_MANUAL_FIRE', '手控排除'],
  ])('warns about the actual hint combination %s', (hints, message) => {
    expect(check('weapons', { hints }).some((i) => i.severity === 'warning' && i.message.includes(message!))).toBe(true);
  });
  it('allows USE_VS_FRIGATES on its own', () => {
    expect(check('weapons', { hints: 'USE_VS_FRIGATES' })).toEqual([]);
  });
  it('retains each independent hint warning through the shared problem collection', () => {
    const fields = createFieldInputs();
    const problems = createEditorProblems(fields, () =>
      check('weapons', { hints: 'GROUP_LINKED,GROUP_ALTERNATING,IMPORTANT,NO_MANUAL_FIRE' }),
    );
    expect(problems.issues.value).toHaveLength(2);
    fields.release();
  });
  it('checks ship relationships, drawing order and phase system replacement', () => {
    const result = check('ships', {
      'min crew': '5',
      'max crew': '2',
      minPieces: '8',
      maxPieces: '3',
      hints: 'WEAPONS_FRONT_TO_BACK,WEAPONS_BACK_TO_FRONT',
      'shield type': 'PHASE',
      'system id': 'other',
    });
    for (const text of ['min crew 大于 max crew', 'minPieces 大于 maxPieces', '优先采用 WEAPONS_FRONT_TO_BACK', 'phasecloak'])
      expect(result.some((i) => i.message.includes(text))).toBe(true);
  });
  it('checks actual ship slots and hull size from resolved content', () => {
    const values = { hints: 'PLAY_FIGHTER_OVERLOAD_SOUNDS,MISSILE_HARDPOINTS_ROTATE,CARRIER' },
      ctx = context('ships', values);
    ctx.entities['ship:entry'] = { hullSize: 'CRUISER', weaponSlots: [] };
    expect(check('ships', values, ctx).filter((i) => i.path === 'entry/hints')).toHaveLength(3);
  });
  it('checks weapon branch, projectile and ammo-sensitive hints', () => {
    const values = { hints: 'CONSERVE_2,DIRECT_AIM', 'damage/shot': '5' },
      ctx = context('weapons', values);
    ctx.entities['weapon:entry'] = { specClass: 'beam', type: 'ENERGY' };
    const result = check('weapons', values, ctx);
    expect(result.some((i) => i.path === 'entry/damage/shot')).toBe(true);
    expect(result.filter((i) => i.path === 'entry/hints')).toHaveLength(2);
    ctx.entities['weapon:entry'] = { specClass: 'projectile', projectileSpecId: 'missing' };
    expect(check('weapons', values, ctx).some((i) => i.code === 'csv.projectile_missing' && i.severity === 'error')).toBe(true);
    ctx.complete = false;
    expect(check('weapons', values, ctx).some((i) => i.code === 'csv.projectile_missing' && i.severity === 'warning')).toBe(true);
  });
  it.each([
    ['beam', 'damage/shot'],
    ['beam', 'energy/shot'],
    ['beam', 'min spread'],
    ['beam', 'max spread'],
    ['beam', 'spread/shot'],
    ['beam', 'spread decay/sec'],
    ['beam', 'proj speed'],
    ['beam', 'launch speed'],
    ['beam', 'flight time'],
    ['beam', 'proj hitpoints'],
    ['projectile', 'damage/second'],
    ['projectile', 'beam speed'],
  ])('warns about %s field %s only when positive', (specClass, key) => {
    for (const value of ['', '0', '0.0', '-0', '0e3', '-1', '1', '0.5', '1f', '1e-3']) {
      const values = { [key!]: value },
        ctx = context('weapons', values);
      ctx.entities['weapon:entry'] = { specClass };
      const issues = check('weapons', values, ctx).filter((issue) => issue.code === 'csv.branch_field');
      expect(issues).toHaveLength(['1', '0.5', '1f', '1e-3'].includes(value) ? 1 : 0);
      if (issues.length) expect(issues[0]).toMatchObject({ severity: 'warning', path: `entry/${key}` });
    }
  });
  it.each(['desc', 'sModDesc'])('checks Java string formatting in %s', (key) => {
    for (const value of ['value %d', 'value %11$s', 'value 20%'])
      expect(check('hullmods', { [key]: value }).some((i) => i.code === 'csv.format_invalid')).toBe(true);
    expect(check('hullmods', { [key]: 'value %1$s and %%' }).some((i) => i.code === 'csv.format_invalid')).toBe(false);
  });
  it('uses complete sources for references and downgrades absent-source certainty', () => {
    const values = { variant: 'missing' },
      ctx = context('wings', values);
    delete ctx.entities['variant:missing'];
    ctx.sources['csv:variants.variantId'] = [];
    expect(check('wings', values, ctx).some((i) => i.code === 'csv.variant_missing' && i.severity === 'error')).toBe(true);
    ctx.complete = false;
    expect(check('wings', values, ctx).some((i) => i.code === 'csv.variant_missing' && i.severity === 'warning')).toBe(true);
  });
  it('checks image and script presence with their own severities', () => {
    const values = { icon: 'graphics/sample.png', script: 'sample.Script' },
      ctx = context('marketConditions', values);
    ctx.files[values.icon] = false;
    ctx.classes[values.script] = false;
    expect(check('marketConditions', values, ctx)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'csv.image_missing', severity: 'error' }),
        expect.objectContaining({ code: 'csv.script_missing', severity: 'warning' }),
      ]),
    );
  });
  it('dispatches simulator IDs by the literal suffix', () => {
    const values = { 'variant id': 'sample_wing' },
      ctx = context('simOpponents', values);
    ctx.sources['csv:wings.id'] = [];
    expect(check('simOpponents', values, ctx).some((i) => i.severity === 'error')).toBe(true);
    ctx.sources['csv:wings.id'] = ['sample_wing'];
    expect(check('simOpponents', values, ctx).filter((i) => i.severity === 'error')).toEqual([]);
    expect(csvValidationRequest('simOpponents', [sample('simOpponents', values)]).sources).not.toContain('csv:variants.variantId');
    expect(csvValidationRequest('simOpponents', [sample('simOpponents', values)])).toMatchObject({
      sources: expect.arrayContaining(['csv:wings.id']),
    });
  });
  it('validates generic item industry references', () => {
    const item = { plugin: 'com.fs.starfarer.api.campaign.impl.items.GenericSpecialItemPlugin', 'plugin params': 'missing' },
      ctx = context('specialItems', item);
    ctx.sources['csv:industries.id'] = [];
    expect(check('specialItems', item, ctx).some((i) => i.path === 'entry/plugin params')).toBe(true);
  });
  it('checks aptitude effects and blueprint packages using source metadata', () => {
    const skill = context('skills', {});
    skill.entities['skill:entry'] = { governingAptitude: 'sample' };
    skill.sources['aptitudeEffect:sample'] = ['entry'];
    expect(
      check('skills', { tier: '2', reqPoints: '1' }, skill).filter((i) => ['entry/name', 'entry/tier', 'entry/reqPoints'].includes(i.path)),
    ).toHaveLength(3);
    const values = { plugin: 'com.fs.starfarer.api.campaign.impl.items.MultiBlueprintItemPlugin', 'plugin params': 'package_tag' },
      ctx = context('specialItems', values);
    for (const source of ['csv:ships.tags', 'csv:weapons.tags', 'csv:wings.tags']) ctx.sources[source] = [];
    expect(check('specialItems', values, ctx).some((i) => i.message.includes('package_tag'))).toBe(true);
  });
  it.each(['tier', 'reqPoints', 'reqPointsPerExtraSkill'])('warns about aptitude effect field %s only when positive', (key) => {
    for (const value of ['', '0', '0.0', '-0', '-1', '1', '2']) {
      const values = { [key]: value },
        ctx = context('skills', values);
      ctx.entities['skill:entry'] = { governingAptitude: 'sample' };
      ctx.sources['aptitudeEffect:sample'] = ['entry'];
      const issues = check('skills', values, ctx).filter(
        (issue) => issue.code === 'csv.aptitude_override' && issue.path === `entry/${key}`,
      );
      expect(issues).toHaveLength(['1', '2'].includes(value) ? 1 : 0);
    }
  });
  it('accepts explicit and previous string argument indices', () => {
    expect(check('hullmods', { desc: '%2$s %<s %s %%' }).some((i) => i.code === 'csv.format_invalid')).toBe(false);
    expect(check('hullmods', { desc: '%+s' }).some((i) => i.code === 'csv.format_invalid')).toBe(true);
  });
  it('checks same-table references against current rows plus external saved sources', () => {
    const rows = [sample('industries', { id: 'current', upgrade: 'new' }), sample('industries', { id: 'new' })];
    const ctx = context('industries', rows[0]!.data);
    ctx.sources['csv:industries.id'] = ['current', 'old'];
    ctx.sources['external:csv:industries.id'] = [];
    const header = getCsvColumnSchemas('industries').map((c) => c.key);
    expect(csvRowProblems('industries', rows, header, ctx).some((i) => i.code === 'csv.reference_missing')).toBe(false);
    rows[0]!.data.upgrade = 'old';
    expect(csvRowProblems('industries', rows, header, ctx).some((i) => i.code === 'csv.reference_missing')).toBe(true);
    ctx.sources['external:csv:industries.id'] = ['old'];
    expect(csvRowProblems('industries', rows, header, ctx).some((i) => i.code === 'csv.reference_missing')).toBe(false);
  });
  it.each([
    [100, 1],
    [100, 2],
    [1000, 1],
    [1000, 2],
  ] as const)('reads IDs linearly for %i rows with %i same-table references each', (count, references) => {
    let idReads = 0,
      sourceReads = 0;
    const rows = Array.from({ length: count }, (_, index) => {
      const row = sample('industries', {
        upgrade: `item-${(index + 1) % count}`,
        downgrade: references === 2 ? 'external-item' : '',
      });
      row.rowKey = `row-${index}`;
      Object.defineProperty(row.data, 'id', {
        enumerable: true,
        get: () => {
          idReads++;
          return `item-${index}`;
        },
      });
      return row;
    });
    const ctx = context('industries', { upgrade: 'item-0' });
    Object.defineProperty(ctx.sources, 'external:csv:industries.id', {
      get: () => {
        sourceReads++;
        return ['external-item'];
      },
    });
    const issues = csvRowProblems(
      'industries',
      rows,
      getCsvColumnSchemas('industries').map((c) => c.key),
      ctx,
    );
    expect(issues.filter((issue) => issue.code === 'csv.reference_missing')).toEqual([]);
    expect({ idReads, sourceReads }).toEqual({ idReads: 4 * count, sourceReads: 1 });
  });
  it.each(['commented', 'TARGET', ' target '])('keeps exact reference identity and excludes comment ID %j', (target) => {
    const rows = [
      sample('industries', { id: 'origin', upgrade: target }),
      sample('industries', { id: 'target' }),
      { ...sample('industries', { id: 'commented' }), isComment: true },
    ];
    const ctx = context('industries', rows[0]!.data);
    ctx.sources['external:csv:industries.id'] = [];
    const issues = csvRowProblems(
      'industries',
      rows,
      getCsvColumnSchemas('industries').map((c) => c.key),
      ctx,
    );
    expect(issues.filter((issue) => issue.code === 'csv.reference_missing')).toEqual([
      expect.objectContaining({ path: 'entry/upgrade', severity: 'warning' }),
    ]);
  });
});
