import { layeredDependencies, dependencyPositions } from './dependency-graph.mjs';
/** @type {(id: string) => HTMLElement} */
const byId = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @type {{reportId: string, overview: import('./model.mjs').ReportOverview, graph: import('./model.mjs').DependencyGraph, graphSource: import('./model.mjs').DependencyGraph, selected: string, selectedFile: string, issuePage: number, issueTotal: number, filePage: number, fileTotal: number, timer: number, detailVersion: number, moduleCache: Map<string, import('./model.mjs').ModuleDetail>}} */
const state = {
  reportId: '',
  overview: /** @type {any} */ (null),
  graph: { nodes: [], edges: [] },
  graphSource: { nodes: [], edges: [] },
  selected: '',
  selectedFile: '',
  issuePage: 1,
  issueTotal: 0,
  filePage: 1,
  fileTotal: 0,
  timer: 0,
  detailVersion: 0,
  moduleCache: new Map(),
};
/** @type {Record<string, string>} */
const labels = {
  shared: '公共文件',
  declared: '已声明所属',
  candidate: '引用候选',
  conflict: '声明冲突',
  unmatched: '未覆盖',
  production: '生产代码',
  test: '测试',
  document: '文档',
  engineering: '工程文件',
  asset: '资源',
  'rust-semantic-coverage': '语义目标待核',
  'frontend-outside-project': '前端文件缺少项目配置',
  'frontend-dynamic-any': '前端动态类型待核',
  'frontend-no-symbol': '前端符号待核',
  'frontend-no-signature': '前端调用签名待核',
  'frontend-signature-without-declaration': '前端调用签名缺少源码声明',
  'frontend-symbol-without-declaration': '前端符号缺少源码声明',
  'frontend-unmapped-source': 'Vue 源码映射待核',
  'rust-inactive-source': '当前编译配置未启用',
  'ipc-target': '窗口命令目标待核',
  'ipc-registration': '窗口命令登记待核',
  'unresolved-import': '导入未解析',
  parse: '源码解析待核',
  'rust-type': 'Rust 类型引用',
  'rust-import': 'Rust 导入',
  ipc: '窗口命令',
  'window-event': '窗口消息',
  'document-reference': '文档引用',
  'style-import': '样式引用',
  owns: '拥有',
  consumes: '消费',
  assembles: '装配',
  related: '关联',
  runtime: '运行引用',
  type: '类型引用',
  location: '位置待核',
};
/** @type {(value: string) => string} */
const roleLabel = (value) => labels[value] ?? value;
/** @type {(value: string) => string} */
const kindLabel = (value) => labels[value] ?? value.replaceAll('-', ' ');
/** @type {(tag: string, value: unknown, parent: HTMLElement, className?: string) => HTMLElement} */
const text = (tag, value, parent, className = '') => {
  const element = document.createElement(tag);
  element.textContent = String(value ?? '');
  if (className) element.className = className;
  parent.appendChild(element);
  return element;
};
/** @type {(parent: HTMLElement, value: string, callback: () => void | Promise<void>) => HTMLButtonElement} */
const action = (parent, value, callback) => {
  const element = /** @type {HTMLButtonElement} */ (text('button', value, parent, 'link'));
  element.type = 'button';
  element.onclick = () => {
    void Promise.resolve(callback()).catch(showError);
  };
  return element;
};
/** @type {(path: string, options?: RequestInit) => Promise<any>} */
const api = async (path, options) => {
  const response = await fetch(path, { cache: 'no-store', ...options });
  const body = await response.json();
  if (!response.ok) {
    const error = /** @type {Error & {status: number, body: any}} */ (new Error(body.message ?? `请求失败 (${response.status})`));
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
};
/** @type {(path: string) => string} */
const reportUrl = (path) => `/api/reports/${encodeURIComponent(state.reportId)}${path}`;
const selection = () => ({
  mode: control('mode').value,
  basis: control('basis').value,
  scope: control('scope').value,
  kind: control('kind').value,
  relationScope: control('relationScope').value,
});
/** @type {(values: Record<string, string | number>) => string} */
const queryString = (values) =>
  new URLSearchParams(Object.fromEntries(Object.entries(values).map(([key, value]) => [key, String(value)]))).toString();
/** @type {(id: string) => any} */
const control = (id) => /** @type {HTMLInputElement} */ (byId(id));
const compact = window.matchMedia('(max-width: 1180px)');
const drawer = /** @type {HTMLDialogElement} */ (byId('sidePanel'));
const navigation = byId('navigation');
const detailPanel = byId('detail');
const navigationSlot = document.createComment('navigation');
const detailSlot = document.createComment('detail');
navigation.before(navigationSlot);
detailPanel.before(detailSlot);
const searchField = /** @type {HTMLElement} */ (byId('search').closest('label'));
const searchSlot = document.createComment('module-search');
searchField.before(searchSlot);
/** @type {HTMLElement | null} */
let drawerTrigger = null;
function restorePanel() {
  navigationSlot.after(navigation);
  detailSlot.after(detailPanel);
  control('toggleNav').setAttribute('aria-expanded', 'false');
  control('toggleDetail').setAttribute('aria-expanded', 'false');
}
/** @param {boolean} [restoreFocus] */
function closePanel(restoreFocus = true) {
  if (!drawer.open) return;
  drawer.close();
  restorePanel();
  if (restoreFocus) drawerTrigger?.focus();
}
/** @param {'navigation' | 'detail'} kind @param {HTMLElement} [trigger] */
function openPanel(kind, trigger) {
  if (!compact.matches) return;
  hideTooltips();
  closePanel(false);
  drawerTrigger = trigger ?? (kind === 'navigation' ? byId('toggleNav') : byId('toggleDetail'));
  drawer.dataset.panel = kind;
  byId('sidePanelTitle').textContent = kind === 'navigation' ? '模块' : '证据详情';
  byId('sidePanelBody').append(kind === 'navigation' ? navigation : detailPanel);
  control(kind === 'navigation' ? 'toggleNav' : 'toggleDetail').setAttribute('aria-expanded', 'true');
  drawer.showModal();
  (kind === 'navigation' ? byId('search') : byId('closePanels')).focus();
}
function responsivePanels() {
  closePanel(false);
  if (compact.matches) navigation.prepend(searchField);
  else searchSlot.after(searchField);
  network.redraw();
}
/** @type {(callback: () => void, delay?: number) => () => void} */
const throttleInput = (callback, delay = 250) => {
  let timer = 0;
  return () => {
    clearTimeout(timer);
    timer = window.setTimeout(callback, delay);
  };
};

/** @type {import('vis-network').DataSet<import('vis-network').Node>} */
let graphNodes = new window.vis.DataSet();
/** @type {import('vis-network').DataSet<import('vis-network').Edge>} */
let graphEdges = new window.vis.DataSet();
const network = new window.vis.Network(
  byId('graph'),
  { nodes: graphNodes, edges: graphEdges },
  {
    nodes: {
      shape: 'box',
      margin: { top: 12, right: 12, bottom: 12, left: 12 },
      font: { size: 14 },
      widthConstraint: { maximum: 190 },
      borderWidth: 1,
      chosen: { node: true, label: false },
    },
    edges: {
      arrows: { to: { enabled: true, scaleFactor: 0.6 } },
      smooth: { enabled: true, type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.35 },
    },
    layout: { improvedLayout: false },
    physics: false,
    interaction: {
      hover: true,
      dragNodes: true,
      hideEdgesOnDrag: false,
      hideNodesOnDrag: false,
      selectConnectedEdges: false,
      keyboard: { enabled: true, bindToWindow: false },
    },
  },
);
function hideTooltips() {
  for (const tooltip of document.querySelectorAll('#graph .vis-tooltip'))
    /** @type {HTMLElement} */ (tooltip).style.visibility = 'hidden';
}
byId('graph').addEventListener('pointerleave', hideTooltips);
network.on('dragStart', hideTooltips);

/** @param {import('./model.mjs').DependencyGraph} graph @param {boolean} [fit] */
function setGraph(graph, fit = false) {
  const changed = state.graph !== graph || graphNodes.length === 0;
  state.graph = graph;
  const selected = state.selected;
  const theme = getComputedStyle(document.documentElement);
  const color = (/** @type {string} */ name) => theme.getPropertyValue(name).trim();
  const cycles = layeredDependencies(graph).groups.filter((group) => group.members.length > 1);
  const positions = changed ? dependencyPositions(graph) : new Map();
  const nodes = graph.nodes.map((node) => {
    const cycle = cycles.find((group) => group.members.includes(node.id));
    const related =
      !selected ||
      node.id === selected ||
      graph.edges.some(
        (edge) => (edge.source === selected && edge.target === node.id) || (edge.target === selected && edge.source === node.id),
      );
    const tooltip = document.createElement('div');
    text('strong', node.label, tooltip);
    text(
      'p',
      `依赖 ${graph.edges.filter((edge) => edge.source === node.id).length} 个节点 · 使用方 ${graph.edges.filter((edge) => edge.target === node.id).length} 个节点`,
      tooltip,
    );
    if (cycle) text('p', `循环关联：${cycle.members.length} 个模块`, tooltip);
    return {
      id: node.id,
      label: node.label,
      title: tooltip,
      color: {
        background: node.id === selected ? color('--accent') : color('--surface'),
        border: node.id === selected ? color('--accent') : color('--graph-border'),
        highlight: {
          background: node.id === selected ? color('--accent') : color('--accent-soft'),
          border: color('--accent'),
        },
        hover: { background: node.id === selected ? color('--accent') : color('--raised'), border: color('--accent') },
      },
      font: {
        size: 14,
        color: related ? (node.id === selected ? color('--on-accent') : color('--text')) : color('--muted'),
      },
      borderDashes: Boolean(cycle),
      ...positions.get(node.id),
    };
  });
  const edges = graph.edges.map((edge, index) => {
    const related = !selected || edge.source === selected || edge.target === selected;
    return {
      id: index,
      from: edge.source,
      to: edge.target,
      title: edge.count + ' 条证据',
      width: selected && related ? 2 : 1,
      color: {
        color: selected && related ? color('--accent') : color('--graph-line'),
        highlight: color('--accent'),
        hover: color('--accent'),
        opacity: related ? 0.65 : 0.06,
      },
    };
  });
  if (changed) {
    graphNodes = new window.vis.DataSet(nodes);
    graphEdges = new window.vis.DataSet(edges);
    network.setData({ nodes: graphNodes, edges: graphEdges });
  } else {
    graphNodes.update(nodes);
    graphEdges.update(edges);
  }
  byId('graphStatus').textContent = graph.nodes.length + ' 个节点 · ' + graph.edges.length + ' 组模块关系 · 有向分层：上层在上，基础层在下';
  if (fit && graph.nodes.length) {
    const positions = network.getPositions();
    const sinks = graph.nodes.filter((node) => !graph.edges.some((edge) => edge.source === node.id));
    const focus = /** @type {import('./model.mjs').GraphNode} */ (
      (sinks.length ? sinks : graph.nodes)
        .slice()
        .sort(
          (a, b) => graph.edges.filter((edge) => edge.target === b.id).length - graph.edges.filter((edge) => edge.target === a.id).length,
        )[0]
    );
    const point = /** @type {{x:number,y:number}} */ (positions[focus.id]);
    network.moveTo({
      position: { x: point.x, y: point.y - byId('graph').clientHeight / 2 + 80 },
      scale: 1,
      animation: false,
    });
  }
}

async function refreshGraph() {
  const reportId = state.reportId;
  const params = {
    mode: control('mode').value,
    basis: control('basis').value,
    scope: control('scope').value,
    kind: control('kind').value,
    relationScope: control('relationScope').value,
  };
  const defaultGraph =
    params.mode === 'module' &&
    params.basis === 'usage' &&
    params.scope === 'production' &&
    params.kind === 'all' &&
    params.relationScope === 'source';
  try {
    const graph = defaultGraph ? state.overview.graph : await api(reportUrl('/graph?' + queryString(params)));
    if (state.reportId !== reportId || queryString(selection()) !== queryString(params)) return;
    if (params.mode === 'exploration' && !state.overview.exploration)
      byId('graphStatus').textContent = '本次扫描未生成探索分组；可从命令行使用 scan --graphify。';
    state.graphSource = graph;
    renderGraphDirection(true);
    renderEntries();
  } catch (error) {
    showError(error);
  }
}

function renderEntries() {
  const query = control('search').value.trim().toLowerCase();
  const parent = byId('entries');
  parent.replaceChildren();
  const moduleMode = control('mode').value === 'module';
  const candidates = moduleMode
    ? state.overview.modules.map((module) => ({
        id: module.id,
        label: module.title,
        description: module.path,
        count: module.fileCount,
      }))
    : state.graphSource.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        description: node.title ?? node.id,
        count: null,
      }));
  const modules = candidates.filter((node) => `${node.id} ${node.label} ${node.description}`.toLowerCase().includes(query));
  for (const module of modules) {
    const entry = action(parent, module.count === null ? module.label : `${module.label} · ${module.count}`, () => {
      if (moduleMode) void selectModule(module.id);
      else {
        closePanel(false);
        state.selected = module.id;
        renderGraphDirection();
        void showFile(module.id);
      }
    });
    entry.className = 'entry';
    entry.title = module.id;
    entry.setAttribute('aria-pressed', String(module.id === state.selected));
  }
  if (!modules.length) text('p', '没有匹配的模块，请调整查找内容。', parent, 'empty-list');
  byId('listCount').textContent = `${modules.length} / ${candidates.length} 个${moduleMode ? '模块' : '节点'}`;
}

