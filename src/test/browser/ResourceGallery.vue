<template>
  <section class="page-content browser-gallery" data-gallery="resources">
    <div class="browser-gallery-actions">
      <label
        >资源状态
        <select aria-label="资源状态" v-model="state" @change="load">
          <option v-for="(label, key) in states" :key="key" :value="key">{{ label }}</option>
        </select></label
      ><button
        @click="
          state = 'ready';
          load();
        "
      >
        重新加载资源</button
      ><output>{{ status }}</output>
    </div>
    <div class="browser-resource-grid">
      <section>
        <h2>图片与预览</h2>
        <n-spin :show="state === 'loading'"
          ><AppImage v-if="url" :key="generation" :src="url" alt="测试图片" width="160" />
          <p v-else>{{ status }}</p></n-spin
        >
      </section>
      <section>
        <h2>正式缩略图</h2>
        <ResourceThumbnail
          v-if="url"
          :key="generation"
          :session-id="model.sessionId"
          :resource="resource"
          :url="url"
          label="测试缩略图"
          :width="96"
          :height="96"
        />
        <p v-else>{{ status }}</p>
      </section>
      <section>
        <h2>字体与缺字</h2>
        <FontText font="insignia15LTaa" :text="'舰船名称 AV 0123\n长文字换行与缺字：' + String.fromCodePoint(0x10ffff)" block /><label
          >原版字体
          <input
            type="checkbox"
            :checked="settings.immersiveGameFont"
            @change="settings.setImmersiveGameFont(($event.target as HTMLInputElement).checked)"
        /></label>
      </section>
    </div>
  </section>
</template>
<script setup lang="ts">
import { onScopeDispose, ref } from 'vue';
import AppImage from '@/app/components/AppImage.vue';
import ResourceThumbnail from '@/app/components/media/ResourceThumbnail.vue';
import FontText from '@/app/components/fonts/FontText.vue';
import { useSettingsStore } from '@/stores/settings.store';
import { queryResourceDataUrls } from '@/services/resource-media.service';
import { invalidateResourceMediaForSession } from '@/services/resource-media.service';
import type { ResourceRef } from '@/shared/types';
import { browserModel } from './runtime/commands';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import './browser.css';
const model = browserModel(),
  settings = useSettingsStore();
const feedback = useAppFeedback();
const states = { ready: '成功', loading: '加载中', empty: '空资源', failed: '读取失败' };
const state = ref<keyof typeof states>('ready'),
  url = ref(''),
  status = ref(''),
  generation = ref(0);
const resource: ResourceRef = model.graph('ship').hull!.sprite!;
let ticket = 0;
onScopeDispose(() => ticket++);
async function load() {
  const current = ++ticket;
  invalidateResourceMediaForSession(model.sessionId);
  generation.value++;
  url.value = '';
  status.value = states[state.value];
  if (state.value === 'empty') return;
  model.resourceDelay = state.value === 'loading' ? 1500 : 0;
  if (state.value === 'failed')
    model.failures.set('query_resource_data_urls', { code: 'sample.resource', message: '测试资源读取失败', location: null });
  try {
    const urls = await queryResourceDataUrls(model.sessionId, [resource]);
    if (ticket === current) {
      url.value = urls[0] ?? '';
      status.value = '资源已加载';
    }
  } catch (error) {
    if (ticket === current) {
      status.value = '读取失败';
      feedback.error(error, '示例资源');
    }
  }
}
void load();
</script>
