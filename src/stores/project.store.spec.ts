import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useProjectStore } from './project.store';
import { sessionUpdateFixture } from '@/test/fixtures/write-result';
import { TABLE_KEYS, type ProjectManifest } from '@/shared/types';

function manifest(sessionId: string, modRoot = 'M:/alpha'): ProjectManifest {
  const update = sessionUpdateFixture(sessionId, modRoot);
  return update.projection.manifest;
}

beforeEach(() => setActivePinia(createPinia()));

describe('project manifest ownership', () => {
  it('keeps manifests and write targets for every loaded root', () => {
    const project = useProjectStore();
    project.registerProjectManifest(manifest('alpha'));
    project.registerProjectManifest(manifest('beta', 'M:/beta'));
    expect(project.getSessionId('M:/alpha')).toBe('alpha');
    expect(project.getSessionId('M:/beta')).toBe('beta');
    expect(project.getManifest('M:/missing')).toBeNull();
    expect(project.tableWriteTargets).toHaveLength(TABLE_KEYS.length * 2);
    expect(project.tableWriteTargets).toContainEqual({ sessionId: 'beta', modRoot: 'M:/beta', table: 'ships', path: 'M:/beta\\ships.csv' });
    project.removeProjectManifest('M:/alpha');
    expect(project.getSessionId('M:/alpha')).toBeNull();
    expect(project.tableWriteTargets.every((target) => target.sessionId === 'beta')).toBe(true);
  });

  it('accepts queued content only for the registered session', () => {
    const project = useProjectStore();
    project.registerProjectManifest(manifest('old'));
    project.replaceProjectManifest({ ...manifest('old'), modInfo: { name: 'latest' } });
    project.replaceProjectManifest({ ...manifest('old'), modInfo: { name: 'late' } });
    project.replaceProjectManifest(manifest('other'));
    expect(project.getManifest('M:/alpha')?.modInfo?.name).toBe('late');
    project.registerProjectManifest(manifest('new'));
    project.replaceProjectManifest(manifest('old'));
    project.replaceProjectManifest({ ...manifest('new'), modInfo: { name: 'new' } });
    expect(project.getManifest('M:/alpha')).toMatchObject({ sessionId: 'new', modInfo: { name: 'new' } });
    project.removeProjectManifest('M:/alpha');
    project.replaceProjectManifest(manifest('new'));
    expect(project.getManifest('M:/alpha')).toBeNull();
  });

  it('isolates manifest registries between windows', () => {
    const first = useProjectStore();
    first.registerProjectManifest(manifest('first'));
    setActivePinia(createPinia());
    const second = useProjectStore();
    expect(second.getManifest('M:/alpha')).toBeNull();
    second.registerProjectManifest(manifest('second'));
    expect(first.getSessionId('M:/alpha')).toBe('first');
    expect(second.getSessionId('M:/alpha')).toBe('second');
  });
});