/** @param {string} id */
async function selectModule(id) {
  const reportId = state.reportId;
  const version = ++state.detailVersion;
  const fromNavigation = drawer.open && drawer.dataset.panel === 'navigation';
  if (fromNavigation) {
    closePanel(false);
    byId('graph').focus();
  }
  state.selected = id;
  state.selectedFile = '';
  network.selectNodes([id], false);
  renderEntries();
  renderGraphDirection();
  try {
    const detail = await api(reportUrl(`/modules/${encodeURIComponent(id)}?` + queryString(selection())));
    if (state.selected !== id || state.reportId !== reportId || version !== state.detailVersion) return;
    showModule(detail, null, !fromNavigation);
  } catch (error) {
    showError(error);
  }
}

/** @param {import('./model.mjs').ModuleDetail} detail @param {{source: string, target: string} | null} [pair] @param {boolean} [present] */
function showModule(detail, pair = null, present = true) {
  const panel = byId('detail');
  panel.replaceChildren();
  text('h2', detail.module.title, panel);
  text('small', `${detail.files.length} 个所属文件 · ${detail.module.path}`, panel, 'muted');
  const edges = pair ? detail.edges.filter((edge) => edge.source === pair.source && edge.target === pair.target) : detail.edges;
  const neighbors = new Map();
  for (const edge of edges) {
    const neighbor = edge.source === detail.module.id ? edge.target : edge.source;
    const item = neighbors.get(neighbor) ?? { incoming: 0, outgoing: 0, edges: [] };
    if (edge.source === detail.module.id) item.outgoing += edge.references.length;
    else item.incoming += edge.references.length;
    item.edges.push(edge);
    neighbors.set(neighbor, item);
  }
  text('h3', pair ? '关系证据' : '上下游关系', panel);
  for (const [neighbor, item] of neighbors) {
    const title = state.overview.modules.find((module) => module.id === neighbor)?.title ?? neighbor;
    const section = document.createElement('section');
    section.className = 'evidence-group';
    text('h3', `${title} · ${item.outgoing ? `依赖 ${item.outgoing}` : ''}${item.incoming ? ` 使用 ${item.incoming}` : ''}`, section);
    for (const edge of item.edges)
      for (const reference of edge.references) {
        const row = document.createElement('details');
        text(
          'summary',
          `${kindLabel(reference.kind)} · ${reference.source}:${reference.line ?? '—'} → ${reference.target}:${reference.targetLine ?? '—'}`,
          row,
        );
        text('p', `${reference.symbols} · ${reference.dependencyClass ?? ''} · ${reference.parser}`, row);
        for (const evidence of reference.evidence ?? [])
          action(row, `${evidence.path}:${evidence.line ?? '—'} · ${evidence.text}`, () => showFile(evidence.path, evidence.line));
        action(row, `${reference.source}:${reference.line ?? '—'}`, () => showFile(reference.source, reference.line));
        section.appendChild(row);
      }
    panel.appendChild(section);
  }
  text('h3', '所属文件', panel);
  for (const file of detail.files.slice(0, 100)) action(panel, file.path, () => showFile(file.path));
  if (detail.files.length > 100) text('p', `另有 ${detail.files.length - 100} 个文件，请在“文件”面板中查找。`, panel, 'muted');
  if (present) openPanel('detail');
}

