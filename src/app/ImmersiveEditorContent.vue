<template>
  <ImmersiveEditorShell
    :title="`舰船沉浸式编辑器 · ${joint.currentTarget.value?.id ?? root.id}`"
    :dirty="dirty"
    :saving="saving"
    :loading="loading"
    :error="errorText"
    :ready="ready"
    :locked="handoffLocked"
    :external-notice="externalUpdateNotice"
    :can-undo="history.canUndo.value"
    :can-redo="history.canRedo.value"
    @save="save"
    @undo="undo"
    @redo="redo"
    @close="closeWindow"
    @retry="initialize"
    @load-external="loadExternal"
  >
    <template v-if="panel && snapshot">
      <div class="ship-immersive-header">
        <div>
          <div class="immersive-title-row">
            <ImmersiveStatRow
              v-for="stat in panel.heading.slice(0, 2)"
              :key="stat.id"
              v-bind="rowProps(stat)"
              @toggle="toggleStat(stat.id, $event)"
              @dismiss="dismissStat"
              @update="updateField"
            />
          </div>
          <ImmersiveStatRow
            v-bind="rowProps(panel.heading[2]!)"
            @toggle="toggleStat(panel.heading[2]!.id, $event)"
            @dismiss="dismissStat"
            @update="updateField"
          />
          <div class="ship-immersive-description">
            <ImmersiveStatRow
              v-bind="rowProps(panel.description)"
              @toggle="toggleStat(panel.description.id, $event)"
              @dismiss="dismissStat"
              @update="updateField"
            />
          </div>
        </div>
        <div class="ship-immersive-sprite">
          <img v-if="sprite" :src="sprite" :alt="panel.heading[0]!.display" /><span v-else>贴图暂无可用内容</span>
        </div>
      </div>
      <ImmersiveSourceNotice :records="notices" :saving="saving" @create-overrides="createOverrides" />
      <div class="ship-immersive-stats">
        <section class="ship-immersive-logistics">
          <h2 class="immersive-group-title">后勤数据</h2>
          <div class="ship-immersive-logistics-columns">
            <div v-for="(column, index) in panel.logistics" :key="index">
              <ImmersiveStatRow
                v-for="stat in column"
                :key="stat.id"
                v-bind="rowProps(stat)"
                @toggle="toggleStat(stat.id, $event)"
                @dismiss="dismissStat"
                @update="updateField"
              />
            </div>
          </div>
        </section>
        <section>
          <h2 class="immersive-group-title">战斗性能</h2>
          <ImmersiveStatRow
            v-for="stat in panel.combat"
            :key="stat.id"
            v-bind="rowProps(stat)"
            @toggle="toggleStat(stat.id, $event)"
            @dismiss="dismissStat"
            @update="updateField"
          />
        </section>
      </div>
      <section class="ship-immersive-related">
        <ImmersiveStatRow
          v-bind="rowProps(panel.system)"
          @toggle="toggleStat(panel.system.id, $event)"
          @dismiss="dismissStat"
          @update="updateField"
        />
        <p>{{ panel.systemDescription }}</p>
        <div class="immersive-related-row">
          <span>挂载</span><strong>{{ panel.mounts }}</strong>
        </div>
        <div class="immersive-related-row">
          <span>内置武装</span><strong>{{ panel.armaments }}</strong>
        </div>
        <div class="immersive-related-row">
          <span>内置插件</span><strong v-if="!panel.hullmods.length">无</strong>
          <div v-else>
            <div v-for="mod in panel.hullmods" :key="mod.id" class="immersive-hullmod">
              <strong>{{ mod.name }}</strong
              ><small>{{ mod.description }}</small>
            </div>
          </div>
        </div>
      </section>
    </template>
  </ImmersiveEditorShell>
</template>
<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue';
import type { JointEditRoot } from '@/shared/types';
import type { ImmersiveStat } from '@/domain/immersive/fields';
import { AppError } from '@/shared/lib/errors';
import { useImmersiveEditorViewModel } from '@/app/composables/use-immersive-editor-view-model';
import { useDirtyWindowCloseGuard } from '@/app/composables/use-dirty-window-close-guard';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useInputEditMode } from '@/app/composables/use-input-edit-mode';
import { closeCurrentWindow } from '@/windows/current.window';
import ImmersiveEditorShell from '@/app/components/immersive/ImmersiveEditorShell.vue';
import ImmersiveStatRow from '@/app/components/immersive/ImmersiveStatRow.vue';
import ImmersiveSourceNotice from '@/app/components/immersive/ImmersiveSourceNotice.vue';
const params = new URLSearchParams(window.location.search);
const sessionId = params.get('sessionId');
const modRoot = params.get('modRoot');
const id = params.get('id');
if (!sessionId || !modRoot || !id || params.get('kind') !== 'ship')
  throw new AppError('缺少有效舰船窗口身份', { action: 'open-immersive-editor' });
const root: JointEditRoot = { sessionId, modRoot, id, kind: 'ship' };
const {
  joint,
  snapshot,
  panel,
  notices,
  runtimeContext,
  sprite,
  errorText,
  selectedStatId,
  history,
  editable,
  updateField,
  toggleStat,
  dismissStat,
  save,
  createOverrides,
  undo,
  redo,
  initialize,
  loadExternal,
} = useImmersiveEditorViewModel(root);
const { dirty, saving, loading, ready, handoffLocked, externalUpdateNotice } = joint;
useInputEditMode(joint.inputs);
const closeGuard = useDirtyWindowCloseGuard({
  dirty,
  title: '关闭沉浸式编辑器？',
  content: '当前舰船有未保存草稿或活动输入，关闭前确认所属保存。',
});
function rowProps(stat: ImmersiveStat) {
  return {
    stat,
    editable: stat.fields.every(editable),
    active: selectedStatId.value === stat.id,
    values: joint.draftValue.value,
    snapshot: snapshot.value!,
    runtimeContext: runtimeContext.value,
  };
}
function closeWindow() {
  void closeCurrentWindow();
}
useShortcutDispatch({
  commands: {
    save: () => {
      void save();
    },
    undo: () => {
      void undo();
    },
    redo: () => {
      void redo();
    },
  },
  keys: { escape: closeWindow },
});
onMounted(async () => {
  await closeGuard.install();
  await initialize();
});
onUnmounted(closeGuard.dispose);
</script>
