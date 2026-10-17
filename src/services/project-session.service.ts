import type { OpenProjectSessionPayload, CloseProjectSessionPayload, ProjectManifest } from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import { measurePerformanceAsync } from '@/shared/runtime/performance';

export function openProject(modRoot: string, starsectorRoot: string | null): Promise<ProjectManifest> {
  const fields = { modRoot, hasStarsectorRoot: Boolean(starsectorRoot) };
  return measurePerformanceAsync('frontend.openProjectSession', fields, () =>
    measurePerformanceAsync('frontend.openProjectSession.invoke', fields, () =>
      invokeCommand('open_project_session', { payload: { modRoot, starsectorRoot } satisfies OpenProjectSessionPayload }),
    ),
  );
}

export function closeProject(sessionId: string): Promise<void> {
  return invokeCommand('close_project_session', { payload: { sessionId } satisfies CloseProjectSessionPayload });
}
