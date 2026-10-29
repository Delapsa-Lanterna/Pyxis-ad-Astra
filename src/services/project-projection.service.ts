import { AppError } from '@/shared/lib/errors';
import { invalidatedRead } from '@/shared/runtime/read-request';

const pendingSessions = new Set<string>();
let referenceRevision = 0;
let referenceReadiness: Promise<void> | undefined;
export const waitForReferenceSources = () => referenceReadiness;
export function setReferenceReadiness(ready: Promise<void>) {
  referenceReadiness = ready;
  const release = () => {
    if (referenceReadiness === ready) referenceReadiness = undefined;
  };
  void ready.then(release, release);
}
export const currentReferenceRevision = () => referenceRevision;
export function acceptReferenceRevision(revision: number) {
  if (revision <= referenceRevision) return false;
  referenceRevision = revision;
  return true;
}

export function markProjectionPending(sessionId: string) {
  pendingSessions.add(sessionId);
}
export function markProjectionReady(sessionId: string) {
  pendingSessions.delete(sessionId);
}
export function requireProjectionReady(sessionId: string, revision = referenceRevision) {
  if (revision !== referenceRevision) throw invalidatedRead({ sessionId, revision }, 'project');
  if (pendingSessions.has(sessionId))
    throw new AppError('Session projection pending', { action: 'query-session', code: 'session.projection_pending' });
}