/** @param {string} path @param {number} [line] */
/** @param {string} path @param {number | null} [line] */
async function showFile(path, line = 1) {
  try {
    const version = ++state.detailVersion;
    const reportId = state.reportId;
    state.selectedFile = path;
    const currentLine = line ?? 1;
    const detail = /** @type {import('./model.mjs').FileDetail} */ (await api(reportUrl('/files?' + queryString({ path }))));
    if (state.reportId !== reportId || state.selectedFile !== path || version !== state.detailVersion) return;
    const panel = byId('detail');
    const { file, declarations, events, edges } = detail;
    panel.replaceChildren();
    text('h2', file.path, panel);
    text('small', `${roleLabel(file.role)} · ${file.bytes} 字节 · SHA-256 ${file.hash}`, panel, 'muted');
    text('h3', '归属依据', panel);
    text('p', roleLabel(file.ownership.status), panel);
    for (const candidate of file.ownership.candidates) {
      text('p', `${candidate.module} · ${roleLabel(candidate.relation)}`, panel);
      for (const evidence of candidate.evidence)
        action(panel, `${evidence.path}:${evidence.line ?? '—'} · ${evidence.text}`, () => showFile(evidence.path, evidence.line));
    }
    for (const evidence of file.ownership.sharedEvidence ?? [])
      action(panel, `${evidence.path}:${evidence.line ?? '—'} · ${evidence.text}`, () => showFile(evidence.path, evidence.line));
    text('h3', '声明与消息', panel);
    for (const declaration of declarations)
      action(panel, `${declaration.line} · ${declaration.kind} · ${declaration.scope} / ${declaration.name}`, () =>
        showFile(path, declaration.line),
      );
    for (const event of events)
      action(panel, `${event.line} · ${event.role} · ${event.value ?? event.expression}`, () => showFile(path, event.line));
    text('h3', `关系与使用方 (${edges.length})`, panel);
    for (const edge of edges) {
      const row = document.createElement('details');
      text('summary', `${kindLabel(edge.kind)} · ${edge.source === path ? edge.target : edge.source}`, row);
      text('p', `${edge.symbols} · ${edge.dependencyClass ?? ''} · ${edge.parser}`, row);
      action(row, `${edge.source}:${edge.line ?? '—'}`, () => showFile(edge.source, edge.line));
      if (state.overview.files.some((item) => item.path === edge.target))
        action(row, `${edge.target}:${edge.targetLine ?? '—'}`, () => showFile(edge.target, edge.targetLine));
      panel.appendChild(row);
    }
    text('h3', '扫描时源码', panel);
    const source = text('pre', '', panel);
    if (file.text === null) source.textContent = '二进制资源';
    else
      for (const [index, value] of file.text.split('\n').entries()) {
        const row = text('span', `${index + 1}  ${value}`, source, 'source-line');
        row.dataset.current = String(index + 1 === currentLine);
      }
    source.scrollTop = Math.max(0, (currentLine - 4) * 21);
    if (!drawer.open) openPanel('detail');
  } catch (error) {
    showError(error);
  }
}

