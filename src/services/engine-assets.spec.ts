import { describe, expect, it, vi } from 'vitest';
import { queryEngineRenderAssets, hasEngineAssetsInvalidation } from './engine-assets.service';
import { invalidateQueryCacheByProject, invalidateQueryCacheForSession } from './query-cache.service';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import type { EngineRenderAssets, ProjectInvalidation } from '@/shared/types';
vi.mock('@/shared/runtime/command.runtime', () => ({ invokeCommand: vi.fn(), invokeSaveCommand: vi.fn() }));
const result: EngineRenderAssets = { styles: {}, versions: [], resources: {} as EngineRenderAssets['resources'] };
const changed: ProjectInvalidation = {
  session: false,
  paths: [],
  tables: [],
  entities: [],
  queryScopes: [],
  resources: [{ source: 'mod', relPath: 'data/config/engine_styles.json' }],
};
describe('engine resource queries', () => {
  it('keeps inline texture declarations in the formal query identity', async () => {
    vi.mocked(invokeCommand).mockResolvedValue(result);
    const styles = [{ glowSprite: 'graphics/slot.png' }];
    await Promise.all([queryEngineRenderAssets('inline', styles), queryEngineRenderAssets('inline', [])]);
    expect(invokeCommand).toHaveBeenCalledWith('query_engine_render_assets', { sessionId: 'inline', inlineStyles: styles });
    expect(invokeCommand).toHaveBeenCalledWith('query_engine_render_assets', { sessionId: 'inline', inlineStyles: [] });
  });
  it('shares transport while a released consumer ends its own wait', async () => {
    let finish!: (value: EngineRenderAssets) => void;
    vi.mocked(invokeCommand).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const controller = new AbortController(),
      first = queryEngineRenderAssets('shared', [], controller.signal),
      second = queryEngineRenderAssets('shared', []);
    const ended = expect(first).rejects.toMatchObject({ code: 'query.invalidated' });
    controller.abort();
    await ended;
    finish(result);
    await expect(second).resolves.toEqual(result);
    expect(invokeCommand).toHaveBeenCalledTimes(1);
    expect(invokeCommand).toHaveBeenCalledWith('query_engine_render_assets', { sessionId: 'shared', inlineStyles: [] });
  });
  it('invalidates a late request and lets the replacement read independently', async () => {
    let finish!: (value: EngineRenderAssets) => void;
    vi.mocked(invokeCommand)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      )
      .mockResolvedValue(result);
    const first = queryEngineRenderAssets('late', []),
      ended = expect(first).rejects.toMatchObject({ code: 'query.invalidated' });
    invalidateQueryCacheByProject('late', changed);
    await ended;
    await expect(queryEngineRenderAssets('late', [])).resolves.toEqual(result);
    finish(result);
    invalidateQueryCacheForSession('late');
  });
  it('recognizes parent refreshes and retries read failures', async () => {
    expect(
      hasEngineAssetsInvalidation({
        ...changed,
        resources: [{ source: 'core', relPath: 'data/config' }],
      }),
    ).toBe(true);
    vi.mocked(invokeCommand).mockRejectedValueOnce(new Error('read')).mockResolvedValue(result);
    await expect(queryEngineRenderAssets('retry', [])).rejects.toThrow('read');
    await expect(queryEngineRenderAssets('retry', [])).resolves.toEqual(result);
  });
});
