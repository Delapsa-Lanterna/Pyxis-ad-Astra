import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, stat, readdir, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { until } from '../runtime.mjs';
import { startProcessSampler } from '../process-sampler.mjs';
import { prepareJavaProject, javaProjectAction } from './java-project.mjs';

/** @param {import('./registry.mjs').DesktopCase} context */
export async function javaBuild(context) {
  const { app, page, manifest, environment } = await prepareJavaProject(context);
  const result = await verifyJavaBuild(context, app, page, manifest);
  await context.check('manual project settings persist on input completion without a save button', async () => {
    await mkdir(join(context.fixture.mod, 'source/extra'), { recursive: true });
    await page.getByRole('textbox', { name: '工程源码目录' }).fill('source/main\nsource/second\nsource/extra');
    await page.getByRole('heading', { name: '工程配置', exact: true }).click();
    await until(
      async () => (await javaProjectAction(page, { kind: 'read' })).settings.sources.includes('source/extra'),
      'automatic project settings',
    );
    const snapshot = await javaProjectAction(page, { kind: 'read' });
    const files = await readdir(join(snapshot.logPath, '..'));
    const storedFile = files.find((path) => path.endsWith('.json'));
    assert.ok(storedFile);
    const stored = JSON.parse(await readFile(join(snapshot.logPath, '..', storedFile), 'utf8'));
    assert.deepEqual(stored.settings.sources, ['source/main', 'source/second', 'source/extra']);
    assert.equal(await page.getByRole('button', { name: '保存工程设置', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '打开 Java 设置', exact: true }).count(), 0);
  });
  await context.check('Gradle UI runs a non-Java task with project parameters and its actual output', async () => {
    const config = join(context.fixture.mod, 'build.gradle');
    await writeFile(
      config,
      "tasks.register('emitIndex') { group='assets'; description='Generate an asset index'; outputs.file('index.txt'); doLast { file('index.txt').text=providers.gradleProperty('message').get() } }",
    );
    await until(() => page.getByRole('button', { name: '检测环境', exact: true }).isEnabled(), 'settings acceptance before mode switch');
    await page.getByRole('switch', { name: '使用 Gradle' }).click();
    await page.locator('[aria-label="使用 Gradle"][aria-checked="true"]').waitFor();
    const sync = page.getByRole('button', { name: '同步项目配置', exact: true });
    await until(() => sync.isEnabled(), 'generic Gradle description');
    await sync.click();
    await until(() => sync.isEnabled(), 'generic Gradle tasks');
    const task = page
      .locator('.schema-field')
      .filter({ hasText: /^项目任务/ })
      .locator('.n-base-selection');
    for (const close of await task.locator('.n-tag__close').all()) await close.click();
    await task.click();
    await task.locator('input').fill(':emitIndex');
    await page
      .locator('.n-base-select-option:visible')
      .filter({ hasText: /^:emitIndex$/ })
      .click();
    await page.getByRole('heading', { name: '构建与部署', exact: true }).click();
    await page.getByRole('textbox', { name: 'Gradle 任务参数' }).fill('-Pmessage=sample value');
    const run = page.getByRole('button', { name: '运行 Gradle', exact: true });
    await run.click();
    await until(
      async () =>
        (await run.isEnabled()) && (await readFile(join(context.fixture.mod, 'index.txt'), 'utf8').catch(() => '')) === 'sample value',
      'generic Gradle result',
      90000,
    );
    const snapshot = await javaProjectAction(page, { kind: 'read' });
    assert.equal(snapshot.error, null);
    assert.equal(snapshot.selectedProject, null);
    assert.equal(snapshot.artifacts.length, 0);
    assert.ok(
      snapshot.tasks.some(
        (/** @type {{path:string,description:string}} */ task) =>
          task.path === ':emitIndex' && task.description === 'Generate an asset index',
      ),
    );
    assert.ok(snapshot.build.artifacts.some((/** @type {{path:string}} */ artifact) => artifact.path.endsWith('index.txt')));
    await page.screenshot({ path: join(context.artifacts, 'gradle-tasks-native.png') });
  });
  await context.check('failed model acquisition retains a structured diagnostic and the successful artifact', async () => {
    const previous = (await javaProjectAction(page, { kind: 'read' })).build.id;
    await writeFile(join(context.fixture.mod, 'build.gradle'), "plugins { id 'java' }");
    await writeFile(join(context.fixture.mod, 'gradlew.bat'), '@echo off\r\nexit /b 0\r\n');
    const failed = await javaProjectAction(page, { kind: 'sync', online: true });
    assert.equal(failed.phase, 'failed');
    assert.equal(failed.error.code, 'io.unexpected');
    assert.ok(failed.error.location.path.endsWith('model.json'));
    assert.equal(failed.build.id, previous);
  });
  await context.check('application close cancels and waits for the owned Gradle process tree', async () => {
    await writeFile(join(context.fixture.mod, 'build.gradle'), "plugins { id 'java' }");
    await writeFile(
      join(context.fixture.mod, 'gradlew.bat'),
      '@echo off\r\npowershell.exe -NoProfile -Command "Start-Sleep -Seconds 30"\r\n',
    );
    const pending = page
      .evaluate(() => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('java_project', { action: { kind: 'sync', online: true } }))
      .then(
        (snapshot) => ({ phase: snapshot.phase }),
        () => ({ phase: 'windowClosed' }),
      );
    await until(
      async () =>
        page.evaluate(async () => {
          const snapshot = await Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('java_project', { action: { kind: 'read' } });
          return snapshot.active && snapshot.logPath !== null;
        }),
      'owned Gradle before close',
    );
    await context.close(app);
    const completed = await pending;
    assert.ok(['cancelled', 'windowClosed'].includes(completed.phase));
    const log = await readFile(join(context.artifacts, 'application-' + app.environment.nativeDesktop.pid + '.log'), 'utf8');
    assert.match(log, /java_project.task_completed.*"phase":"cancelled"/);
    const records = /** @param {string} code */ (code) =>
      log
        .split('\n')
        .filter((line) => line.includes('[' + code + ']'))
        .map((line) => {
          const match = line.match(/\] (\{.*\}) process=/);
          assert.ok(match?.[1]);
          return JSON.parse(match[1]);
        });
    const started = records('java_project.task_started'),
      finished = records('java_project.task_completed');
    assert.ok(started.length > 0);
    assert.equal(started.length, finished.length);
    for (const task of started) assert.equal(finished.filter((result) => result.taskId === task.taskId).length, 1);
    assert.ok(finished.some((task) => task.exitCode === 0 && task.artifactBytes > 0));
    assert.match(log, /\[debug\] \[java_project.build_inputs\]/);
    assert.match(log, /\[warning\] \[java_project.task_failed\]/);
    assert.match(log, /\[error\] \[java_project.task_failed\]/);
    assert.ok(!log.includes('class Sample extends') && !log.includes('class Sample { Missing value; }'));
  });
  return { ...result, environment };
}

