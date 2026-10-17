import { onMounted, onUnmounted } from 'vue';
import { useWindowCloseState } from './use-window-close-state';
import { isEditableKeyTarget, shortcutCommandFromKeyEvent, type ShortcutCommand } from '@/domain/workspace/main-window-commands';

export interface ShortcutDispatchHandlers {
  priority?: (event: KeyboardEvent) => boolean;
  commands?: Partial<Record<ShortcutCommand, () => void>>;
  // Plain keys (no Ctrl/Alt/Meta): never fire inside inputs, textareas, selects or
  // contenteditable targets; a hit always prevents the default behavior.
  keys?: Record<string, (event: KeyboardEvent) => void>;
  undoRedoInEditable?: boolean;
  keyScope?: (event: KeyboardEvent) => boolean;
}

// Sole shortcut dispatch entry of the app: command parsing lives in the domain
// (shortcutCommandFromKeyEvent); this composable only owns the window listener,
// command routing and plain-key table dispatch.
export function useShortcutDispatch(handlers: ShortcutDispatchHandlers) {
  const closing = useWindowCloseState();
  function onKeyDown(event: KeyboardEvent) {
    if (closing?.value) return;
    if (event.defaultPrevented) return;
    if (handlers.priority?.(event)) {
      event.preventDefault();
      return;
    }
    const command = shortcutCommandFromKeyEvent(event, { undoRedoInEditable: handlers.undoRedoInEditable });
    if (command) {
      const commandHandler = handlers.commands?.[command];
      if (commandHandler) {
        event.preventDefault();
        commandHandler();
      }
      return;
    }
    if (!handlers.keys || event.ctrlKey || event.altKey || event.metaKey) return;
    if (handlers.keyScope && !handlers.keyScope(event)) return;
    if (isEditableKeyTarget(event.target)) return;
    const keyHandler = handlers.keys[event.key.toLowerCase()];
    if (keyHandler) {
      event.preventDefault();
      keyHandler(event);
    }
  }

  onMounted(() => window.addEventListener('keydown', onKeyDown, Boolean(handlers.priority)));
  onUnmounted(() => window.removeEventListener('keydown', onKeyDown, Boolean(handlers.priority)));
}
