<template>
  <div class="startup-error ui-content-column">
    <header class="titlebar ui-control-row" @pointerdown="drag" @dblclick="perform(toggleMaximizeCurrentWindow)">
      <div class="titlebar-brand ui-control-row">
        <img class="titlebar-mark ui-image" :src="appIcon" alt="" draggable="false" />
        <strong class="ui-text-small">星界罗盘 [Circinus ad Astra]</strong>
      </div>
      <div class="titlebar-controls ui-control-row" @pointerdown.stop @dblclick.stop>
        <button
          class="titlebar-button ui-button ui-control-button ui-layout-grid ui-text-soft"
          aria-label="最小化"
          @click="perform(minimizeCurrentWindow)"
        >
          <svg class="titlebar-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14" /></svg>
        </button>
        <button
          class="titlebar-button ui-button ui-control-button ui-layout-grid ui-text-soft"
          aria-label="最大化或还原"
          @click="perform(toggleMaximizeCurrentWindow)"
        >
          <svg class="titlebar-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7h10v10H7z" /></svg>
        </button>
        <button
          class="titlebar-button close ui-button ui-control-button ui-layout-grid ui-text-soft"
          aria-label="关闭"
          @click="perform(exit)"
        >
          <svg class="titlebar-button-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m7 7 10 10M17 7 7 17" /></svg>
        </button>
      </div>
    </header>
    <main class="startup-error-body ui-control-center ui-content-scroll">
      <section class="startup-error-content ui-layout-grid" aria-labelledby="startup-error-title">
        <svg class="startup-error-icon ui-control-icon" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v6m0 3v1" />
        </svg>
        <h1 id="startup-error-title" class="page-title ui-text-reset">启动失败</h1>
        <p class="ui-text-reset ui-text-soft">窗口未能完成初始化。你可以重试启动，或复制诊断信息后退出。</p>
        <div class="action-group">
          <button class="startup-error-button primary ui-button" :disabled="busy" @click="perform(reloadCurrentWindow)">重试启动</button>
          <button class="startup-error-button ui-button" :disabled="busy" @click="perform(copy)">复制诊断</button>
          <button class="startup-error-button ui-button" :disabled="busy" @click="perform(exit)">退出</button>
        </div>
        <p v-if="notice" class="ui-text-reset ui-text-soft" role="status">{{ notice }}</p>
        <details class="startup-error-details">
          <summary class="ui-control-pointer">诊断详情</summary>
          <pre class="startup-error-code">{{ diagnosticText }}</pre>
          <pre v-if="actionDiagnostic" class="startup-error-code">{{ actionDiagnostic }}</pre>
        </details>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import appIcon from '@/assets/app-icon.svg';
import { errorDiagnosticOf, errorContextOf, formatError } from '@/shared/lib/errors';
import { writeClipboardText } from '@/shared/runtime/clipboard.runtime';
import {
  closeCurrentWindow,
  minimizeCurrentWindow,
  toggleMaximizeCurrentWindow,
  startCurrentWindowDrag,
  reloadCurrentWindow,
} from '@/windows/current.window';

const props = defineProps<{ error: unknown; reported: Promise<void> }>();
const emit = defineEmits<{ failure: [error: unknown] }>();
const diagnosticText = JSON.stringify({ ...errorDiagnosticOf(props.error), ...errorContextOf(props.error) }, null, 2);
const busy = ref(false),
  notice = ref(''),
  actionDiagnostic = ref('');
async function perform(action: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true;
  notice.value = '';
  try {
    await action();
  } catch (error) {
    const diagnostic = errorDiagnosticOf(error);
    notice.value = '操作未完成：' + formatError(error);
    actionDiagnostic.value = JSON.stringify(diagnostic, null, 2);
    emit('failure', error);
  } finally {
    busy.value = false;
  }
}
async function exit() {
  await props.reported;
  await closeCurrentWindow();
}
async function copy() {
  await writeClipboardText(diagnosticText + (actionDiagnostic.value ? '\n' + actionDiagnostic.value : ''));
  notice.value = '诊断信息已复制';
}
function drag(event: PointerEvent) {
  if (event.button === 0 && event.detail <= 1) void perform(startCurrentWindowDrag);
}
</script>
