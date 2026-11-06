import type { CsvDraftRow, CsvTableKey, CsvValidationContext, FieldProblem } from '@/shared/types';
import { getCsvColumnSchemas } from '@/domain/schema/csv-schema-registry';
import { csvValueError } from '@/domain/schema/csv-value-validation';
import { cell } from '@/shared/lib/starsector';
import { isRowData } from '@/shared/lib/row-data';
import { CSV_SPEC_KINDS, DESCRIPTION_KINDS } from './csv-rule-context';

export function csvRowProblems(
  table: CsvTableKey,
  rows: readonly CsvDraftRow[],
  header: readonly string[],
  context: CsvValidationContext | null,
  deferredSpecs: ReadonlySet<string> = new Set(),
): FieldProblem[] {
  const issues: FieldProblem[] = [],
    definitions = getCsvColumnSchemas(table),
    columns = definitions.filter((column) => header.includes(column.key) || column.required);
  const add = (severity: FieldProblem['severity'], code: string, path: string, message: string) =>
    issues.push({ severity, code: `csv.${code}`, path, message });
  const business = new Set(rows.filter((row) => !row.isComment && Object.values(row.data).some((v) => cell(v) !== '')));
  if (business.size)
    for (const column of definitions)
      if ((column.requiredColumn || column.required) && !header.includes(column.key))
        add('error', 'column_missing', column.key, `缺少必读列 ${column.key}。`);
  rows.forEach((row, index) => {
    if (!business.has(row)) return;
    const data = row.data,
      id = cell(data.id),
      hints = new Set(
        cell(data.hints)
          .split(',')
          .map((v) => v.trim())
          .filter(Boolean),
      );
    const text = (key: string) => cell(data[key]),
      num = (key: string) => Number(text(key).replace(/[fFdD]$/, '')),
      yes = (key: string) => text(key).toLowerCase() === 'true';
    const problem = (key: string, message: string, severity: FieldProblem['severity'] = 'warning', code = 'relation') =>
      add(severity, code, `${row.rowKey}/${key}`, `第 ${index + 1} 行 / ${key} = ${JSON.stringify(text(key))}：${message}`);
    const hintProblem = (rule: string, message: string) => problem('hints', message, 'warning', `hint.${rule}`);
    const pair = (first: string, second: string, message: string) => {
      if (hints.has(first) && hints.has(second)) hintProblem(`${first}.${second}`, message);
    };
    const reference = (key: string, source: string, severity: FieldProblem['severity']) => {
      const values =
        context &&
        (source === `csv:${table}.id`
          ? [...business].map((entry) => cell(entry.data.id)).concat(context.sources[`external:${source}`]!)
          : context.sources[source]!);
      if (context && text(key) && !values!.includes(text(key)))
        problem(
          key,
          `引用 ${JSON.stringify(text(key))} 在当前来源中未找到。`,
          context.complete ? severity : 'warning',
          'reference_missing',
        );
    };
    for (const column of columns) {
      const value = text(column.key),
        error = csvValueError(column, value);
      if (error) {
        problem(column.key, `${error}。`, 'error', 'value_invalid');
        continue;
      }
      if (
        value &&
        column.control === 'number' &&
        ((column.warningMin !== undefined && num(column.key) < column.warningMin) ||
          (column.warningMax !== undefined && num(column.key) > column.warningMax))
      )
        problem(column.key, `当前值 ${value} 超出通常用途范围，请确认。`, 'warning', 'number_range');
      if (column.script && value && context && !context.classes[value])
        problem(
          column.key,
          `脚本类 ${JSON.stringify(value)} 尚未在当前来源的 Java、class 或已声明 JAR 中找到，请确认依赖与接口。`,
          'warning',
          'script_missing',
        );
      if (column.control === 'path-image') {
        if (value && context && !context.files[value])
          problem(
            column.key,
            `图片 ${JSON.stringify(value)} 在当前来源中未找到。`,
            context.complete ? 'error' : 'warning',
            'image_missing',
          );
        if (!value) problem(column.key, '图标为空，请确认预期显示或默认图标。');
      }
      if (column.control === 'reference' && column.source && column.source !== 'csv:variants.variantId' && value)
        reference(
          column.key,
          column.source,
          ['upgrade', 'downgrade', 'faction', 'tech/manufacturer'].includes(column.key) || column.source.startsWith('config:')
            ? 'warning'
            : 'error',
        );
    }
    if (id && id !== id.trim()) problem('id', 'ID 包含首尾空白，游戏按原值区分身份。');
    if (header.includes('name') && !text('name') && (table !== 'ships' || !text('designation')))
      problem('name', table === 'ships' ? '名称与定位均为空，请确认显示效果。' : '名称为空，请确认显示效果。');
    if (!id && table !== 'simOpponents') problem('id', '本行已有内容，但 ID 为空，请确认该行的用途。');
    const ownKind = CSV_SPEC_KINDS[table];
    const spec = context && ownKind ? context.entities[`${ownKind}:${id}`] : null;
    if (id && context && ownKind && !spec)
      problem(
        'id',
        `规格 ${JSON.stringify(id)} 在当前来源中未找到，请在关联规格保存中创建、导入或确认来源。`,
        ['ships', 'skills'].includes(table) && context.complete && !deferredSpecs.has(id) ? 'error' : 'warning',
        'spec_missing',
      );
    if (table === 'ships') {
      for (const [a, b] of [
        ['min crew', 'max crew'],
        ['minPieces', 'maxPieces'],
      ] as const)
        if (text(a) && text(b) && num(a) > num(b)) problem(a, `${a} 大于 ${b}。`);
      pair('WEAPONS_FRONT_TO_BACK', 'WEAPONS_BACK_TO_FRONT', '两种排序同时存在，游戏优先采用 WEAPONS_FRONT_TO_BACK。');
      if (text('shield type') === 'PHASE' && !text('defense id') && text('system id') && text('system id') !== 'phasecloak')
        problem('system id', '当前相位防御配置会将系统 ID 设置为 phasecloak。');
      if (context && text('codex variant id') && !context.entities[`variant:${text('codex variant id')}`])
        problem('codex variant id', '数据百科装配引用尚未找到。');
      if (spec) {
        const slots = Array.isArray(spec.weaponSlots) ? spec.weaponSlots.filter(isRowData) : [];
        if (hints.has('PLAY_FIGHTER_OVERLOAD_SOUNDS') && spec.hullSize !== 'FIGHTER')
          hintProblem('PLAY_FIGHTER_OVERLOAD_SOUNDS', '当前非战机船体默认已经播放过载声音。');
        if (
          hints.has('MISSILE_HARDPOINTS_ROTATE') &&
          !slots.some(
            (slot) =>
              slot.mount === 'HARDPOINT' &&
              ['MISSILE', 'COMPOSITE', 'SYNERGY', 'UNIVERSAL'].includes(cell(slot.type)) &&
              Math.abs(Number(slot.angle)) < 90,
          )
        )
          hintProblem('MISSILE_HARDPOINTS_ROTATE', '当前船体缺少符合转动条件的导弹固定槽。');
        if (hints.has('INDEPENDENT_ROTATION'))
          hintProblem('INDEPENDENT_ROTATION', '独立旋转在父舰子模块位置更新流程生效，请确认实际模块用途。');
        if (hints.has('CARRIER') && num('fighter bays') <= 0 && !slots.some((slot) => slot.type === 'LAUNCH_BAY'))
          hintProblem('CARRIER', '当前基础甲板为零，请确认模块、船插或脚本提供的舰载机能力。');
      }
    }
    if (table === 'weapons') {
      if (text('min spread') && text('max spread') && num('min spread') > num('max spread'))
        problem('min spread', '最小散布大于最大散布。');
      if (hints.has('PD_ALSO') && !hints.has('PD') && !hints.has('PD_ONLY'))
        hintProblem('PD_ALSO', 'PD_ALSO 的兼用点防御行为需要相应点防御配置，请确认。');
      for (const [a, b, message] of [
        ['PD_ONLY', 'PD_ALSO', '点防御专用条件仍限制常规舰船目标，请确认兼用用途。'],
        ['RANGE_FROM_TARGETING_OVAL', 'RANGE_FROM_SHIP_RADIUS', 'AI 测距优先采用目标轮廓方式，请确认半径方式的用途。'],
        ['GROUP_LINKED', 'GROUP_ALTERNATING', '两种默认编组偏好同时存在，齐射维度会影响最终分组模式。'],
        ['IMPORTANT', 'NO_MANUAL_FIRE', '手控优先加权受到手控排除条件覆盖。'],
      ])
        pair(a!, b!, message!);
      const conserve = ['CONSERVE_1', 'CONSERVE_2', 'CONSERVE_3', 'CONSERVE_4', 'CONSERVE_5', 'CONSERVE_ALL'].filter((hint) =>
        hints.has(hint),
      );
      if (conserve.length > 1) hintProblem('CONSERVE_LEVELS', `多个保留档位同时存在，游戏优先采用 ${conserve[0]}。`);
      if (conserve.length && hints.has('DO_NOT_CONSERVE')) hintProblem('DO_NOT_CONSERVE', 'DO_NOT_CONSERVE 会跳过多项弹药保留判断。');
      if (
        hints.has('SHOW_IN_CODEX') &&
        text('tags')
          .split(',')
          .some((tag) => tag.trim() === 'hide_in_codex')
      )
        hintProblem('SHOW_IN_CODEX', 'hide_in_codex 标签先于系统武器显示条件生效。');
      if (spec) {
        const beam = spec.specClass === 'beam',
          missile = spec.type === 'MISSILE';
        if (conserve.length && (beam || !text('ammo') || num('ammo') >= 2147483647))
          hintProblem('CONSERVE_BRANCH', '保留档位计算要求使用弹药并进入实弹规格分支，请确认。');
        for (const hint of ['DIRECT_AIM', 'MISSILE_SPREAD', 'RESET_BARREL_INDEX_ON_BURST'])
          if (hints.has(hint) && (!missile || (hint === 'RESET_BARREL_INDEX_ON_BURST' && num('burst size') <= 1)))
            hintProblem(hint, `${hint} 的原生导弹运行条件尚未满足，请确认具体弹体 AI。`);
        const ignored = beam
          ? [
              'damage/shot',
              'energy/shot',
              'min spread',
              'max spread',
              'spread/shot',
              'spread decay/sec',
              'proj speed',
              'launch speed',
              'flight time',
              'proj hitpoints',
            ]
          : ['damage/second', 'beam speed'];
        for (const key of ignored) if (text(key)) problem(key, `当前 ${beam ? '光束' : '实弹'} 读取分支使用另一组字段，请确认该值的用途。`);
        if (!beam && text('burst size')) {
          const error = csvValueError({ key: 'burst size', control: 'number', valueType: 'integer' }, text('burst size'));
          if (error) problem('burst size', error, 'error', 'value_invalid');
        }
        if (!beam && spec.projectileSpecId && context && !context.entities[`projectile:${cell(spec.projectileSpecId)}`])
          problem('id', '武器引用的弹体规格未找到。', context.complete ? 'error' : 'warning', 'projectile_missing');
      }
    }
    if (table === 'wings' && context && text('variant')) {
      const variant = context.entities[`variant:${text('variant')}`];
      if (!variant) problem('variant', '联队装配未找到。', context.complete ? 'error' : 'warning', 'variant_missing');
      else {
        const skin = context.entities[`skin:${cell(variant.hullId)}`];
        const hull =
          context.entities[`ship:${cell(variant.hullId)}`] ?? (skin?.hullSize ? skin : context.entities[`ship:${cell(skin?.baseHullId)}`]);
        if (hull && hull.hullSize && hull.hullSize !== 'FIGHTER') problem('variant', '当前装配基础船体属于非战机类型，请确认联队用途。');
      }
    }
    if (table === 'shipSystems') {
      if (yes('noDissipation') && yes('noHardDissipation')) problem('noHardDissipation', '禁止全部耗散已经覆盖硬幅能耗散限制。');
      if (text('max uses') && num('max uses') === 0) problem('max uses', '基础可用次数为零，请确认脚本覆盖。');
    }
    if (table === 'hullmods') {
      if (yes('hiddenEverywhere') && (yes('unlocked') || num('base value') > 0))
        problem('hiddenEverywhere', '完全隐藏与解锁、出售用途同时声明，请确认。');
      for (const key of ['desc', 'sModDesc']) {
        const error = formatStringError(text(key));
        if (error) problem(key, error, 'error', 'format_invalid');
      }
    }
    if (table === 'industries') {
      for (const key of ['upgrade', 'downgrade']) if (id && text(key) === id) problem(key, '升级或降级目标指向自身。');
      if (context && text('plugin') === 'com.fs.starfarer.api.impl.campaign.econ.impl.OrbitalStation') {
        const parsed = context.stationData[text('data')]!,
          value = parsed.value;
        if (parsed.error) problem('data', parsed.error, 'error', 'plugin_data');
        else {
          if (
            !isRowData(value) ||
            typeof value.variant !== 'string' ||
            typeof value.fleetName !== 'string' ||
            !['number', 'string'].includes(typeof value.radius) ||
            String(value.radius).trim() === '' ||
            !Number.isFinite(Number(value.radius))
          )
            problem('data', '原生空间站数据需要 variant、radius、fleetName。', 'error', 'plugin_data');
          else if (!context.entities[`variant:${value.variant}`])
            problem('data', '空间站装配引用未找到。', context.complete ? 'error' : 'warning', 'plugin_reference');
        }
      }
    }
    if (table === 'skills' && spec && context?.sources[`aptitudeEffect:${cell(spec.governingAptitude)}`]?.includes(id))
      for (const key of ['name', 'description', 'tier', 'reqPoints', 'reqPointsPerExtraSkill'])
        if (text(key)) problem(key, '类别效果技能由天赋类别定义接管此内容。');
    if (table === 'specialItems' && context && text('plugin') === 'com.fs.starfarer.api.campaign.impl.items.GenericSpecialItemPlugin')
      for (const value of text('plugin params')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean))
        if (!context.sources['csv:industries.id']!.includes(value))
          problem('plugin params', `通用物品参数中的工业 ${JSON.stringify(value)} 未找到。`);
    if (table === 'specialItems' && context && text('plugin') === 'com.fs.starfarer.api.campaign.impl.items.MultiBlueprintItemPlugin') {
      const tags = new Set(['csv:ships.tags', 'csv:weapons.tags', 'csv:wings.tags'].flatMap((source) => context.sources[source]!));
      for (const tag of text('plugin params')
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean))
        if (!tags.has(tag)) problem('plugin params', `蓝图包标签 ${JSON.stringify(tag)} 在当前舰船、武器和联队来源中未找到。`);
    }
    if (table === 'simOpponents' && context && text('variant id')) {
      const value = text('variant id');
      if (value.endsWith('_wing')) reference('variant id', 'csv:wings.id', 'error');
      else if (!context.entities[`variant:${value}`])
        problem('variant id', '按当前后缀查找的舰船装配未找到。', context.complete ? 'error' : 'warning', 'variant_missing');
    }
    if (table === 'descriptions') {
      if ((!id || !text('type')) && ['text1', 'text2', 'text3', 'text4', 'text5'].some((key) => text(key)))
        problem('id', '正文已有内容而身份不完整，游戏会跳过该描述。');
      if (id && text('type') && !['text1', 'text2', 'text3', 'text4', 'text5'].some((key) => text(key)))
        problem('text1', '五个正文均为空，请确认描述显示。');
      const kind = DESCRIPTION_KINDS[text('type')];
      if (id && kind && context && !context.entities[`${kind}:${id}`])
        problem('id', '当前类型的同名实体未找到，请确认 descriptionId 或脚本对该描述的引用。');
    }
  });
  return issues;
}

function formatStringError(text: string): string | null {
  let used = 0,
    previous = 0;
  for (let index = 0; index < text.length; index++)
    if (text[index] === '%') {
      const match = /^%(?:(\d+)\$)?([-#+ 0,(<]*)(\d+)?(?:\.(\d+))?([a-zA-Z%])/.exec(text.slice(index));
      if (!match) return '格式占位符无法解析，文字百分号应写为 %% 。';
      index += match[0].length - 1;
      if (['%', 'n'].includes(match[5]!)) continue;
      const position = match[1] ? Number(match[1]) : match[2]!.includes('<') ? previous : ++used;
      previous = position;
      if (
        position < 1 ||
        position > 10 ||
        !['s', 'S', 'b', 'B', 'h', 'H'].includes(match[5]!) ||
        /[^\-<]/.test(match[2]!) ||
        (match[2]!.includes('-') && !match[3])
      )
        return '描述格式需要匹配提供的 10 个字符串参数，请核对占位符及索引。';
    }
  return null;
}
