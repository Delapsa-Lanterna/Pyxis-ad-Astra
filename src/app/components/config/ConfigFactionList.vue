<template>
  <aside class="faction-list config-entity-list ui-layout-row ui-layout-stack ui-layout-clip ui-content-surface-muted">
    <header class="faction-list-header config-entity-list-header">
      <h3 class="config-entity-list-header-title ui-text-reset">势力</h3>
      <small class="config-entity-list-count">{{ factions.length }} 项</small>
    </header>

    <ul :ref="setMediaRoot" class="faction-list-items config-entity-list-items ui-text-reset">
      <li
        v-for="faction in factions"
        :key="faction.id"
        :ref="mediaRef(faction.id, factionIconRefs[faction.id])"
        class="faction-list-item config-entity-list-item ui-text-soft ui-layout-shrink ui-control-pointer ui-layout-grid ui-layout-center"
        :class="{ active: faction.id === selectedId }"
        @click="selectFaction(faction.id)"
      >
        <span v-if="factionIconRefs[faction.id]" class="config-entity-thumb ui-layout-grid ui-layout-clip">
          <ResourceThumbnail
            :session-id="sessionId!"
            :resource="factionIconRefs[faction.id]!"
            :url="mediaSrc(factionIconRefs[faction.id])"
            :active="mediaVisible(faction.id)"
            :label="faction.displayName || faction.id"
            :width="20"
            :height="20"
          />
        </span>
        <span v-else class="config-entity-color ui-control-border" :style="{ backgroundColor: faction.colorCss }" /><span
          class="config-entity-text ui-layout-grid ui-layout-shrink"
          ><strong class="config-entity-text-value ui-text-truncate">{{ faction.displayName || faction.id }}</strong
          ><small class="config-entity-text-meta ui-text-truncate ui-text-muted">{{ faction.id }}</small></span
        >
      </li>
    </ul>

    <footer class="faction-list-footer config-entity-list-footer ui-footer">
      <n-button size="small" block :loading="actionRunning" @click="openCreateDialog">新建势力</n-button>
    </footer>

    <!-- Create dialog -->
    <n-modal
      v-model:show="showCreateDialog"
      preset="dialog"
      title="新建势力"
      positive-text="创建"
      negative-text="取消"
      :positive-button-props="{ loading: actionRunning, disabled: actionRunning }"
      @positive-click="doCreate"
    >
      <FieldRow label="势力 ID"><n-input v-model:value="newFactionId" placeholder="输入势力 ID（英文标识）" autofocus /></FieldRow>
    </n-modal>
  </aside>
</template>

<script setup lang="ts">
import FieldRow from '@/shared/ui/FieldRow.vue';
import { computed, ref, watch } from 'vue';
import type { ResourceRef, RowData } from '@/shared/types';
import { configFactionListItems } from '@/domain/config/config-entities';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';

const props = defineProps<{
  selectedId: string | null;
  actionRunning: boolean;
  factions: Record<string, RowData>;
  factionIconRefs: Record<string, ResourceRef | null>;
  modRoot: string | null;
  sessionId: string | null;
  listLoadStartedAt: number;
  createFaction: (sessionId: string, modRoot: string, id: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ select: [factionId: string | null] }>();

const { mediaRef, mediaSrc, mediaVisible, recordListFirstFrame, setMediaRoot } = useVisibleResourceMedia({
  thumbnailSize: 20,
  sessionId: () => props.sessionId,
  surface: 'config-faction-list',
  failureLabel: '读取势力徽标失败',
});

const showCreateDialog = ref(false);
const newFactionId = ref('');
const createModRoot = ref<string | null>(null);
const createSessionId = ref<string | null>(null);

const factions = computed(() => configFactionListItems(props.factions));
watch(factions, (items) => void recordListFirstFrame(props.listLoadStartedAt, items.length));

function selectFaction(id: string) {
  emit('select', id);
}

function openCreateDialog() {
  createModRoot.value = props.modRoot;
  createSessionId.value = props.sessionId;
  if (!createModRoot.value || !createSessionId.value) return;
  newFactionId.value = '';
  showCreateDialog.value = true;
}

async function doCreate() {
  const targetModRoot = createModRoot.value;
  const targetSessionId = createSessionId.value;
  if (!targetModRoot || !targetSessionId) return false;
  const trimmedId = newFactionId.value.trim();
  if (!(await props.createFaction(targetSessionId, targetModRoot, trimmedId))) return false;
  showCreateDialog.value = false;
  return true;
}
</script>
