import { normalizeFsPath } from '@/shared/lib/paths';
import type { EntityTargetSnapshot, FileVersion } from '@/shared/types';

export function captureIdentityVersions(baseline: FileVersion[], destination: FileVersion): FileVersion[] {
  return baseline.some((version) => normalizeFsPath(version.path) === normalizeFsPath(destination.path))
    ? baseline
    : [...baseline, destination];
}

export function handoffTableVersions(baseline: FileVersion[], snapshot: EntityTargetSnapshot): FileVersion[] {
  const linked = snapshot.baseVersions.filter((version) => normalizeFsPath(version.path) !== normalizeFsPath(snapshot.target.write.path));
  return [...baseline.filter((version) => !linked.some((next) => normalizeFsPath(next.path) === normalizeFsPath(version.path))), ...linked];
}