/** @param {import('./model.mjs').GraphEdge} edge */
async function showEdge(edge) {
  const version = ++state.detailVersion;
  const reportId = state.reportId;
  const sourceModule = edge.source,
    module = state.overview.modules.find((item) => item.id === sourceModule);
  if (!module) return showFile(edge.source);
  try {
    const detail = await api(reportUrl(`/modules/${encodeURIComponent(sourceModule)}?` + queryString(selection())));
    if (version !== state.detailVersion || state.reportId !== reportId) return;
    showModule(detail, edge);
  } catch (error) {
    showError(error);
  }
}

async function renderFiles() {
  const reportId = state.reportId;
  control('previousFiles').disabled = true;
  control('nextFiles').disabled = true;
  /** @type {Record<string, string | number>} */
  const params = {
    q: control('fileSearch').value.trim(),
    ownership: control('ownership').value,
    page: state.filePage,
  };
  if (control('scope').value !== 'all') params.role = control('scope').value;
  if (state.selected && control('mode').value === 'module') params.module = state.selected;
  try {
    const result = await api(reportUrl('/files?' + queryString(params)));
    if (
      state.reportId !== reportId ||
      state.filePage !== result.page ||
      control('fileSearch').value.trim() !== params.q ||
      control('ownership').value !== params.ownership
    )
      return;
    state.fileTotal = result.total;
    const table = document.createElement('table');
    const header = table.createTHead().insertRow();
    for (const label of ['文件', '角色', '归属', '物理行']) text('th', label, header);
    const body = table.createTBody();
    for (const file of result.items) {
      const row = body.insertRow();
      action(row.insertCell(), file.path, () => showFile(file.path));
      text('td', roleLabel(file.role), row);
      text(
        'td',
        `${roleLabel(file.ownership.status)}${file.ownership.owner ? ' · ' + (state.overview.modules.find((item) => item.id === file.ownership.owner)?.title ?? file.ownership.owner) : ''}`,
        row,
      );
      text('td', String(file.lines ?? '—'), row);
    }
    byId('fileTable').replaceChildren(table);
    if (!result.total) text('p', '没有匹配文件，请调整范围或查找内容。', byId('fileTable'), 'muted');
    byId('filesTitle').textContent = `文件 · ${result.total}`;
    byId('filePage').textContent = `${result.page} / ${Math.max(1, Math.ceil(result.total / result.pageSize))}`;
    /** @type {HTMLButtonElement} */ (byId('previousFiles')).disabled = result.page <= 1;
    /** @type {HTMLButtonElement} */ (byId('nextFiles')).disabled = result.page * result.pageSize >= result.total;
  } catch (error) {
    showError(error);
  }
}

