<template>
  <section
    v-if="snapshot && snapshot.mode !== 'core'"
    class="panel-card ui-layout-shrink ui-control-border ui-content-surface ui-layout-grid ui-layout-stretch"
    aria-label="工程任务与产物"
  >
    <h3 class="panel-section-title">构建与部署</h3>
    <FieldRow label="编译模式"
      ><n-switch
        class="tool-switch"
        :value="snapshot.settings.buildMode === 'gradle'"
        :disabled="project.busy.value"
        aria-label="使用 Gradle"
        @update:value="changeMode"
        ><template #checked>Gradle</template><template #unchecked>手动编译</template></n-switch
      ></FieldRow
    >
    <template v-if="snapshot.mode === 'gradle'">
      <FieldHints
        v-if="snapshot.mode === 'gradle' && snapshot.stale"
        warning="构建配置尚未读取或已变化。请点击同步项目配置，读取源码目录、依赖和构建任务。"
      />

      <FieldRow v-if="snapshot.sources.length" readonly label="源码目录"
        ><div class="ui-layout-grid">
          <span v-for="path in snapshot.sources" :key="path" class="ui-code ui-text-wrap" :title="path">{{ localPath(path) }}</span>
        </div></FieldRow
      >
      <FieldRow v-if="snapshot.libraries.length" readonly label="编译依赖"
        ><div class="ui-layout-grid">
          <span v-for="path in snapshot.libraries" :key="path" class="ui-code ui-text-wrap">{{ localPath(path) }}</span>
        </div></FieldRow
      >
      <FieldRow v-if="snapshot.artifacts.length" readonly label="构建输出"
        ><div class="ui-layout-grid">
          <span v-for="path in snapshot.artifacts" :key="path" class="ui-code ui-text-wrap">{{ localPath(path) }}</span>
        </div></FieldRow
      >

      <FieldRow v-if="snapshot.choices.length > 1" label="Java 分析项目"
        ><n-select
          :value="snapshot.selectedProject"
          size="small"
          :options="snapshot.choices.map((value) => ({ label: projectName(value), value }))"
          placeholder="选择要分析的 Java 子项目"
          @update:value="chooseProject"
      /></FieldRow>
      <FieldRow v-else-if="snapshot.selectedProject" readonly label="Java 分析项目"
        ><span>{{ projectName(snapshot.selectedProject) }}</span></FieldRow
      >
      <FieldRow readonly label="运行 Gradle"
        ><div>
          <span v-if="snapshot.gradle">{{ gradleSources[snapshot.gradle.source] }}</span>
          <p v-if="snapshot.gradle" class="ui-code ui-text-wrap ui-text-reset">{{ snapshot.gradle.path }}</p>
          <span v-else>尚未找到 Gradle，请选择已安装的 Gradle 或配置项目 Wrapper。</span>
        </div>
        <template v-if="snapshot.gradle?.source !== 'wrapper'" #actions
          ><n-button size="small" @click="project.pickGradle">选择 Gradle</n-button></template
        ></FieldRow
      >
      <FieldHints v-if="snapshot.gradleError" :warning="snapshot.gradleError.message" />
      <FieldHints v-if="snapshot.missing.length" :warning="'缺失项：' + snapshot.missing.map(localPath).join('，')" />
      <FieldHints v-if="snapshot.configurationError" :warning="snapshot.configurationError.message" />
    </template>
    <div class="action-group">
      <n-button size="small" :disabled="project.busy.value" @click="project.detect">检测环境</n-button>
      <n-button v-if="snapshot.mode === 'gradle'" size="small" :disabled="project.busy.value || !snapshot.gradle" @click="project.sync()"
        >同步项目配置</n-button
      >
      <n-button
        v-if="snapshot.mode === 'gradle' && snapshot.phase === 'offlineFailed'"
        size="small"
        :disabled="project.busy.value"
        @click="project.retry"
        >允许下载并重试</n-button
      >
      <n-button v-if="project.busy.value" size="small" @click="project.cancel">取消任务</n-button>
      <template v-if="snapshot.mode === 'gradle'"
        ><n-button
          v-for="path in snapshot.buildFiles.filter((path) => /(?:build|settings)\.gradle(?:\.kts)?$/.test(path))"
          :key="path"
          size="small"
          @click="project.open(path)"
          ><span class="ui-code">{{ path.split(/[\\/]/).at(-1) }}</span></n-button
        ></template
      >
    </div>
    <template v-if="snapshot.mode === 'gradle'">
      <FieldRow label="项目任务"
        ><n-select
          v-model:value="tasks"
          :input-props="{ 'aria-label': 'Gradle 项目任务', role: 'combobox' }"
          size="small"
          multiple
          filterable
          :placeholder="snapshot.stale ? '同步项目配置后选择任务' : '选择项目提供的任务'"
          :options="taskOptions"
          :render-label="renderCodeLabel"
          ><template #empty
            ><span>{{ taskEmptyMessage }}</span></template
          ></n-select
        ></FieldRow
      >
      <p v-for="task in selectedTasks" :key="task.path" class="ui-text-reset ui-text-muted">
        <span class="ui-code">{{ task.path }}</span
        >{{ task.description ? ' · ' + task.description : '' }}
      </p>
      <FieldRow label="附加任务与参数"
        ><n-input
          class="ui-code"
          v-model:value="argumentsText"
          type="textarea"
          size="small"
          :autosize="{ minRows: 1, maxRows: 4 }"
          placeholder="其他任务路径或参数，每行一项，原样传给 Gradle"
          :input-props="{ 'aria-label': 'Gradle 任务参数' }"
      /></FieldRow>
    </template>
    <div class="action-group">
      <n-button
        v-if="snapshot.mode === 'gradle'"
        size="small"
        :disabled="project.busy.value || !snapshot.gradle || (!tasks.length && !argumentsText.trim())"
        type="primary"
        @click="
          project.build(
            tasks,
            argumentsText.split('\n').filter((value) => value.trim()),
          )
        "
        >运行 Gradle</n-button
      >
      <n-button v-else size="small" :disabled="project.busy.value" type="primary" @click="project.build()"
        >使用 javac 编译并生成 JAR</n-button
      >
    </div>
    <template v-if="snapshot.build && snapshot.build.mode === snapshot.settings.buildMode && snapshot.build.artifacts.length">
      <FieldRow readonly label="最近成功任务"
        ><span class="ui-text-path">
          {{ snapshot.build.task }} · {{ snapshot.build.milliseconds.toFixed(0) }} ms ·
          {{ snapshot.build.inputsChanged ? '输入已变化' : '任务完成' }}
        </span></FieldRow
      >
      <FieldRow v-if="snapshot.build.artifacts.some((artifact) => /\.jar$/i.test(artifact.path))" label="部署目标"
        ><n-select
          size="small"
          v-model:value="target"
          :options="targets.map((value) => ({ label: value, value }))"
          :render-label="renderCodeLabel"
          placeholder="选择游戏加载 JAR"
      /></FieldRow>
      <FieldRow v-for="artifact in snapshot.build.artifacts" :key="artifact.id" label="产物" readonly>
        <div class="ui-layout-shrink ui-text-path">
          <div class="ui-text-wrap">{{ artifact.path }}</div>
          <div class="ui-text-small ui-text-muted">{{ artifact.bytes }} 字节 · {{ artifact.fingerprint }}</div>
          <FieldHints :warning="isLoaded(artifact.path) ? '已直接写入游戏加载位置' : ''" />
        </div>
        <template #actions>
          <n-button size="small" :disabled="project.busy.value" @click="project.locate(artifact.id)">定位文件</n-button>
          <n-button
            v-if="/\.jar$/i.test(artifact.path)"
            size="small"
            :disabled="project.busy.value || !target"
            @click="project.deploy(artifact.id, target!)"
            >部署</n-button
          >
        </template>
      </FieldRow>
    </template>
    <JavaProjectTasks :project="project" />
  </section>
