import type {
  JointEditQuery,
  JointEditDraft,
  JointEditPrepared,
  SaveJointEditPayload,
  CsvSave,
  AppSettings,
  CsvTableIndex,
  CsvTableRowsRead,
  CsvTableIndexPayload,
  CsvTableRowsPayload,
  AppendAppLogsPayload,
  EngineRenderAssets,
  ManagedWindowContext,
  AppLogStatus,
  MiscConfigWrite,
  JsonRecoveryRequest,
  SaveDelivery,
  SaveRequest,
  WriteResult,
} from '@/shared/types';
import { createSettingsFixture } from '../../fixtures/settings';
import { sessionUpdateFixture, savedWriteFixture } from '../../fixtures/write-result';
import { createBrowserModel, type BrowserModel } from '../scenarios/model';
import { emit } from './events';
import { MISC_CONFIG_FILES, miscConfigFile } from '@/domain/json-editor/misc-config-files';
import { CONFIG_OPTION_SOURCES, isConfigSource } from '@/domain/schema/schema-sources';
import type { RowData } from '@/shared/types';

let model: BrowserModel;
let saveChannel: { onmessage: (delivery: SaveDelivery) => void } | null = null;
export function installBrowserModel(next: BrowserModel) {
  model = next;
}
export function browserModel() {
  return model;
}
export function browserWindowLabel() {
  return model.context?.label ?? 'main';
}