function renderIssueCategories() {
  const select = control('issueCategory');
  select.replaceChildren();
  const emptyOption = /** @type {HTMLOptionElement} */ (text('option', '选择类别查看详情', select));
  emptyOption.value = '';
  const categories = byId('issueCategories');
  categories.replaceChildren();
  for (const category of state.overview.issueCategories) {
    const option = /** @type {HTMLOptionElement} */ (text('option', `${roleLabel(category.kind)} · ${category.count}`, select));
    option.value = category.kind;
    const card = text('section', '', categories, 'issue-category');
    action(card, `${roleLabel(category.kind)} · ${category.count} 条`, () => {
      select.value = category.kind;
      state.issuePage = 1;
      return renderIssues();
    });
    for (const sample of category.samples) text('p', `${sample.path}:${sample.line ?? '—'} · ${sample.message}`, card, 'muted');
  }
  byId('issues').replaceChildren();
  if (!state.overview.issueCategories.length) {
    byId('issueSummary').textContent = '本次扫描没有待核线索。';
    byId('issues').replaceChildren();
  }
}

async function renderIssues() {
  const reportId = state.reportId;
  const category = control('issueCategory').value;
  byId('issueCategories').hidden = Boolean(category);
  byId('allIssueCategories').hidden = !category;
  control('previousIssues').disabled = true;
  control('nextIssues').disabled = true;
  if (!category) {
    byId('issues').replaceChildren();
    byId('issueSummary').textContent = '选择类别查看对应线索。';
    byId('issuePage').textContent = '';
    return;
  }
  const params = { category, page: state.issuePage, q: control('issueSearch').value.trim() };
  try {
    const result = await api(reportUrl('/issues?' + queryString(params)));
    if (
      state.reportId !== reportId ||
      state.issuePage !== result.page ||
      control('issueCategory').value !== category ||
      control('issueSearch').value.trim() !== params.q
    )
      return;
    state.issueTotal = result.total;
    byId('issueSummary').textContent = `${roleLabel(category)} · ${result.total} 条待核线索`;
    const parent = byId('issues');
    parent.replaceChildren();
    if (!result.total) text('p', '没有匹配线索，请调整查找内容。', parent, 'muted');
    for (const issue of result.items) {
      const row = document.createElement('details');
      row.className = 'issue-category';
      text('summary', `${issue.path}${issue.line ? ':' + issue.line : ''} · ${roleLabel(issue.kind)}`, row);
      text('p', issue.message, row);
      text('small', `解析依据：${issue.parser}`, row, 'muted');
      if (state.overview.files.some((file) => file.path === issue.path))
        action(row, `${issue.path}:${issue.line ?? '—'}`, () => showFile(issue.path, issue.line ?? 1));
      for (const candidate of issue.candidates ?? [])
        action(row, `${candidate.path}:${candidate.line ?? '—'} · ${candidate.text}`, () => showFile(candidate.path, candidate.line ?? 1));
      parent.appendChild(row);
    }
    byId('issuePage').textContent = `${result.page} / ${Math.max(1, Math.ceil(result.total / result.pageSize))}`;
    /** @type {HTMLButtonElement} */ (byId('previousIssues')).disabled = result.page <= 1;
    /** @type {HTMLButtonElement} */ (byId('nextIssues')).disabled = result.page * result.pageSize >= result.total;
  } catch (error) {
    showError(error);
  }
}

