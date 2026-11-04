import 'vue';
import type { NAutoComplete } from 'naive-ui/es/auto-complete';
import type { NButton } from 'naive-ui/es/button';
import type { NCheckbox } from 'naive-ui/es/checkbox';
import type { NCollapse, NCollapseItem } from 'naive-ui/es/collapse';
import type { NConfigProvider } from 'naive-ui/es/config-provider';
import type { NDialogProvider } from 'naive-ui/es/dialog';
import type { NDynamicTags } from 'naive-ui/es/dynamic-tags';
import type AppImage from './components/AppImage.vue';
import type { NInput } from 'naive-ui/es/input';
import type { NInputNumber } from 'naive-ui/es/input-number';
import type { NMessageProvider } from 'naive-ui/es/message';
import type { NModal } from 'naive-ui/es/modal';
import type { NPopover } from 'naive-ui/es/popover';
import type { NRadioButton, NRadioGroup } from 'naive-ui/es/radio';
import type AppSelect from './components/AppSelect.vue';
import type { NSlider } from 'naive-ui/es/slider';
import type { NSpin } from 'naive-ui/es/spin';
import type { NSwitch } from 'naive-ui/es/switch';
import type { NTree } from 'naive-ui/es/tree';

declare module 'vue' {
  export interface GlobalComponents {
    NAutoComplete: typeof NAutoComplete;
    NButton: typeof NButton;
    NCheckbox: typeof NCheckbox;
    NCollapse: typeof NCollapse;
    NCollapseItem: typeof NCollapseItem;
    NConfigProvider: typeof NConfigProvider;
    NDialogProvider: typeof NDialogProvider;
    NDynamicTags: typeof NDynamicTags;
    NImage: typeof AppImage;
    NInput: typeof NInput;
    NInputNumber: typeof NInputNumber;
    NMessageProvider: typeof NMessageProvider;
    NModal: typeof NModal;
    NPopover: typeof NPopover;
    NRadioButton: typeof NRadioButton;
    NRadioGroup: typeof NRadioGroup;
    NSelect: typeof AppSelect;
    NSlider: typeof NSlider;
    NSpin: typeof NSpin;
    NSwitch: typeof NSwitch;
    NTree: typeof NTree;
  }
}
