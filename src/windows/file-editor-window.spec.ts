import { describe, expect, it, vi } from 'vitest';

const openManagedWindow = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/windows/managed.window', () => ({ openManagedWindow }));

import { openGameWarningFileEditor, openModOpeningFailureFileEditor } from '@/windows/file-editor.window';
import type { GameScanWarning, ModOpeningFailure } from '@/shared/types';

describe('workspace warning file editor window', () => {
  it('opens recovery mode with the structured target and parsed position', async () => {
    const warning = editableWarning();

    await openGameWarningFileEditor(warning);

    expect(openManagedWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: { type: 'recovery', modRoot: warning.editTarget?.modRoot, path: warning.editTarget?.path },
        input: {
          kind: 'file-editor',
          location: { contextLabel: '错误', contextSeverity: 'error', message: warning.message, line: 5, column: 44 },
        },
      }),
    );
  });

  it('ignores warnings without a structured edit target', () => {
    const result = openGameWarningFileEditor({
      code: 'scan.mods_missing',
      location: null,
      path: 'D:\\game',
      message: '缺少目录',
      editTarget: null,
    });

    expect(result).toBeNull();
    expect(openManagedWindow).not.toHaveBeenCalled();
  });

  it('opens a Mod opening failure in recovery mode', async () => {
    const failure: ModOpeningFailure = {
      diagnostic: { code: 'parse.csv', message: 'raw CSV detail', location: null },
      modRoot: 'D:\\game\\mods\\broken',
      message: '解析 CSV 失败',
      file: { path: 'D:\\game\\mods\\broken\\data.csv', line: 7 },
    };

    await openModOpeningFailureFileEditor(failure);

    expect(openManagedWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: { type: 'recovery', modRoot: failure.modRoot, path: failure.file?.path },
        input: {
          kind: 'file-editor',
          location: { contextLabel: '错误', contextSeverity: 'error', message: failure.message, line: 7, column: null },
        },
      }),
    );
  });
});

function editableWarning(): GameScanWarning {
  return {
    code: 'parse.json_syntax',
    location: { path: 'D:/game/mods/broken/mod_info.json', line: 5, column: 44 },
    path: 'D:\\game\\mods\\broken\\mod_info.json',
    message: '读取 mod_info.json 失败: 解析 JSON 文件失败 (D:\\game\\mods\\broken\\mod_info.json): expected comma at line 5 column 44',
    editTarget: {
      modRoot: 'D:\\game\\mods\\broken',
      path: 'D:\\game\\mods\\broken\\mod_info.json',
    },
  };
}
