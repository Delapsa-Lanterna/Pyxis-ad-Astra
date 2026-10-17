import { normalizeFsPath } from '@/shared/lib/paths';
import type { EntityEditInfo, FileVersion } from '@/shared/types';

export function captureIdentityVersions(baseline: FileVersion[], destination: FileVersion): FileVersion[] {
  return baseline.some((version) => normalizeFsPath(version.path) === normalizeFsPath(destination.path))
    ? baseline
    : [...baseline, destination];
}

export function handoffTableVersions(baseline: FileVersion[], info: EntityEditInfo): FileVersion[] {
  const linked = info.baseVersions.filter((version) => normalizeFsPath(version.path) !== normalizeFsPath(info.target.write.path));
  return [...baseline.filter((version) => !linked.some((next) => normalizeFsPath(next.path) === normalizeFsPath(version.path))), ...linked];
}
