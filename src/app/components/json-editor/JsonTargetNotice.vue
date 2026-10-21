<template>
  <div v-if="deletedTarget" class="ui-notice">
    <span>当前{{ label }}的来源不完整，草稿与输入已保留。</span>
    <n-button size="small" @click="recreateSources">重新创建来源</n-button>
    <n-button size="small" @click="discardDeletedTarget">放弃编辑并继续</n-button>
  </div>
  <div v-else-if="actionsLocked" class="ui-notice">正在交接{{ label }}编辑目标。</div>
</template>

<script setup lang="ts">
defineProps<{
  label: string;
  recreateSources: () => unknown | Promise<unknown>;
  deletedTarget: boolean;
  actionsLocked: boolean;
  discardDeletedTarget: () => void | Promise<void>;
}>();
</script>
