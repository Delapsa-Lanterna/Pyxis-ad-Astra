import type { SpecEditorKind } from './spec-editor.types';
import type { JointEditKind } from './joint-edit.types';
import type { WeaponFirePreviewSource } from './weapon-fire-preview.types';
export type WindowIdentity =
  | { type: 'immersive'; sessionId: string; kind: JointEditKind; modRoot: string; id: string }
  | { type: 'spec'; sessionId: string; kind: SpecEditorKind; modRoot: string; id: string }
  | { type: 'weapon-fire-preview'; sessionId: string; modRoot: string; id: string }
  | { type: 'file'; sessionId: string; modRoot: string; path: string }
  | { type: 'recovery'; modRoot: string | null; path: string };
export interface FileWindowLocation {
  contextLabel: string | null;
  contextSeverity: 'error' | 'warning' | 'info' | null;
  message: string | null;
  line: number | null;
  column: number | null;
}
export type ManagedWindowInput =
  | { kind: 'editor'; starsectorRoot: string | null }
  | { kind: 'file-editor'; location: FileWindowLocation }
  | { kind: 'immersive-editor'; rowKey: string | null }
  | { kind: 'weapon-fire-preview'; source: WeaponFirePreviewSource };
export interface NativeWindowRequest {
  identity: WindowIdentity;
  title: string;
  input: ManagedWindowInput;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
}
interface WindowContextMeta {
  label: string;
  revision: number;
  requestId: number;
  receiverGeneration: number;
  title: string;
}
export type ManagedWindowContext = WindowContextMeta &
  (
    | { kind: 'editor'; identity: Extract<WindowIdentity, { type: 'spec' }>; input: Extract<ManagedWindowInput, { kind: 'editor' }> }
    | {
        kind: 'file-editor';
        identity: Extract<WindowIdentity, { type: 'file' | 'recovery' }>;
        input: Extract<ManagedWindowInput, { kind: 'file-editor' }>;
      }
    | {
        kind: 'immersive-editor';
        identity: Extract<WindowIdentity, { type: 'immersive' }>;
        input: Extract<ManagedWindowInput, { kind: 'immersive-editor' }>;
      }
    | {
        kind: 'weapon-fire-preview';
        identity: Extract<WindowIdentity, { type: 'weapon-fire-preview' }>;
        input: Extract<ManagedWindowInput, { kind: 'weapon-fire-preview' }>;
      }
  );
export type WindowContextFor<K extends ManagedWindowContext['kind']> = Extract<ManagedWindowContext, { kind: K }>;
export type WindowBootstrap = { kind: 'main' } | { kind: 'managed'; context: ManagedWindowContext; restoring: boolean; modName: string };
export interface WindowRequestReceipt {
  label: string;
  requestId: number;
  status: 'accepted' | 'superseded' | 'cancelled';
}
export type WindowRequestResult = WindowRequestReceipt;
export interface ManagedWindowStatus {
  dirty: boolean;
  saving: boolean;
}
export type CloseScope = { kind: 'window' } | { kind: 'sessions'; sessionIds: string[] } | { kind: 'application' };
export type ClosePhase = 'hold' | 'settle' | 'prepare' | 'confirm' | 'flush' | 'resume';
export interface WindowCloseIntent {
  onlyIfClean: boolean;
  operationId: number;
  phase: ClosePhase;
  scope: CloseScope;
  releasedSessions: string[];
}
export interface CloseResult {
  status: 'closed' | 'cancelled' | 'failed';
  destroyedWindows: string[];
  releasedSessions: string[];
  diagnostic: import('./error.types').ErrorDiagnostic | null;
}
