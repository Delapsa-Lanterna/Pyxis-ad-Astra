<template>
  <slot />
  <n-dropdown
    v-if="menu"
    class="window-context-menu ui-control-border"
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
import { useWindowContextMenu, type ContextMenuHost } from '@/app/composables/use-context-menu';
const props = defineProps<{ host: ContextMenuHost }>();
const { menu, options, close, select, activeKey, preventBlur } = useWindowContextMenu(props.host);
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
