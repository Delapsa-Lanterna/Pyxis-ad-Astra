<template><span hidden /></template>
<script setup lang="ts">
import { csvIdentityColumn } from '@/shared/lib/starsector';
import { onMounted, onScopeDispose, watch, nextTick } from 'vue';
import { EditorView } from '@codemirror/view';
import { normalizeFsPath } from '@/shared/lib/paths';
import { useWorkspaceStore } from '@/stores/workspace.store';
import { useCsvEditorStore } from '@/stores/csv-editor.store';
import { useJsonEditorStore } from '@/stores/json-editor.store';
import { useFileBrowserStore } from '@/stores/file-browser.store';
import { useSaveCommandStore } from '@/stores/save-command.store';
import { useAppFeedback } from '@/app/composables/use-app-feedback';
import { useWorkspaceNavigationActions } from '@/app/composables/use-workspace-navigation-actions';
import { openWorkspaceMod } from '@/orchestrators/workspace-opening.orchestrator';
import { openSpecEditorWindow } from '@/windows/spec-editor.window';
import { openTextEditorWindow } from '@/windows/text-editor.window';
import { openImmersiveEditorWindow } from '@/windows/immersive-editor.window';
import { openWeaponFirePreviewWindow } from '@/windows/weapon-fire-preview.window';
import { openCodeEditor } from '@/services/code-editor.service';
import { managedWindowContext } from '@/windows/window-context.window';
import { JSON_DOCUMENT_DEFINITIONS } from '@/domain/json-editor/json-document-definitions';
import { buildModNavigationSections } from '@/domain/workspace/mod-navigation';
import { queryFileDirectory } from '@/services/file-browser.service';
import { queryJointEdit } from '@/services/joint-edit.service';
import { locationSearch } from './location';
import type { BrowserLocation } from './location';
import type { BrowserWorkspace } from './workspace-runtime';
import type { EntityKind, JointEditKind, SpecEditorKind, TextFileOpen } from '@/shared/types';
import { until } from './timing';

const props = defineProps<{ runtime: BrowserWorkspace; label: string }>();
const workspace = useWorkspaceStore(),
  csv = useCsvEditorStore(),
  json = useJsonEditorStore(),
  files = useFileBrowserStore();
const commands = useSaveCommandStore(),
  feedback = useAppFeedback(),
  navigation = useWorkspaceNavigationActions();
let disposed = false,
  connected = false,
  unbind = () => {},
  lastColumn: string | undefined,
  pending = false;
