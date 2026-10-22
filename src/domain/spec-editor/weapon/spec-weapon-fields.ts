import { BEAM_TEXTURES, COLLISION_CLASSES } from '@/domain/editors/lib/game-spec-enums';
import type { SpecSection, SpecField } from '@/domain/editors/spec-construction';
import type { RowData } from '@/shared/types';
const WHITE = [255, 255, 255, 255];
const WEAPON_TYPES = ['BALLISTIC', 'ENERGY', 'MISSILE', 'HYBRID', 'UNIVERSAL', 'SYNERGY', 'COMPOSITE', 'DECORATIVE', 'SYSTEM', 'BUILT_IN'];
export const WEAPON_OBJECT_FIELDS: Record<string, SpecField[]> = {
  muzzleFlashSpec: [
    ['length', '长度', 0, undefined, true],
    ['spread', '散布', 0, undefined, true],
    ['particleSizeMin', '最小粒子尺寸', 0, undefined, true],
    ['particleSizeRange', '粒子尺寸变化', 0, undefined, true],
    ['particleDuration', '粒子持续时间', 0, undefined, true],
    ['particleCount', '粒子数量', 0, undefined, true],
    ['particleColor', '粒子颜色', WHITE],
  ],
  smokeSpec: [
    ['particleSizeMin', '最小粒子尺寸', 0, undefined, true],
    ['particleSizeRange', '粒子尺寸变化', 0, undefined, true],
    ['cloudParticleCount', '云团粒子数量', 0, undefined, true],
    ['cloudDuration', '云团持续时间', 0, undefined, true],
    ['cloudRadius', '云团半径', 0, undefined, true],
    ['blowbackParticleCount', '回喷粒子数量', 0, undefined, true],
    ['blowbackDuration', '回喷持续时间', 0, undefined, true],
    ['blowbackLength', '回喷长度', 0, undefined, true],
    ['blowbackSpread', '回喷散布', 0, undefined, true],
    ['particleColor', '粒子颜色', WHITE],
  ],
};
export function weaponSections(weapon: RowData): SpecSection[] {
  const beam = weapon.specClass === 'beam';
  return [
    {
      name: 'basic',
      title: '基础属性',
      fields: [
        ['id', '武器 ID', '', undefined, true],
        ['specClass', '规格类型', '', ['projectile', 'beam'], true],
        ['type', '类型', '', WEAPON_TYPES, true],
        ['size', '尺寸', '', ['SMALL', 'MEDIUM', 'LARGE'], true],
        ...(!beam ? [['restrictToSpecifiedMountType', '限定指定挂载类型', false] as SpecField] : []),
      ],
    },
    ...(['turret', 'hardpoint'] as const).map((mode) => ({
      name: mode + 'Barrels',
      title: mode === 'turret' ? '炮塔配置' : '固定配置',
      fields: [
        [mode + 'Sprite', '主体贴图', '', undefined, true],
        [mode + 'UnderSprite', '底层贴图', ''],
        [mode + 'GlowSprite', '光效贴图', ''],
        ...(!beam ? [[mode + 'GunSprite', '炮管贴图', ''] as SpecField] : []),
      ] as SpecField[],
    })),
    beam
      ? {
          name: 'beam',
          title: '光束参数',
          fields: [
            ['width', '宽度', 10],
            ['textureType', '纹理类型', '', BEAM_TEXTURES, true],
            ['textureScrollSpeed', '纹理滚动速度', 64],
            ['fringeScrollSpeedMult', '外围滚动倍率', 1],
            ['pixelsPerTexel', '纹素比例', 1],
            ['fringeColor', '外围颜色', WHITE],
            ['coreColor', '核心颜色', WHITE],
            ['darkCore', '暗色核心', false],
            ['darkCoreIter', '暗芯绘制次数', 1],
            ['darkFringeIter', '外围绘制次数', 1],
            ['coreWidthMult', '核心宽度倍率', 1],
            ['randomizeTextureOffset', '随机纹理偏移', false],
            ['beamFireOnlyOnFullCharge', '完全充能后发射', false],
            ['convergeOnPoint', '汇聚于目标点', false],
            ['skipIdleFrameIfZeroBurstDelay', '零连发间隔跳过空闲帧', false],
          ],
        }
      : {
          name: 'proj',
          title: '发射设置',
          fields: [
            ['barrelMode', '发射模式', '', ['ALTERNATING', 'ALTERNATING_BURST', 'DUAL', 'LINKED'], true],
            ['projectileSpecId', '弹体 ID', '', undefined, true],
            ['autocharge', '自动充能', false],
            ['requiresFullCharge', '需要完全充能', true],
            ['interruptibleBurst', '允许中断连发', false],
            ['unaffectedByProjectileSpeedBonuses', '忽略弹体速度加成', false],
          ],
        },
    beam
      ? {
          name: 'hit',
          title: '命中效果',
          fields: [
            ['collisionClass', '碰撞类型', 'RAY', COLLISION_CLASSES],
            ['collisionClassByFighter', '战机发射时碰撞类型', 'RAY_FIGHTER', COLLISION_CLASSES],
            ['pierceSet', '穿透类型', [], COLLISION_CLASSES],
            ['hitGlowRadius', '命中光晕半径', -1],
            ['hitGlowBrightenDuration', '命中增亮时间', 1],
            ['useGlowColorForHitGlow', '命中使用光效颜色', false],
          ],
        }
      : {
          name: 'muzzle',
          title: '炮口效果',
          fields: [
            ['animationType', '炮口动画类型', '', ['NONE', 'GLOW', 'MUZZLE_FLASH', 'GLOW_AND_FLASH', 'SMOKE'], true],
            ['visualRecoil', '视觉后坐', 0],
            ['separateRecoilForLinkedBarrels', '齐射时各炮管独立后坐', false],
          ],
        },
    {
      name: 'anim',
      title: '帧动画',
      fields: [
        ['numFrames', '帧数', 1],
        ['frameRate', '帧率', 1],
        ['alwaysAnimate', '持续播放', false],
        ['animateWhileFiring', '开火时播放', true],
      ],
    },
    {
      name: 'glow',
      title: '光效与绘制',
      fields: [
        ['glowColor', '光效颜色', WHITE],
        ['specialWeaponGlowWidth', '特殊光效宽度', -1],
        ['specialWeaponGlowHeight', '特殊光效高度', -1],
        [
          'renderHints',
          '绘制提示',
          [],
          [
            'RENDER_BARREL_BELOW',
            'RENDER_LOADED_MISSILES',
            'RENDER_LOADED_MISSILES_UNLESS_HIDDEN',
            'RENDER_ADDITIVE',
            'SUSPEND_RECOIL',
            'NEVER_RENDER_IN_CAMPAIGN',
          ],
        ],
        ['renderBelowAllWeapons', '绘制于全部武器下方', false],
        ['showDamageWhenDecorative', '装饰类型显示伤害', false],
        ...(!beam ? [['renderAboveAllWeapons', '绘制于全部武器上方', false] as SpecField] : []),
      ],
    },
    {
      name: 'sound',
      title: '音效',
      fields: [
        ['fireSoundOne', '开火音效', ''],
        ['fireSoundTwo', '开火音效 2', ''],
        ['stopPreviousFireSound', '停止上次开火音效', false],
        ...(beam
          ? [['playFullFireSoundOne', '完整播放首音效', false] as SpecField]
          : ([
              ['fadePreviousFireSound', '上次音效淡出时间', 0],
              ['noImpactSounds', '关闭命中音效', false],
              ['noShieldImpactSounds', '关闭护盾命中音效', false],
              ['noNonShieldImpactSounds', '关闭非护盾命中音效', false],
            ] as SpecField[])),
      ],
    },
    {
      name: 'scripts',
      title: '脚本',
      fields: [['everyFrameEffect', '逐帧效果脚本', ''], ...(beam ? [['beamEffect', '光束效果脚本', ''] as SpecField] : [])],
    },
    {
      name: 'advanced',
      title: '高级属性',
      fields: [
        ['mountTypeOverride', '挂载类型', weapon.type ?? '', WEAPON_TYPES],
        ['displayArcRadius', '显示射界半径', 250],
      ],
    },
    { name: 'extra', title: '扩展字段', fields: [] },
  ];
}
