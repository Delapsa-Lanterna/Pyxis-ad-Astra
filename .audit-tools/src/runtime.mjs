import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dependencyCycles, projectDependencies, selectDependencies } from './dependency-graph.mjs';

export const toolRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const projectRoot = resolve(toolRoot, '..');
export const runtimeRoot = join(toolRoot, '.runtime');
export const outputRoot = join(toolRoot, 'output');
export const python = join(runtimeRoot, process.platform === 'win32' ? 'python/Scripts/python.exe' : 'python/bin/python');

export function environment() {
  return {
    ...process.env,
    CARGO_HOME: join(runtimeRoot, 'cache/cargo'),
    CARGO_TARGET_DIR: join(runtimeRoot, 'build/project'),
    npm_config_cache: join(runtimeRoot, 'cache/npm'),
    PIP_CACHE_DIR: join(runtimeRoot, 'cache/pip'),
    PLAYWRIGHT_BROWSERS_PATH: join(runtimeRoot, 'browsers'),
    XDG_CACHE_HOME: join(runtimeRoot, 'cache/xdg'),
    TEMP: join(runtimeRoot, 'work/tmp'),
    TMP: join(runtimeRoot, 'work/tmp'),
    PYTHONUTF8: '1',
    PYTHONDONTWRITEBYTECODE: '1',
  };
}

