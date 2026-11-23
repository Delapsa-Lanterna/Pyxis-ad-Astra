<template>
  <div class="dialog-body">
    <p>移除方式</p>
    <n-select :value="checked ? 'delete' : 'keep'" :options="options" aria-label="移除方式" @update:value="checked = $event === 'delete'" />
    <p>
      {{
        checked
          ? '移除' + label + ' ' + id + ' 的本地登记，同时删除' + (label === '战役' ? '整个战役目录' : '这个势力文件')
          : '从本地列表移除' + label + ' ' + id + ' 的登记'
      }}，并放弃当前草稿和草稿历史。
    </p>
    <p>
      <code class="ui-code">{{ indexPath }}</code>
    </p>
    <p v-if="checked && companionPath">同时删除势力争霸配置并移除该势力的本地争霸登记。</p>
    <p v-if="checked && companionPath">
      <code class="ui-code">{{ companionPath }}</code>
    </p>
    <p v-if="!checked">{{ label === '战役' ? '战役目录保留：' : '势力文件保留：' }}</p>
    <p>
      <code class="ui-code">{{ path }}</code>
    </p>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
const props = defineProps<{ id: string; label: string; path: string; indexPath: string; companionPath?: string }>();
const options = computed(() => [
  { label: '仅移除登记', value: 'keep' },
  { label: '移除登记并删除' + (props.label === '战役' ? '战役目录' : '势力文件'), value: 'delete' },
]);
const checked = defineModel<boolean>('checked', { required: true });
</script>
