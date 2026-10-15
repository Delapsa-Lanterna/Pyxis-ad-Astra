import type { JointValue } from '@/shared/types';
import type { ImmersiveEditorRuntime } from '../use-immersive-editor-runtime';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSettingsStore } from '@/stores/settings.store';
import { jointObject } from '@/domain/joint-edit';
import { changeWeaponSpecClass } from '@/domain/editors/weapon-spec';
import { openSpecProjectileEditorWindow } from '@/windows/spec-editor.window';
import { schemaStringValue } from '@/domain/schema/schema-values';

export function useImmersiveWeaponEditor(runtime: ImmersiveEditorRuntime) {
  const { joint, snapshot, notices } = runtime;
  const feedback = useAppFeedback(),
    settings = useSettingsStore();
  async function createOverrides(selected?: string[]) {
    const target = joint.currentTarget.value;
    const admitted = joint.inputs.captureContext();
    const keys = selected ?? notices.value.filter((record) => record.source?.source === 'core').map((record) => record.key);
    try {
      const records = snapshot.value!;
      const spec = records.records.find((record) => record.key === records.bindings.spec);
      let corrected: Record<string, JointValue> | undefined;
      if (spec && jointObject(spec.value).specClass === 'pulse' && keys.includes(spec.key)) {
        const choice = await feedback.choose({
          title: '选择覆盖的武器分支',
          content: 'pulse 在原版中无法正常处理，选择合法分支并补齐必读字段后建立当前 Mod 覆盖。',
          choices: [
            { label: '弹丸 projectile', value: 'projectile', type: 'primary' },
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
  async function openProjectile() {
    const target = joint.currentTarget.value;
    const admitted = joint.inputs.captureContext();
    try {
      if ((await joint.inputs.commit()) === false) return;
      if (!runtime.isActive() || !admitted() || joint.currentTarget.value !== target) return;
      const current = snapshot.value!;
      const id = schemaStringValue(jointObject(joint.draftValue.value[current.bindings.spec!]).projectileSpecId);
      await openSpecProjectileEditorWindow({
        sessionId: current.root.sessionId,
        modRoot: current.root.modRoot,
        id,
        starsectorRoot: settings.starsectorRoot,
      });
    } catch (error) {
      feedback.error(error, '打开弹体编辑器失败');
    }
  }
  return { createOverrides, openProjectile };
}
