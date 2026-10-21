<template>
  <JsonEditorPage
    v-if="workspace.currentView === 'json-editor' && workspace.activeManifest"
    :key="JSON.stringify([workspace.activeSessionId, workspace.jsonPage])"
    :session-id="workspace.activeSessionId!"
    :mod-root="workspace.activeModRoot!"
    :page="workspace.jsonPage"
  />
</template>
<script setup lang="ts">
import { useWorkspaceStore } from '@/stores/workspace.store';
import JsonEditorPage from './JsonEditorPage.vue';
const workspace = useWorkspaceStore();
</script>