export async function invoke<T>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  const request = command === 'save_project' ? (args.request as SaveRequest) : null;
  if (request) {
    command = request.action.kind;
    args = { payload: request.action.input };
  }
  if (command === 'query_joint_edit') {
    const delay = Number(new URLSearchParams(location.search).get('readDelay') ?? 0);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  }
  const failure = model.failures.get(command);
  if (failure) {
    model.failures.delete(command);
    throw typeof failure === 'string' ? Error(failure) : failure;
  }
  const result = await dispatch(command, args);
  if (request) {
    const { id } = request;
    saveChannel!.onmessage({ kind: 'waiting', modRoot: model.manifest.modRoot, waiting: true });
    saveChannel!.onmessage({
      kind: 'saved',
      requestId: id,
      event: {
        originWindowLabel: browserWindowLabel(),
        sessionId: model.sessionId,
        modRoot: model.manifest.modRoot,
        reason: command === 'refresh_project_sources' ? 'refresh' : 'save',
        result: structuredClone(result) as WriteResult,
      },
    });
    saveChannel!.onmessage({ kind: 'waiting', modRoot: model.manifest.modRoot, waiting: false });
  }
  return structuredClone(result) as T;
}
async function dispatch(command: string, args: Record<string, unknown>): Promise<unknown> {
  switch (command) {
    case 'register_save_window':
      saveChannel = args.channel as typeof saveChannel;
      saveChannel!.onmessage({ kind: 'references', snapshot: { revision: 0, sources: [] }, event: null });
      return;
    case 'unregister_save_window':
      saveChannel = null;
      return;
    case 'resolve_save_sources':
    case 'abandon_project_saves':
    case 'retry_project_save':
    case 'wait_project_saves':
      return;
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
    case 'query_core_root':
      return (args.payload as { sessionId: string | null }).sessionId
        ? model.manifest.starsectorRoot
        : (model.settingsSnapshot().value.starsectorRoot ?? (args.payload as { starsectorRoot: string | null }).starsectorRoot);
    case 'scan_core_graphics':
      return ['graphics/sample.svg'];
    case 'invalidate_core_cache':
      return;
    case 'get_app_log_status':
      return {
        path: (model.settings.logDirectory ?? 'M:/tool-data') + '/sample.log',
        sizeBytes: model.logEntries * 80,
        recording: 'active',
        level: model.settings.logLevel,
        lastError: null,
        dropped: 0,
        pending: 0,
      } satisfies AppLogStatus;
    case 'append_app_logs':
      model.logEntries += (args.payload as AppendAppLogsPayload).entries.length;
      return;
    case 'stop_app_log':
      return;
    case 'clear_app_log_file':
      model.logEntries = 0;
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
        baseVersions: [{ path: model.manifest.tableSummaries.ships.path, fingerprint: String(model.saveCount) }],
      } satisfies CsvTableIndex;
    }
    case 'query_csv_table_rows': {
      model.readRows();
      const payload = args.payload as CsvTableRowsPayload;
      const byKey = new Map(model.rows.map((row) => [row.rowKey, row]));
      return {
        table: payload.table,
        rows: payload.rowKeys.map((key) => byKey.get(key)!),
        baseVersions: [{ path: model.manifest.tableSummaries.ships.path, fingerprint: String(model.saveCount) }],
      } satisfies CsvTableRowsRead;
    }
    case 'save_csv_patch':
      return model.saveCsv(args.payload as CsvSave);
    case 'query_misc_config_files':
      return MISC_CONFIG_FILES.map(({ kind, path }) => ({
        kind,
        path: model.manifest.modRoot + '/' + path,
        relPath: path,
        state: model.miscFiles.some((file) => file.kind === kind) ? 'present' : 'missing',
        error: null,
      }));
    case 'query_misc_config_file':
      return model.miscFiles.find((file) => file.kind === (args.payload as { kind: string }).kind) ?? null;
    case 'prepare_json_source_recovery': {
      const request = args.payload as JsonRecoveryRequest;
      if (request.origin.kind !== 'miscConfig') throw new Error('Browser fixture expects misc config recovery');
      const definition = miscConfigFile(request.origin.file);
      const file = model.miscFiles.find((file) => file.kind === definition.kind);
      return {
        request,
        baseVersions: file?.baseVersions ?? [{ path: model.manifest.modRoot + '/' + definition.path, fingerprint: null }],
        missingPaths: file ? [] : [definition.path],
        currentSources: file ? { file: file.data } : {},
        resourceRefs: {},
      };
    }
    case 'save_misc_config':
    case 'delete_misc_config': {
      const payload = args.payload as MiscConfigWrite;
      const result = model.receipt(command === 'save_misc_config' ? payload.data : null, {
        kind: 'json',
        origin: { kind: 'miscConfig', file: payload.kind },
      });
      const definition = miscConfigFile(payload.kind);
      const path = model.manifest.modRoot + '/' + definition.path;
      result.baseVersions = [{ path, fingerprint: command === 'save_misc_config' ? String(model.saveCount) : null }];
      result.invalidation.paths = [path];
      result.invalidation.queryScopes = Object.entries(CONFIG_OPTION_SOURCES)
        .filter(([, relative]) => relative === definition.path)
        .map(([source]) => ({ kind: 'csv-source-options', source, table: null, entity: null, resource: null }));
      result.sessionUpdates[0]!.projection.invalidation = result.invalidation;
      const index = model.miscFiles.findIndex((file) => file.kind === payload.kind);
      if (index !== -1) model.miscFiles.splice(index, 1);
      if (command === 'save_misc_config')
        model.miscFiles.push({
          kind: payload.kind,
          path,
          relPath: definition.path,
          data: payload.data,
          baseVersions: result.baseVersions,
        });
      return result;
    }
    case 'query_csv_row_preview':
      return { resourceRef: null };
    case 'query_csv_source_options': {
      const source = (args.payload as { source: string }).source;
      if (isConfigSource(source)) {
        const data = model.miscFiles.find((file) => file.relPath === CONFIG_OPTION_SOURCES[source])?.data as RowData | undefined;
        const values = Object.keys((source === 'config:designTypes' ? data?.designTypeColors : data) ?? {}).filter(
          (key) => source !== 'config:sounds' || key !== 'music',
        );
        const core = {
          'config:sounds': ['sample_core_effect'],
          'config:designTypes': ['Low Tech'],
          'config:hullStyles': ['LOW_TECH'],
          'config:engineStyles': ['LOW_TECH'],
        }[source];
        return (
          [
            ['mod', values],
            ['core', core.filter((key) => !values.includes(key))],
          ] as const
        ).map(([origin, ids]) => ({
          origin,
          options: ids.map((value) => ({ value, label: value, description: null, resourceRef: null, origin })),
        }));
      }
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
        weaponSlots: {},
        moduleSlots: {},
      };
    case 'query_joint_edit': {
      const payload = args.payload as JointEditQuery;
      if (payload.catalog)
        return {
          root: payload.root,
          catalog: {
            kind: payload.catalog,
            entries: model
              .catalog(payload.catalog)
              .filter((entry) => !payload.catalogSource || entry.source.source === payload.catalogSource),
          },
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
      return {
        entries: (args.payload as { resources: { relPath: string }[] }).resources.map((resource) => ({
          ...resource,
          dataUrl: model.resourceDataUrl(resource.relPath),
        })),
      };
    case 'query_image_source_options': {
      const { directories, missionId } = args.payload as { directories: string[]; missionId: string | null };
      return [
        {
          origin: 'mod',
          options: directories.map((directory) => {
            const value = directory === '.' ? 'sample.png' : directory + '/sample.png';
            return { label: 'sample.png', value, description: missionId, resourceRef: null, origin: 'mod' };
          }),
        },
      ];
    }
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
    case 'refresh_project_sources': {
      const projection = sessionUpdateFixture(model.sessionId, model.manifest.modRoot).projection;
      const result = {
        ...projection,
        manifest: model.manifest,
        invalidation: {
          ...projection.invalidation,
          resources: (args.payload as import('@/shared/types').SourceRefresh).sources,
        },
      };
      return {
        ...savedWriteFixture(),
        changes: [],
        identityChanges: [],
        keyMap: [],
        content: null,
        baseVersions: [],

        history: { revision: 0, undoStack: [], redoStack: [] },
        invalidation: result.invalidation,
        sessionUpdates: [{ sessionId: model.sessionId, modRoot: model.manifest.modRoot, projection: result }],
      };
    }
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
