import { describe, expect, it, vi } from 'vitest';

const requestWindow = vi.hoisted(() => vi.fn(() => Promise.resolve()));

vi.mock('@/windows/managed.window', () => ({ requestWindow }));

import { openFileEditorWindow } from '@/windows/file-editor.window';
import { scanWarningNotice, modOpeningFailureNotice } from '@/domain/project/load-diagnostics';
import { extractFileReferenceFromError } from '@/shared/lib/errors';
import type { GameScanWarning, ModOpeningFailure } from '@/shared/types';

describe('workspace warning file editor window', () => {
  it('opens recovery mode with the structured target and parsed position', async () => {
    const warning = editableWarning();

    const reference = extractFileReferenceFromError(scanWarningNotice(warning).diagnostic)!;
    await openFileEditorWindow({ ...reference.target!, ...reference, contextLabel: '错误', contextSeverity: 'error' });

    expect(requestWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: { type: 'recovery', modRoot: warning.editTarget?.modRoot, path: warning.editTarget?.path },
        input: {
          kind: 'file-editor',
          location: { contextLabel: '错误', contextSeverity: 'error', message: 'JSON 语法错误', line: 5, column: 44 },
        },
      }),
    );
  });

  it('ignores warnings without a structured edit target', () => {
    const notice = scanWarningNotice({
      code: 'scan.mods_missing',
      location: null,
      path: 'D:\\game',
      message: '缺少目录',
      editTarget: null,
    });

    expect(extractFileReferenceFromError(notice.diagnostic)).toBeNull();
    expect(requestWindow).not.toHaveBeenCalled();
  });

  it('opens a Mod opening failure in recovery mode', async () => {
    const failure: ModOpeningFailure = {
      diagnostic: { code: 'parse.csv', message: 'raw CSV detail', location: null },
      modRoot: 'D:\\game\\mods\\broken',
      message: '解析 CSV 失败',
      file: { path: 'D:\\game\\mods\\broken\\data.csv', line: 7 },
    };

    const reference = extractFileReferenceFromError(modOpeningFailureNotice(failure).diagnostic)!;
    await openFileEditorWindow({ ...reference.target!, ...reference, contextLabel: '错误', contextSeverity: 'error' });

    expect(requestWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: { type: 'recovery', modRoot: failure.modRoot, path: failure.file?.path },
        input: {
          kind: 'file-editor',
          location: { contextLabel: '错误', contextSeverity: 'error', message: 'CSV 解析失败', line: 7, column: null },
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
