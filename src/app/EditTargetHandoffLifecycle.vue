<template><slot /></template>
<script setup lang="ts">
import { useEditTargetHandoff } from '@/app/composables/use-edit-target-handoff';
useEditTargetHandoff();
</script>
