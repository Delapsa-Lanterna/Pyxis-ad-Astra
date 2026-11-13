import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { until } from '../runtime.mjs';

/** @param {import('playwright').Page} page @param {Record<string,unknown>} action */
export async function javaProjectAction(page, action) {
  const invoke = /** @param {Record<string,unknown>} action */ (action) =>
    page.evaluate((action) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('java_project', { action }), action);
  if (action.kind === 'build') {
    let prepared = await invoke({ kind: 'refresh' });
    if (prepared.stale) {
      prepared = await invoke({ kind: 'sync', online: action.online });
      if (prepared.error) return prepared;
    }

    action = { ...action, configuration: prepared.configuration };
  }
  return invoke(action);
}

/** @param {import('./registry.mjs').DesktopCase} context */
export async function prepareJavaProject(context) {
  const { fixture, check, options } = context;
  if (!options.game) throw Error('Java project acceptance requires --game');
  const root = fixture.mod,
    source = join(root, 'source/main/Sample.java');
  await mkdir(join(root, 'source/main'), { recursive: true });
  await writeFile(source, 'class Sample {}');
  const info = JSON.parse(await readFile(fixture.descriptor, 'utf8'));
  await writeFile(fixture.descriptor, JSON.stringify({ ...info, jars: ['jars/sample.jar'] }));
  await writeFile(join(root, 'settings.gradle'), "rootProject.name='sample'");
  const build =
    "plugins { id 'java'; id 'distribution' }\nsourceSets.main.java.srcDirs=['source/main','generated']\njava { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }\ntasks.named('jar') { destinationDirectory=file('jars'); archiveFileName='sample.jar' }\ndistributions { main { contents { from('source/main') } } }";
  await writeFile(join(root, 'build.gradle'), build);
  const app = await context.launch();
  const selected = process.env.JAVA_PROJECT_TEST_JAVA;
  if (!selected) throw Error('Set JAVA_PROJECT_TEST_JAVA to a complete JDK 17 or newer');
  const environment = await app.main.evaluate(
    async ({ game, selected }) => {
      const invoke = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke,
        settings = await invoke('read_settings');
      const probe = await invoke('manage_java_analysis', {
        action: { kind: 'probe', javaPath: selected },
        operationKey: crypto.randomUUID(),
      });
      if (probe.error) throw Error(probe.error);
      await invoke('save_settings', {
        payload: {
          settings: { ...settings.value, starsectorRoot: game, javaExecutable: selected, logLevel: 'debug', logRotationSizeMiB: 32 },
        },
      });
      return probe.environment;
    },
    { game: options.game, selected },
  );
  const manifest = await app.main.evaluate(
    async ({ root, game }) => {
      const manifest = await Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_project_session', {
        payload: { modRoot: root, starsectorRoot: game },
      });
      const stores = Reflect.get(/** @type {HTMLElement} */ (globalThis.document.querySelector('#app')), '__vue_app__').config
        .globalProperties.$pinia._s;
      stores.get('project').registerProjectManifest(manifest);
      stores.get('csv-editor').initializeModTables({ sessionId: manifest.sessionId, modRoot: manifest.modRoot, manifest });
      stores.get('workspace').registerMod({ modRoot: manifest.modRoot, displayName: 'Desktop sample', version: '1', status: 'ready' });
      stores.get('workspace').activateModTab(manifest.modRoot);
      return manifest;
    },
    { root, game: options.game },
  );
  await app.main.getByRole('tab').filter({ hasText: 'Desktop sample' }).click();
  await app.main.getByRole('button', { name: '代码编辑器', exact: true }).click();
  await until(() => app.context.pages().length === 2, 'project code window');
  const page = app.context.pages().find((page) => page !== app.main);
  assert.ok(page);
  const action = /** @param {Record<string,unknown>} action */ (action) => javaProjectAction(page, action);
  await page.getByRole('region', { name: 'Java 工程设置' }).waitFor();
  await page.getByRole('switch', { name: '使用 Gradle' }).click();
  await page.locator('[aria-label="使用 Gradle"][aria-checked="true"]').waitFor();
  await until(() => page.getByRole('button', { name: '同步项目配置', exact: true }).isEnabled(), 'Gradle mode detection');
  const cdp = await app.context.newCDPSession(page);
  let memory;
  try {
    memory = await cdp.send('Runtime.getHeapUsage');
  } finally {
    await cdp.detach();
  }
  let snapshot = await action({ kind: 'read' });
  await check('shared Java selection, fixed target and real Gradle project model', async () => {
    assert.ok(Number(environment.version) >= 17);
    assert.equal(snapshot.target, '17');
    assert.equal(snapshot.mode, 'gradle');
    const previousTask = snapshot.taskId;
    await page.getByRole('button', { name: '同步项目配置', exact: true }).click();
    await until(
      async () => {
        snapshot = await action({ kind: 'read' });
        return snapshot.taskId !== previousTask && !snapshot.active && (snapshot.phase === 'succeeded' || snapshot.error);
      },
      'Gradle project model',
      90000,
    );
    assert.equal(snapshot.error, null, snapshot.error ?? 'sync succeeded');
    assert.equal(snapshot.stale, false);
    assert.equal(snapshot.sources.length, 2);
    assert.equal(snapshot.sourceCount, 1);
    assert.ok(snapshot.artifacts.some(/** @param {string} path */ (path) => path.endsWith('sample.jar')));
    assert.ok(snapshot.tasks.some((/** @type {{path:string}} */ task) => task.path === ':jar'));
    assert.equal(await readFile(join(root, 'build.gradle'), 'utf8'), build);
  });
  return { app, page, manifest, action, environment, snapshot, memory, build, source };
}

