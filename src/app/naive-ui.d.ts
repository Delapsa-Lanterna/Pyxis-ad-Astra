import 'vue';

declare module 'vue' {
  export interface GlobalComponents {
    NAutoComplete: typeof import('naive-ui/es/auto-complete').NAutoComplete;
    NButton: typeof import('naive-ui/es/button').NButton;
    NCheckbox: typeof import('naive-ui/es/checkbox').NCheckbox;
    NCollapse: typeof import('naive-ui/es/collapse').NCollapse;
    NCollapseItem: typeof import('naive-ui/es/collapse').NCollapseItem;
    NConfigProvider: typeof import('naive-ui/es/config-provider').NConfigProvider;
    NDialogProvider: typeof import('naive-ui/es/dialog').NDialogProvider;
    NDynamicTags: typeof import('naive-ui/es/dynamic-tags').NDynamicTags;
    NImage: typeof import('./components/AppImage.vue').default;
    NInput: typeof import('naive-ui/es/input').NInput;
    NInputNumber: typeof import('naive-ui/es/input-number').NInputNumber;
    NMessageProvider: typeof import('naive-ui/es/message').NMessageProvider;
    NModal: typeof import('naive-ui/es/modal').NModal;
    NPopover: typeof import('naive-ui/es/popover').NPopover;
    NRadioButton: typeof import('naive-ui/es/radio').NRadioButton;
    NRadioGroup: typeof import('naive-ui/es/radio').NRadioGroup;
    NSelect: typeof import('./components/AppSelect.vue').default;
    NSlider: typeof import('naive-ui/es/slider').NSlider;
    NSpin: typeof import('naive-ui/es/spin').NSpin;
    NSwitch: typeof import('naive-ui/es/switch').NSwitch;
    NTree: typeof import('naive-ui/es/tree').NTree;
  }
}
