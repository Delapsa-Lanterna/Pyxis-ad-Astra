<template>
  <section class="page-content browser-gallery" data-gallery="feedback">
    <div class="browser-gallery-actions">
      <button @click="feedback.success('操作已完成')">成功消息</button><button @click="feedback.info(content)">信息消息</button
      ><button @click="warning">警告消息</button><button @click="error">错误消息</button><button @click="confirm">确认操作</button
      ><button @click="choose">多项选择</button><label>长文案 <input type="checkbox" v-model="long" /></label>
    </div>
    <output role="status" data-feedback-result>{{ result }}</output>
    <p :title="content">悬停查看正式提示</p>
    <n-popover trigger="click"
      ><template #trigger><n-button>打开浮层</n-button></template
      >{{ content }}</n-popover
    >
    <div class="browser-menu-sample" tabindex="0" data-menu-target>在区域内右键，检查动作、禁用项、键盘与边缘定位。</div>
  </section>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useContextMenuScope } from '@/app/composables/use-context-menu';
import { AppError } from '@/shared/lib/errors';
import './browser.css';
const feedback = useAppFeedback(),
  result = ref('尚未操作'),
  long = ref(false);
const content = computed(() => '用于核对消息、确认框、提示和浮层的内容。'.repeat(long.value ? 20 : 1));
useContextMenuScope({
  identity: () => 'feedback-gallery',
  actions: () => [
    {
      label: '执行示例动作',
      run: () => {
        result.value = '菜单动作已执行';
      },
    },
    { label: '禁用动作', disabled: true, run: () => {} },
  ],
  refresh: () => {
    result.value = '刷新已执行';
  },
});
function warning() {
  feedback.warning({ userMessage: content.value, diagnostic: { code: 'sample.warning', message: content.value, location: null } });
}
function error() {
  feedback.error(new AppError(content.value, { action: 'feedback-gallery' }), '示例错误');
}
function confirm() {
  feedback.confirmWarning({
    title: '确认示例操作',
    content: content.value,
    actionText: '确认执行',
    onConfirm: () => {
      result.value = '操作已确认';
    },
    onCancel: () => {
      result.value = '操作已取消';
    },
  });
}
async function choose() {
  result.value =
    (await feedback.choose({
      title: '选择示例动作',
      content: content.value,
      choices: [
        { label: '选择 A', value: 'A' },
        { label: '选择 B', value: 'B' },
      ],
    })) ?? '选择已取消';
}
</script>
