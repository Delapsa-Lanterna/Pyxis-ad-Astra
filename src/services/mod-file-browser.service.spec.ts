import { describe, expect, it, vi } from 'vitest';
import { queryModDirectory, queryModFileSearch, queryModTextFileTarget } from './mod-file-browser.service';
const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock('@/shared/runtime/command.runtime', () => ({ invokeCommand: invoke }));
describe('mod file browser transport', () => {
  it('uses structured session-scoped directory and file inputs', async () => {
    await queryModDirectory('s', null);
    expect(invoke).toHaveBeenLastCalledWith('query_mod_directory', { payload: { sessionId: 's', directory: null } });
    await queryModDirectory('s', 'data/hulls');
    expect(invoke).toHaveBeenLastCalledWith('query_mod_directory', { payload: { sessionId: 's', directory: 'data/hulls' } });
    await queryModFileSearch('s', '中文');
    expect(invoke).toHaveBeenLastCalledWith('query_mod_file_search', { payload: { sessionId: 's', query: '中文' } });
    await queryModTextFileTarget('s', 'README');
    expect(invoke).toHaveBeenLastCalledWith('query_mod_text_file_target', { payload: { sessionId: 's', relPath: 'README' } });
  });
});
