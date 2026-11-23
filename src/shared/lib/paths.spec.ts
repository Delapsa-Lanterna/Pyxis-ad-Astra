import { describe, expect, it } from 'vitest';
import { pathBelongsToRoot, normalizeFsPath, relativePathFromRoot } from '@/shared/lib/paths';
import { mediaResourceKey } from '@/services/resource-media.service';
import { sameResourceRef } from '@/shared/lib/resource-ref';
import type { ResourceRef } from '@/shared/types';
import windowsPathCases from '@/test/fixtures/windows-path-cases.json';

describe('Windows path ownership', () => {
  it.each(windowsPathCases)('preserves Windows identity for $first and $second', ({ first: left, second: right, same }) => {
    expect(normalizeFsPath(left) === normalizeFsPath(right)).toBe(same);
    const resource: ResourceRef = { source: 'mod', ownerKind: 'ship', ownerId: 'sample', key: 'sprite', relPath: left };
    expect(sameResourceRef(resource, { ...resource, relPath: right })).toBe(same);
    expect(
      mediaResourceKey('session', { source: 'mod', relPath: left }) === mediaResourceKey('session', { source: 'mod', relPath: right }),
    ).toBe(same);
  });
  it('normalizes UNC, extended UNC, duplicate separators and trailing separators', () => {
    expect(normalizeFsPath('\\\\?\\UNC\\Server\\Share\\Mod\\')).toBe('//server/share/mod');
    expect(normalizeFsPath('\\\\Server\\Share\\Mod')).toBe('//server/share/mod');
    expect(normalizeFsPath('D:/Mod//nested/')).toBe('d:/mod/nested');
    expect(normalizeFsPath('/tmp/mod/')).toBe('/tmp/mod');
  });
  it.each([
    ['//?/UNC/Server/Share/Mod', '//?/UNC/server/share/mod/Data/Sample.java'],
    ['//Server/Share/Mod/', '//?/UNC/server//share/mod/Data/Sample.java'],
    ['D:/Mod', '//?/D:/mod/Data/Sample.java'],
  ])('preserves relative spelling under %s', (root, file) => {
    expect(relativePathFromRoot(root, file)).toBe('Data/Sample.java');
    expect(relativePathFromRoot(root, root)).toBe('');
  });
  it('treats extended and drive paths as the same root', () => {
    expect(pathBelongsToRoot('D:\\game\\mods\\demo\\data.csv', '\\\\?\\D:\\game\\mods\\demo')).toBe(true);
    expect(pathBelongsToRoot('\\\\?\\D:\\game\\mods\\demo\\data.csv', 'D:\\game\\mods\\demo')).toBe(true);
  });

  it('rejects paths outside the extended root', () => {
    expect(pathBelongsToRoot('D:\\game\\mods\\other\\data.csv', '\\\\?\\D:\\game\\mods\\demo')).toBe(false);
  });
});