/** @param {import('./registry.mjs').DesktopCase} context */
export async function javaProject(context) {
  const { fixture, check, artifacts } = context;
  const { app, page, manifest, action, environment, snapshot, memory, build, source } = await prepareJavaProject(context);
  const root = fixture.mod;
  await check('same-window input survives synchronization and configuration changes invalidate the result', async () => {
    const installation = await app.main.evaluate(() =>
      Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('manage_java_analysis', {
        action: { kind: 'download' },
        operationKey: crypto.randomUUID(),
      }),
    );
    assert.equal(installation.installation, 'installed', installation.error ?? 'analysis dependencies ready');
    await app.main.evaluate(
      (input) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_code_editor', { input, key: crypto.randomUUID() }),
      { ...manifest, files: [{ path: source }] },
    );
    const text = page.getByRole('textbox', { name: '文件内容' });
    await page.getByRole('status').filter({ hasText: 'Java 分析就绪' }).waitFor();
    const analyzed = await page.evaluate(
      (file) =>
        Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('java_editor', {
          action: { kind: 'inspect', file, offset: 0, purpose: 'document' },
        }),
      source,
    );
    assert.equal(
      analyzed.result.diagnostics.filter(/** @param {{severity:string}} entry */ (entry) => entry.severity === 'error').length,
      0,
    );
    await text.fill('class Sample {int draft;}');
    await page.getByRole('button', { name: '打开代码总览', exact: true }).click();
    const synchronized = await action({ kind: 'sync', online: false });
    assert.equal(synchronized.error, null);
    await page.getByRole('tab').filter({ hasText: 'Sample.java' }).click();
    assert.match(await text.innerText(), /int draft/);
    await writeFile(join(root, 'build.gradle'), build.replaceAll('VERSION_17', 'VERSION_21'));
    assert.equal((await action({ kind: 'refresh' })).stale, true);
    const failed = await action({ kind: 'sync', online: false });
    assert.match(failed.output, /compile target must be 17/);
    await writeFile(join(root, 'build.gradle'), build);
  });
  await check('offline Wrapper absence is reported before startup and cancellation releases the Gradle process tree', async () => {
    await mkdir(join(root, 'gradle/wrapper'), { recursive: true });
    await writeFile(join(root, 'gradlew.bat'), '@echo off\r\nexit /b 1\r\n');
    await writeFile(
      join(root, 'gradle/wrapper/gradle-wrapper.properties'),
      'distributionUrl=https\\://example.invalid/gradle-pyxis-test-bin.zip\n',
    );
    const offline = await action({ kind: 'sync', online: false });
    assert.match(offline.error.message, /Gradle 缓存/);
    assert.equal(offline.phase, 'offlineFailed');
    await writeFile(join(root, 'gradlew.bat'), '@echo off\r\npowershell.exe -NoProfile -Command "Start-Sleep -Seconds 30"\r\n');
    const pending = action({ kind: 'sync', online: true });
    await until(async () => (await action({ kind: 'read' })).active, 'owned synchronization');
    const cancelled = await action({ kind: 'cancel' });
    await pending;
    assert.equal(cancelled.active, false);
    assert.equal(cancelled.phase, 'cancelled');
    assert.ok(cancelled.logPath);
    const directories = await readdir(join(cancelled.logPath, '..'));
    assert.ok(!directories.some((name) => name.endsWith('.work')));
  });
  await page.getByRole('button', { name: '打开代码总览', exact: true }).click();
  await page.screenshot({ path: join(artifacts, 'java-project-native.png') });
  const finalSession = await app.context.newCDPSession(page);
  let finalMemory;
  try {
    await finalSession.send('HeapProfiler.collectGarbage');
    finalMemory = await finalSession.send('Runtime.getHeapUsage');
  } finally {
    await finalSession.detach();
  }
  return { environment, model: snapshot, memory: { before: memory, after: finalMemory } };
}