const owner = (mod: string) => {
  const project = props.runtime.projects.find((entry) => entry.manifest.modInfo?.id === mod);
  if (!project) throw Error('链接中的项目不存在：' + mod);
  return project;
};
function projectId(root: string) {
  return String(
    props.runtime.projects.find((entry) => normalizeFsPath(entry.manifest.modRoot) === normalizeFsPath(root))!.manifest.modInfo!.id,
  );
}
function read(): BrowserLocation | null {
  const context = managedWindowContext.value;
  if (context) {
    const identity = context.identity;
    if (!identity.modRoot) return null;
    const mod = projectId(identity.modRoot);
    if (identity.type === 'immersive') return { view: 'immersive', mod, kind: identity.kind, id: identity.id };
    if (identity.type === 'spec') return { view: 'spec', mod, kind: identity.kind, id: identity.id };
    if (identity.type === 'weapon-fire-preview') return { view: 'preview', mod, id: identity.id };
    if (identity.type === 'text-editor' || identity.type === 'recovery') {
      const location = context.input.kind === 'text-editor' ? context.input.location : null;
      const position = readPosition();
      return {
        view: 'text',
        mod,
        path: identity.path.slice(identity.modRoot.length + 1),
        ...(position ?? {
          ...(location?.line ? { line: location.line } : {}),
          ...(location?.column ? { column: String(location.column) } : {}),
        }),
      };
    }
    const path =
      document.querySelector<HTMLElement>('.code-editor-path')?.title ||
      document.querySelector<HTMLElement>('.code-editor-tabs .mod-tab.active')?.title;
    return { view: 'code', mod, ...(path ? { path: path.slice(identity.modRoot.length + 1), ...readPosition() } : {}) };
  }
  const view = workspace.currentView;
  if (view === 'overview') return { view: 'workspace' };
  if (view === 'settings' || view === 'about') return { view };
  const manifest = workspace.activeManifest;
  if (!manifest) return null;
  const mod = projectId(manifest.modRoot);
  if (view === 'mod-overview' || view === 'file-history') return { view, mod };
  if (view === 'json-editor') {
    const page = workspace.jsonPage,
      kind = JSON_DOCUMENT_DEFINITIONS[page].kind;
    const id = json.selection(manifest.sessionId, kind).value;
    return { view: 'json', mod, page, ...(id && kind !== 'mod-info' ? { id } : {}) };
  }
  if (view === 'file-browser') {
    const path = files.sessions.get(manifest.sessionId)?.selected;
    return { view: 'files', mod, ...(path ? { path } : {}) };
  }
  const state = csv.getCsvModState(manifest.modRoot)!;
  const rowKey = state.selectedRowKey,
    row = rowKey ? state.documents[state.currentTab].rows[rowKey] : null;
  const source = props.runtime.projects.find((entry) => entry.manifest.sessionId === manifest.sessionId)!;
  const index = source.tables.get(state.currentTab)!.rows.findIndex((entry) => entry.rowKey === rowKey);
  const id = row?.data[csvIdentityColumn(state.currentTab)];
  const column = document.querySelector<HTMLElement>('.csv-cell-selected')?.dataset.columnKey ?? lastColumn;
  return {
    view: 'table',
    mod,
    table: state.currentTab,
    ...(id ? { id: String(id) } : {}),
    ...(index >= 0 ? { row: index + 1 } : {}),
    ...(column && rowKey ? { column } : {}),
  };
}
function readPosition() {
  const element = document.querySelector<HTMLElement>('.cm-content');
  if (!element) return null;
  const editor = EditorView.findFromDOM(element)!;
  const offset = editor.state.selection.main.head,
    line = editor.state.doc.lineAt(offset);
  return { line: line.number, column: String(offset - line.from + 1) };
}
async function open(location: BrowserLocation) {
  if (props.label !== 'main') {
    if (location.path && (location.view === 'text' || location.view === 'code')) {
      await until(
        () => Boolean(document.querySelector('.cm-content')) && !document.querySelector('.text-editor-body[aria-busy="true"]'),
        '文本定位',
      );
      const editor = EditorView.findFromDOM(document.querySelector<HTMLElement>('.cm-content')!)!;
      const line = editor.state.doc.line(Math.min(location.line ?? 1, editor.state.doc.lines));
      const anchor = Math.min(line.to, line.from + Number(location.column ?? 1) - 1);
      editor.dispatch({ selection: { anchor }, effects: EditorView.scrollIntoView(anchor, { y: 'center' }) });
      editor.focus();
    }
    return;
  }
  const waiting = commands.waitForSaves();
  if (waiting && !(await waiting)) throw Error('保存完成后才能打开链接');
  const current = workspace.activeModRoot;
  const inputs =
    current && workspace.currentView === 'table'
      ? csv.getTableInputs(current, csv.getCsvModState(current)!.currentTab)
      : json.active?.inputs;
  if (inputs && (await inputs.commit()) === false) throw Error('请先完成当前输入');
  if (location.theme || location.accent)
    await props.runtime.setAppearance({
      ...(location.theme ? { theme: location.theme } : {}),
      ...(location.accent ? { accent: location.accent } : {}),
    });
  if (location.view === 'workspace') {
    navigation.showOverview();
    await nextTick();
    return;
  }
  if (location.view === 'settings' || location.view === 'about') {
    if (location.view === 'settings') navigation.showSettings();
    else navigation.showAbout();
    await nextTick();
    return;
  }
  const project = owner(location.mod!),
    manifest = project.manifest,
    modRoot = manifest.modRoot;
  const outcome = await openWorkspaceMod(modRoot, manifest.starsectorRoot);
  if (outcome.type === 'cancelled') throw Error('项目打开已取消');
  const root = { sessionId: manifest.sessionId, modRoot },
    kind = location.kind;
  if (location.view === 'spec' || location.view === 'immersive' || location.view === 'preview') {
    if (location.view === 'immersive' && kind === 'wing') {
      if (!project.tables.get('wings')!.rows.some((row) => row.data.id === location.id))
        throw Error('链接中的战机联队不存在：' + location.id);
    } else {
      const entityKind: EntityKind = location.view === 'preview' ? 'weapon' : (kind as EntityKind);
      if (!project.entities.has(project.entityKey(entityKind, location.id!))) throw Error('链接中的实体不存在：' + location.id);
    }
    if (location.view === 'spec')
      await openSpecEditorWindow({ ...root, kind: kind as SpecEditorKind, id: location.id!, starsectorRoot: manifest.starsectorRoot });
    else if (location.view === 'preview') await openWeaponFirePreviewWindow({ ...root, id: location.id!, source: { kind: 'saved' } });
    else {
      const snapshot = await queryJointEdit({ ...root, kind: kind as JointEditKind, id: location.id! });
      const record = snapshot.records.find((entry) => entry.key === snapshot.bindings.csv);
      await openImmersiveEditorWindow(
        { ...snapshot.root },
        kind === 'wing' && record?.target.kind === 'csv' ? record.target.rowKey : undefined,
      );
    }
    await until(
      () =>
        [...props.runtime.locations.clients].some(
          ([label, client]) =>
            label !== 'main' &&
            locationSearch(client.read() ?? { view: 'workspace' }) ===
              locationSearch({ view: location.view, mod: location.mod, kind, id: location.id }),
        ),
      '链接窗口就绪',
    );
    return;
  }
  if (location.view === 'text' || location.view === 'code') {
    const path = location.path ? modRoot + '/' + location.path : null;
    if (path && !project.textFiles.has(path)) throw Error('链接中的文本文件不存在：' + location.path);
    if (location.view === 'text')
      await openTextEditorWindow({
        ...root,
        path: path!,
        line: location.line,
        column: location.column ? Number(location.column) : undefined,
      });
    else {
      const files: TextFileOpen[] = path
        ? [{ path, line: location.line, column: location.column ? Number(location.column) : undefined }]
        : [];
      const results = await openCodeEditor({ ...root, files });
      const failure = results.find((result) => result.diagnostic);
      if (failure) throw Error(failure.diagnostic!.message);
    }
    const label = [...props.runtime.windows].find(([, entry]) => {
      const identity = entry.context?.identity;
      return (
        identity?.type === (location.view === 'text' ? 'text-editor' : 'code-editor') &&
        'sessionId' in identity &&
        identity.sessionId === manifest.sessionId &&
        (location.view !== 'text' || ('path' in identity && identity.path === path))
      );
    })![0];
    await until(() => props.runtime.locations.clients.has(label), '文本窗口链接入口');
    await props.runtime.locations.clients.get(label)!.open(location);
    return;
  }
  const target = buildModNavigationSections(manifest)
    .flatMap((section) => section.items)
    .find((entry) =>
      location.view === 'table'
        ? entry.id === 'table:' + location.table
        : location.view === 'json'
          ? entry.id === 'json:' + location.page
          : location.view === 'files'
            ? entry.id === 'file-browser'
            : entry.id === location.view,
    );
  if (!target) throw Error('链接中的页面不属于当前项目');
  if (location.view === 'mod-overview') navigation.navigateToModOverview(modRoot);
  else if (location.view === 'file-history') navigation.navigateToModFileHistory(modRoot);
  else if (location.view === 'files') {
    navigation.navigateToFileBrowser(modRoot);
    await until(() => workspace.currentView === 'file-browser' && files.sessions.has(manifest.sessionId), '文件浏览页面');
    if (location.path) {
      const state = files.sessions.get(manifest.sessionId)!;
      const parts = location.path.split('/');
      state.expanded = parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join('/'));
      for (const directory of [null, ...state.expanded])
        files.acceptDirectory(manifest.sessionId, await queryFileDirectory(manifest.sessionId, directory));
      if (![...state.directories.values()].some((directory) => directory.entries?.some((entry) => entry.relPath === location.path)))
        throw Error('链接中的文件或目录不存在：' + location.path);
      state.selected = location.path;
    }
  } else if (location.view === 'json') {
    navigation.navigateToModJson(modRoot, location.page!);
    await until(() => workspace.currentView === 'json-editor' && Boolean(document.querySelector('.json-page')), 'JSON 页面');
    if (location.id) {
      const definition = JSON_DOCUMENT_DEFINITIONS[location.page!];
      if (
        definition.kind !== 'misc-config' &&
        definition.kind !== 'mod-info' &&
        !project.entities.has(project.entityKey(definition.kind, location.id))
      )
        throw Error('链接中的 JSON 实体不存在：' + location.id);
      await until(() => Boolean(document.querySelector('[data-entity-id="' + CSS.escape(location.id!) + '"]')), 'JSON 实体');
      document.querySelector<HTMLElement>('[data-entity-id="' + CSS.escape(location.id) + '"]')!.click();
      await until(
        () => json.selection(manifest.sessionId, JSON_DOCUMENT_DEFINITIONS[location.page!].kind).value === location.id,
        'JSON 选择',
      );
    }
  } else {
    const table = location.table!,
      rows = project.tables.get(table)!.rows;
    navigation.navigateToModTable(modRoot, table);
    await until(
      () =>
        workspace.currentView === 'table' &&
        csv.getCsvModState(modRoot)?.currentTab === table &&
        Boolean(document.querySelector('.csv-grid')),
      'CSV 页面',
    );
    if (location.id || location.row) {
      const index = location.row ? location.row - 1 : rows.findIndex((row) => row.data[csvIdentityColumn(table)] === location.id);
      const row = rows[index];
      if (!row || (location.id && row.data[csvIdentityColumn(table)] !== location.id)) throw Error('链接中的 CSV 行不存在');
      if (location.column && !project.tables.get(table)!.header.includes(location.column))
        throw Error('链接中的 CSV 列不存在：' + location.column);
      const state = csv.getCsvModState(modRoot)!,
        captured = { ...root, table };
      await until(() => state.documents[table].rowOrder.includes(row.rowKey), 'CSV 行索引');
      csv.selectRowByKey(captured, row.rowKey);
      const panel = document.querySelector<HTMLElement>('.table-panel')!;
      panel.scrollTop = index * 24;
      panel.dispatchEvent(new Event('scroll'));
      if (location.column) {
        const headers = [...document.querySelectorAll<HTMLElement>('.csv-header-cell[title]')];
        const header = headers.find((entry) => entry.title.split('\n')[0] === location.column)!;
        panel.scrollLeft = header.offsetLeft;
        panel.dispatchEvent(new Event('scroll'));
        await until(
          () =>
            Boolean(
              document.querySelector(
                '[data-row-key="' + CSS.escape(row.rowKey) + '"] [data-column-key="' + CSS.escape(location.column!) + '"]',
              ),
            ),
          'CSV 单元格',
        );
        lastColumn = location.column;
        document
          .querySelector<HTMLElement>(
            '[data-row-key="' + CSS.escape(row.rowKey) + '"] [data-column-key="' + CSS.escape(location.column) + '"]',
          )!
          .click();
      }
    }
  }
  await nextTick();
}
function publish() {
  if (!connected || disposed) return;
  const location = read();
  if (location) props.runtime.locations.publish(props.label, location);
}
function focus() {
  if (!connected || disposed) return;
  const location = read();
  if (location) props.runtime.locations.publish(props.label, location, true);
}
function schedule() {
  if (pending || !connected) return;
  pending = true;
  requestAnimationFrame(() => {
    pending = false;
    publish();
  });
}
const stop = watch(
  () => {
    const manifest = workspace.activeManifest;
    const state = manifest ? csv.getCsvModState(manifest.modRoot) : null;
    const selected =
      manifest && workspace.currentView === 'json-editor'
        ? json.selection(manifest.sessionId, JSON_DOCUMENT_DEFINITIONS[workspace.jsonPage].kind).value
        : null;
    return [
      workspace.currentView,
      manifest?.sessionId,
      workspace.jsonPage,
      selected,
      state?.currentTab,
      state?.selectedRowKey,
      state?.editing?.column,
      manifest ? files.sessions.get(manifest.sessionId)?.selected : null,
      managedWindowContext.value,
    ];
  },
  schedule,
  { flush: 'post' },
);
function clicked(event: Event) {
  const cell = (event.target as Element).closest<HTMLElement>('[data-column-key]');
  if (cell) lastColumn = cell.dataset.columnKey;
  schedule();
  requestAnimationFrame(focus);
}
onMounted(() => {
  void (async () => {
    if (props.label === 'main') {
      await commands.settleCloseActions();
      await until(() => props.runtime.state.mods.every((mod) => workspace.mods.get(mod.modRoot)?.status === 'ready'), '工作区恢复');
    }
    if (disposed) return;
    unbind = props.runtime.locations.connect(props.label, { open, read });
    connected = true;
    document.addEventListener('click', clicked);
    document.addEventListener('keyup', schedule);
    window.addEventListener('focus', focus);
    document.addEventListener('focusin', focus);
    focus();
  })().catch((error) => feedback.error(error, '初始化链接定位失败'));
});
onScopeDispose(() => {
  disposed = true;
  connected = false;
  unbind();
  stop();
  document.removeEventListener('click', clicked);
  document.removeEventListener('keyup', schedule);
  window.removeEventListener('focus', focus);
  document.removeEventListener('focusin', focus);
});
</script>
