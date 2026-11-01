import type { OpenProjectSessionPayload, ProjectManifest } from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';

export function openProject(modRoot: string, starsectorRoot: string | null): Promise<ProjectManifest> {
  return invokeCommand('open_project_session', { payload: { modRoot, starsectorRoot } satisfies OpenProjectSessionPayload });
}
