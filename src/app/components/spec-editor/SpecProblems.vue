<template>
  <EditorProblems :ignore-warnings="settings.ignoreEditorWarnings" :issues="problems?.issues.value ?? []" @locate="locate" />
</template>
<script setup lang="ts">
import { inject } from 'vue';
import EditorProblems from '@/shared/ui/EditorProblems.vue';
import { useSettingsStore } from '@/stores/settings.store';
import { specProblemsKey } from '@/app/composables/spec-editor/use-spec-problems';
import { specProblemNavigationKey } from '@/app/composables/spec-editor/use-spec-problem-navigation';
const settings = useSettingsStore();
const locate = inject(specProblemNavigationKey)!;
const problems = inject(specProblemsKey, null);
</script>
