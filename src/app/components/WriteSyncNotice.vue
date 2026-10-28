<template>
  <div v-if="failedCount || blockedCount" class="ui-notice" role="status">
    <div v-if="blockedCount">{{ blockedCount }} 项保存恢复等待处理。</div>
    <div v-if="failedCount">内容已保存，{{ failedCount }} 项同步待完成。</div>
    <div v-for="issue in issues" :key="issue.id">
      <div>{{ issue.path }}：{{ issue.message }}</div>
      <details>
        <summary>详细诊断</summary>
        <pre>{{ issue.diagnostic }}</pre>
      </details>
    </div>
    <n-button size="small" :loading="retrying" @click="retry">重试</n-button>
  </div>
</template>
<script setup lang="ts">
import { useWriteSyncViewModel } from '@/app/composables/use-write-sync-view-model';
const { failedCount, blockedCount, issues, retrying, retry } = useWriteSyncViewModel();
</script>