/** @param {string} command @param {string[]} args @param {{cwd?: string, logs?: string, name?: string, env?: NodeJS.ProcessEnv}} [options] */
export async function execute(command, args, options = {}) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const child = spawn(command, args, {
    cwd: options.cwd ?? projectRoot,
    env: { ...environment(), ...options.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  /** @type {Buffer[]} */
  const stdout = [];
  /** @type {Buffer[]} */
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const code = await new Promise((done, fail) => {
    child.once('error', fail);
    child.once('close', done);
  });
  const result = {
    command,
    args,
    cwd: options.cwd ?? projectRoot,
    startedAt,
    seconds: (performance.now() - started) / 1000,
    exitCode: code,
    stdout: Buffer.concat(stdout).toString('utf8'),
    stderr: Buffer.concat(stderr).toString('utf8'),
  };
  if (options.logs) {
    await mkdir(options.logs, { recursive: true });
    const name = options.name ?? 'command';
    await Promise.all([
      writeFile(join(options.logs, name + '.stdout.txt'), result.stdout, 'utf8'),
      writeFile(join(options.logs, name + '.stderr.txt'), result.stderr, 'utf8'),
      writeJson(join(options.logs, name + '.json'), { ...result, stdout: undefined, stderr: undefined }),
    ]);
  }
  if (code !== 0) throw new Error(`${command} ${args.join(' ')}\nexit=${code}\n${result.stderr || result.stdout}`);
  return result;
}

/** @param {string} path @param {unknown} value */
export async function writeJson(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

/** @param {string | Buffer} value */
export function hash(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** @param {string} parent @param {string} path */
export function ownedPath(parent, path) {
  const target = resolve(path),
    child = relative(resolve(parent), target);
  if (!child || child.startsWith('..') || isAbsolute(child)) throw new Error(`Outside owned directory: ${target}`);
  return target;
}

/** @param {string} root @param {string} operation */
export async function lock(root, operation) {
  await mkdir(root, { recursive: true });
  const path = join(root, 'active.lock');
  const handle = await open(path, 'wx').catch((error) => {
    if (error.code === 'EEXIST') throw new Error(`An audit operation owns ${path}; wait for its completion.`);
    throw error;
  });
  await handle.writeFile(JSON.stringify({ pid: process.pid, operation, startedAt: new Date().toISOString() }), 'utf8');
  return async () => {
    await handle.close();
    await rm(path);
  };
}

/** @param {string} root @param {string} id @param {string} directory */
export async function publish(root, id, directory) {
  await mkdir(root, { recursive: true });
  const current = join(root, 'current.json');
  const previous = existsSync(current) ? JSON.parse(await readFile(current, 'utf8')).id : null;
  await (
    await import('node:fs/promises')
  ).cp(directory, ownedPath(root, join(root, id)), { recursive: true, errorOnExist: true, force: false });
  const pointer = join(root, 'current.next.json');
  await writeJson(pointer, { id });
  await rename(pointer, current);
  await rm(directory, { recursive: true });
  if (previous) await rm(ownedPath(root, join(root, previous)), { recursive: true });
}

/**
 * @param {string} root
 * @param {number} [port]
 * @param {{runtimeRoot?: string, launchScan?: () => import('node:child_process').ChildProcess}} [options]
 */
export async function serve(root, port = 8766, options = {}) {
  const runtime = options.runtimeRoot ?? runtimeRoot;
  const { renderShell } = await import('./report.mjs');
  /** @type {any} */
  let scanState = null;
  /** @type {Map<string, Promise<import('./model.mjs').GraphIndex>>} */
  const graphIndexes = new Map();
  /** @param {import('node:http').ServerResponse} response @param {number} status @param {unknown} value */
  const sendJson = (response, status, value) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  /** @param {import('node:http').ServerResponse} response @param {number} status @param {string} code @param {string} message @param {Record<string, unknown>} [extra] */
  const sendError = (response, status, code, message, extra = {}) => sendJson(response, status, { error: code, message, ...extra });
  /** @returns {Promise<string | null>} */
  async function currentId() {
    if (!existsSync(join(root, 'current.json'))) return null;
    const pointer = JSON.parse(await readFile(join(root, 'current.json'), 'utf8'));
    if (typeof pointer.id !== 'string' || !/^[A-Za-z0-9._-]+$/.test(pointer.id)) throw new Error('Invalid current report pointer');
    return pointer.id;
  }
  /** @param {string} id @returns {Promise<{current: string | null, base: string | null}>} */
  async function reportBase(id) {
    const current = await currentId();
    if (current !== id) return { current, base: null };
    return { current, base: ownedPath(root, join(root, id)) };
  }
  /** @param {string} base @returns {Promise<import('./model.mjs').ReportOverview>} */
  async function overviewFor(base) {
    return JSON.parse(await readFile(join(base, 'overview.json'), 'utf8'));
  }
  /** @param {string} id @param {string} base @returns {Promise<import('./model.mjs').GraphIndex>} */
  async function graphIndexFor(id, base) {
    if (!graphIndexes.has(id)) {
      graphIndexes.clear();
      graphIndexes.set(
        id,
        readFile(join(base, 'graph-index.json'), 'utf8').then((source) => JSON.parse(source)),
      );
    }
    return /** @type {Promise<import('./model.mjs').GraphIndex>} */ (graphIndexes.get(id));
  }
  async function status() {
    const [id, lastRun] = await Promise.all([
      currentId().catch(() => null),
      existsSync(join(runtime, 'last-run.json'))
        ? readFile(join(runtime, 'last-run.json'), 'utf8')
            .then(JSON.parse)
            .catch(() => null)
        : null,
    ]);
    let report = null;
    if (id) report = await overviewFor(ownedPath(root, join(root, id))).catch(() => null);
    let active = null;
    if (existsSync(join(runtime, 'active.lock')))
      active = await readFile(join(runtime, 'active.lock'), 'utf8')
        .then(JSON.parse)
        .catch(() => ({ operation: 'unknown' }));
    const scan =
      scanState?.status === 'running'
        ? { ...scanState, elapsedSeconds: Math.floor((Date.now() - Date.parse(scanState.startedAt)) / 1000) }
        : active?.operation === 'scan'
          ? {
              status: 'running',
              phase: lastRun?.phase ?? '准备扫描',
              startedAt: active.startedAt,
              activity: lastRun?.activity ?? '',
              elapsedSeconds: Math.floor((Date.now() - Date.parse(active.startedAt)) / 1000),
            }
          : scanState;
    return {
      report: report ? { ...report.run, id, metrics: report.metrics } : null,
      scan,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            startedAt: lastRun.startedAt,
            completedAt: lastRun.completedAt,
            error: lastRun.error,
            logPath: lastRun.logPath,
            logError: lastRun.logError,
          }
        : null,
    };
  }
  function startScan() {
    const launch =
      options.launchScan ??
      (() =>
        spawn(process.execPath, [join(toolRoot, 'src/cli.mjs'), 'scan'], {
          cwd: projectRoot,
          env: environment(),
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        }));
    const child = launch();
    const startedAt = new Date().toISOString();
    scanState = { status: 'running', id: null, phase: '准备扫描', startedAt, activity: '正在启动扫描' };
    let stdoutBuffer = '',
      stderrBuffer = '';
    child.stdout?.on('data', (chunk) => {
      stdoutBuffer += chunk.toString('utf8');
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() ?? '';
      for (const line of lines) {
        const value = line.trim();
        if (!value) continue;
        scanState.activity = value.slice(0, 300);
        if (value.startsWith('Collect ')) scanState.phase = '收集文件';
        else if (value === 'Analyze frontend') scanState.phase = '分析前端';
        else if (value === 'Analyze Rust') scanState.phase = '分析 Rust';
        else if (value.startsWith('Render ')) scanState.phase = '整理并校验';
        else if (value === 'Publish verified report') scanState.phase = '发布报告';
      }
    });
    child.stderr?.on('data', (chunk) => {
      stderrBuffer = (stderrBuffer + chunk.toString('utf8')).slice(-5000);
      scanState.activity = stderrBuffer.trim().split(/\r?\n/).at(-1)?.slice(0, 300) ?? '正在处理扫描';
    });
    child.once('error', (error) => {
      scanState = {
        status: 'failed',
        startedAt,
        completedAt: new Date().toISOString(),
        error: error.message,
        activity: error.message,
      };
    });
    child.once('close', (code) => {
      const completedAt = new Date().toISOString();
      if (code === 0) {
        scanState = { status: 'success', startedAt, completedAt, phase: '发布完成', activity: '报告已发布' };
        graphIndexes.clear();
      } else {
        const error = stderrBuffer.trim() || `扫描命令退出，代码 ${code}`;
        scanState = {
          status: 'failed',
          startedAt,
          completedAt,
          error,
          activity: error.split(/\r?\n/).at(-1)?.slice(0, 300),
        };
      }
    });
    return child;
  }
  const server = createServer((request, response) => {
    void serveRequest(request, response).catch((error) => sendError(response, 500, 'request_failed', String(error)));
  });
  /** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
  async function serveRequest(request, response) {
    const url = new URL(/** @type {string} */ (request.url), 'http://localhost');
    let segments;
    try {
      segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      sendError(response, 400, 'invalid_path', '路径格式无效');
      return;
    }
    if (request.method === 'GET' && url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end(await renderShell());
      return;
    }
    if (segments[0] === 'api' && segments[1] === 'status' && request.method === 'GET') {
      try {
        sendJson(response, 200, await status());
      } catch (error) {
        sendError(response, 500, 'status_unavailable', String(error));
      }
      return;
    }
    if (segments[0] === 'api' && segments[1] === 'scan' && request.method === 'POST') {
      const origin = request.headers.origin;
      const host = request.headers.host;
      if (!host || !origin || origin !== `http://${host}` || !['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) {
        sendError(response, 403, 'origin_rejected', '只允许从本机报告页面启动扫描');
        return;
      }
      if (scanState?.status === 'running' || existsSync(join(runtime, 'active.lock'))) {
        sendError(response, 409, 'operation_active', '已有扫描或工具操作正在运行');
        return;
      }
      try {
        const child = startScan();
        sendJson(response, 202, { status: 'running', startedAt: scanState.startedAt });
        child.unref();
      } catch (error) {
        sendError(response, 500, 'scan_start_failed', String(error));
      }
      return;
    }
    if (segments[0] === 'api' && segments[1] === 'reports' && segments[2]) {
      const id = segments[2];
      if (!/^[A-Za-z0-9._-]+$/.test(id)) {
        sendError(response, 404, 'report_not_found', '报告不存在');
        return;
      }
      let base, current, summary;
      try {
        ({ base, current } = await reportBase(id));
        if (!base) {
          sendError(response, 409, 'report_updated', '报告已更新，请载入最新报告', { currentReportId: current });
          return;
        }
        summary = await overviewFor(base);
      } catch (error) {
        sendError(response, 404, 'report_not_found', String(error));
        return;
      }
      if (segments.length === 4 && segments[3] === 'overview' && request.method === 'GET') {
        sendJson(response, 200, summary);
        return;
      }
      if (segments.length === 4 && segments[3] === 'graph' && request.method === 'GET') {
        try {
          const mode = url.searchParams.get('mode') ?? 'module';
          const basis = url.searchParams.get('basis') ?? 'usage';
          const scope = url.searchParams.get('scope') ?? 'production';
          const kind = url.searchParams.get('kind') ?? 'all';
          const relationScope = url.searchParams.get('relationScope') ?? 'source';
          if (mode === 'exploration') {
            sendJson(response, 200, summary.exploration ?? { nodes: [], edges: [] });
            return;
          }
          const index = await graphIndexFor(id, base);
          const selected = selectDependencies(index.files, index.edges, { mode, basis, scope, kind, relationScope });
          const projected = projectDependencies(index.files, selected, mode);
          const grouped = new Map();
          for (const edge of projected) {
            const key = edge.source + '\0' + edge.target;
            const entry = grouped.get(key) ?? { source: edge.source, target: edge.target, count: 0, kinds: {} };
            entry.count++;
            entry.kinds[edge.reference.kind] = (entry.kinds[edge.reference.kind] ?? 0) + 1;
            grouped.set(key, entry);
          }
          const nodes =
            mode === 'module'
              ? summary.modules.map(({ id, title }) => ({ id, label: title }))
              : index.files
                  .filter((file) => (scope === 'all' || file.role === scope) && (mode !== 'rust' || file.path.endsWith('.rs')))
                  .map((file) => ({ id: file.path, label: file.path.split('/').at(-1), title: file.path }));
          sendJson(response, 200, { nodes, edges: [...grouped.values()] });
        } catch (error) {
          sendError(response, 400, 'graph_unavailable', String(error));
        }
        return;
      }
      if (segments.length === 4 && segments[3] === 'files' && request.method === 'GET') {
        try {
          const path = url.searchParams.get('path');
          if (path !== null) {
            const file = summary.files.find((entry) => entry.path === path);
            if (!file) {
              sendError(response, 404, 'file_not_found', '文件不属于此报告');
              return;
            }
            const detail = /** @type {import('./model.mjs').FileDetail} */ (
              JSON.parse(await readFile(join(base, 'files', hash(path) + '.json'), 'utf8'))
            );
            sendJson(response, 200, detail);
            return;
          }
          const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
          const role = url.searchParams.get('role') ?? 'all';
          const ownership = url.searchParams.get('ownership') ?? 'all';
          const module = url.searchParams.get('module');
          const matches = summary.files.filter(
            (file) =>
              (role === 'all' || file.role === role) &&
              (ownership === 'all' || file.ownership.status === ownership) &&
              (!module || file.ownership.owner === module || file.ownership.candidates.some((candidate) => candidate.module === module)) &&
              (
                file.path +
                ' ' +
                file.role +
                ' ' +
                file.ownership.status +
                ' ' +
                file.ownership.candidates.map((candidate) => candidate.module).join(' ')
              )
                .toLowerCase()
                .includes(query),
          );
          const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
          sendJson(response, 200, {
            page,
            pageSize: 100,
            total: matches.length,
            items: matches.slice((page - 1) * 100, page * 100),
          });
        } catch (error) {
          sendError(response, 500, 'file_read_failed', String(error));
        }
        return;
      }
      if (segments.length === 4 && segments[3] === 'issues' && request.method === 'GET') {
        const category = url.searchParams.get('category');
        if (!category || !summary.issueCategories.some((item) => item.kind === category)) {
          sendError(response, 400, 'issue_category_required', '请选择待核线索类别');
          return;
        }
        try {
          const all = /** @type {import('./model.mjs').Issue[]} */ (
            JSON.parse(await readFile(join(base, 'issues', hash(category) + '.json'), 'utf8'))
          );
          const query = (url.searchParams.get('q') ?? '').trim().toLowerCase();
          const matches = query
            ? all.filter((issue) =>
                `${issue.kind} ${issue.path} ${issue.message} ${issue.parser} ${(issue.candidates ?? []).map((candidate) => `${candidate.path} ${candidate.text}`).join(' ')}`
                  .toLowerCase()
                  .includes(query),
              )
            : all;
          const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
          sendJson(response, 200, {
            category,
            page,
            pageSize: 100,
            total: matches.length,
            items: matches.slice((page - 1) * 100, page * 100),
          });
        } catch (error) {
          sendError(response, 500, 'issue_read_failed', String(error));
        }
        return;
      }
      if (segments.length === 5 && segments[3] === 'modules' && request.method === 'GET') {
        const moduleId = segments[4];
        const module = summary.modules.find((entry) => entry.id === moduleId);
        if (!module) {
          sendError(response, 404, 'module_not_found', '模块不属于此报告');
          return;
        }
        try {
          const index = await graphIndexFor(id, base);
          const owners = new Map(index.files.map((file) => [file.path, file.ownership.owner]));
          const selected = selectDependencies(index.files, index.edges, {
            mode: url.searchParams.get('mode') ?? 'module',
            basis: url.searchParams.get('basis') ?? 'usage',
            scope: url.searchParams.get('scope') ?? 'production',
            kind: url.searchParams.get('kind') ?? 'all',
            relationScope: url.searchParams.get('relationScope') ?? 'source',
          });
          const related = selected.filter((edge) => owners.get(edge.source) === moduleId || owners.get(edge.target) === moduleId);
          const projected = projectDependencies(index.files, related, 'module');
          const groups = new Map();
          for (const edge of projected) {
            const key = edge.source + '\0' + edge.target;
            const group = groups.get(key) ?? { source: edge.source, target: edge.target, references: [] };
            group.references.push(edge.reference);
            groups.set(key, group);
          }
          sendJson(response, 200, {
            module,
            files: summary.files.filter((file) => file.ownership.owner === moduleId),
            edges: [...groups.values()],
          });
        } catch (error) {
          sendError(response, 500, 'module_read_failed', String(error));
        }
        return;
      }
      if (segments.length === 4 && segments[3] === 'cycles' && request.method === 'GET') {
        const index = await graphIndexFor(id, base);
        const selection = Object.fromEntries(url.searchParams);
        sendJson(response, 200, dependencyCycles(index.files, index.edges, selection));
        return;
      }
      if (segments.length === 5 && segments[3] === 'downloads' && request.method === 'GET') {
        const name = /** @type {string} */ (segments[4]);
        if (!/^(?:facts\.json|ownership\.csv|(?:module-)?dependencies(?:-(?:source|communication))?(?:-usage)?\.(?:csv|dot))$/.test(name)) {
          sendError(response, 404, 'download_not_found', '下载文件不存在');
          return;
        }
        try {
          const content = await readFile(join(base, name));
          response.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Disposition': `attachment; filename="${name}"`,
            'Cache-Control': 'no-store',
          });
          response.end(content);
        } catch (error) {
          sendError(response, 404, 'download_not_found', String(error));
        }
        return;
      }
      sendError(response, 404, 'route_not_found', '报告接口不存在');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      sendError(response, 405, 'method_not_allowed', '请求方法不支持');
      return;
    }
    try {
      const id = await currentId();
      if (!id) {
        sendError(response, 404, 'report_file_not_found', '当前没有报告文件');
        return;
      }
      const base = ownedPath(root, join(root, id));
      const requested = decodeURIComponent(url.pathname);
      const file = ownedPath(base, resolve(base, '.' + requested));
      const content = await readFile(file);
      const mime = file.endsWith('.html')
        ? 'text/html; charset=utf-8'
        : file.endsWith('.json')
          ? 'application/json; charset=utf-8'
          : file.endsWith('.csv')
            ? 'text/csv; charset=utf-8'
            : 'text/plain; charset=utf-8';
      response.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch (error) {
      sendError(response, 404, 'report_file_not_found', String(error));
    }
  }
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', () => done(undefined));
  });
  return server;
}

