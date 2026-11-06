<template>
  <div v-if="failedCount || blockedCount || externalCount || sourceCount || scanningSources" class="ui-notice" role="status">
    <div v-if="blockedCount">{{ blockedCount }} 项保存恢复等待处理。</div>
    <div v-if="failedCount">内容已保存，{{ failedCount }} 项同步待完成。</div>
    <div v-if="externalCount">{{ externalCount }} 项外部内容更新待完成。</div>
    <div v-if="sourceCount">{{ sourceCount }} 项外部来源等待恢复。</div>
    <div v-if="scanningSources">正在重新读取 {{ scanningSources }} 项来源。</div>
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
import { useProjectSyncViewModel } from '@/app/composables/use-project-sync-view-model';
const { failedCount, externalCount, sourceCount, scanningSources, blockedCount, issues, retrying, retry } = useProjectSyncViewModel();
</script>
