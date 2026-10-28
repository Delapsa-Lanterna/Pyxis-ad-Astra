import { AppError } from '@/shared/lib/errors';

const pendingSessions = new Set<string>();

export function markProjectionPending(sessionId: string) {
  pendingSessions.add(sessionId);
}
export function markProjectionReady(sessionId: string) {
  pendingSessions.delete(sessionId);
}
export function requireProjectionReady(sessionId: string) {
  if (pendingSessions.has(sessionId))
    throw new AppError('Session projection pending', { action: 'query-session', code: 'session.projection_pending' });
}
