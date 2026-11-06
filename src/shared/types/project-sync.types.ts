import type { CommittedWriteEvent } from './write-commit.types';
import type { InvalidatedResourceScope } from './project-session.types';
import type { ReferenceSources, ResourceSource } from './project-identity.types';
import type { ErrorDiagnostic } from './error.types';

export type SourceSyncState = 'watching' | 'scanning' | 'failed' | 'released';

export type ProjectSyncDelivery =
  | { kind: 'coreChanged'; root: string; sources: InvalidatedResourceScope[] }
  | {
      kind: 'sourceStatus';
      root: string;
      source: ResourceSource;
      state: SourceSyncState;
      diagnostic: ErrorDiagnostic | null;
    }
  | { kind: 'references'; snapshot: ReferenceSources; event: CommittedWriteEvent | null }
  | { kind: 'missing'; requestId: string; paths: string[] }
  | { kind: 'saved'; requestId: string; event: CommittedWriteEvent }
  | { kind: 'blocked'; requestId: string; modRoot: string; sessionId: string | null; diagnostic: ErrorDiagnostic }
  | { kind: 'waiting'; modRoot: string; waiting: boolean };
