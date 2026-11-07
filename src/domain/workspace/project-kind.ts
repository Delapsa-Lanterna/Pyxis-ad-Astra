import type { ProjectManifest } from '@/shared/types';
import { gameCoreDirectoryPath, normalizeFsPath } from '@/shared/lib/paths';

export function isCoreProjectManifest(manifest: ProjectManifest | null | undefined): boolean {
  return Boolean(
    manifest?.starsectorRoot && normalizeFsPath(manifest.modRoot) === normalizeFsPath(gameCoreDirectoryPath(manifest.starsectorRoot)),
  );
}
