import { querySessionEntity, querySessionEntityEditTarget } from '@/services/entity-query.service';
import { querySessionDraftResources } from '@/services/resource-reference.service';
import { queryResourceDataUrls } from '@/services/resource-media.service';
import { queryJointCandidate } from '@/services/joint-edit.service';
import { jointObject } from '@/domain/joint-edit';
import { createShipSpec } from '@/domain/editors/spec-construction';
import { shipBuiltInWeaponIds, type ShipWeaponSources, type ShipWeaponSource } from '@/domain/spec-editor/ship/spec-ship-weapons';
import { formatError } from '@/shared/lib/errors';
import { requireRowData } from '@/shared/lib/row-data';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import type { EntityData, ProjectSessionId, JointEditRoot, ResourceRef, RowData } from '@/shared/types';

export async function querySpecShipWeaponSources(root: JointEditRoot, ship: RowData, signal?: AbortSignal): Promise<ShipWeaponSources> {
  const ids = shipBuiltInWeaponIds(ship);
  const [hull, ...results] = await Promise.allSettled([
    queryJointCandidate({ ...root, kind: 'ship' }, signal),
    ...ids.map((id) => queryJointCandidate({ ...root, kind: 'weapon', id }, signal)),
  ]);
  const hullSnapshot = hull!.status === 'fulfilled' ? hull!.value : null;
  const csv = hullSnapshot?.records.find((record) => record.key === hullSnapshot.bindings.csv);
  const hints = jointObject(csv?.value).hints;
  const weapons = Object.fromEntries(
    ids.map((id, index): [string, ShipWeaponSource] => {
      const result = results[index]!;
      if (result.status === 'rejected')
        return [id, { spec: null, resources: {}, projectile: {}, projectileResources: {}, diagnostic: formatError(result.reason) }];
      const snapshot = result.value;
      const spec = snapshot.records.find((record) => record.key === snapshot.bindings.spec);
      const projectile = snapshot.records.find((record) => record.key === snapshot.bindings.projectile);
      return [
        id,
        {
          spec: spec?.value.state === 'present' ? jointObject(spec.value) : null,
          resources: cloneQuerySnapshot<Record<string, ResourceRef>>(spec?.resourceRefs ?? {}),
          projectile: jointObject(projectile?.value),
          projectileResources: cloneQuerySnapshot<Record<string, ResourceRef>>(projectile?.resourceRefs ?? {}),
          diagnostic: '',
        },
      ];
    }),
  );
  return {
    baseVersions: [hullSnapshot, ...results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))].flatMap(
      (snapshot) => snapshot?.baseVersions ?? [],
    ),
    hints:
      typeof hints === 'string'
        ? hints
            .split(',')
            .map((hint) => hint.trim())
            .filter(Boolean)
        : [],
    weapons,
    diagnostic: hull!.status === 'rejected' ? '船体渲染提示读取失败：' + formatError(hull!.reason) : '',
  };
}

export async function querySpecShipEditorData(
  sessionId: ProjectSessionId,
  id: string,
  signal?: AbortSignal,
): Promise<import('@/shared/types/index').SpecEditorData<'ship'>> {
  const record = await querySessionEntity(sessionId, 'ship', id, signal);
  const data = record ? cloneQuerySnapshot<EntityData>(record) : null;
  const info = data ?? (await querySessionEntityEditTarget(sessionId, 'ship', id, signal));
  return {
    kind: 'ship',
    spec: data ? requireRowData(data.data, '舰船 ' + id + ' 数据无效') : createShipSpec(id),
    target: info.target,
    baseVersions: cloneQuerySnapshot<import('@/shared/types/index').FileVersion[]>(info.baseVersions),
    isNew: info.target.state === 'create',
  };
}

export async function querySpecShipEditorImages(sessionId: string, id: string, draft: RowData, signal?: AbortSignal) {
  const refs = await querySessionDraftResources(sessionId, 'ship', id, draft, signal);
  const spriteData = await querySpriteData(sessionId, refs.sprite ?? null, signal);
  return {
    resourceRefs: Object.values(refs),
    spriteData,
    diagnostic: draft.spriteName && !spriteData ? '找不到贴图：' + draft.spriteName : '',
  };
}

async function querySpriteData(sessionId: ProjectSessionId, resource: ResourceRef | null, signal?: AbortSignal): Promise<string> {
  if (!resource) return '';
  return (await queryResourceDataUrls(sessionId, [resource], signal))[0] ?? '';
}
