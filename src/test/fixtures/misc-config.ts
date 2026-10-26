import { getSchema } from '@/domain/schema/config-schema-registry';
import { miscConfigFile } from '@/domain/json-editor/misc-config-files';
import type { MiscConfigKind, RowData } from '@/shared/types';

export function miscConfigFixture(kind: MiscConfigKind): RowData {
  if (kind === 'strings') return { dialogue: { line: '001\n$sample "text"' } };
  if (kind === 'engineStyles' || kind === 'hullStyles') {
    const defaults = getSchema(miscConfigFile(kind).schema)!.root!.valueSchema!.default;
    return {
      SAMPLE_STYLE: {
        ...structuredClone(defaults as RowData),
        ...(kind === 'engineStyles' ? { contrailMaxSpeedMult: '0.5f' } : {}),
        sampleExtra: { keep: true },
      },
    };
  }
  if (kind === 'settings')
    return {
      designTypeColors: { 'Sample Design': [100, 150, 200, 255] },
      maxShipsInFleet: 42,
      sampleEnabled: true,
      graphics: { sample: { icons: ['graphics/sample_a.png', 'graphics/sample_b.png'] } },
    };
  return {
    sample_effect: [{ file: 'sounds/sample.ogg', pitch: 1, volume: 0.5 }],
    sample_group: { sounds: [{ file: 'sounds/sample.ogg' }], FRIGATE: { sounds: [0], pitch: 1, volume: 1 } },
    engine_loop: { SAMPLE_STYLE: { pitch: 1, volume: 0.8 } },
    music: {
      sample_music: [{ source: 'sounds/music', files: ['sample_a.ogg', 'sample_b.ogg'], randomStart: true, shuffle: false, volume: 1 }],
    },
  };
}
