import { computed, inject, onScopeDispose, provide, shallowReactive, watch, type InjectionKey } from 'vue';
import type { FontId, TextRun } from '@/domain/fonts/font.types';
import { layoutText } from '@/domain/fonts/text-layout';
import { decodeOriginalFont, type LoadedFont } from '@/app/fonts/font-provider';
import { fontDefaultStyles } from '@/domain/fonts/font-styles';
import { queryOriginalFont } from '@/services/font.service';
import { useSettingsStore } from '@/stores/settings.store';
import { useQueryReadOwner } from './use-query-read-owner';
import { recordLogBestEffort } from '@/services/app-log.service';
import { errorDiagnosticOf } from '@/shared/lib/errors';

export interface OriginalFontState {
  status: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable';
  font: LoadedFont | null;
}

export interface OriginalFonts {
  state(id: FontId): OriginalFontState;
  retain(id: FontId): () => void;
}

const originalFontsKey: InjectionKey<OriginalFonts> = Symbol('original-fonts');

export function provideOriginalFonts(sessionId: () => string) {
  const settings = useSettingsStore();
  const reads = useQueryReadOwner();
  const states = shallowReactive(new Map<FontId, OriginalFontState>());
  const consumers = new Map<FontId, { count: number }>();
  let generation = 0;
  function state(id: FontId): OriginalFontState {
    return states.get(id) ?? { status: 'idle', font: null };
  }
  function load(id: FontId) {
    if (!settings.immersiveGameFont || state(id).status !== 'idle') return;
    const identity = {
      sessionId: sessionId(),
      starsectorRoot: settings.starsectorRoot,
      fontDirectory: settings.immersiveFontDirectory,
      fontId: id,
      generation,
    };
    states.set(id, { status: 'loading', font: null });
    void reads.consume(
      id,
      identity,
      async (signal) => {
        const errors: Array<{ error: unknown; directory: string | null }> = [];
        const directories = identity.fontDirectory ? [identity.fontDirectory, null] : [null];
        for (const directory of directories) {
          if (signal.aborted) break;
          try {
            const result = await queryOriginalFont(identity.sessionId, identity.starsectorRoot, id, directory);
            if (result.status === 'available' && !signal.aborted) {
              const font = await decodeOriginalFont(result);
              return { font, errors };
            }
          } catch (error) {
            errors.push({ error, directory });
          }
        }
        return { font: null, errors };
      },
      {
        ready: ({ font, errors }) => {
          states.set(id, { status: font ? 'ready' : errors.length ? 'error' : 'unavailable', font });
          for (const { error, directory } of errors) {
            const diagnostic = errorDiagnosticOf(error);
            recordLogBestEffort({
              level: 'warning',
              code: diagnostic.code,
              message: diagnostic.message,
              path: diagnostic.location?.path ?? null,
              line: diagnostic.location?.line ?? null,
              fields: { fontId: id, sessionId: identity.sessionId, root: directory ?? identity.starsectorRoot ?? 'session' },
            });
          }
        },
      },
    );
  }
  function retain(id: FontId) {
    const entry = consumers.get(id) ?? { count: 0 };
    entry.count++;
    consumers.set(id, entry);
    load(id);
    return () => {
      entry.count--;
      if (!entry.count) consumers.delete(id);
    };
  }
  watch(
    () => [settings.immersiveGameFont, settings.immersiveFontDirectory, settings.starsectorRoot, sessionId()] as const,
    () => {
      generation++;
      reads.revoke();
      states.clear();
      for (const id of consumers.keys()) load(id);
    },
    { flush: 'sync' },
  );
  onScopeDispose(() => {
    generation++;
    reads.revoke();
    states.clear();
    consumers.clear();
  });
  const runtime = { state, retain };
  provide(originalFontsKey, runtime);
  return runtime;
}

export function useOriginalFont(id: () => FontId) {
  const runtime = inject(originalFontsKey, null);
  let release = () => {};
  watch(
    id,
    (next) => {
      release();
      release = runtime?.retain(next) ?? (() => {});
    },
    { immediate: true, flush: 'sync' },
  );
  onScopeDispose(() => release());
  return computed(() => runtime?.state(id()).font ?? null);
}

export function useFontMeasurement(id: FontId) {
  const settings = useSettingsStore();
  const font = useOriginalFont(() => id);
  const style = fontDefaultStyles[id];
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  return (runs: readonly TextRun[]): number => {
    if (font.value) return layoutText(font.value.definition, runs).width;
    context.font = `${style.weight} ${style.size}px ${settings.fontFamily}`;
    return Math.max(
      ...runs
        .map((run) => run.text)
        .join('')
        .split(/\r\n|\r|\n/)
        .map((line) => context.measureText(line).width),
    );
  };
}