async function renderCycles() {
  const parent = byId('cycleList');
  parent.replaceChildren();
  const cycles = /** @type {import('./model.mjs').Report['cycles']} */ (
    control('mode').value === 'exploration' ? [] : await api(reportUrl('/cycles?' + queryString(selection())))
  );
  text('p', `${cycles.length} 组循环关系`, parent, 'muted');
  for (const cycle of cycles) {
    const row = document.createElement('details');
    text('summary', `${cycle.category === 'source' ? '代码循环' : '窗口消息闭环'} · ${cycle.members.length} 个成员`, row);
    text('pre', cycle.chain.join(' → '), row);
    for (let index = 0; index < cycle.chain.length - 1; index++) {
      const source = cycle.chain[index],
        target = cycle.chain[index + 1];
      const edge = state.graph.edges.find((entry) => entry.source === source && entry.target === target);
      if (edge) action(row, `${source} → ${target}`, () => showEdge(edge));
    }
    parent.appendChild(row);
  }
}

function renderExports() {
  const parent = byId('exports');
  parent.replaceChildren();
  const choices = [
    ['facts.json', '完整 JSON'],
    ['ownership.csv', '归属 CSV'],
    ['dependencies', '依赖 CSV / DOT'],
    ['module-dependencies', '模块依赖 CSV / DOT'],
  ];
  for (const [file, label] of choices) {
    if (file === 'dependencies' || file === 'module-dependencies') {
      for (const relation of ['combined', 'source', 'communication'])
        for (const basis of ['usage', 'complete'])
          for (const extension of ['csv', 'dot']) {
            const suffix = (relation === 'combined' ? '' : '-' + relation) + (basis === 'usage' ? '-usage' : '');
            const prefix = file === 'module-dependencies' ? 'module-' : '';
            const link = /** @type {HTMLAnchorElement} */ (
              text('a', `${label} · ${relation} · ${basis} · ${extension.toUpperCase()}`, parent)
            );
            link.href = reportUrl(`/downloads/${prefix}dependencies${suffix}.${extension}`);
          }
    } else {
      const link = /** @type {HTMLAnchorElement} */ (text('a', label, parent));
      link.href = reportUrl('/downloads/' + file);
    }
  }
}

/** @param {Error & {status?: number, body?: {error?: string}}} error */
/** @param {any} error */
function showError(error) {
  if (error.status === 409 && error.body?.error === 'report_updated') {
    byId('statusBanner').hidden = false;
    byId('statusBanner').dataset.kind = 'failed';
    byId('statusBanner').textContent = '报告已更新，请载入最新报告。';
    byId('refreshReport').hidden = false;
    state.moduleCache.clear();
    return;
  }
  byId('statusBanner').hidden = false;
  byId('statusBanner').dataset.kind = 'failed';
  byId('statusBanner').textContent = error.message;
}

/** @param {any} status */
function showEmpty(status) {
  byId('statusBanner').hidden = true;
  byId('workspace').hidden = true;
  byId('emptyState').hidden = false;
  byId('emptyTitle').textContent =
    status.scan?.status === 'running' ? '正在生成报告' : status.lastRun?.status === 'failed' ? '最近一次扫描未完成' : '尚无报告';
  byId('emptyMessage').textContent =
    status.scan?.status === 'running'
      ? '扫描完成并通过输入校验后，报告会自动显示在这里。'
      : status.lastRun?.status === 'failed'
        ? '上次结果没有发布。检查失败原因后可以重新生成。'
        : '生成报告后，这里会显示全部模块关系。';
  const running = status.scan?.status === 'running';
  byId('scanProgress').hidden = !running;
  if (running)
    byId('scanProgress').textContent =
      `${status.scan.phase ?? '正在扫描'} · 已运行 ${status.scan.elapsedSeconds ?? 0} 秒 · ${status.scan.activity ?? ''}`;
  byId('scanFailure').hidden = status.lastRun?.status !== 'failed' && status.scan?.status !== 'failed';
  byId('scanError').textContent = [
    status.lastRun?.error ?? status.scan?.error,
    status.lastRun?.logPath ? `日志：${status.lastRun.logPath}` : '',
    status.lastRun?.logError,
  ]
    .filter(Boolean)
    .join('\n');
  control('startScan').disabled = running;
  control('startScan').textContent = running ? '正在生成' : status.lastRun?.status === 'failed' ? '重新生成' : '开始生成';
}

