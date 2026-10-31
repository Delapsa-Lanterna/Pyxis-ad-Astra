import { requestClose, replyNativeClose, readyNativeClose } from './app-lifecycle.service';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSettings, readDefaultSettings, saveSettings, querySystemFonts } from './app-settings.service';
import { createSettingsFixture } from '@/test/fixtures/settings';
import { openConfigFolder } from './app-config.service';
import { clearLog, loadLogStatus } from './app-log.service';
import { loadPersistedWorkspace, savePersistedWorkspace } from './workspace-state.service';
import { createNewModProject } from './mod-creation.service';
import { queryCoreRoot, queryCoreFields, queryCoreGraphics, invalidateCoreCacheForRoot } from './core-assets.service';
import { detectDirectoryTarget, scanDirectoryGameOverview } from './directory.service';
import { requestProjectSessionRefresh, refreshProjectSources, setReferenceSources } from './project-sync.service';
import { queryOriginalFont } from './font.service';
import { openProject, closeProject } from './project-session.service';
import {
  getNativeWindowBootstrap,
  getNativeWindowContext,
  getNativeWindowRequest,
  acceptNativeWindowRequest,
  failNativeWindowRequest,
  failNativeWindowStartup,
  requestNativeWindow,
  focusNativeManagedWindow,
  updateNativeWindowStatus,
  reserveNativeWindowTargets,
  releaseNativeWindowTargets,
  retargetNativeWindow,
} from './window.service';
import type { CreateModRequest, ManagedWindowStatus, NativeWindowRequest, PersistedWorkspace, WindowIdentity } from '@/shared/types';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const settings = createSettingsFixture();
const state: PersistedWorkspace = { starsectorRoot: null, mods: [], columnWidths: {}, gameMods: [], gameWarnings: [] };
const create: CreateModRequest = {
  destination: { kind: 'directory', parentDirectory: 'M:/' },
  template: { id: 'demo', name: 'Demo', version: '1', gameVersion: '0.98a' },
};
const identity: WindowIdentity = { type: 'file', sessionId: 's1', modRoot: 'M:/mod', path: 'M:/mod/demo.json' };
const request: NativeWindowRequest = {
  identity,
  input: { kind: 'file-editor', location: { contextLabel: null, contextSeverity: null, message: null, line: null, column: null } },
  title: 'Demo',
  width: 860,
  height: 600,
  minWidth: 500,
  minHeight: 400,
};
const status: ManagedWindowStatus = { dirty: false, saving: false };
const cases: Array<[string, () => unknown, Record<string, unknown> | undefined]> = [
  [
    'set_reference_sources',
    () => setReferenceSources(['source-b', 'source-c']),
    { sessionIds: ['source-b', 'source-c'], order: ['source-b', 'source-c'] },
  ],
  ['read_settings', readSettings, undefined],
  ['read_default_settings', readDefaultSettings, undefined],
  ['query_system_fonts', querySystemFonts, undefined],
  [
    'query_original_font',
    () => queryOriginalFont('s1', 'insignia15LTaa', 'F:/fonts'),
    { payload: { sessionId: 's1', fontId: 'insignia15LTaa', fontDirectory: 'F:/fonts' } },
  ],
  ['save_settings', () => saveSettings(settings), { payload: { settings } }],
  ['get_app_log_status', loadLogStatus, undefined],
  ['clear_app_log_file', clearLog, undefined],
  ['open_config_dir', openConfigFolder, undefined],
  ['load_workspace', loadPersistedWorkspace, undefined],
  ['save_workspace', () => savePersistedWorkspace(state), { payload: { state } }],
  ['create_mod', () => createNewModProject(create), { payload: create }],
  ['scan_core_fields', () => queryCoreFields('G:/core'), { payload: { starsectorRoot: 'G:/core' } }],
  [
    'query_core_root',
    () => queryCoreRoot({ sessionId: 's1', starsectorRoot: null }),
    { payload: { sessionId: 's1', starsectorRoot: null } },
  ],
  ['scan_core_graphics', () => queryCoreGraphics('G:/core'), { payload: { starsectorRoot: 'G:/core' } }],
  ['invalidate_core_cache', () => invalidateCoreCacheForRoot('G:/core'), { payload: { starsectorRoot: 'G:/core' } }],
  ['detect_directory', () => detectDirectoryTarget('M:/mod', null), { payload: { path: 'M:/mod', knownStarsectorRoot: null } }],
  ['scan_game_overview', () => scanDirectoryGameOverview('G:/core'), { payload: { starsectorRoot: 'G:/core' } }],
  ['open_project_session', () => openProject('M:/mod', null), { payload: { modRoot: 'M:/mod', starsectorRoot: null } }],
  ['close_project_session', () => closeProject('s1'), { payload: { sessionId: 's1' } }],
  ['invalidate_project_session', () => requestProjectSessionRefresh('s1', []), { payload: { sessionId: 's1', changes: [] } }],
  [
    'refresh_project_sources',
    () => refreshProjectSources('s1', [{ source: 'core', relPath: 'data/hulls/demo.ship' }]),
    { payload: { sessionId: 's1', sources: [{ source: 'core', relPath: 'data/hulls/demo.ship' }] } },
  ],
  ['request_close', () => requestClose({ kind: 'window' }), { scope: { kind: 'window' } }],
  ['reply_close', () => replyNativeClose(1, 'hold', true), { operationId: 1, phase: 'hold', accepted: true, diagnostic: null }],
  ['ready_close', readyNativeClose, undefined],
  ['get_window_bootstrap', getNativeWindowBootstrap, undefined],
  ['get_current_window_context', getNativeWindowContext, undefined],
  ['get_current_window_request', getNativeWindowRequest, undefined],
  ['accept_window_request', () => acceptNativeWindowRequest(9, 2), { requestId: 9, receiverGeneration: 2 }],
  [
    'fail_window_request',
    () => failNativeWindowRequest(9, 2, { code: 'window.failed', message: '失败', location: null }),
    { requestId: 9, receiverGeneration: 2, diagnostic: { code: 'window.failed', message: '失败', location: null } },
  ],
  [
    'fail_window_startup',
    () => failNativeWindowStartup({ code: 'window.failed', message: '失败', location: null }),
    { diagnostic: { code: 'window.failed', message: '失败', location: null } },
  ],
  ['request_window', () => requestNativeWindow(request), { payload: request }],
  ['focus_managed_window', () => focusNativeManagedWindow(identity), { identity }],
  ['update_managed_window_status', () => updateNativeWindowStatus(status), { payload: status }],
  ['reserve_window_targets', () => reserveNativeWindowTargets([identity]), { identities: [identity] }],
  ['release_window_targets', releaseNativeWindowTargets, undefined],
  ['retarget_managed_window', () => retargetNativeWindow(identity, 'Demo'), { identity, title: 'Demo', input: null }],
];
beforeEach(() => {
  vi.clearAllMocks();
  invoke.mockResolvedValue({ ready: true });
});
describe('application capability protocols', () => {
  it.each(cases)('%s maps the formal arguments to Tauri', async (command, action, args) => {
    await action();
    expect(invoke).toHaveBeenCalledExactlyOnceWith(
      command === 'refresh_project_sources' ? 'save_project' : command,
      command === 'refresh_project_sources'
        ? { request: { id: expect.any(String), edits: [], action: { kind: command, input: args!.payload } } }
        : args,
    );
  });
});
