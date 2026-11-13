<template>
  <section class="java-project-settings ui-layout-grid" aria-label="Java 工程设置">
    <JavaProjectSettings :project="project" />
    <JavaBuildPanel :project="project" />
  </section>
</template>
<script setup lang="ts">
import JavaProjectSettings from './JavaProjectSettings.vue';
import JavaBuildPanel from './JavaBuildPanel.vue';
import type { JavaProjectModel } from '@/app/composables/java-project/use-java-project';
defineProps<{ project: JavaProjectModel }>();
</script>
