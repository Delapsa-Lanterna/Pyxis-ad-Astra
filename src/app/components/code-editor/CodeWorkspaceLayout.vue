<template>
  <section ref="workspace" class="code-workspace">
    <n-split
      :size="tree ? treeSize + 'px' : '0px'"
      :min="treeMin + 'px'"
      :max="treeMax + 'px'"
      :disabled="!tree"
      :resize-trigger-size="6"
      @update:size="(size) => (treeWidth = parseFloat(String(size)))"
    >
      <template #1
        ><div v-show="tree" class="code-analysis-body"><slot name="tree" /></div
      ></template>
      <template #resize-trigger>
        <div
          class="code-resize"
          role="separator"
          tabindex="0"
          aria-label="调整项目树宽度"
          aria-orientation="vertical"
          :aria-valuenow="Math.round(treeSize)"
          :aria-valuemin="treeMin"
          :aria-valuemax="treeMax"
          @keydown="resizeKey($event, 'tree')"
        />
      </template>
      <template #2>
        <section v-if="active" class="code-analysis-body">
          <n-split
            direction="vertical"
            :size="results ? `calc(100% - ${panelSize + 6}px)` : 1"
            :min="0.4"
            :max="1"
            :disabled="!results"
            :resize-trigger-size="6"
            @update:size="(size) => (panelHeight = height - 6 - parseFloat(String(size)))"
          >
            <template #1>
              <n-split
                :size="outline ? `calc(100% - ${outlineSize + 6}px)` : 1"
                :min="textMin + 'px'"
                :max="Math.max(textMin, mainWidth - 146) + 'px'"
                :disabled="!outline"
                :resize-trigger-size="6"
                @update:size="(size) => (outlineWidth = mainWidth - 6 - parseFloat(String(size)))"
              >
                <template #1><slot name="text" /></template>
                <template #resize-trigger>
                  <div
                    class="code-resize"
                    role="separator"
                    tabindex="0"
                    aria-label="调整大纲宽度"
                    aria-orientation="vertical"
                    :aria-valuenow="Math.round(outlineSize)"
                    :aria-valuemin="140"
                    :aria-valuemax="mainWidth - textMin - 6"
                    @keydown="resizeKey($event, 'outline')"
                  />
                </template>
                <template #2
                  ><div v-show="outline" class="code-analysis-body"><slot name="outline" /></div
                ></template>
              </n-split>
            </template>
            <template #resize-trigger>
              <div
                class="code-resize code-resize-horizontal"
                role="separator"
                tabindex="0"
                aria-label="调整结果面板高度"
                aria-orientation="horizontal"
                :aria-valuenow="Math.round(panelSize)"
                :aria-valuemin="96"
                :aria-valuemax="Math.round(height * 0.6)"
                @keydown="resizeKey($event, 'panel')"
              />
            </template>
            <template #2><slot name="results" /></template>
          </n-split>
        </section>
        <slot v-else name="empty" />
      </template>
    </n-split>
  </section>
</template>
<script setup lang="ts">
import { computed, onMounted, onScopeDispose, ref, useTemplateRef, watch } from 'vue';

defineProps<{ active: boolean; results: boolean }>();
const tree = defineModel<boolean>('tree', { required: true });
const outline = defineModel<boolean>('outline', { required: true });
const workspace = useTemplateRef<HTMLElement>('workspace');
const width = ref(window.innerWidth),
  height = ref(window.innerHeight);
const treeWidth = ref(240),
  outlineWidth = ref(180),
  panelHeight = ref(200);
const textMin = computed(() => Math.min(320, width.value * 0.6));
const treeMin = computed(() => Math.min(180, width.value * 0.35));
const treeMax = computed(() => Math.max(treeMin.value, width.value - textMin.value - (outline.value ? 146 : 6)));
const treeSize = computed(() => Math.min(treeMax.value, Math.max(treeMin.value, treeWidth.value)));
const mainWidth = computed(() => width.value - (tree.value ? treeSize.value + 6 : 0));
const outlineSize = computed(() => Math.max(140, Math.min(outlineWidth.value, mainWidth.value - textMin.value - 6)));
const panelSize = computed(() => Math.min(Math.max(96, panelHeight.value), height.value * 0.6));
watch([tree, outline], ([treeOpen, outlineOpen], [previousTree, previousOutline]) => {
  if (width.value >= 800) return;
  if (treeOpen && !previousTree) outline.value = false;
  else if (outlineOpen && !previousOutline) tree.value = false;
});
watch(
  width,
  (value) => {
    if (value < 640) tree.value = outline.value = false;
  },
  { immediate: true },
);
function resizeKey(event: KeyboardEvent, pane: 'tree' | 'outline' | 'panel') {
  const keys = pane === 'panel' ? ['ArrowDown', 'ArrowUp'] : pane === 'outline' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowLeft', 'ArrowRight'];
  if (!keys.includes(event.key)) return;
  event.preventDefault();
  const delta = event.key === keys[0] ? -16 : 16;
  if (pane === 'tree') treeWidth.value = Math.max(treeMin.value, Math.min(treeMax.value, treeSize.value + delta));
  else if (pane === 'outline') outlineWidth.value = Math.max(140, Math.min(mainWidth.value - textMin.value - 6, outlineSize.value + delta));
  else panelHeight.value = Math.max(96, Math.min(height.value * 0.6, panelSize.value + delta));
}
const observer = new ResizeObserver(([entry]) => {
  width.value = entry!.contentRect.width;
  height.value = entry!.contentRect.height;
});
onMounted(() => observer.observe(workspace.value!));
onScopeDispose(() => observer.disconnect());
</script>
