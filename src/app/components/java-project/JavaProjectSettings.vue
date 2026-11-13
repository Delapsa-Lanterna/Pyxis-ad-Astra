<template>
  <section v-if="snapshot" class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch">
    <h3 class="panel-section-title">工程配置</h3>
    <FieldRow readonly label="工程 Java">
      <span v-if="snapshot.javaPath" class="ui-code ui-text-wrap">{{ snapshot.javaPath }}</span
      ><span v-else>请在设置中选择 Java</span>
      <template #hint><FieldHints description="在主窗口设置中配置。" /></template>
    </FieldRow>
    <FieldRow v-if="snapshot.mode !== 'gradle' || snapshot.choices.length" readonly label="生成的字节码"
      ><span>Java {{ snapshot.target }}</span>
      <template #hint><FieldHints description="生成供游戏加载的代码，编译版本由当前游戏版本确定。" /></template>
    </FieldRow>
    <template v-if="snapshot.mode === 'manual'">
      <FieldRow label="源码目录"
        ><n-input
          class="ui-code"
          v-model:value="sources"
          @change="save"
          type="textarea"
          size="small"
          :autosize="{ minRows: 1, maxRows: 4 }"
          placeholder="每行一个项目内目录，留空自动识别 src"
          :input-props="{ 'aria-label': '工程源码目录' }"
      /></FieldRow>
      <FieldRow label="补充依赖"
        ><n-input
          class="ui-code"
          v-model:value="libraries"
          @change="save"
          type="textarea"
          size="small"
          :autosize="{ minRows: 1, maxRows: 4 }"
          placeholder="每行一个 JAR 路径"
          :input-props="{ 'aria-label': '工程补充依赖' }"
      /></FieldRow>
      <FieldRow label="主 JAR"
        ><n-input
          class="ui-code"
          v-model:value="primary"
          @change="save"
          @keydown.enter="save"
          size="small"
          placeholder="相对于项目根目录的 JAR 路径"
          :input-props="{ 'aria-label': '工程主 JAR' }" /><n-select
          v-if="snapshot.gameJars.length > 1"
          size="small"
          v-model:value="primary"
          @update:value="save"
          :options="snapshot.gameJars.map((value) => ({ label: value, value }))"
          :render-label="renderCodeLabel"
      /></FieldRow>
    </template>
    <FieldRow v-if="snapshot.gameJars.length" readonly label="游戏加载 JAR"
      ><div class="ui-layout-grid">
        <span v-for="path in snapshot.gameJars" :key="path" class="ui-code ui-text-wrap">{{ path }}</span>
      </div>
      <template #hint><FieldHints description="游戏从 mod_info.json 声明的位置加载代码。" /></template
    ></FieldRow>
    <FieldHints
      v-if="snapshot.mode !== 'gradle' && snapshot.missing.length"
      :warning="'缺失项：' + snapshot.missing.map(localPath).join('，')"
    />
  </section>
</template>
<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import FieldRow from '@/shared/ui/FieldRow.vue';
import FieldHints from '@/shared/ui/FieldHints.vue';
import { pathBelongsToRoot, relativePathFromRoot } from '@/shared/lib/paths';
import type { JavaProjectModel } from '@/app/composables/java-project/use-java-project';
const props = defineProps<{ project: Pick<JavaProjectModel, 'snapshot' | 'save'> }>();
const snapshot = computed(() => props.project.snapshot.value);
const localPath = (path: string) =>
  pathBelongsToRoot(path, snapshot.value!.modRoot) ? relativePathFromRoot(snapshot.value!.modRoot, path) : path;
const renderCodeLabel = (option: { label?: string | number }) => h('span', { class: 'ui-code' }, option.label);
const sources = ref(''),
  libraries = ref(''),
  primary = ref('');
watch(
  () => ({ settings: snapshot.value?.settings, primary: snapshot.value?.primaryJar }),
  ({ settings, primary: effectivePrimary }, previous) => {
    if (!previous?.settings || sources.value === (previous.settings.sources?.join('\n') ?? ''))
      sources.value = settings?.sources?.join('\n') ?? '';
    if (!previous?.settings || libraries.value === previous.settings.libraries.join('\n'))
      libraries.value = settings?.libraries.join('\n') ?? '';
    if (!previous || primary.value === (previous.primary ?? '')) primary.value = effectivePrimary ?? '';
  },
  { immediate: true },
);
const lines = (text: string) =>
  text
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);
function save() {
  return props.project.save({
    ...snapshot.value!.settings,
    sources: sources.value.trim() ? lines(sources.value) : null,
    libraries: lines(libraries.value),
    primaryJar: primary.value || null,
  });
}
</script>
