import type { JointValue } from '@/shared/types';
import { isExternalSource } from '@/shared/lib/resource-ref';
import type { ImmersiveEditorRuntime } from '../use-immersive-editor-runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSettingsStore } from '@/stores/settings.store';
import { jointObject } from '@/domain/joint-edit';
import { changeWeaponSpecClass } from '@/domain/entity-write/spec-construction';
import { openSpecProjectileEditorWindow } from '@/windows/spec-editor.window';
import { openWeaponFirePreviewWindow } from '@/windows/weapon-fire-preview.window';
import { deepClone } from '@/shared/lib/starsector';
import { schemaStringValue } from '@/domain/schema/schema-values';

export function useImmersiveWeaponEditor(runtime: ImmersiveEditorRuntime) {
  const { joint, snapshot, notices } = runtime;
  const feedback = useAppFeedback(),
    settings = useSettingsStore();
  async function createOverrides(selected?: string[]) {
    const target = joint.currentTarget.value;
    const admitted = joint.inputs.captureContext();
    const keys = selected ?? notices.value.filter((record) => isExternalSource(record.source?.source)).map((record) => record.key);
    try {
      const records = snapshot.value!;
      const spec = records.records.find((record) => record.key === records.bindings.spec);
      let corrected: Record<string, JointValue> | undefined;
      if (spec && jointObject(spec.value).specClass === 'pulse' && keys.includes(spec.key)) {
        const choice = await feedback.choose({
          title: '选择覆盖的武器分支',
          choices: [
            { label: '弹体 projectile', value: 'projectile', type: 'primary' },
            { label: '光束 beam', value: 'beam' },
          ],
        });
        if (choice !== 'projectile' && choice !== 'beam') return;
        if (!runtime.isActive() || !admitted() || joint.currentTarget.value !== target) return;
        corrected = { [spec.key]: { state: 'present', value: changeWeaponSpecClass(jointObject(spec.value), choice) } };
      }
      if (!runtime.isActive() || !admitted() || joint.currentTarget.value !== target) return;
      await joint.createOverrides(keys, corrected);
    } catch (error) {
      feedback.error(error);
    }
  }
  async function openWeaponWindow(kind: 'projectile' | 'preview') {
    const target = joint.currentTarget.value;
    const admitted = joint.inputs.captureContext();
    try {
      if ((await joint.inputs.commit()) === false) return;
      if (!runtime.isActive() || !admitted() || joint.currentTarget.value !== target) return;
      const current = snapshot.value!;
      const weapon = jointObject(joint.draftValue.value[current.bindings.spec!]);
      if (kind === 'preview') {
        await openWeaponFirePreviewWindow({
          sessionId: current.root.sessionId,
          modRoot: current.root.modRoot,
          id: current.root.id,
          source: { kind: 'draft', weapon: deepClone(weapon) },
        });
      } else {
        await openSpecProjectileEditorWindow({
          sessionId: current.root.sessionId,
          modRoot: current.root.modRoot,
          id: schemaStringValue(weapon.projectileSpecId),
          starsectorRoot: settings.starsectorRoot,
        });
      }
    } catch (error) {
      feedback.error(error, kind === 'preview' ? '打开开火预览失败' : '打开弹体编辑器失败');
    }
  }
  return {
    createOverrides,
    openProjectile: () => openWeaponWindow('projectile'),
    openPreview: () => openWeaponWindow('preview'),
  };
}
