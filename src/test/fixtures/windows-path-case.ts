import type { WindowsPathCaseMap } from '@/shared/types';

// Browser and unit fixtures cover the Windows rules used by shared path samples.
export const windowsPathCaseFixture: WindowsPathCaseMap = [
  ...Array.from({ length: 26 }, (_, index): [number, number] => [65 + index, 97 + index]),
  [0x00e4, 0x00c4],
  [0x1f80, 0x1f88],
];
