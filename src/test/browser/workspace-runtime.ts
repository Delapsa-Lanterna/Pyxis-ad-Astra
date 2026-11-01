import type * as T from '@/shared/types';
import { reactive } from 'vue';
import { createWorkspaceProject, workspaceRoots, coreRoot, gameRoot } from './workspace-project';
import { dispatch as dispatchScene } from './runtime/commands';
import { createSettingsFixture } from '../fixtures/settings';
import { entityTargetFixture } from '../fixtures/entity-target';
import { buildModNavigationSections } from '@/domain/workspace/mod-navigation';
import { gameQuery, gameCatalog } from './game-queries';
import { gameImages, gameAudio } from './game-files';
import { gameCommands } from './game-queries';
import { normalizeFsPath } from '@/shared/lib/paths';
import { initializeWindowsPathCase } from '@/shared/lib/paths';
import { windowsPathCaseFixture } from '../fixtures/windows-path-case';
import { cell, formatModVersion } from '@/shared/lib/starsector';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { miscConfigDefinition } from '@/domain/misc-config';

type Handler = (event: { event: string; id: number; payload: unknown }) => void | Promise<void>;
type DeliveryChannel = { onmessage: (delivery: T.SaveDelivery) => void };
export function createBrowserWorkspace(systemTheme: T.AppTheme = 'light') {
  initializeWindowsPathCase(windowsPathCaseFixture);
  let references: T.ReferenceSource[] = [];
  const buildProjects = () => [coreRoot, ...workspaceRoots].map(createWorkspaceProject);
  let projects = buildProjects();
  function connectProjectSources() {
    projects.forEach((entry) => entry.setSources(() => sourceList(entry)));
  }
  connectProjectSources();
  const windows = new Map<
    string,
    { context: T.ManagedWindowContext | null; status: T.ManagedWindowStatus; ready: boolean; generation: number }
  >();
  const listeners = new Map<number, { label: string; event: string; handler: Handler; target?: string }>();
  const channels = new Map<string, DeliveryChannel>();
  let nextId = 0,
    generation = 0,
    revision = 0,
    settings = createSettingsFixture({ starsectorRoot: gameRoot });
  const appearance = reactive({
    theme: (settings.theme ?? systemTheme) as T.AppTheme,
    accent: 'blue' as T.AccentPreset,
    customAccent: '#2563eb',
  });
  function updateAppearance() {
    Object.assign(appearance, {
      theme: settings.theme ?? systemTheme,
      accent: settings.accent,
      customAccent: settings.customAccent,
    });
  }
  let state: T.PersistedWorkspace = {
    mods: projects.slice(1).map(({ manifest }) => ({
      modRoot: manifest.modRoot,
      displayName: String(manifest.modInfo!.name),
      version: formatModVersion(manifest.modInfo!.version),
      referenceable: false,
    })),
    starsectorRoot: gameRoot,
    gameMods: [],
    gameWarnings: [],
    columnWidths: {},
  };
  const faults = { delay: 0, read: false, save: false };
  const diagnostics: { level: string; message: string; window: string }[] = [];
  const calls: { window: string; command: string; sessionId?: string }[] = [];
  const replies = new Map<string, (accepted: boolean) => void>();
  let onWindows = () => {};
  const project = (sessionId: string) => projects.find((entry) => entry.manifest.sessionId === sessionId)!;
  const roots = new Map<string, string>();
  function addWindow(label: string, context: T.ManagedWindowContext | null) {
    windows.set(label, { context, status: { dirty: false, saving: false }, ready: false, generation: ++generation });
    onWindows();
  }
  async function emit(event: string, payload: unknown, target?: string) {
    await Promise.all(
      [...listeners]
        .filter(([, entry]) => entry.event === event && (!target || entry.label === target || entry.target === target))
        .map(([id, entry]) => entry.handler({ event, id, payload })),
    );
  }
  function sourceList(receiver: ReturnType<typeof project>) {
    return [
      receiver,
      ...references.filter((source) => source.sessionId !== receiver.manifest.sessionId).map((source) => project(source.sessionId)),
      projects[0]!,
    ].filter((entry, index, all) => all.indexOf(entry) === index);
  }
  function findEntity(receiver: ReturnType<typeof project>, kind: T.EntityKind, id: string) {
    for (const source of sourceList(receiver)) {
      const entity = source.entities.get(source.entityKey(kind, id));
      if (!entity) continue;
      const result = structuredClone(entity);
      if (source !== receiver) {
        result.target = entityTargetFixture(kind, id, 'create', receiver.manifest.modRoot);
        result.target.source = {
          ...entity.target.write,
          source: source === projects[0] ? 'core' : 'reference',
          ...(source === projects[0] ? {} : { reference: { sessionId: source.manifest.sessionId, modRoot: source.manifest.modRoot } }),
        };
        result.resourceRefs = Object.fromEntries(
          Object.entries(result.resourceRefs).map(([key, resource]) => [
            key,
            resource.source === 'core'
              ? resource
              : { ...resource, source: 'reference', reference: { sessionId: source.manifest.sessionId, modRoot: source.manifest.modRoot } },
          ]),
        );
      }
      return result;
    }
    return null;
  }
  function notify(
    label: string,
    receiver: ReturnType<typeof project>,
    result: T.WriteResult<T.RowData>,
    reason: 'save' | 'refresh' = 'save',
  ) {
    for (const channel of channels.values())
      channel.onmessage({
        kind: 'saved',
        requestId: 'external-' + ++revision,
        event: { originWindowLabel: label, sessionId: receiver.manifest.sessionId, modRoot: receiver.manifest.modRoot, reason, result },
      });
  }
  async function close(label: string, scope: T.CloseScope) {
    const targets = [...windows]
      .filter(
        ([key, entry]) =>
          scope.kind === 'application' ||
          (scope.kind === 'window'
            ? key === label
            : entry.context && 'sessionId' in entry.context.identity && scope.sessionIds.includes(entry.context.identity.sessionId)),
      )
      .map(([key]) => key);
    const operationId = ++nextId;
    async function deliver(target: string, phase: T.ClosePhase) {
      const key = JSON.stringify([target, operationId, phase]);
      const reply = new Promise<boolean>((resolve) => replies.set(key, resolve));
      await emit('window-lifecycle-close-requested', { operationId, phase, scope, onlyIfClean: false, releasedSessions: [] }, target);
      const accepted = await reply;
      replies.delete(key);
      return accepted;
    }
    for (const phase of ['hold', 'settle', 'prepare', 'confirm', 'flush'] as const) {
      for (const target of targets) {
        if (!(await deliver(target, phase))) {
          for (const key of targets) await deliver(key, 'resume');
          return { status: 'cancelled', destroyedWindows: [], releasedSessions: [], diagnostic: null };
        }
      }
    }
    const releasedSessions =
      scope.kind === 'sessions' ? scope.sessionIds : scope.kind === 'application' ? projects.map((entry) => entry.manifest.sessionId) : [];
    setTimeout(() => {
      targets.forEach((key) => {
        windows.delete(key);
        channels.delete(key);
        for (const [id, listener] of listeners) if (listener.label === key) listeners.delete(id);
      });
      onWindows();
    }, 0);
    return { status: 'closed', destroyedWindows: targets, releasedSessions, diagnostic: null };
  }
  async function invoke(label: string, command: string, args: Record<string, unknown> = {}): Promise<unknown> {
    calls.push({ window: label, command });
    const request = command === 'save_project' ? (args.request as T.SaveRequest) : null;
    if (request) {
      command = request.action.kind;
      args = { payload: request.action.input };
    }
    const payload = (args.payload ?? {}) as Record<string, unknown>;
    const current = windows.get(label)!;
    const sessionId = String(
      payload.sessionId ??
        (current.context && 'sessionId' in current.context.identity ? current.context.identity.sessionId : projects[1]!.manifest.sessionId),
    );
    const receiver = project(sessionId);
    calls[calls.length - 1]!.sessionId = sessionId;
    if (/^(query|load|scan)_/.test(command)) {
      if (faults.delay) await new Promise((resolve) => setTimeout(resolve, faults.delay));
      if (faults.read) {
        faults.read = false;
        throw new Error('测试工作区读取失败');
      }
    }
    if (request && faults.save) {
      faults.save = false;
      throw new Error('测试工作区保存失败');
    }
    let result: unknown;
    switch (command) {
      case 'get_window_bootstrap':
        return current.context
          ? {
              kind: 'managed',
              context: current.context,
              restoring: true,
              modName: String(receiver.manifest.modInfo!.name),
              windowsPathCaseMap: windowsPathCaseFixture,
            }
          : { kind: 'main', windowsPathCaseMap: windowsPathCaseFixture };
      case 'get_current_window_context':
        return current.context;
      case 'get_current_window_request':
        return null;
      case 'accept_window_request':
        return true;
      case 'ready_close':
        current.ready = true;
        return;
      case 'reply_close':
        replies.get(JSON.stringify([label, args.operationId, args.phase]))!(Boolean(args.accepted));
        return;
      case 'request_close':
        return close(label, (args.scope ?? payload.scope) as T.CloseScope);
      case 'update_managed_window_status':
        current.status = args.payload as T.ManagedWindowStatus;
        return;
      case 'request_window': {
        const input = args.payload as T.NativeWindowRequest;
        const existing = [...windows].find(([, entry]) => stableDeepEqual(entry.context?.identity, input.identity));
        if (existing) {
          focus(existing[0]);
          return { label: existing[0], requestId: existing[1].context!.requestId, status: 'accepted' };
        }
        const key = 'window-' + ++nextId;
        const kind = input.input.kind === 'editor' ? 'editor' : input.input.kind === 'file-editor' ? 'file-editor' : input.input.kind;
        addWindow(key, {
          label: key,
          revision: 1,
          receiverGeneration: 1,
          requestId: nextId,
          title: input.title,
          kind,
          identity: input.identity,
          input: input.input,
        } as T.ManagedWindowContext);
        return { label: key, requestId: nextId, status: 'accepted' };
      }
      case 'focus_managed_window': {
        const found = [...windows].find(([, entry]) => stableDeepEqual(entry.context?.identity, args.identity));
        if (found) focus(found[0]);
        return Boolean(found);
      }
      case 'retarget_managed_window':
        current.context = {
          ...current.context!,
          identity: args.identity,
          input: args.input ?? current.context!.input,
          title: args.title,
          revision: current.context!.revision + 1,
        } as T.ManagedWindowContext;
        return current.context;
      case 'register_save_window':
        channels.set(label, args.channel as DeliveryChannel);
        channels.get(label)!.onmessage({ kind: 'references', snapshot: { revision, sources: references }, event: null });
        return;
      case 'unregister_save_window':
        channels.delete(label);
        return;
      case 'set_reference_sources':
        references = (args.sessionIds as string[]).map((id) => {
          const { sessionId, modRoot } = project(id).manifest;
          return { sessionId, modRoot };
        });
        revision++;
        for (const channel of channels.values())
          channel.onmessage({ kind: 'references', snapshot: { revision, sources: references }, event: null });
        return;
      case 'read_settings':
        return { revision, value: settings, performanceMonitorActive: false };
      case 'save_settings':
        settings = (args.payload as { settings: T.AppSettings }).settings;
        updateAppearance();
        revision++;
        await emit('app-settings-changed', { revision, value: settings, performanceMonitorActive: false });
        return { revision, value: settings, performanceMonitorActive: false };
      case 'load_workspace':
        return state;
      case 'save_workspace':
        state = (args.payload as T.SaveWorkspacePayload).state;
        return;
      case 'open_project_session': {
        const target = projects.find((entry) => normalizeFsPath(entry.manifest.modRoot) === normalizeFsPath(String(payload.modRoot)))!;
        roots.set(target.manifest.sessionId, String(payload.modRoot));
        return {
          ...target.manifest,
          modRoot: String(payload.modRoot),
        };
      }
      case 'close_project_session':
        return;
      case 'scan_game_overview':
        return {
          starsectorRoot: gameRoot,
          coreAvailable: true,
          modsDir: gameRoot + '/mods',
          mods: projects.slice(1).map(({ manifest }) => ({
            modRoot: manifest.modRoot,
            id: manifest.modInfo!.id,
            name: manifest.modInfo!.name,
            version: formatModVersion(manifest.modInfo!.version),
            description: cell(manifest.modInfo!.description),
            hasModInfo: true,
          })),
          warnings: [],
        };
      case 'detect_directory':
        return {
          kind: 'mod-in-game',
          selectedPath: payload.path,
          starsectorRoot: gameRoot,
          modRoot: payload.path,
          overview: null,
          warnings: [],
        };
      case 'query_entity_list':
        return structuredClone([...receiver.entities.values()].filter((entity) => entity.kind === payload.kind));
      case 'query_entity':
        return findEntity(receiver, payload.kind as T.EntityKind, String(payload.id));
      case 'query_draft_resources': {
        const kind = payload.kind as T.EntityKind;
        const id = String(payload.id);
        const draft = payload.draft as T.RowData;
        return receiver.resources(
          kind,
          id,
          kind === 'mission' ? { icon: `data/missions/${id}/${(draft.descriptor as T.RowData).icon}` } : draft,
        );
      }
      case 'query_entity_edit_target': {
        const entity = findEntity(receiver, payload.kind as T.EntityKind, String(payload.id));
        const target =
          entity?.target ?? entityTargetFixture(payload.kind as T.EntityKind, String(payload.id), 'create', receiver.manifest.modRoot);
        return { target, baseVersions: entity?.baseVersions ?? [receiver.version(target.write.path)] };
      }
      case 'query_entity_identity_intent': {
        const source = payload.source as T.EntityEditTarget;
        const nextWrite = entityTargetFixture(source.kind, String(payload.nextId), 'create', receiver.manifest.modRoot).write;
        return { source, nextId: String(payload.nextId), nextWrite, destinationVersion: { path: nextWrite.path, fingerprint: null } };
      }
      case 'get_app_log_status':
        return {
          path: 'M:/browser-logs/sample.log',
          sizeBytes: 0,
          recording: 'active',
          level: settings.logLevel,
          lastError: null,
          dropped: 0,
          pending: 0,
        };
      case 'append_app_logs':
      case 'flush_app_logs':
      case 'stop_app_log':
        return;
      case 'query_core_root':
        return gameRoot;
      case 'scan_core_fields':
        return Object.fromEntries(
          [...projects[0]!.tables].map(([table, { header, rows }]) => [
            table,
            header.map((key) => ({
              key,
              type: typeof rows[0]?.data[key] === 'number' ? 'float' : typeof rows[0]?.data[key] === 'boolean' ? 'boolean' : 'string',
              origin: 'core',
            })),
          ]),
        );
      case 'scan_core_graphics':
        return [...gameImages.keys()]
          .filter((path) => path.startsWith(coreRoot + '/'))
          .map((path) => path.slice(coreRoot.length + 1))
          .concat(
            [...projects[0]!.textFiles.keys()]
              .filter((path) => /graphics\/fonts\/[^/]+\.fnt$/.test(path))
              .map((path) => path.slice(coreRoot.length + 1)),
          );
      case 'invalidate_core_cache':
        return;
      case 'query_csv_table_index':
      case 'query_csv_table_rows':
      case 'save_csv_patch':
        result = gameQuery(receiver, command, payload);
        break;
      case 'prepare_json_source_recovery': {
        const input = args.payload as T.JsonRecoveryRequest;
        if (input.origin.kind === 'miscConfig') {
          const path = receiver.manifest.modRoot + '/' + miscConfigDefinition(input.origin.file).path;
          return {
            request: input,
            baseVersions: [receiver.version(path)],
            missingPaths: receiver.textFiles.has(path) ? [] : [path],
            currentSources: receiver.textFiles.has(path) ? { file: JSON.parse(receiver.textFiles.get(path)!) } : {},
            resourceRefs: {},
          };
        }
        const entity = input.origin.kind === 'entity' ? findEntity(receiver, input.origin.target.kind, input.origin.target.id)! : null;
        const data = entity?.data as T.RowData;
        return {
          request: input,
          missingPaths: [],
          currentSources: entity
            ? entity.kind === 'mission'
              ? { descriptor: data.descriptor, text: data.text, index: { rows: [{ data: data.list, isComment: false }] } }
              : { file: data }
            : { file: receiver.manifest.modInfo },
          baseVersions: entity?.baseVersions ?? [{ path: receiver.manifest.modRoot + '/mod_info.json', fingerprint: '1' }],
          resourceRefs: entity?.resourceRefs ?? {},
        };
      }
      case 'recreate_json_sources': {
        const input = payload as unknown as T.JsonSourceRestore,
          origin = input.plan.request.origin,
          baseline = input.baseline;
        if (origin.kind === 'miscConfig') gameQuery(receiver, 'save_misc_config', { kind: origin.file, data: baseline.file });
        else if (origin.kind === 'modInfo') {
          const path = receiver.manifest.modRoot + '/mod_info.json';
          receiver.textFiles.set(path, JSON.stringify(baseline.file, null, 2));
          receiver.write(null, { kind: 'json', origin }, [path]);
        } else
          receiver.document(
            origin.target.kind === 'variant'
              ? 'create_variant_entity'
              : origin.target.kind === 'skin'
                ? 'create_skin_entity'
                : 'create_indexed_config_entity',
            {
              kind: origin.target.kind,
              nextId: origin.target.id,
              previousId: null,
              relPath: origin.target.relPath,
              data: baseline,
              entityData: origin.target.kind === 'mission' ? { ...baseline, text: (baseline.text as T.RowData).content } : baseline,
              indexRow: baseline.list,
            } as unknown as Parameters<typeof receiver.document>[1],
          );
        result = receiver.write(
          await invoke(label, 'prepare_json_source_recovery', { payload: input.plan.request }),
          { kind: 'recovery', origin },
          [],
        );
        break;
      }
      case 'save_variant_entity':
      case 'create_variant_entity':
      case 'delete_variant_entity':
      case 'save_skin_entity':
      case 'create_skin_entity':
      case 'delete_skin_entity':
      case 'save_indexed_config_entity':
      case 'create_indexed_config_entity':
      case 'delete_indexed_config_entity': {
        result = receiver.document(command, payload as unknown as Parameters<typeof receiver.document>[1]);
        break;
      }
      case 'save_editor_spec': {
        const input = args.payload as T.SpecSave;
        const entity = receiver.entities.get(receiver.entityKey(input.target.kind, input.target.id));
        const data =
          input.target.kind === 'weapon' || input.target.kind === 'projectile'
            ? { ...(entity!.data as T.RowData), spec: input.data }
            : input.data;
        result = receiver.saveEntity(input.target, data);
        break;
      }
      case 'save_mod_info': {
        const modInfo = payload.data as T.RowData;
        receiver.textFiles.set(receiver.manifest.modRoot + '/mod_info.json', JSON.stringify(modInfo, null, 2) + '\n');
        result = receiver.write({ file: payload.data as T.RowData }, { kind: 'json', origin: { kind: 'modInfo' } }, [
          receiver.manifest.modRoot + '/mod_info.json',
        ]);
        break;
      }
      case 'query_hull_references': {
        return gameQuery(receiver, command, payload);
      }
      case 'query_file_history':
        return receiver.history;
      case 'clear_file_history':
        receiver.snapshots.length = 0;
        receiver.redos.length = 0;
        receiver.history.undoStack = [];
        receiver.history.redoStack = [];
        receiver.history.revision++;
        return receiver.history;
      case 'apply_file_change_set':
        result = receiver.undo(payload.direction as 'undo' | 'redo');
        break;
      case 'refresh_project_sources':
        result = receiver.write(null, { kind: 'json', origin: { kind: 'modInfo' } }, (payload.paths as string[]) ?? []);
        break;
      case 'query_mod_file_search': {
        const query = String(payload.query).trim();
        const files = [...new Set([...receiver.textFiles.keys(), ...gameImages.keys(), ...gameAudio.keys()])]
          .filter((path) => path.startsWith(receiver.manifest.modRoot + '/'))
          .map((path) => path.slice(receiver.manifest.modRoot.length + 1));
        const paths = new Set<string>(),
          matchedPaths: string[] = [];
        for (const file of files) {
          const parts = file.split('/');
          for (let i = 1; i <= parts.length; i++) paths.add(parts.slice(0, i).join('/'));
        }
        const entries = new Map<string, T.ModFileEntry>();
        for (const path of paths)
          if (path.split('/').at(-1)!.toLowerCase().includes(query.toLowerCase())) {
            matchedPaths.push(path);
            const parts = path.split('/');
            for (let i = 1; i <= parts.length; i++) {
              const relPath = parts.slice(0, i).join('/');
              entries.set(relPath, {
                name: parts[i - 1]!,
                relPath,
                kind: files.includes(relPath) ? 'file' : 'directory',
                sizeBytes: null,
                modifiedAt: null,
              });
            }
          }
        return { query, entries: [...entries.values()], matchedPaths };
      }
      case 'query_mod_directory': {
        const directory = payload.directory as string | null;
        const prefix = directory ? directory + '/' : '';
        const assets = [...gameImages.keys(), ...gameAudio.keys()]
          .filter((path) => path.startsWith(receiver.manifest.modRoot + '/'))
          .map((path) => [path, null] as const);
        const files = [...new Map([...[...receiver.textFiles].map(([path, text]) => [path, text.length] as const), ...assets]).entries()];
        return {
          directory,
          entries: [
            ...new Map(
              files
                .map(([path, sizeBytes]) => [path.slice(receiver.manifest.modRoot.length + 1), sizeBytes] as const)
                .filter(([path]) => path.startsWith(prefix))
                .map(([path, sizeBytes]) => {
                  const name = path.slice(prefix.length).split('/')[0]!;
                  const relPath = prefix + name;
                  return [
                    name,
                    {
                      name,
                      relPath,
                      kind: path === relPath ? 'file' : 'directory',
                      sizeBytes: path === relPath ? sizeBytes : null,
                      modifiedAt: null,
                    },
                  ];
                }),
            ).values(),
          ],
        };
      }
      case 'query_mod_text_file_target':
        return receiver.textFiles.has(receiver.manifest.modRoot + '/' + payload.relPath)
          ? { sessionId, modRoot: receiver.manifest.modRoot, path: receiver.manifest.modRoot + '/' + payload.relPath }
          : null;
      case 'load_editable_file': {
        const path = [...receiver.textFiles.keys()].find((path) => normalizeFsPath(path) === normalizeFsPath(String(payload.path)))!;
        return {
          path,
          text: receiver.textFiles.get(path),
          encoding: 'UTF-8',
          writable: true,
          baseVersions: [{ path, fingerprint: receiver.versions.get(path) ?? '1' }],
        };
      }
      case 'save_text_file': {
        const path = String(payload.path);
        receiver.textFiles.set(path, String(payload.text));
        result = receiver.write(null, { kind: 'text', path }, [path]);
        break;
      }
      case 'query_joint_edit': {
        const input = payload as unknown as T.JointEditQuery;
        if (input.catalog)
          return {
            root: input.root,
            referenceSettings: { values: {}, versions: [], resources: {} },
            catalog: {
              kind: input.catalog,
              entries: gameCatalog(receiver, input.catalog).filter(
                (entry) => !input.catalogSource || entry.source.source === input.catalogSource,
              ),
            },
          };
        return receiver.queryJoint(input);
      }
      case 'prepare_joint_edit':
        return {
          snapshot: receiver.model.project((payload as unknown as T.JointEditDraft).baseline.root),
          values: (payload as unknown as T.JointEditDraft).values,
          conflicts: [],
        };
      case 'save_joint_edit': {
        const joint = payload as unknown as T.SaveJointEditPayload;
        result = receiver.model.saveJoint(joint);
        break;
      }
      case 'query_weapon_spec_data': {
        const found = findEntity(receiver, 'weapon', String(payload.id));
        if (!found) return null;
        const data = found.data as T.RowData;
        return { ...found, weapon: data.spec, weaponCsvRow: data.csvRow, resourceRefs: Object.values(found.resourceRefs), isNew: false };
      }
      case 'query_engine_render_assets':
      case 'query_resource_data_urls':
      case 'query_csv_row_preview':
      case 'query_csv_source_options':
      case 'query_image_source_options':
        result = gameQuery(receiver, command, payload);
        break;
      default:
        result = gameCommands.has(command) ? gameQuery(receiver, command, payload) : await dispatchScene(command, args, receiver.model);
    }
    if (request) {
      const saved = result as T.WriteResult;
      saved.sessionUpdates.forEach((update) => {
        update.sessionId = sessionId;
        update.modRoot = roots.get(sessionId) ?? receiver.manifest.modRoot;
        update.projection.manifest = { ...receiver.manifest, modRoot: update.modRoot };
      });
      for (const channel of channels.values())
        channel.onmessage({
          kind: 'saved',
          requestId: request.id,
          event: {
            originWindowLabel: label,
            sessionId,
            modRoot: roots.get(sessionId) ?? receiver.manifest.modRoot,
            reason: command === 'refresh_project_sources' ? 'refresh' : 'save',
            result: saved,
          },
        });
    }
    return result;
  }
  function focus(label: string) {
    document.querySelector<HTMLIFrameElement>(`iframe[data-window="${label}"]`)?.focus();
  }
  addWindow('main', null);
  return {
    get projects() {
      return projects;
    },
    windows,
    faults,
    diagnostics,
    calls,
    appearance,
    invoke,
    emit,
    focus,
    notify,
    findEntity,
    sourceList,
    get state() {
      return state;
    },
    get references() {
      return references;
    },
    navigation: buildModNavigationSections(projects[1]!.manifest).flatMap((section) => section.items),
    setWindowListener(callback: () => void) {
      onWindows = callback;
      return () => {
        onWindows = () => {};
      };
    },
    listen(label: string, event: string, handler: Handler, target?: string) {
      const id = ++nextId;
      listeners.set(id, { label, event, handler, target });
      return () => listeners.delete(id);
    },
    openSampleWindow(
      kind: 'editor' | 'file-editor' | 'immersive-editor' | 'weapon-fire-preview',
      targetKind: T.SpecEditorKind | T.JointEditKind = kind === 'immersive-editor' ? 'variant' : 'ship',
    ) {
      const receiver =
        targetKind === 'wing'
          ? projects[1]!
          : projects.slice(1).find((source) => [...source.entities.values()].some((entity) => entity.kind === targetKind))!;
      const targetId =
        targetKind === 'wing'
          ? receiver.model.graph('wing').root.id
          : [...receiver.entities.values()].find((entity) => entity.kind === targetKind)!.id;
      const weapon = [...receiver.entities.values()].find((entity) => entity.kind === 'weapon')!;
      const identity: T.WindowIdentity =
        kind === 'editor'
          ? {
              type: 'spec',
              sessionId: receiver.manifest.sessionId,
              modRoot: receiver.manifest.modRoot,
              kind: targetKind as T.SpecEditorKind,
              id: targetId,
            }
          : kind === 'file-editor'
            ? {
                type: 'file',
                sessionId: receiver.manifest.sessionId,
                modRoot: receiver.manifest.modRoot,
                path: receiver.manifest.modRoot + '/mod_info.json',
              }
            : kind === 'immersive-editor'
              ? {
                  type: 'immersive',
                  sessionId: receiver.manifest.sessionId,
                  modRoot: receiver.manifest.modRoot,
                  kind: targetKind as T.JointEditKind,
                  id: targetId,
                }
              : { type: 'weapon-fire-preview', sessionId: receiver.manifest.sessionId, modRoot: receiver.manifest.modRoot, id: weapon.id };
      const input: T.ManagedWindowInput =
        kind === 'editor'
          ? { kind: 'editor', starsectorRoot: gameRoot }
          : kind === 'file-editor'
            ? { kind: 'file-editor', location: { contextLabel: null, contextSeverity: null, message: null, line: null, column: null } }
            : kind === 'immersive-editor'
              ? { kind: 'immersive-editor', rowKey: null }
              : { kind: 'weapon-fire-preview', source: { kind: 'saved' } };
      return invoke('main', 'request_window', {
        payload: { identity, input, title: kind, width: 1000, height: 700, minWidth: 500, minHeight: 400 },
      });
    },
    replayExternalUpdates() {
      return this.externalUpdate();
    },
    async closeApplication() {
      return close('main', { kind: 'application' });
    },
    setAppearance(patch: Partial<Pick<T.AppSettings, 'theme' | 'accent' | 'customAccent'>>) {
      return emit('browser-appearance-request', patch, 'main');
    },
    reopen() {
      windows.clear();
      channels.clear();
      listeners.clear();
      addWindow('main', null);
    },
    restoreSample() {
      projects = buildProjects();
      references = [];
      connectProjectSources();
      state = {
        mods: projects.slice(1).map(({ manifest }) => ({
          modRoot: manifest.modRoot,
          displayName: String(manifest.modInfo!.name),
          version: formatModVersion(manifest.modInfo!.version),
          referenceable: false,
        })),
        starsectorRoot: gameRoot,
        gameMods: [],
        gameWarnings: [],
        columnWidths: {},
      };
      settings = createSettingsFixture({ starsectorRoot: gameRoot });
      updateAppearance();
      this.reopen();
    },
    externalUpdate() {
      const receiver = projects[1]!;
      const current = JSON.parse(receiver.textFiles.get(receiver.manifest.modRoot + '/mod_info.json')!) as T.RowData;
      const modInfo = { ...current, description: String(current.description ?? '') + '\nExternal update' };
      receiver.textFiles.set(receiver.manifest.modRoot + '/mod_info.json', JSON.stringify(modInfo, null, 2) + '\n');
      const result = receiver.write({ file: modInfo }, { kind: 'json', origin: { kind: 'modInfo' } }, [
        receiver.manifest.modRoot + '/mod_info.json',
      ]);
      notify('external', receiver, result, 'refresh');
    },
  };
}
export type BrowserWorkspace = ReturnType<typeof createBrowserWorkspace>;
export { workspaceClient, clientWindowLabel } from './workspace-client';
