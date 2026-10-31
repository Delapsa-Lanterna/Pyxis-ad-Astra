import { computed, inject, nextTick, onMounted, onScopeDispose, reactive, type InjectionKey } from 'vue';
export function createModNavigationPanel() {
  const state = reactive({ narrow: window.innerWidth < 850, wideExpanded: true, narrowExpanded: false });
  const expanded = computed(() => (state.narrow ? state.narrowExpanded : state.wideExpanded));
  const resize = () => {
    state.narrow = window.innerWidth < 850;
  };
  onMounted(() => window.addEventListener('resize', resize));
  onScopeDispose(() => window.removeEventListener('resize', resize));
  function close() {
    state.narrowExpanded = false;
    document.querySelector<HTMLButtonElement>('[aria-controls="mod-navigation-content"]')?.focus();
  }
  async function toggle() {
    if (state.narrow) state.narrowExpanded = !state.narrowExpanded;
    else state.wideExpanded = !state.wideExpanded;
    if (state.narrow && state.narrowExpanded) {
      await nextTick();
      document
        .querySelector<HTMLButtonElement>(
          '#mod-navigation-content .mod-navigation-button.active, #mod-navigation-content .mod-navigation-button',
        )
        ?.focus();
    }
  }
  return { state, expanded, close, toggle };
}
export const modNavigationPanelKey: InjectionKey<ReturnType<typeof createModNavigationPanel>> = Symbol('content-navigation');
export function useModNavigationPanel() {
  return inject(modNavigationPanelKey)!;
}