/** @param {boolean} graphify */
export function setupCommands(graphify) {
  const npmEntry = realpathSync(
    /** @type {string} */ (
      execFileSync(process.platform === 'win32' ? 'where.exe' : 'which', [process.platform === 'win32' ? 'npm.cmd' : 'npm'], {
        encoding: 'utf8',
      })
        .trim()
        .split(/\r?\n/)[0]
    ),
  );
  const npmCli = process.platform === 'win32' ? join(dirname(npmEntry), 'node_modules/npm/bin/npm-cli.js') : npmEntry;
  const commands = [
    {
      name: 'npm',
      command: process.execPath,
      args: [npmCli, 'ci', '--ignore-scripts'],
      cwd: projectRoot,
    },
    {
      name: 'rust-analyzer',
      command: process.execPath,
      args: [join(toolRoot, 'src/rust-semantic.mjs')],
      cwd: toolRoot,
    },
    {
      name: 'rust-syntax',
      command: process.execPath,
      args: [join(toolRoot, 'src/rust-syntax.mjs')],
      cwd: toolRoot,
    },
    {
      name: 'chromium',
      command: process.execPath,
      args: [join(projectRoot, 'node_modules/playwright/cli.js'), 'install', 'chromium'],
      cwd: toolRoot,
    },
  ];
  if (graphify)
    commands.push(
      { name: 'venv', command: 'python', args: ['-m', 'venv', join(runtimeRoot, 'python')], cwd: toolRoot },
      {
        name: 'graphify',
        command: python,
        args: ['-m', 'pip', 'install', '--disable-pip-version-check', '--no-input', '-r', join(toolRoot, 'requirements-graphify.lock')],
        cwd: toolRoot,
      },
    );
  return commands;
}

