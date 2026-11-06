<template><EditorProblems :issues="problems?.issues.value ?? []" /></template>
<script setup lang="ts">
import { inject } from 'vue';
import EditorProblems from '@/shared/ui/EditorProblems.vue';
import { specProblemsKey } from '@/app/composables/spec-editor/use-spec-problems';
const problems = inject(specProblemsKey, null);
</script>