/** @param {string} id */
async function loadReport(id) {
  state.reportId = id;
  state.moduleCache.clear();
  state.overview = await api(reportUrl('/overview'));
  byId('emptyState').hidden = true;
  byId('workspace').hidden = false;
  const run = state.overview.run;
  byId('identity').textContent = `${String(run.head).slice(0, 8)} · ${run.completedAt} · 输入 ${String(run.digest).slice(0, 12)}`;
  const metricItems = [
    `${state.overview.metrics.modules} 个模块`,
    `${state.overview.metrics.files} 个维护文件`,
    `${state.overview.graph.edges.length} 组生产代码关系`,
    `${state.overview.metrics.coverage.declared + state.overview.metrics.coverage.shared}/${state.overview.metrics.coverage.productionFiles} 个生产文件归属明确`,
    `${state.overview.metrics.coverage.missing.length} 个归属待核文件 · ${state.overview.metrics.coverage.affectedReferences} 条受影响关系`,
  ];
  const metrics = byId('metrics');
  metrics.replaceChildren();
  for (const item of metricItems) text('span', item, metrics);
  renderEntries();
  renderExports();
  byId('ownershipSummary').textContent = Object.entries(state.overview.metrics.ownership)
    .map(([key, count]) => `${roleLabel(key)} ${count}`)
    .join(' · ');
  for (const option of [.../** @type {HTMLSelectElement} */ (byId('kind')).options].slice(1)) option.remove();
  for (const kind of state.overview.edgeKinds) {
    const option = /** @type {HTMLOptionElement} */ (text('option', kindLabel(kind), control('kind')));
    option.value = kind;
  }
  renderIssueCategories();
  state.selected = '';
  control('mode').value = 'module';
  control('relationScope').value = 'source';
  control('basis').value = 'usage';
  control('scope').value = 'production';
  state.graph = state.overview.graph;
  state.graphSource = state.graph;
  renderGraphDirection(true);
  await Promise.all([renderCycles(), renderFiles()]);
}

async function refreshStatus() {
  try {
    const status = await api('/api/status');
    byId('toolbar').hidden = !status.report;
    if (!status.report) byId('moreControls').hidden = true;
    byId('regenerate').hidden = !status.report;
    control('regenerate').disabled = status.scan?.status === 'running';
    if (status.report) {
      if (status.report.id !== state.reportId) await loadReport(status.report.id);
      byId('emptyState').hidden = true;
      byId('workspace').hidden = false;
      if (status.scan?.status === 'running') {
        byId('statusBanner').hidden = false;
        byId('statusBanner').dataset.kind = 'running';
        byId('statusBanner').textContent =
          `${status.scan.phase ?? '正在扫描'} · 已运行 ${status.scan.elapsedSeconds ?? 0} 秒 · ${status.scan.activity ?? ''} · 当前显示上次成功报告`;
      } else if (status.scan?.status === 'failed' || status.lastRun?.status === 'failed') {
        byId('statusBanner').hidden = false;
        byId('statusBanner').dataset.kind = 'failed';
        byId('statusBanner').textContent =
          `最近一次扫描失败，仍显示 ${String(status.report.head).slice(0, 8)} 的成功报告。${status.scan?.activity ?? ''}`;
      } else byId('statusBanner').hidden = true;
    } else {
      state.reportId = '';
      showEmpty(status);
      byId('identity').textContent = '';
      byId('metrics').replaceChildren();
    }
    clearInterval(state.timer);
    state.timer = window.setInterval(
      () => {
        void refreshStatus();
      },
      status.scan?.status === 'running' ? 1500 : 5000,
    );
  } catch (error) {
    showError(error);
  }
}

const beginScan = async () => {
  control('startScan').disabled = true;
  control('regenerate').disabled = true;
  try {
    await api('/api/scan', { method: 'POST' });
    await refreshStatus();
  } catch (error) {
    showError(error);
    await refreshStatus();
  }
};
byId('startScan').onclick = beginScan;
byId('regenerate').onclick = beginScan;
byId('refreshReport').onclick = () => {
  state.reportId = '';
  byId('refreshReport').hidden = true;
  void refreshStatus();
};
control('search').oninput = renderEntries;
for (const id of ['mode', 'relationScope', 'basis', 'scope', 'kind'])
  control(id).onchange = () => {
    clearSelection();
    void refreshGraph();
    void renderCycles();
    state.filePage = 1;
    void renderFiles();
  };
