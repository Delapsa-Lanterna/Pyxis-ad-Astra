import { describe, expect, it, vi } from 'vitest';
import { queryFileDirectory, queryFileSearch, queryFileTextTarget } from './file-browser.service';
const invoke = vi.hoisted(() => vi.fn(async () => null));
vi.mock('@/shared/runtime/command.runtime', () => ({ invokeCommand: invoke, invokeSaveCommand: invoke }));
describe('file browser transport', () => {
  it('uses structured session-scoped directory and file inputs', async () => {
    await queryFileDirectory('s', null);
    expect(invoke).toHaveBeenLastCalledWith('query_file_directory', { payload: { sessionId: 's', directory: null } });
    await queryFileDirectory('s', 'data/hulls');
    expect(invoke).toHaveBeenLastCalledWith('query_file_directory', { payload: { sessionId: 's', directory: 'data/hulls' } });
    await queryFileSearch('s', '中文');
    expect(invoke).toHaveBeenLastCalledWith('query_file_search', { payload: { sessionId: 's', query: '中文' } });
    await queryFileTextTarget('s', 'README');
    expect(invoke).toHaveBeenLastCalledWith('query_file_text_target', { payload: { sessionId: 's', relPath: 'README' } });
  });
});