</template>
<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import FieldRow from '@/shared/ui/FieldRow.vue';
import JavaProjectTasks from './JavaProjectTasks.vue';
import FieldHints from '@/shared/ui/FieldHints.vue';
import { normalizeFsPath, pathBelongsToRoot, relativePathFromRoot } from '@/shared/lib/paths';
import type { JavaProjectModel } from '@/app/composables/java-project/use-java-project';
const props = defineProps<{
  project: Pick<
    JavaProjectModel,
    | 'snapshot'
    | 'busy'
    | 'build'
    | 'locate'
    | 'deploy'
    | 'detect'
    | 'sync'
    | 'retry'
    | 'cancel'
    | 'open'
    | 'save'
    | 'pickGradle'
    | 'outputShown'
    | 'locations'
    | 'toggleOutput'
  >;
}>();
const snapshot = computed(() => props.project.snapshot.value),
  tasks = ref<string[]>([]),
  argumentsText = ref(''),
  target = ref<string | null>(null);
const targets = computed(() => snapshot.value?.deployTargets ?? []);
const renderCodeLabel = (option: { label?: string | number }) => h('span', { class: 'ui-code' }, option.label);
const gradleSources = { wrapper: '项目 Wrapper', selected: '手动选择的 Gradle', system: '系统 PATH 中的 Gradle' };
const projectName = (path: string) => (path === ':' ? '根项目' : '子项目 ' + path);
const localPath = (path: string) =>
  pathBelongsToRoot(path, snapshot.value!.modRoot) ? relativePathFromRoot(snapshot.value!.modRoot, path) : path;
function chooseProject(project: string) {
  return props.project.save({ ...snapshot.value!.settings, project });
}
async function changeMode(gradle: boolean) {
  if (!(await props.project.save({ ...snapshot.value!.settings, buildMode: gradle ? 'gradle' : 'manual' }))) return;
  if (gradle) await props.project.detect();
}
const selectedTasks = computed(() => snapshot.value?.tasks.filter((task) => tasks.value.includes(task.path)) ?? []);
const taskEmptyMessage = computed(() => {
  const project = snapshot.value!;
  if (project.active && project.operation?.kind === 'sync') return '正在读取项目任务，请稍候。';
  if (project.stale) return '任务列表尚未加载或需要更新，请点击同步项目配置。';
  return project.tasks.length ? '没有匹配的任务，请调整搜索内容。' : '已读取项目配置，当前项目没有可用任务。';
});
const taskOptions = computed(() =>
  [...new Set(snapshot.value?.tasks.map((task) => task.group ?? '其他任务'))].map((group) => ({
    type: 'group' as const,
    label: group,
    key: group,
    children: snapshot
      .value!.tasks.filter((task) => (task.group ?? '其他任务') === group)
      .map((task) => ({ label: task.path, value: task.path })),
  })),
);
function isLoaded(path: string) {
  return targets.value.some((target) => normalizeFsPath(path) === normalizeFsPath(snapshot.value!.modRoot + '/' + target));
}
watch(
  targets,
  (values) => {
    if (!target.value || !values.includes(target.value)) target.value = values.length === 1 ? values[0]! : null;
  },
  { immediate: true },
);
</script>