control('direction').onchange = () => renderGraphDirection();
control('moreToggle').onclick = () => {
  const open = byId('moreControls').hidden;
  byId('moreControls').hidden = !open;
  byId('moreToggle').setAttribute('aria-expanded', String(open));
};
byId('overview').onclick = () => {
  clearSelection();
  renderGraphDirection(true);
};
function clearSelection() {
  ++state.detailVersion;
  state.selected = '';
  state.selectedFile = '';
  network.unselectAll();
  renderEntries();
  renderGraphDirection();
  const panel = byId('detail');
  panel.replaceChildren();
  text('h2', '证据详情', panel);
  text('p', '选择模块或关系查看依据和源码。', panel);
  panel.scrollTop = 0;
  state.filePage = 1;
  void renderFiles();
}
byId('fit').onclick = () => {
  network.fit({ animation: false });
};
byId('readableZoom').onclick = () => network.moveTo({ scale: 1, animation: false });
byId('toggleNav').onclick = () => {
  openPanel('navigation', byId('toggleNav'));
};
byId('toggleDetail').onclick = () => {
  openPanel('detail', byId('toggleDetail'));
};
byId('fileSearch').oninput = throttleInput(() => {
  state.filePage = 1;
  void renderFiles();
});
control('ownership').onchange = () => {
  state.filePage = 1;
  void renderFiles();
};
byId('previousFiles').onclick = () => {
  state.filePage = Math.max(1, state.filePage - 1);
  void renderFiles();
};
byId('nextFiles').onclick = () => {
  state.filePage++;
  void renderFiles();
};
byId('issueCategory').onchange = () => {
  state.issuePage = 1;
  void renderIssues();
};
byId('allIssueCategories').onclick = () => {
  control('issueCategory').value = '';
  state.issuePage = 1;
  void renderIssues();
};
byId('issueSearch').oninput = throttleInput(() => {
  state.issuePage = 1;
  void renderIssues();
});
byId('previousIssues').onclick = () => {
  state.issuePage = Math.max(1, state.issuePage - 1);
  void renderIssues();
};
byId('nextIssues').onclick = () => {
  state.issuePage++;
  void renderIssues();
};
const contentTabs = [...document.querySelectorAll('#sectionTabs [role="tab"]')];
for (const [index, tab] of contentTabs.entries()) {
  /** @type {HTMLElement} */ (tab).tabIndex = tab.getAttribute('aria-selected') === 'true' ? 0 : -1;
  /** @type {HTMLElement} */ (tab).onclick = () => {
    for (const other of contentTabs) {
      other.setAttribute('aria-selected', String(other === tab));
      /** @type {HTMLElement} */ (other).tabIndex = other === tab ? 0 : -1;
    }
    for (const panel of document.querySelectorAll('.content-panel'))
      /** @type {HTMLElement} */ (panel).hidden = panel.id !== tab.getAttribute('aria-controls');
  };
  /** @type {HTMLElement} */ (tab).onkeydown = (event) => {
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % contentTabs.length
        : event.key === 'ArrowLeft'
          ? (index + contentTabs.length - 1) % contentTabs.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? contentTabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const target = /** @type {HTMLElement} */ (contentTabs[next]);
    target.click();
    target.focus();
  };
}
byId('closePanels').onclick = () => {
  ++state.detailVersion;
  closePanel();
};
drawer.addEventListener('cancel', (event) => {
  event.preventDefault();
  ++state.detailVersion;
  closePanel();
});
drawer.addEventListener('click', (event) => {
  if (event.target === drawer) {
    ++state.detailVersion;
    closePanel();
  }
});
compact.addEventListener('change', responsivePanels);
responsivePanels();
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  if (drawer.open) {
    event.preventDefault();
    ++state.detailVersion;
    closePanel();
    return;
  }
  const exports = /** @type {HTMLDetailsElement} */ (byId('exportMenu'));
  if (exports.open) {
    exports.open = false;
    /** @type {HTMLElement} */ (exports.querySelector('summary')).focus();
    return;
  }
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  clearSelection();
});
network.on('click', (/** @type {{nodes: (string | number)[], edges: (string | number)[]}} */ event) => {
  if (event.nodes.length) {
    const id = String(event.nodes[0]);
    if (control('mode').value === 'module') void selectModule(id);
    else {
      state.selected = id;
      renderEntries();
      renderGraphDirection();
      void showFile(id);
    }
  } else if (event.edges.length) void showEdge(/** @type {import('./model.mjs').GraphEdge} */ (state.graph.edges[Number(event.edges[0])]));
  else clearSelection();
});
document.addEventListener('pointerdown', (event) => {
  const menu = /** @type {HTMLDetailsElement} */ (byId('exportMenu'));
  if (menu.open && event.target instanceof Node && !menu.contains(event.target)) menu.open = false;
});
window.addEventListener('resize', () => network.redraw());
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => setGraph(state.graph));
void refreshStatus();

function renderGraphDirection(fit = false) {
  const direction = control('direction').value;
  const graph = state.graphSource;
  if (!state.selected || direction === 'both') return setGraph(graph, fit);
  const edges = graph.edges.filter((edge) => (direction === 'out' ? edge.source === state.selected : edge.target === state.selected));
  setGraph({ nodes: graph.nodes, edges }, fit);
}
