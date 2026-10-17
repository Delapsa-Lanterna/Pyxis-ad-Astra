<template>
  <aside class="mission-file-list config-entity-list ui-layout-row ui-layout-stack ui-layout-clip ui-content-surface-muted">
    <header class="mission-file-list-header config-entity-list-header">
      <h3 class="config-entity-list-header-title ui-text-reset">战役</h3>
      <small class="config-entity-list-count">{{ missions.length }} 项</small>
    </header>
    <ul :ref="setMediaRoot" class="mission-file-items config-entity-list-items ui-text-reset">
      <li v-if="missions.length === 0" class="mission-file-empty config-entity-list-empty ui-text-small">
        未找到 data/missions/mission_list.csv 或其中没有战役。
      </li>
      <li
        v-for="mission in missions"
        :key="mission.id"
        class="mission-file-item config-entity-list-item ui-text-soft ui-layout-shrink ui-control-pointer ui-layout-grid ui-layout-center"
        :class="{ active: mission.id === selectedId }"
        @click="emit('select', mission.id)"
      >
        <svg class="config-entity-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" /></svg>
        <span class="mission-file-name config-entity-name config-entity-text-value ui-text-truncate ui-layout-shrink">{{
          mission.id
        }}</span>
      </li>
    </ul>
    <footer class="mission-file-list-footer config-entity-list-footer ui-footer">
      <n-button size="small" block :loading="actionRunning" @click="openCreateDialog">新建战役</n-button>
    </footer>

    <n-modal
      v-model:show="showCreateDialog"
      preset="dialog"
      title="新建战役"
      positive-text="创建"
      negative-text="取消"
      :positive-button-props="{ loading: actionRunning, disabled: actionRunning }"
      @positive-click="doCreateMission"
    >
      <n-input v-model:value="newMissionId" placeholder="输入战役 ID（英文目录名）" autofocus />
    </n-modal>
  </aside>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';
import type { ResourceRef } from '@/shared/types';

const props = defineProps<{
  selectedId: string | null;
  actionRunning: boolean;
  missions: Array<{ id: string }>;
  missionIconRefs: Record<string, ResourceRef | null>;
  modRoot: string | null;
  sessionId: string | null;
  listLoadStartedAt: number;
  createMission: (sessionId: string, modRoot: string, id: string) => Promise<boolean>;
  deleteMission: (sessionId: string, modRoot: string, id: string, deleteDirectory: boolean) => Promise<boolean>;
}>();
const emit = defineEmits<{ select: [missionId: string | null] }>();

const { recordListFirstFrame, setMediaRoot } = useVisibleResourceMedia({
  sessionId: () => props.sessionId,
  surface: 'config-mission-list',
  failureLabel: '读取战役图标失败',
});

const showCreateDialog = ref(false);
const newMissionId = ref('');
const createModRoot = ref<string | null>(null);
const createSessionId = ref<string | null>(null);

function openCreateDialog() {
  createModRoot.value = props.modRoot;
  createSessionId.value = props.sessionId;
  if (!createModRoot.value || !createSessionId.value) return;
  newMissionId.value = '';
  showCreateDialog.value = true;
}

async function doCreateMission() {
  const targetModRoot = createModRoot.value;
  const targetSessionId = createSessionId.value;
  if (!targetModRoot || !targetSessionId) return false;
  const id = newMissionId.value.trim();
  if (!(await props.createMission(targetSessionId, targetModRoot, id))) return false;
  showCreateDialog.value = false;
  return true;
}

watch(
  () => props.missions,
  (items) => void recordListFirstFrame(props.listLoadStartedAt, items.length),
);
</script>
