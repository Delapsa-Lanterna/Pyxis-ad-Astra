<template>
  <slot />
  <n-dropdown
    v-if="menu"
    class="window-context-menu"
    size="small"
    :theme-overrides="menuTheme"
    trigger="manual"
    :show="true"
    :x="menu.x"
    :y="menu.y"
    :options="options"
    :keyboard="false"
    :value="activeKey"
    :render-option="({ node }) => h('div', { onMousedown: preventBlur }, [node])"
    placement="bottom-start"
    @select="select"
    @clickoutside="close"
  />
</template>
<script setup lang="ts">
import { computed, h } from 'vue';
import { useThemeVars } from 'naive-ui/es/composables';
import { NDropdown } from 'naive-ui/es/dropdown';
import { useWindowContextMenu } from '@/app/composables/use-context-menu';
const { menu, options, close, select, activeKey, preventBlur } = useWindowContextMenu();
const theme = useThemeVars();
const menuTheme = computed(() => ({
  fontSizeSmall: '12px',
  optionHeightSmall: '30px',
  borderRadius: '5px',
  optionColorActive: theme.value.hoverColor,
  optionTextColorActive: theme.value.textColor2,
  peers: { Popover: { boxShadow: 'none' } },
}));
</script>
<style scoped>
:global(.window-context-menu) {
  min-width: 160px;
  border: 1px solid var(--color-border);
}
:global(.window-context-menu .context-menu-danger) {
  color: var(--color-danger) !important;
}
</style>