/** @param {import('./registry.mjs').DesktopCase} context @param {Awaited<ReturnType<typeof import('../runtime.mjs').startDesktop>>} app @param {import('playwright').Page} page @param {{sessionId:string,modRoot:string}} manifest */
export async function verifyJavaBuild(context, app, page, manifest) {
  const sampler = await startProcessSampler(app.environment.nativeDesktop.pid);
  try {
    await sampler.phase('build-deploy');
    const { fixture, check, artifacts } = context,
      root = fixture.mod,
      config = join(root, 'build.gradle'),
      source = join(root, 'source/main/Sample.java');
    const timings = /** @type {Record<string,unknown>[]} */ ([]);
    const action = /** @param {Record<string,unknown>} action */ async (action) => {
      const started = performance.now();
      const result = await javaProjectAction(page, action);
      if (action.kind === 'build') {
        timings.push({
          action,
          milliseconds: performance.now() - started,
          backendMs: result.milliseconds,
          phase: result.phase,
          artifacts: result.build?.artifacts,
        });
        await writeFile(join(artifacts, 'build-result-' + timings.length + '.json'), JSON.stringify(result, null, 2), 'utf8');
        if (result.logPath) await copyFile(result.logPath, join(artifacts, 'build-output-' + timings.length + '.log'));
      }
      return result;
    };
    const invoke = /** @param {string} command @param {Record<string,unknown>} args */ (command, args) =>
      page.evaluate(({ command, args }) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke(command, args), { command, args });
    const openText = /** @param {string} path */ async (path) => {
      const before = new Set(app.context.pages());
      await app.main.evaluate(
        ({ manifest, path }) =>
          Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('request_window', {
            payload: {
              identity: { type: 'text-editor', ...manifest, path },
              title: '文本编辑器',
              input: {
                kind: 'text-editor',
                location: { line: null, column: null, message: null, contextLabel: null, contextSeverity: null },
              },
              width: 1040,
              height: 760,
              minWidth: 780,
              minHeight: 520,
            },
          }),
        { manifest, path },
      );
      await until(() => app.context.pages().some((page) => !before.has(page)), 'text window');
      const text = app.context.pages().find((page) => !before.has(page));
      assert.ok(text);
      await text.getByRole('textbox', { name: '文件内容' }).waitFor();
      return text;
    };
    const hash = /** @param {string} path */ async (path) => {
      const bytes = await readFile(path);
      let value = 0xcbf29ce484222325n;
      for (const byte of bytes) value = BigInt.asUintN(64, (value ^ BigInt(byte)) * 0x100000001b3n);
      return bytes.length + ':' + value.toString(16).padStart(16, '0');
    };
    let built = await action({ kind: 'read' });
    await check('Gradle registers only the executed JAR, build and distribution outputs', async () => {
      for (const task of [':jar', ':build', ':distZip']) {
        built = await action({ kind: 'build', tasks: [task], arguments: [], online: false });
        assert.equal(built.error, null, built.output);
        assert.equal(built.exitCode, 0);
        assert.ok(built.build.artifacts.length);
        assert.ok(
          built.build.artifacts.some(
            /** @param {{path:string}} artifact */ (artifact) => artifact.path.endsWith(task === ':distZip' ? '.zip' : '.jar'),
          ),
        );
        for (const artifact of built.build.artifacts) assert.equal(await hash(artifact.path), artifact.fingerprint);
      }
    });
    await check('project Wrapper builds offline with the selected Java', async () => {
      const generated = await action({ kind: 'build', tasks: [':wrapper'], arguments: [], online: false });
      assert.equal(generated.error, null, generated.output);
      assert.ok((await stat(join(root, 'gradlew.bat'))).isFile());
      const wrapped = await action({ kind: 'build', tasks: [':jar'], arguments: [], online: false });
      assert.equal(wrapped.error, null, wrapped.output);
      assert.equal(wrapped.build.task, ':jar');
    });
    await check('cross-window confirmation preserves cancellation and rejects input changed after confirmation', async () => {
      await app.main.evaluate(
        (input) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_code_editor', { input, key: crypto.randomUUID() }),
        { ...manifest, files: [{ path: config }] },
      );
      const saved = await readFile(config, 'utf8');
      await page.getByRole('textbox', { name: '文件内容' }).fill(saved + '\n// window draft');
      const text = await openText(fixture.notes);
      await text.getByRole('textbox', { name: '文件内容' }).fill('Unsaved text window');
      await page.getByRole('button', { name: '打开代码总览', exact: true }).click();
      const task = page
        .locator('.schema-field')
        .filter({ hasText: /^项目任务/ })
        .locator('.n-base-selection');
      await task.click();
      await task.locator('input').fill(':jar');
      await page
        .locator('.n-base-select-option:visible')
        .filter({ hasText: /^:jar$/ })
        .click();
      await page.getByRole('heading', { name: '构建与部署', exact: true }).click();
      const build = page.getByRole('button', { name: '运行 Gradle', exact: true });
      await build.click();
      const dialog = app.main.getByRole('dialog').filter({ hasText: '保存并构建？' });
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /build.gradle/);
      assert.match(await dialog.innerText(), /notes.txt/);
      await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await until(() => build.isEnabled(), 'cancelled build');
      assert.equal(await readFile(config, 'utf8'), saved);
      assert.equal(await readFile(fixture.notes, 'utf8'), 'Initial text');
      await build.click();
      await dialog.waitFor();
      await text.getByRole('textbox', { name: '文件内容' }).fill('Changed after confirmation');
      await dialog.getByRole('button', { name: '保存并构建', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await until(() => build.isEnabled(), 'stale confirmation');
      assert.equal(await readFile(fixture.notes, 'utf8'), 'Initial text');
      const previous = (await action({ kind: 'read' })).build.id;
      await build.click();
      await dialog.waitFor();
      await dialog.getByRole('button', { name: '保存并构建', exact: true }).click();
      await page
        .getByRole('dialog')
        .filter({ hasText: '构建将更新游戏加载文件' })
        .getByRole('button', { name: '继续构建', exact: true })
        .click();
      await until(
        async () => {
          built = await action({ kind: 'read' });
          return built.build.id !== previous && !built.active;
        },
        'confirmed build',
        90000,
      );
      assert.equal(built.error, null, built.output);
      assert.equal(await readFile(fixture.notes, 'utf8'), 'Changed after confirmation');
      assert.equal(await readFile(config, 'utf8'), saved + '\n// window draft');
      await text.getByTitle('关闭', { exact: true }).click();
      await until(() => text.isClosed(), 'text window release');
    });
    await check('configuration synchronization captures drafts from a separate text window', async () => {
      await page.getByRole('button', { name: '关闭 build.gradle', exact: true }).click();
      const text = await openText(config),
        saved = await readFile(config, 'utf8');
      await text.getByRole('textbox', { name: '文件内容' }).fill(saved + '\n// synchronized draft');
      const sync = page.getByRole('button', { name: '同步项目配置', exact: true }),
        dialog = app.main.getByRole('dialog').filter({ hasText: '保存构建配置后同步？' });
      await sync.click();
      await dialog.waitFor();
      assert.match(await dialog.innerText(), /build.gradle/);
      await dialog.getByRole('button', { name: '继续编辑', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
      await until(() => sync.isEnabled(), 'synchronization cancelled');
      assert.equal(await readFile(config, 'utf8'), saved);
      await sync.click();
      await dialog.waitFor();
      await dialog.getByRole('button', { name: '保存并同步', exact: true }).click();
      await until(() => sync.isEnabled(), 'configuration synchronized', 90000);
      assert.equal(await readFile(config, 'utf8'), saved + '\n// synchronized draft');
      assert.equal((await action({ kind: 'read' })).error, null);
      await text.getByTitle('关闭', { exact: true }).click();
      await until(() => text.isClosed(), 'configuration window release');
    });
    await check('build cancellation waits for merged callers and releases its workspaces', async () => {
      const original = await readFile(config, 'utf8');
      await writeFile(config, original + "\ntasks.register('slowBuild') { group='build'; doLast { Thread.sleep(30000) } }");
      assert.equal((await action({ kind: 'sync', online: false })).error, null);
      const request = { kind: 'build', tasks: [':slowBuild'], arguments: [], online: false };
      const first = action(request),
        second = action(request);
      await until(async () => {
        const snapshot = await action({ kind: 'read' });
        return snapshot.active && snapshot.task === ':slowBuild';
      }, 'build process');
      const cancelled = await action({ kind: 'cancel' });
      assert.equal(cancelled.phase, 'cancelled');
      assert.equal(cancelled.active, false);
      assert.equal((await first).phase, 'cancelled');
      assert.equal((await second).phase, 'cancelled');
      assert.ok(!(await readdir(join(cancelled.logPath, '..'))).some((name) => name.endsWith('.work')));
    });
    await check('manual JDK compilation, repeat merging, failure retention and binary deployment history', async () => {
      await rm(config);
      await rm(join(root, 'settings.gradle'));
      await rm(join(root, 'gradlew.bat'));
      await rm(join(root, 'gradlew'));
      await rm(join(root, 'gradle/wrapper'), { recursive: true });
      await mkdir(join(root, 'source/second'), { recursive: true });
      await writeFile(source, 'class Sample extends com.fs.starfarer.api.BaseModPlugin { Helper value; }');
      await writeFile(join(root, 'source/second/Helper.java'), 'class Helper {}');
      const current = await action({ kind: 'read' });
      await action({
        kind: 'save',
        settings: { ...current.settings, buildMode: 'manual', sources: ['source/main', 'source/second'], primaryJar: 'jars/sample.jar' },
      });
      await writeFile(config, 'invalid Gradle script');
      const request = { kind: 'build', tasks: [], arguments: [], online: false };
      const [first, second] = await Promise.all([action(request), action(request)]);
      assert.equal(first.error, null, first.output);
      assert.equal(second.build.id, first.build.id);
      built = first;
      const artifact = built.build.artifacts[0],
        bytes = await readFile(artifact.path);
      assert.equal(await hash(artifact.path), artifact.fingerprint);
      assert.equal(built.build.inputsChanged, false);
      assert.equal(built.build.task, 'javac + jar');
      const preview = await invoke('preview_java_deployment', { artifact: artifact.id, target: 'jars/sample.jar' });
      const before = await readFile(join(root, 'jars/sample.jar'));
      const save = /** @param {Record<string,unknown>} action */ async (action) => {
        const request = { request: { id: crypto.randomUUID(), edits: [], action } },
          started = performance.now();
        const result = await invoke('save_project', request);
        timings.push({
          action: action.kind,
          milliseconds: performance.now() - started,
          requestBytes: Buffer.byteLength(JSON.stringify(request)),
          responseBytes: Buffer.byteLength(JSON.stringify(result)),
        });
        return result;
      };
      const deployed = await save({ kind: 'deploy_java_artifact', input: preview.request });
      assert.deepEqual(await readFile(join(root, 'jars/sample.jar')), bytes);
      const undo = await save({
        kind: 'apply_file_change_set',
        input: { ...manifest, direction: 'undo', entryId: deployed.history.undoStack.at(-1).id, revision: deployed.history.revision },
      });
      assert.deepEqual(await readFile(join(root, 'jars/sample.jar')), before);
      await save({
        kind: 'apply_file_change_set',
        input: { ...manifest, direction: 'redo', entryId: undo.history.redoStack.at(-1).id, revision: undo.history.revision },
      });
      assert.deepEqual(await readFile(join(root, 'jars/sample.jar')), bytes);
      const unchanged = await invoke('preview_java_deployment', { artifact: artifact.id, target: 'jars/sample.jar' });
      const noop = await save({ kind: 'deploy_java_artifact', input: unchanged.request });
      assert.equal(noop.changes.length, 0);
      const changeJava = /** @param {string|null} path */ (path) =>
        app.main.evaluate(async (path) => {
          const invoke = Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke,
            settings = await invoke('read_settings');
          await invoke('save_settings', { payload: { settings: { ...settings.value, javaExecutable: path } } });
        }, path);
      await changeJava(null);
      const incomplete = await action(request);
      assert.match(incomplete.error.message, /完整 JDK/);
      assert.equal(incomplete.build.id, built.build.id);
      await changeJava(process.env.JAVA_PROJECT_TEST_JAVA ?? null);
      await writeFile(source, 'class Sample { Missing value; }');
      const failed = await action(request);
      assert.equal(failed.phase, 'failed');
      assert.match(failed.output, /Missing/);
      assert.ok(
        failed.locations.some(
          /** @param {{path:string,line:number}} location */ (location) => location.path.endsWith('Sample.java') && location.line === 1,
        ),
      );
      assert.equal(failed.build.id, built.build.id);
      assert.deepEqual(await readFile(artifact.path), bytes);
      await writeFile(artifact.path, Buffer.from('modified artifact'));
      await assert.rejects(invoke('preview_java_deployment', { artifact: artifact.id, target: 'jars/sample.jar' }));
      await writeFile(source, 'class Sample extends com.fs.starfarer.api.BaseModPlugin { Helper value; }');
      built = await action(request);
      assert.equal(built.error, null, built.output);
      assert.equal(await stat(artifact.path).catch(() => null), null);
      const storedFile = (await readdir(join(built.logPath, '..'))).find((path) => path.endsWith('.json'));
      assert.ok(storedFile);
      const stored = JSON.parse(await readFile(join(built.logPath, '..', storedFile), 'utf8'));
      assert.equal(stored.build.id, built.build.id);
      const installation = await app.main.evaluate(() =>
        Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('manage_java_analysis', {
          action: { kind: 'download' },
          operationKey: crypto.randomUUID(),
        }),
      );
      assert.equal(installation.installation, 'installed', installation.error ?? 'Java analysis installed');
      await app.main.evaluate(
        (input) => Reflect.get(globalThis, '__TAURI_INTERNALS__').invoke('open_code_editor', { input, key: crypto.randomUUID() }),
        { ...manifest, files: [{ path: source }] },
      );
      await page.getByRole('status').filter({ hasText: 'Java 分析就绪' }).waitFor();
      const inspect = () => invoke('java_editor', { action: { kind: 'inspect', file: source, offset: 0, purpose: 'document' } });
      const beforeAnalysis = (await inspect()).result.revision;
      await page.getByRole('button', { name: '打开代码总览', exact: true }).click();
      await page.getByRole('button', { name: '检测环境', exact: true }).click();
      await until(() => page.getByRole('button', { name: '使用 javac 编译并生成 JAR', exact: true }).isEnabled(), 'updated overview');
      const output = page.getByRole('region', { name: '工程任务与产物' });
      await output.getByRole('button', { name: '部署', exact: true }).click();
      await page.getByRole('dialog').filter({ hasText: '部署 Java 产物？' }).getByRole('button', { name: '部署', exact: true }).click();
      await until(async () => (await hash(join(root, 'jars/sample.jar'))) === built.build.artifacts[0].fingerprint, 'UI deployment');
      await until(() => output.getByRole('button', { name: '部署', exact: true }).isEnabled(), 'deployment acceptance');
      await until(async () => {
        const response = await inspect();
        return response.result.revision > beforeAnalysis;
      }, 'deployed JAR analysis refresh');
      for (const close of await page.locator('.n-message .n-message__close').all()) await close.click();
      await page.locator('.n-message').waitFor({ state: 'hidden' });
      await page.screenshot({ path: join(artifacts, 'java-build-native.png') });
    });
    const cdp = await app.context.newCDPSession(page);
    let memory;
    try {
      await cdp.send('HeapProfiler.collectGarbage');
      memory = await cdp.send('Runtime.getHeapUsage');
    } finally {
      await cdp.detach();
    }
    await copyFile(built.build.artifacts[0].path, join(artifacts, 'sample.jar'));
    await copyFile(built.logPath, join(artifacts, 'manual-build.log'));
    return {
      build: built.build,
      artifactSha256: createHash('sha256')
        .update(await readFile(built.build.artifacts[0].path))
        .digest('hex'),
      timings,
      logBytes: (await stat(built.logPath)).size,
      memory,
      processes: sampler.statistics('build-deploy'),
    };
  } finally {
    await sampler.close();
    await writeFile(
      join(context.artifacts, 'build-processes.json'),
      JSON.stringify({ environment: sampler.environment, samples: sampler.samples }, null, 2),
      'utf8',
    );
  }
}
