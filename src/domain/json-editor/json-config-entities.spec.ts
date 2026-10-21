import { describe, expect, it } from 'vitest';
import { createDefaultFaction } from '@/domain/json-editor/json-config-entities';
import { configFactionSaveDraft, configMissionSaveDraft, configModInfoSaveData } from '@/domain/json-editor/json-config-entities';
import { getSchema } from '@/domain/schema/config-schema-registry';

describe('configuration business content boundaries', () => {
  it('preserves top-level, dictionary and array object keys through every source split', () => {
    const content = { id: 'demo', _rowKey: 'business', nested: { _slot: 'weapon' }, values: [{ _field: 2 }] };
    expect(configModInfoSaveData({ file: content }, getSchema('mod-info')!)).toEqual(content);
    expect(configFactionSaveDraft({ file: content }, getSchema('faction')!).file).toEqual(content);
    const mission = configMissionSaveDraft(
      { list: { mission: 'demo', _column: 'cell' }, descriptor: content, text: { content: 'text' } },
      getSchema('mission')!,
    );
    expect(mission.descriptor).toEqual(content);
    expect(mission.list).toEqual({ mission: 'demo', _column: 'cell' });
  });
});

describe('new faction game contract', () => {
  it('contains the required loader fields and a core faction logo', () => {
    const faction = createDefaultFaction('new_faction');
    expect(faction).toMatchObject({
      id: 'new_faction',
      displayName: 'new_faction',
      displayNameWithArticle: 'new_faction',
      logo: 'graphics/factions/neutral_traders.png',
      names: { modern: 1 },
      portraits: {},
      color: [128, 128, 128, 255],
      baseUIColor: [128, 128, 128, 255],
      darkUIColor: [64, 64, 64, 255],
    });
    faction.names = {};
    expect(createDefaultFaction('other').names).toEqual({ modern: 1 });
  });
});
