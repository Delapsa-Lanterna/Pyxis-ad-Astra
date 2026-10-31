import type { ReadonlyVariantEntry } from '@/shared/types';
import { isRowData } from '@/shared/lib/row-data';
import { schemaStringValue } from '@/domain/schema/schema-values';
import { weaponImageLayers, weaponLoadedMissile } from '@/shared/lib/starsector/weapon-images';
import { immersiveCatalogScene, immersiveWingLayout } from '@/domain/immersive/hull-scene';
import { immersiveNumber } from '@/domain/immersive/fields';
import { hullThumbnailRequest, weaponThumbnailRequest } from '../use-immersive-thumbnails';
import { resourceThumbnailRequest } from '@/app/composables/use-resource-thumbnail';

export function variantCandidateThumbnail(sessionId: string, entry: ReadonlyVariantEntry, kind: 'weapons' | 'wings' | 'variants') {
  if (kind === 'variants') return entry.resourceRefs.icon ? resourceThumbnailRequest(sessionId, entry.resourceRefs.icon, 69, 69) : null;
  const data = isRowData(entry.data) ? entry.data : {},
    spec = isRowData(entry.spec) ? entry.spec : {};
  if (kind === 'weapons')
    return weaponThumbnailRequest(
      sessionId,
      weaponImageLayers(spec, entry.resourceRefs, 'turret'),
      String(spec.mountTypeOverride || spec.type || ''),
      String(spec.size ?? ''),
      weaponLoadedMissile(
        spec,
        entry.projectile && isRowData(entry.projectile.data) ? entry.projectile.data : {},
        entry.projectile?.resourceRefs ?? {},
        'turret',
      ),
    );
  const scene = immersiveCatalogScene(entry),
    layout = immersiveWingLayout(immersiveNumber(data, 'num', NaN), schemaStringValue(data.formation), 72);
  return scene && !layout.diagnostic ? hullThumbnailRequest(sessionId, scene, 69, layout) : null;
}
