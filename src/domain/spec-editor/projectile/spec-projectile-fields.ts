import { BEAM_TEXTURES, COLLISION_CLASSES, MISSILE_TYPES, PROJECTILE_SPAWN_TYPES } from '@/domain/editors/lib/game-spec-enums';
import type { SpecField, SpecSection } from '@/domain/editors/spec-construction';
const WHITE = [255, 255, 255, 255];
export const EXPLOSION_FIELDS: SpecField[] = [
  ['duration', '持续时间', 0, undefined, true],
  ['radius', '半径', 0, undefined, true],
  ['coreRadius', '核心半径', 0, undefined, true],
  ['maxDamage', '最大伤害', 0],
  ['minDamage', '最小伤害', 0],
  ['collisionClass', '碰撞类型', '', COLLISION_CLASSES, true],
  ['collisionClassByFighter', '战机发射时碰撞类型', '', COLLISION_CLASSES, true],
  ['particleSizeMin', '最小粒子尺寸', 0],
  ['particleSizeRange', '粒子尺寸变化', 0],
  ['particleDuration', '粒子持续时间', 0],
  ['particleCount', '粒子数量', 0],
  ['particleSpawnRadius', '粒子生成半径', -1],
  ['particleColor', '粒子颜色', WHITE],
  ['explosionColor', '爆炸颜色', WHITE],
  ['useDetailedExplosion', '详细爆炸效果', false],
  ['detailedExplosionRadius', '详细爆炸半径', -1],
  ['detailedExplosionFlashRadius', '闪光半径', -1],
  ['detailedExplosionFlashDuration', '闪光持续时间', -1],
  ['detailedExplosionFlashColorFringe', '闪光外围颜色', WHITE],
  ['detailedExplosionFlashColorCore', '闪光核心颜色', WHITE],
  ['sound', '音效', '', undefined, false, 'config:sounds'],
  ['soundVolume', '音量', 1],
];
export const MISSILE_ENGINE_FIELDS: SpecField[] = [
  ['id', '引擎 ID', '', undefined, true],
  ['loc[0]', '位置 X', 0, undefined, true],
  ['loc[1]', '位置 Y', 0, undefined, true],
  ['angle', '角度', 0, undefined, true],
  ['width', '宽度', 0, undefined, true],
  ['length', '长度', 0, undefined, true],
  ['style', '引擎风格', '', [], true],
];
export function projectileSections(missile: boolean): SpecSection[] {
  const pass: SpecField[] = [
    ['passThroughMissiles', '穿透导弹', false],
    ['passThroughFighters', '穿透战机', false],
    ['passThroughFightersOnlyWhenDestroyed', '仅摧毁后穿透战机', false],
    ['applyOnHitEffectWhenPassThrough', '穿透时应用命中效果', false],
  ];
  return [
    {
      name: 'basic',
      title: '基础属性',
      fields: [
        ['id', '弹体 ID', '', undefined, true],
        ['specClass', '规格类型', '', ['projectile', 'missile'], true],
        missile ? ['missileType', '导弹类型', '', MISSILE_TYPES, true] : ['spawnType', '生成类型', '', PROJECTILE_SPAWN_TYPES, true],
      ],
    },
    missile
      ? {
          name: 'missileVisual',
          title: '贴图与中心',
          fields: [
            ['sprite', '贴图', '', undefined, true],
            ['size[0]', '宽度', 0, undefined, true],
            ['size[1]', '高度', 0, undefined, true],
            ['center[0]', '中心 X', 0, undefined, true],
            ['center[1]', '中心 Y', 0, undefined, true],
          ],
        }
      : {
          name: 'visual',
          title: '弹体外观',
          fields: [
            ['bulletSprite', '弹体贴图', ''],
            ['length', '长度', 10],
            ['width', '宽度', 0, undefined, true],
            ['textureType', '纹理类型', 'SMOOTH', BEAM_TEXTURES],
            ['textureScrollSpeed', '纹理滚动速度', 64],
            ['pixelsPerTexel', '纹素比例', 1],
            ['fringeColor', '外围颜色', WHITE],
            ['coreColor', '核心颜色', WHITE],
            ['darkCore', '暗色核心', false],
            ['darkCoreIter', '暗芯绘制次数', 1],
            ['darkFringeIter', '外围绘制次数', 1],
            ['coreWidthMult', '核心宽度倍率', 1],
          ],
        },
    ...(missile
      ? [
          {
            name: 'flight',
            title: '飞行参数',
            fields: [
              ['engineSpec.turnAcc', '转向加速度', 0, undefined, true],
              ['engineSpec.turnRate', '最大转向速度', 0, undefined, true],
              ['engineSpec.acc', '加速度', 0, undefined, true],
              ['engineSpec.dec', '减速度', 0, undefined, true],
              ['engineSpec.maxSpeed', '规格最大速度', 0],
              ['maxFlightTime', '规格飞行时间', 5],
              ['alwaysAccelerate', '持续加速', false],
              ['useProjectileRangeCalculation', '采用弹体射程计算', false],
              ['fizzleOnReachingWeaponRange', '到达武器射程后失效', false],
              ['renderTargetIndicator', '显示目标标记', true],
            ] as SpecField[],
          },
          { name: 'slots', title: '引擎', fields: [] },
        ]
      : [
          {
            name: 'glow',
            title: '光效与消散',
            fields: [
              ['glowColor', '光效颜色', WHITE],
              ['glowRadius', '光效半径', 0],
              ['hitGlowRadius', '命中光晕半径', 0],
              ['fadeTime', '消散时间', 0, undefined, true],
            ] as SpecField[],
          },
        ]),
    {
      name: 'collision',
      title: '碰撞设置',
      fields: missile
        ? [
            ['collisionRadius', '碰撞半径', 0, undefined, true],
            ['collisionClass', '碰撞类型', '', COLLISION_CLASSES, true],
            ['collisionClassAfterFlameout', '熄火后碰撞类型', 'MISSILE_FF', COLLISION_CLASSES],
            ...pass,
            ['noCollisionWhileFading', '消散期间关闭碰撞', false],
          ]
        : [
            ['collisionClass', '碰撞类型', '', COLLISION_CLASSES, true],
            ['collisionClassByFighter', '战机发射时碰撞类型', '', COLLISION_CLASSES, true],
            ...pass,
          ],
    },
    missile
      ? {
          name: 'explosion',
          title: '爆炸与消散',
          fields: [
            ['glowSprite', '光效贴图', ''],
            ['glowColor', '光效颜色', WHITE],
            ['glowRadius', '光效半径', 0],
            ['explosionColor', '爆炸颜色', WHITE],
            ['destroyedExplosionColor', '摧毁时爆炸颜色', [255, 165, 100, 255]],
            ['explosionRadius', '爆炸半径', 0],
            ['armingTime', '引信时间', 0],
            ['flameoutTime', '熄火时间', 4],
            ['dudProbabilityOnFlameout', '熄火后哑弹概率', 0.5],
            ['noEngineGlowTime', '引擎光效停止时间', 2.5],
            ['fadeTime', '消散时间', 0.5],
            ['reduceDamageWhileFading', '消散期间降低伤害', false],
            ['useHitGlowWhenDestroyed', '摧毁时显示命中光效', false],
            ['useHitGlowWhenDealingDamage', '造成伤害时显示命中光效', true],
            ['noDebrisWhenDestroyed', '摧毁时关闭残骸', false],
          ],
        }
      : {
          name: 'sound',
          title: '音效',
          fields: [
            ['noImpactSounds', '关闭命中音效', false],
            ['noShieldImpactSounds', '关闭护盾命中音效', false],
            ['noNonShieldImpactSounds', '关闭非护盾命中音效', false],
          ],
        },
    {
      name: 'scripts',
      title: '行为与脚本',
      fields: [
        ['onFireEffect', '发射效果脚本', ''],
        ['onHitEffect', '命中效果脚本', ''],
        ['behaviorSpec', '行为配置', {}],
      ],
    },
    { name: 'extra', title: '扩展字段', fields: [] },
  ];
}
