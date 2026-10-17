import { useWindowCloseState } from '@/app/composables/use-window-close-state';
import { useShortcutDispatch } from '@/app/composables/use-shortcut-dispatch';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { readClipboardText, writeClipboardText } from '@/shared/runtime/clipboard.runtime';
import { computed, getCurrentInstance, inject, onMounted, onScopeDispose, provide, ref, shallowRef, watch, type InjectionKey } from 'vue';
type WindowMenuAction = '设置' | '关于' | '最小化' | '退出';
type MenuAction = { label: string; key: string; disabled: boolean; props?: { class: string } };
type MenuOption = MenuAction | { type: 'divider'; key: string };
const divider = { type: 'divider' as const, key: 'separator' };
const action = (label: string, disabled = false): MenuAction => ({
  label,
  key: label,
  disabled,
  props: label === '清空' || label === '退出' ? { class: 'context-menu-danger' } : undefined,
});
export interface ContextMenuScope {
  identity: () => string;
  refresh?: (current: () => boolean) => unknown;
  canRefresh?: () => boolean;
  windowActions?: Record<WindowMenuAction, () => unknown>;
}
type Scope = ContextMenuScope & { root: () => Node | null; revision: number };
const menuKey: InjectionKey<ReturnType<typeof provideContextMenu>> = Symbol('context-menu');
export function provideContextMenu() {
  const closing = useWindowCloseState();
  const scopes = new Set<Scope>();
  let active = true;
  onScopeDispose(() => {
    active = false;
  });
  const menu = shallowRef<{
    x: number;
    y: number;
    target: HTMLElement;
    scope?: Scope;
    identity?: string;
    selection: string;
    start: number;
    end: number;
    value: string;
    refreshes: Scope[];
    identities: string[];
  } | null>(null);
  const close = () => {
    menu.value = null;
  };
  function register(scope: Scope) {
    scopes.add(scope);
    const stop = watch(
      scope.identity,
      () => {
        scope.revision++;
        close();
      },
      { flush: 'sync' },
    );
    return () => {
      stop();
      scopes.delete(scope);
      close();
    };
  }
  function open(event: MouseEvent) {
    if (closing?.value) return;
    if (event.defaultPrevented) return;
    event.preventDefault();
    const target = event.target as HTMLElement;
    const matches = [...scopes].filter((scope) => scope.root()?.contains(target));
    const scope =
      matches.find(
        (candidate) =>
          !matches.some((other) => other !== candidate && candidate.root() !== other.root() && candidate.root()?.contains(other.root())),
      ) ?? [...scopes].filter((candidate) => !candidate.windowActions).at(-1);
    const refreshes = (matches.length ? matches : scope ? [scope] : []).filter(
      (candidate) => candidate.refresh && candidate.canRefresh?.() !== false,
    );
    const input = target.closest(
      'textarea, input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([type=range]):not([type=color])',
    ) as HTMLInputElement | HTMLTextAreaElement | null;
    const start = input?.selectionStart ?? 0,
      end = input?.selectionEnd ?? 0;
    menu.value = {
      x: event.clientX,
      y: event.clientY,
      target: input ?? target,
      scope,
      identity: scope ? scope.revision + ':' + scope.identity() : undefined,
      refreshes,
      identities: refreshes.map((candidate) => candidate.revision + ':' + candidate.identity()),
      start,
      end,
      value: input?.value ?? '',
      selection: input ? input.value.slice(start, end) : (window.getSelection()?.toString() ?? ''),
    };
  }
  const runtime = {
    menu,
    close,
    register,
    open,
    current: (captured: NonNullable<typeof menu.value>) =>
      active &&
      (!captured.scope ||
        (scopes.has(captured.scope) && captured.identity === captured.scope.revision + ':' + captured.scope.identity())) &&
      captured.refreshes.every(
        (scope, index) => scopes.has(scope) && scope.revision + ':' + scope.identity() === captured.identities[index],
      ),
  };
  provide(menuKey, runtime);
  return runtime;
}
export function useContextMenuScope(scope: ContextMenuScope) {
  const instance = getCurrentInstance();
  const runtime = inject(menuKey, null);
  if (runtime)
    onScopeDispose(
      runtime.register({ ...scope, revision: 0, root: () => (instance?.proxy?.$el instanceof Node ? instance.proxy.$el : null) }),
    );
}

