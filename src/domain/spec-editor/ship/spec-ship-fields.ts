import type { SpecField, SpecSection } from '@/domain/editors/spec-construction';
export const SHIP_SECTIONS: SpecSection[] = [
  {
    name: 'basic',
    title: '船体属性',
    fields: [
      ['hullId', '舰体 ID', '', undefined, true],
      ['hullName', '舰船名称', ''],
      ['hullSize', '舰级', '', ['FRIGATE', 'DESTROYER', 'CRUISER', 'CAPITAL_SHIP', 'FIGHTER'], true],
      ['style', '舰体风格', '', ['LOW_TECH', 'MIDLINE', 'HIGH_TECH', 'OMEGA', 'CUSTOM'], true],
    ],
  },
  {
    name: 'sprite',
    title: '贴图与中心',
    fields: [
      ['spriteName', '贴图', '', undefined, true],
      ['width', '宽度', 0, undefined, true],
      ['height', '高度', 0, undefined, true],
      ['center[0]', '中心 X', 0, undefined, true],
      ['center[1]', '中心 Y', 0, undefined, true],
    ],
  },
  { name: 'bounds', title: '碰撞边界', fields: [['collisionRadius', '碰撞半径', 0, undefined, true]] },
  {
    name: 'props',
    title: '护盾参数',
    fields: [
      ['shieldCenter[0]', '护盾中心 X', 0, undefined, true],
      ['shieldCenter[1]', '护盾中心 Y', 0, undefined, true],
      ['shieldRadius', '护盾半径', 0, undefined, true],
    ],
  },
  { name: 'weapons', title: '武器槽', fields: [] },
  { name: 'launchBays', title: '甲板', fields: [] },
  { name: 'engines', title: '引擎', fields: [] },
  { name: 'builtins', title: '内置装备', fields: [] },
  {
    name: 'advanced',
    title: '高级属性',
    fields: [
      ['viewOffset', '视角偏移', 0],
      ['moduleAnchor[0]', '模块锚点 X', 0, undefined, true],
      ['moduleAnchor[1]', '模块锚点 Y', 0, undefined, true],
    ],
  },
  { name: 'extra', title: '扩展字段', fields: [] },
];
export const SHIP_SLOT_FIELDS: SpecField[] = [
  ['id', '槽位 ID', '', undefined, true],
  ['size', '尺寸', '', ['SMALL', 'MEDIUM', 'LARGE'], true],
  [
    'type',
    '类型',
    '',
    ['BALLISTIC', 'ENERGY', 'MISSILE', 'HYBRID', 'UNIVERSAL', 'SYNERGY', 'COMPOSITE', 'BUILT_IN', 'DECORATIVE', 'SYSTEM', 'STATION_MODULE'],
    true,
  ],
  ['mount', '挂载方式', '', ['TURRET', 'HARDPOINT', 'HIDDEN'], true],
  ['angle', '角度', 0, undefined, true],
  ['arc', '射界', 0, undefined, true],
  ['renderOrderMod', '绘制顺序修正', 0],
  ['locations[0]', '位置 X', 0, undefined, true],
  ['locations[1]', '位置 Y', 0, undefined, true],
];
export const SHIP_ENGINE_FIELDS: SpecField[] = [
  ['angle', '角度', 0, undefined, true],
  ['width', '宽度', 0, undefined, true],
  ['length', '长度', 0, undefined, true],
  ['contrailSize', '尾迹标记', 0],
  ['style', '引擎风格', '', [], true],
  ['location[0]', '位置 X', 0, undefined, true],
  ['location[1]', '位置 Y', 0, undefined, true],
];
export const SHIP_KNOWN_KEYS = [
  ...new Set(SHIP_SECTIONS.flatMap((section) => section.fields.map((field) => field[0].split('[')[0]!))),
  'coversColor',
  'bounds',
  'weaponSlots',
  'engineSlots',
  'builtInMods',
  'builtInWings',
  'builtInWeapons',
];