/** @param {boolean} [dryRun] @param {{runtimeRoot: string, outputRoot: string}} [storage] */
export async function cleanReports(dryRun = false, storage = { runtimeRoot, outputRoot }) {
  const release = dryRun ? async () => {} : await lock(storage.runtimeRoot, 'clean-reports');
  try {
    /** @type {string[]} */
    const files = [];
    /** @param {string} directory */
    async function collect(directory) {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = ownedPath(storage.outputRoot, join(directory, entry.name));
        if (entry.isDirectory()) await collect(path);
        else if (entry.isFile()) files.push(path);
      }
    }
    if (existsSync(storage.outputRoot)) await collect(storage.outputRoot);
    const lastRun = ownedPath(storage.runtimeRoot, join(storage.runtimeRoot, 'last-run.json'));
    if (existsSync(lastRun)) files.push(lastRun);
    let bytes = 0;
    for (const path of files) {
      bytes += (await stat(path)).size;
      console.log(`${dryRun ? 'Would remove' : 'Remove'} ${path}`);
      if (!dryRun) await rm(path);
    }
    const summary = { dryRun, files: files.length, bytes };
    console.log(JSON.stringify(summary));
    return summary;
  } finally {
    await release();
  }
}

export async function cleanRuntime(dryRun = false) {
  const release = dryRun ? async () => {} : await lock(runtimeRoot, 'clean');
  try {
    const targets = ['cache', 'build', 'work'].map((part) => ownedPath(runtimeRoot, join(runtimeRoot, part)));
    for (const path of targets) {
      console.log(`${dryRun ? 'Would remove' : 'Remove'} ${path}`);
      if (!dryRun && existsSync(path)) await rm(path, { recursive: true });
    }
    return targets;
  } finally {
    await release();
  }
}

export async function setup(graphify = false, dryRun = false) {
  const commands = setupCommands(graphify);
  if (dryRun) {
    console.log(JSON.stringify(commands, null, 2));
    return;
  }
  const release = await lock(runtimeRoot, 'setup');
  try {
    await mkdir(join(runtimeRoot, 'work/tmp'), { recursive: true });
    for (const entry of commands) {
      console.log(`Install ${entry.name}`);
      await execute(entry.command, entry.args, {
        cwd: entry.cwd,
        name: entry.name,
        logs: join(runtimeRoot, 'logs/setup'),
      });
    }
  } finally {
    await release();
  }
}
