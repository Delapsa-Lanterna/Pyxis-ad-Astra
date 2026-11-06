import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { chromium } from 'playwright';
import { removeTestTree } from '../shared/test-workspace.mjs';
import { desktopConfiguration, stores, invoke, root } from './config.mjs';

export const delay = (/** @type {number} */ ms) => new Promise((done) => setTimeout(done, ms));
/** @param {() => Promise<unknown> | unknown} predicate @param {string} label @param {number} [timeout] */
export async function until(predicate, label, timeout = 30000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    if (await predicate()) return;
    await delay(50);
  }
  throw Error('Timed out waiting for: ' + label);
}
/** @param {import('playwright').Page} page @param {string} expression */
export async function waitFor(page, expression) {
  await until(() => page.evaluate(expression), expression);
}

/** @param {{exe:string,artifacts:string,errors:string[],resources:{released:boolean,desktops:{name:string,pid:number,released:boolean}[]}}} options */
export async function startDesktop(options) {
  const config = await desktopConfiguration();
  const roaming = resolve(process.env.APPDATA ?? '', config.identifier);
  /** @type {[string, string]} */
  const directories = [roaming, resolve(process.env.LOCALAPPDATA ?? '', config.identifier)];
  /** @type {string[]} */
  const owned = [];
  /** @type {import('playwright').Browser | undefined} */
  let browser;
  /** @type {import('playwright').Page | undefined} */
  let main;
  /** @type {import('node:child_process').ChildProcess | undefined} */
  let child;
  let exited = Promise.resolve();
  /** @type {string[]} */
  const output = [];
  const nativeDesktop = { name: '', pid: 0, released: false };
  options.resources.desktops.push(nativeDesktop);
  async function close() {
    try {
      if (child?.exitCode === null && main && !main.isClosed()) {
        await main.evaluate('setTimeout(()=>{void ' + invoke + '("request_close",{scope:{kind:"application"}})},0)');
        await until(
          async () => {
            if (child?.exitCode !== null) return true;
            for (const page of browser?.contexts()[0]?.pages() ?? []) {
              const discard = page.getByRole('button', { name: /放弃/ });
              try {
                if (await discard.count()) await discard.first().click();
              } catch (error) {
                if (!page.isClosed()) throw error;
              }
            }
            return false;
          },
          'normal desktop application close',
          15000,
        );
      } else if (child?.exitCode === null && child.pid) {
        child.stdin?.end('close\n');
        await until(() => child?.exitCode !== null, 'startup window close', 15000);
      }
      await exited;
      if (nativeDesktop.name) {
        await promisify(execFile)(
          'pwsh',
          ['-NoProfile', '-File', resolve(root, 'scripts/desktop/desktop-host.ps1'), '-VerifyDesktop', nativeDesktop.name],
          { windowsHide: true },
        );
        nativeDesktop.released = true;
      }
      assert.equal(child?.exitCode ?? 0, 0, 'Desktop application exit code');
    } finally {
      try {
        await browser?.close();
      } catch (error) {
        options.resources.released = false;
        options.errors.push('Debugging connection release: ' + String(error));
      }
      if (child?.pid) {
        try {
          await writeFile(
            join(options.artifacts, 'application-' + nativeDesktop.pid + '.log'),
            await readFile(join(roaming, 'pyxis-ad-astra.log'), 'utf8'),
            'utf8',
          );
        } catch (error) {
          if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'ENOENT') options.errors.push('Application log: ' + String(error));
        }
      }
      if (!child?.pid || child.exitCode !== null) {
        for (const directory of owned) {
          let errors = await removeTestTree(directory);
          for (let retry = 0; errors.length && retry < 20; retry++) {
            await delay(100);
            errors = await removeTestTree(directory);
          }
          options.errors.push(...errors.map((error) => error.message));
          if (errors.length) options.resources.released = false;
        }
      } else {
        child.unref();
        options.resources.released = false;
        options.errors.push('Desktop process still owns its test directories: ' + child.pid);
      }
      await writeFile(join(options.artifacts, 'process-' + (child?.pid ?? 'startup') + '.log'), output.join(''), 'utf8');
    }
  }
  try {
    const port = createServer();
    await new Promise((done, reject) => {
      port.once('error', reject);
      port.listen(config.port, '127.0.0.1', () => port.close(done));
    });
    for (const directory of directories) {
      await mkdir(directory);
      owned.push(directory);
    }
    child = spawn(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        resolve(root, 'scripts/desktop/desktop-host.ps1'),
        '-Executable',
        options.exe,
        '-Log',
        join(options.artifacts, 'native-' + Date.now() + '.log'),
      ],
      {
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, WEBVIEW2_USER_DATA_FOLDER: join(directories[1], 'profile-' + Date.now()) },
      },
    );
    assert.ok(child.stdout);
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.startsWith('DESKTOP_START ')) Object.assign(nativeDesktop, JSON.parse(line.slice(14)));
    });
    child.stdout?.on('data', (data) => output.push(String(data)));
    child.stderr?.on('data', (data) => output.push(String(data)));
    /** @type {Error | undefined} */
    let launchError;
    child.once('error', (error) => {
      launchError = error;
    });
    exited = new Promise((done) => child?.once('close', () => done()));
    await until(
      async () => {
        if (launchError) throw launchError;
        if (child?.exitCode !== null) throw Error('Desktop application exited before the WebView was ready: ' + child?.exitCode);
        try {
          browser = await chromium.connectOverCDP(config.endpoint, { timeout: 1000 });
          return true;
        } catch (error) {
          output.push(String(error) + '\n');
          return false;
        }
      },
      'desktop debugging connection',
      15000,
    );
    assert.ok(browser);
    const connected = browser;
    const context = connected.contexts()[0];
    assert.ok(context);
    const observe = (/** @type {import('playwright').Page} */ page) => {
      page.on('pageerror', (error) => options.errors.push(error.message));
      page.on('console', (message) => {
        if (['warning', 'error'].includes(message.type())) options.errors.push(message.type() + ': ' + message.text());
      });
    };
    context.pages().forEach(observe);
    context.on('page', observe);
    await until(() => {
      main = context.pages().find((page) => page.url().startsWith('http://tauri.localhost'));
      return main;
    }, 'main desktop page');
    assert.ok(main);
    const page = main;
    await waitFor(page, 'document.querySelector("#app")?.__vue_app__?.config?.globalProperties?.$pinia?._s?.has("workspace")');
    const session = await context.newCDPSession(page);
    const environment = {
      browser: connected.version(),
      nativeDesktop,
      ...(await page.evaluate('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})')),
    };
    return { main: page, context, session, environment, config, close };
  } catch (error) {
    try {
      await close();
    } catch (release) {
      options.errors.push('Release: ' + String(release));
    }
    throw error;
  }
}

/** @param {import('playwright').Page} page @param {string} mod @param {string} game @param {string} table */
export async function openMod(page, mod, game, table) {
  const manifest = await page.evaluate(
    invoke + '("open_project_session",{payload:{modRoot:' + JSON.stringify(mod) + ',starsectorRoot:' + JSON.stringify(game) + '}})',
  );
  await page.evaluate(
    'window.__desktopTarget=' +
      JSON.stringify(manifest) +
      ';const stores=' +
      stores +
      ';const manifest=window.__desktopTarget;stores.get("project").registerProjectManifest(manifest);stores.get("csv-editor").initializeModTables({sessionId:manifest.sessionId,modRoot:manifest.modRoot,manifest});stores.get("workspace").registerMod({modRoot:manifest.modRoot,displayName:"Desktop sample",version:"1",status:"ready"});stores.get("csv-editor").switchTab(manifest.modRoot,' +
      JSON.stringify(table) +
      ');stores.get("workspace").activateModTable(manifest.modRoot);',
  );
  return manifest;
}
