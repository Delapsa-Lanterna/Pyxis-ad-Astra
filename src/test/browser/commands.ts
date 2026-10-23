import type {
  JointEditQuery,
  JointEditDraft,
  JointEditPrepared,
  SaveJointEditPayload,
  SaveCsvPatchPayload,
  AppSettings,
  CsvTableIndex,
  CsvTableRowsRead,
  CsvTableIndexPayload,
  CsvTableRowsPayload,
  AppendAppLogsPayload,
  EngineRenderAssets,
  ManagedWindowContext,
  AppLogStatus,
} from '@/shared/types';
import { createSettingsFixture } from '../settings';
import { createBrowserModel, sampleImage, type BrowserModel } from './model';
import { emit } from './events';

let model: BrowserModel;
let logged = 0;
export function installBrowserModel(next: BrowserModel) {
  model = next;
  logged = 0;
}
export function browserModel() {
  return model;
}
export function browserWindowLabel() {
  return model.context?.label ?? 'main';
}

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const failure = model.failures.get(command);
  if (failure) {
    model.failures.delete(command);
    throw Error(failure);
  }
  return structuredClone(await dispatch(command, args)) as T;
}
async function dispatch(command: string, args: Record<string, unknown>): Promise<unknown> {
  switch (command) {
    case 'read_settings':
      return model.settingsSnapshot();
    case 'read_default_settings':
      return createSettingsFixture();
    case 'save_settings': {
      const snapshot = model.saveSettings((args.payload as { settings: AppSettings }).settings);
      await emit('app-settings-changed', snapshot);
      return snapshot;
    }
    case 'query_system_fonts':
      return ['Arial', 'Microsoft YaHei'];
    case 'scan_core_fields':
      return {};
    case 'scan_core_graphics':
      return ['graphics/sample.svg'];
    case 'invalidate_core_cache':
      return;
    case 'get_app_log_status':
      return {
        path: (model.settings.logDirectory ?? 'M:/tool-data') + '/sample.log',
        sizeBytes: logged * 80,
        recording: 'active',
        level: model.settings.logLevel,
        lastError: null,
        dropped: 0,
        pending: 0,
      } satisfies AppLogStatus;
    case 'append_app_logs':
      logged += (args.payload as AppendAppLogsPayload).entries.length;
      return;
    case 'stop_app_log':
      return;
    case 'clear_app_log_file':
      logged = 0;
      return dispatch('get_app_log_status', {});
    case 'open_config_dir':
      return;
    case 'performance_monitor_batch':
      model.monitor.records += (args.batch as { samples: unknown[] }).samples.length;
      return;
    case 'performance_monitor_report': {
      const action = args.action;
      if (action === 'reset') {
        model.monitor.records = 0;
        model.monitor.overwritten = 0;
        model.monitor.startedAt = Date.now();
      }
      if (action === 'export') model.monitor.path = 'M:/tool-data/performance-monitor/sample.json';
      if (action === 'traceStart') {
        model.monitor.traceState = 'recording';
        model.monitor.traceStartedAt = Date.now();
        model.monitor.traceSeconds = Number(args.traceSeconds ?? 15);
      }
      if (
        action === 'traceStop' ||
        (model.monitor.traceState === 'recording' && Date.now() >= model.monitor.traceStartedAt + model.monitor.traceSeconds * 1000)
      )
        model.monitor.traceState = 'ready';
      return model.monitor;
    }
    case 'query_csv_table_index': {
      model.readRows();
      const payload = args.payload as CsvTableIndexPayload;
      const search = payload.search?.trim().toLowerCase() ?? '';
      const keys = payload.searchField === 'id-name' ? ['id', 'name'] : [payload.searchField];
      const rows = model.rows.filter((row) =>
        keys.some((key) =>
          String(row.data[key] ?? '')
            .toLowerCase()
            .includes(search),
        ),
      );
      return {
        table: payload.table,
        header: model.header,
        totalRows: model.rows.length,
        rowKeys: rows.map((r) => r.rowKey),
        rows: rows.slice(0, payload.initialCount),
        baseVersions: [{ path: model.manifest.tableSummaries.ships.path, fingerprint: String(model.commitId) }],
      } satisfies CsvTableIndex;
    }
    case 'query_csv_table_rows': {
      model.readRows();
      const payload = args.payload as CsvTableRowsPayload;
      const byKey = new Map(model.rows.map((row) => [row.rowKey, row]));
      return {
        table: payload.table,
        rows: payload.rowKeys.map((key) => byKey.get(key)!),
        baseVersions: [{ path: model.manifest.tableSummaries.ships.path, fingerprint: String(model.commitId) }],
      } satisfies CsvTableRowsRead;
    }
    case 'save_csv_patch':
      return model.saveCsv(args.payload as SaveCsvPatchPayload);
    case 'query_csv_row_preview':
      return { resourceRef: null };
    case 'query_csv_source_options': {
      const source = (args.payload as { source: string }).source;
      const values =
        source === 'csv:shipSystems.id'
          ? ['ammofeed', 'sample_system']
          : source === 'hull:ids'
            ? ['aurora', 'sample_hull']
            : source.startsWith('csv:wings.')
              ? model.catalog('wings').map((entry) => entry.id)
              : source.startsWith('csv:weapons.')
                ? model.catalog('weapons').map((entry) => entry.id)
                : ['sample', 'browser'];
      return [
        {
          origin: 'mod',
          options: values.map((value) => ({ value, label: value, description: '浏览器样本', origin: 'mod', resourceRef: null })),
        },
      ];
    }
    case 'query_hull_references':
      return {
        groups: [
          {
            origin: 'mod',
            kind: 'ship',
            options: ['aurora', 'sample_hull'].map((value) => ({ label: value, value, origin: 'mod', kind: 'ship', resourceRef: null })),
          },
        ],
        hullNames: { aurora: 'Aurora', sample_hull: 'Sample hull' },
        sprites: {},
        builtInWeaponSlots: {},
      };
    case 'query_joint_edit': {
      const payload = args.payload as JointEditQuery;
      if (payload.catalog)
        return {
          root: payload.root,
          catalog: { kind: payload.catalog, entries: model.catalog(payload.catalog) },
          referenceSettings: model.graph(payload.root.kind).referenceSettings,
        };
      if (payload.root.kind === 'wing' && !payload.root.id) payload.root.id = model.graph('wing').root.id;
      return model.project(payload.root, payload.values);
    }
    case 'prepare_joint_edit': {
      const payload = args.payload as JointEditDraft;
      return { snapshot: model.project(payload.baseline.root), values: payload.values, conflicts: [] } satisfies JointEditPrepared;
    }
    case 'save_joint_edit':
      return model.saveJoint(args.payload as SaveJointEditPayload);
    case 'query_engine_render_assets':
      return { styles: {}, resources: {}, versions: [] } satisfies EngineRenderAssets;
    case 'query_resource_data_urls':
      return { entries: (args.payload as { resources: object[] }).resources.map((resource) => ({ ...resource, dataUrl: sampleImage })) };
    case 'query_original_font':
      return fontResult((args.payload as { fontId: string }).fontId);
    case 'query_edit_target_owners':
      return [];
    case 'get_current_window_context':
      return model.context;
    case 'get_current_window_request':
      return null;
    case 'get_window_bootstrap':
      return model.context ? { kind: 'managed', context: model.context, restoring: true, modName: '浏览器样本' } : { kind: 'main' };
    case 'accept_window_request':
      return true;
    case 'retarget_managed_window':
      model.context = {
        ...model.context,
        identity: args.identity,
        input: args.input,
        revision: model.context.revision + 1,
      } as ManagedWindowContext;
      return model.context;
    case 'query_file_history':
      return { revision: 1, undoStack: [], redoStack: [] };
    case 'synchronize_committed_write':
      return model.commits.get((args.payload as { commitId: number }).commitId)!.sessionUpdates[0];
    case 'update_edit_target_registration':
    case 'reserve_edit_targets':
    case 'reserve_window_targets':
    case 'release_window_targets':
    case 'update_managed_window_status':
    case 'ready_close':
    case 'reply_close':
    case 'fail_window_request':
    case 'fail_window_startup':
      return;
    case 'focus_managed_window':
      return false;
    case 'request_window':
      return { label: 'browser-window', requestId: 1, status: 'accepted' };
    case 'request_close':
      await emit('browser-close', null);
      return { status: 'closed', destroyedWindows: [], releasedSessions: [], diagnostic: null };
    default:
      throw Error('浏览器样本未实现命令：' + command);
  }
}
let fontImage: string, fontDefinition: string;
function fontResult(fontId: string) {
  if (!fontImage) {
    const characters = Array.from(__BROWSER_FONT_CHARS__);
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = Math.ceil(characters.length / 32) * 16;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.font = '14px "Microsoft YaHei", sans-serif';
    ctx.textBaseline = 'top';
    const lines = characters.map((character, i) => {
      const x = (i % 32) * 16,
        y = Math.floor(i / 32) * 16;
      ctx.fillText(character, x, y);
      return `char id=${character.codePointAt(0)} x=${x} y=${y} width=16 height=16 xoffset=0 yoffset=0 xadvance=${Math.ceil(ctx.measureText(character).width)} page=0`;
    });
    fontDefinition = [
      `common lineHeight=16 base=14 scaleW=512 scaleH=${canvas.height} pages=1 packed=0`,
      'page id=0 file="sample.png"',
      ...lines,
    ].join('\n');
    fontImage = canvas.toDataURL();
  }
  return {
    status: 'available',
    root: 'M:/game',
    fontId,
    path: 'sample.fnt',
    definition: fontDefinition,
    pages: [{ id: 0, path: 'sample.png', dataUrl: fontImage }],
  };
}
export function resetBrowserModel(scene = model.scene, count?: number) {
  installBrowserModel(createBrowserModel(scene, count));
  return model;
}