export function useWindowContextMenu() {
  const { menu, close, open, current } = provideContextMenu();
  const feedback = useAppFeedback(),
    commands = useSaveCommandStore();
  const closing = useWindowCloseState();
  watch(() => closing?.value, close, { flush: 'sync' });
  const selected = ref(-1);
  const enabled = computed(() => options.value.filter((option): option is MenuAction => !('type' in option) && !option.disabled));
  const activeKey = computed(() => enabled.value[selected.value]?.key);
  watch(menu, () => {
    selected.value = -1;
  });
  const options = computed<MenuOption[]>(() => {
    const captured = menu.value!;
    if (captured.scope?.windowActions) return [action('设置'), action('关于'), divider, action('最小化'), action('退出')];
    const input = captured.target instanceof HTMLInputElement || captured.target instanceof HTMLTextAreaElement;
    const readonly =
      input &&
      ((captured.target as HTMLInputElement).readOnly ||
        (captured.target as HTMLInputElement).disabled ||
        captured.target.closest('[inert]'));
    if (input)
      return readonly
        ? [action('复制', !captured.selection), action('全选')]
        : [
            action('复制', !captured.selection),
            action('粘贴'),
            action('剪切', !captured.selection),
            divider,
            action('清空'),
            action('全选'),
          ];
    return [...(captured.selection ? [action('复制'), divider] : []), action('刷新', !captured.refreshes.length)];
  });
  function preventBlur(event: MouseEvent) {
    event.preventDefault();
  }
  async function select(key: string) {
    if (closing?.value) return;
    const captured = menu.value!;
    close();
    try {
      if (!current(captured)) return;
      if (captured.scope?.windowActions) await captured.scope.windowActions[key as WindowMenuAction]();
      else if (key === '刷新') {
        if ((await commands.waitForSaves()) === false || !current(captured)) return;
        for (const scope of captured.refreshes) {
          if (!current(captured)) return;
          await scope.refresh!(() => current(captured));
        }
      } else {
        const input = captured.target as HTMLInputElement | HTMLTextAreaElement;
        if (key === '复制' || key === '剪切') await writeClipboardText(captured.selection);
        if (key === '复制') return;
        const text = key === '粘贴' ? await readClipboardText() : '';
        if (
          !current(captured) ||
          !input.isConnected ||
          input.value !== captured.value ||
          input.selectionStart !== captured.start ||
          input.selectionEnd !== captured.end ||
          (key !== '全选' && (input.readOnly || input.disabled || input.closest('[inert]')))
        )
          return;
        input.focus({ preventScroll: true });
        if (key === '全选' || key === '清空') input.select();
        else input.setSelectionRange(captured.start, captured.end);
        // Chromium editing commands retain native undo and dispatch the existing input events.
        if (key !== '全选' && !document.execCommand(key === '粘贴' ? 'insertText' : 'delete', false, text))
          throw new Error('Text editing command failed');
      }
    } catch (error) {
      feedback.error(error, '右键操作失败');
    }
  }
  function handleKey(event: KeyboardEvent) {
    if (!menu.value) return false;
    const available = enabled.value;
    if (!['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(event.key)) return false;
    if (event.key === 'Escape') close();
    else if (event.key === 'Enter') {
      if (activeKey.value !== undefined) void select(activeKey.value);
    } else if (available.length)
      selected.value =
        selected.value === -1
          ? event.key === 'ArrowUp'
            ? available.length - 1
            : 0
          : (selected.value + (event.key === 'ArrowUp' ? -1 : 1) + available.length) % available.length;
    return true;
  }
  useShortcutDispatch({ priority: handleKey });
  onMounted(() => {
    document.addEventListener('contextmenu', open);
    document.addEventListener('input', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('scroll', close, true);
  });
  onScopeDispose(() => {
    close();
    document.removeEventListener('contextmenu', open);
    document.removeEventListener('input', close, true);
    window.removeEventListener('blur', close);
    window.removeEventListener('scroll', close, true);
  });
  return { menu, options, close, select, activeKey, preventBlur };
}
