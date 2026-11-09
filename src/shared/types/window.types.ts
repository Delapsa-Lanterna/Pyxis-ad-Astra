import type { SpecEditorKind } from './spec-editor.types';
import type { JointEditKind } from './joint-edit.types';
import type { WeaponFirePreviewSource } from './weapon-fire-preview.types';
import type { ErrorDiagnostic } from './error.types';

export type WindowIdentity =
  | { type: 'code-editor'; sessionId: string; modRoot: string }
  | { type: 'immersive'; sessionId: string; kind: JointEditKind; modRoot: string; id: string }
  | { type: 'spec'; sessionId: string; kind: SpecEditorKind; modRoot: string; id: string }
  | { type: 'weapon-fire-preview'; sessionId: string; modRoot: string; id: string }
  | { type: 'text-editor'; sessionId: string; modRoot: string; path: string }
  | { type: 'recovery'; modRoot: string | null; path: string };
export interface TextWindowLocation {
  contextLabel: string | null;
  contextSeverity: 'error' | 'warning' | 'info' | null;
  message: string | null;
  line: number | null;
  column: number | null;
}
export type ManagedWindowInput =
  | { kind: 'code-editor' }
  | { kind: 'editor'; starsectorRoot: string | null }
  | { kind: 'text-editor'; location: TextWindowLocation }
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
    | {
        kind: 'code-editor';
        identity: Extract<WindowIdentity, { type: 'code-editor' }>;
        input: Extract<ManagedWindowInput, { kind: 'code-editor' }>;
      }
    | { kind: 'editor'; identity: Extract<WindowIdentity, { type: 'spec' }>; input: Extract<ManagedWindowInput, { kind: 'editor' }> }
    | {
        kind: 'text-editor';
        identity: Extract<WindowIdentity, { type: 'text-editor' | 'recovery' }>;
        input: Extract<ManagedWindowInput, { kind: 'text-editor' }>;
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
export type WindowsPathCaseMap = ReadonlyArray<readonly [number, number]>;
export type WindowBootstrap = { windowsPathCaseMap: WindowsPathCaseMap } & (
  { kind: 'main' } | { kind: 'managed'; context: ManagedWindowContext; restoring: boolean; modName: string }
);
export interface WindowRequestReceipt {
  label: string;
  requestId: number;
  status: 'accepted' | 'superseded' | 'cancelled';
}
export interface ManagedWindowStatus {
  dirty: boolean;
  saving: boolean;
}
export interface ModSaveTarget {
  sessionId: string;
  modRoot: string;
}
export interface WindowSaveParticipant {
  id: number;
  targetKey: string | null;
  label: string;
  paths: string[];
}
export interface WindowSaveItem {
  label: string;
  paths: string[];
  status: 'saved' | 'noop' | 'cancelled' | 'failed';
  diagnostic: ErrorDiagnostic | null;
}
export interface WindowSaveRequest {
  target: ModSaveTarget;
  action: { kind: 'batch' | 'list' } | { kind: 'save'; participant: WindowSaveParticipant };
}
export interface WindowSaveMessage {
  requestId: number;
  receiverGeneration: number;
  request: WindowSaveRequest;
}
export type WindowSaveReply =
  { kind: 'participants'; participants: WindowSaveParticipant[] } | { kind: 'results'; items: WindowSaveItem[] };
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
  diagnostic: ErrorDiagnostic | null;
}
