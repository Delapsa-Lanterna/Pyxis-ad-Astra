<template>
  <aside class="config-entity-list config-family-list ui-layout-row ui-layout-stack ui-layout-clip ui-content-surface-muted">
    <header class="config-entity-list-header">
      <h3 class="config-entity-list-header-title ui-text-reset">{{ family.displayName }}</h3>
      <small class="config-entity-list-count">{{ sortedFiles.length }} 项</small>
    </header>
    <ul :ref="setMediaRoot" class="config-entity-list-items ui-text-reset">
      <li v-if="sortedFiles.length === 0" class="config-entity-list-empty ui-text-small">{{ family.directoryHint }}</li>
      <li
        v-for="file in sortedFiles"
        :key="fileId(file)"
        :ref="mediaRef(fileId(file), props.spriteRefs[fileId(file)])"
        class="config-entity-list-item ui-text-soft ui-layout-shrink ui-control-pointer ui-layout-grid ui-layout-center"
        :class="{ active: fileId(file) === selectedId }"
        @click="emit('select', fileId(file))"
      >
        <span class="config-entity-thumb ui-layout-grid ui-layout-clip ui-control-border">
          <ResourceThumbnail
            v-if="props.spriteRefs[fileId(file)]"
            :session-id="sessionId!"
            :resource="props.spriteRefs[fileId(file)]!"
            :url="mediaSrc(props.spriteRefs[fileId(file)])"
            :active="mediaVisible(fileId(file))"
            :label="fileTitle(file)"
            :width="20"
            :height="20"
          />
          <svg v-else class="config-entity-icon ui-text-muted" viewBox="0 0 24 24" aria-hidden="true">
            <path v-for="path in family.listIconPaths" :key="path" :d="path" />
          </svg>
        </span>
        <span class="config-entity-text ui-layout-grid ui-layout-shrink">
          <span class="config-entity-name config-entity-text-value ui-text-truncate ui-layout-shrink">{{ fileTitle(file) }}</span>
          <small class="config-entity-text-meta ui-text-truncate ui-text-muted ui-layout-shrink">{{ fileId(file) }}</small>
        </span>
      </li>
    </ul>
    <footer class="config-entity-list-footer ui-footer">
      <n-button size="small" block :loading="openingCreateDialog || actionRunning" @click="openCreateDialog">{{
        family.createLabel
      }}</n-button>
    </footer>

    <n-modal
      v-model:show="showCreateDialog"
      preset="dialog"
      :title="family.createLabel"
      positive-text="创建"
      negative-text="取消"
      :positive-button-props="{ loading: actionRunning, disabled: actionRunning }"
      @positive-click="submitCreate"
    >
      <div class="variant-dialog-fields ui-layout-grid">
        <n-input v-if="settings.isPlainEditMode" v-model:value="newCompanionId" :placeholder="family.companionLabel" />
        <n-select v-else v-model:value="newCompanionId" :options="hullOptions" filterable tag :placeholder="family.companionLabel" />
        <n-input v-model:value="newId" :placeholder="family.idField" />
      </div>
    </n-modal>
  </aside>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSettingsStore } from '@/stores/settings.store';
import type { ResourceRef } from '@/shared/types';
import type { SelectOption } from '@/domain/schema/schema-options';
import type { ConfigEntityFamilyDefinition, ConfigFamilyFile } from '@/domain/config/config-entity-families';
import { compareFamilyFiles, familyFileId, familyFileTitle } from '@/domain/config/config-entity-families';
import { useVisibleResourceMedia } from '@/app/composables/use-visible-resource-media';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';

const props = defineProps<{
  family: ConfigEntityFamilyDefinition;
  selectedId: string | null;
  actionRunning: boolean;
  files: ConfigFamilyFile[];
  spriteRefs: Record<string, ResourceRef | null>;
  hullNames: Record<string, string>;
  hullOptions: SelectOption[];
  loadHullOptions: () => Promise<void>;
  modRoot: string | null;
  sessionId: string | null;
  listLoadStartedAt: number;
  createEntity: (sessionId: string, modRoot: string, companionId: string, id: string) => Promise<boolean>;
  deleteEntity: (sessionId: string, modRoot: string, id: string, relPath: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ select: [id: string | null] }>();

const settings = useSettingsStore();
const { mediaRef, mediaSrc, recordListFirstFrame, setMediaRoot, mediaVisible } = useVisibleResourceMedia({
  sessionId: () => props.sessionId,
  surface: props.family.mediaSurface,
  failureLabel: `读取${props.family.displayName}缩略图失败`,
});

const showCreateDialog = ref(false);
const openingCreateDialog = ref(false);
const newCompanionId = ref('');
const newId = ref('');
const createModRoot = ref<string | null>(null);
const createSessionId = ref<string | null>(null);

function fileId(file: ConfigFamilyFile): string {
  return familyFileId(file);
}

function fileTitle(file: ConfigFamilyFile): string {
  return familyFileTitle(props.family, file, props.hullNames);
}

const sortedFiles = computed(() => [...props.files].sort((left, right) => compareFamilyFiles(props.family, left, right)));

async function openCreateDialog() {
  createModRoot.value = props.modRoot;
  createSessionId.value = props.sessionId;
  if (!createModRoot.value || !createSessionId.value) return;
  openingCreateDialog.value = true;
  try {
    await props.loadHullOptions();
    if (props.modRoot !== createModRoot.value || props.sessionId !== createSessionId.value) return;
    showCreateDialog.value = true;
  } finally {
    openingCreateDialog.value = false;
  }
}

async function submitCreate() {
  const targetModRoot = createModRoot.value;
  const targetSessionId = createSessionId.value;
  if (!targetModRoot || !targetSessionId) return false;
  const created = await props.createEntity(targetSessionId, targetModRoot, newCompanionId.value.trim(), newId.value.trim());
  if (!created) return false;
  showCreateDialog.value = false;
  newCompanionId.value = '';
  newId.value = '';
  return true;
}

watch(
  () => props.files,
  (items) => void recordListFirstFrame(props.listLoadStartedAt, items.length),
);
</script>
