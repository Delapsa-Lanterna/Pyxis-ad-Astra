import { entityTargetFixture } from '@/test/entity-target';
import type { EntityData, RowData } from '@/shared/types';

export function jsonEntityFixture(
  kind: 'faction' | 'mission' | 'variant' | 'skin',
  id = 'a',
  name = 'Saved',
  modRoot = 'M:/one',
): EntityData {
  const target = entityTargetFixture(kind, id);
  target.write = { ...target.write, root: modRoot, path: modRoot + '/' + target.write.relPath };
  target.source = { ...target.write };
  const data: RowData =
    kind === 'variant'
      ? { variantId: id, hullId: 'hull', displayName: name }
      : kind === 'skin'
        ? { skinHullId: id, baseHullId: 'hull', hullName: name }
        : kind === 'faction'
          ? { id, displayName: name }
          : { list: { mission: id }, descriptor: { title: name }, text: 'Body' };
  const paths =
    kind === 'mission'
      ? [target.write.path + '/descriptor.json', target.write.path + '/mission_text.txt', modRoot + '/data/missions/mission_list.csv']
      : kind === 'faction'
        ? [target.write.path, modRoot + '/data/world/factions/factions.csv']
        : [target.write.path];
  return { kind, id, target, data, baseVersions: paths.map((path) => ({ path, fingerprint: 'v1' })), resourceRefs: {} };
}
