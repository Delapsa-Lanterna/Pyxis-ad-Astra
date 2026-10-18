<template>
  <div class="config-page editor-page ui-content-column" :inert="handoffLocked">
    <EditorHeader
      :title="displayName"
      :path="paths"
      :dirty="dirty"
      :saving="saving"
      :external-update-notice="externalUpdateNotice"
      @load-external="loadPendingExternalData"
      ><template #actions
        ><n-button :disabled="!dirty || saving" @click="reset">重置</n-button
        ><n-button type="primary" :disabled="!dirty" :loading="saving" @click="save">保存</n-button></template
      ></EditorHeader
    >

    <div class="editor-fields ui-content-scroll">
      <SchemaFormRenderer v-if="schema" :schema="schema" v-model="draftData" :runtime-context="schemaRuntimeContext" />
    </div>
  </div>
</template>

<script setup lang="ts">
import EditorHeader from '@/app/components/editors/common/EditorHeader.vue';

import { computed, onMounted, onUnmounted } from 'vue';
import SchemaFormRenderer from '@/app/components/schema/SchemaFormRenderer.vue';
import { useCoreSchema } from '@/app/composables/use-core-schema';
import { useConfigModInfoViewModel } from '@/app/composables/config/use-config-mod-info-view-model';
import { useSaveCommandStore } from '@/stores/save-command.store';

const { getMergedSchema, loadCoreFields } = useCoreSchema();
void loadCoreFields();
const schema = computed(() => getMergedSchema('mod-info'));
const {
  dirty,
  displayName,
  reset,
  paths,
  draftData,
  externalUpdateNotice,
  loadPendingExternalData,
  saving,
  handoffLocked,
  schemaRuntimeContext,
  saveModInfo,
} = useConfigModInfoViewModel();

async function save() {
  await saveModInfo(schema.value);
}

const saveCommand = useSaveCommandStore();
onMounted(() => saveCommand.registerActiveSaveHandler(save));
onUnmounted(() => saveCommand.unregisterActiveSaveHandler(save));
</script>
