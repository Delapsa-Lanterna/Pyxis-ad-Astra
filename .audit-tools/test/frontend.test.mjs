import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { runtimeRoot } from '../src/runtime.mjs';
import { indexFrontendProject } from '../src/frontend-semantic.mjs';
import { assembleFrontend, indexFrontend } from '../src/frontend.mjs';
import { frontendSource } from '../src/frontend-source.mjs';

/** @param {Record<string,string>} sources @param {(project: ReturnType<typeof indexFrontendProject>, snapshot:import('../src/model.mjs').AuditInputSnapshot)=>Promise<void>} action */
async function fixture(sources, action) {
  await mkdir(join(runtimeRoot, 'work'), { recursive: true });
  const root = await mkdtemp(join(runtimeRoot, 'work/semantic fixture '));
  try {
    const config = {
      compilerOptions: {
        strict: true,
        module: 'ESNext',
        moduleResolution: 'Bundler',
        target: 'ES2023',
        types: [],
        paths: { '@/*': ['./src/*'] },
      },
      include: ['src/**/*'],
      vueCompilerOptions: { strictTemplates: true },
    };
    await writeFile(join(root, 'tsconfig.json'), JSON.stringify(config));
    for (const [file, text] of Object.entries(sources)) {
      await mkdir(join(root, file, '..'), { recursive: true });
      await writeFile(join(root, file), text, 'utf8');
    }
    const files = Object.entries(sources)
      .filter(([file]) => !file.startsWith('node_modules/'))
      .map(([path, text]) => ({
        path,
        text,
        role: 'production',
        hash: 'fixture',
        bytes: Buffer.byteLength(text),
        lines: text.split('\n').length,
        ownership: { status: /** @type {const} */ ('unmatched'), owner: null, candidates: [] },
      }));
    const snapshot = { root, files, head: 'fixture', digest: 'fixture' };
    const project = indexFrontendProject(snapshot, 'tsconfig.json');
    await action(project, snapshot);
  } finally {
    await rm(root, { recursive: true });
  }
}

test('official symbols follow aliases, reexports, methods and local shadowing', async () => {
  await fixture(
    {
      'src/data.ts': 'export function run() {} export const actions={save(){}};',
      'src/bridge.ts': "export {run,actions} from './data';",
      'src/main.ts':
        "import {run as execute,actions} from '@/bridge'; execute(); actions.save(); function local(){function execute(){} execute();}",
    },
    async (project) => {
      const calls = project.calls.filter((call) => call.path === 'src/main.ts');
      assert.ok(calls.some((call) => call.target.path === 'src/data.ts' && call.target.name === 'run'));
      assert.ok(calls.some((call) => call.target.path === 'src/data.ts' && call.target.name === 'save'));
      assert.ok(calls.some((call) => call.target.path === 'src/main.ts' && call.target.name === 'execute'));
      assert.ok(
        project.modules.some(
          (row) =>
            row.specifier === '@/bridge' &&
            row.targets.some(
              (/** @type {import('../src/frontend-semantic.mjs').SemanticTarget} */ target) => target.path === 'src/bridge.ts',
            ),
        ),
      );
    },
  );
});

test('official Vue mapping includes template functions, methods, components and skips string text', async () => {
  await fixture(
    {
      'src/data.ts': 'export function run(value:number){return value;} export const actions={save(){}};',
      'src/Child.vue': '<script setup lang="ts">defineProps<{title:number}>();</script><template><span>{{title}}</span></template>',
      'src/Panel.vue':
        '<script setup lang="ts">import {run,actions} from "./data"; import Child from "./Child.vue"; const title=run(1);</script><template><Child :title="title"/>{{run(2)}}<button @click="actions.save()">{{`size ${title}px`}}</button></template>',
    },
    async (project) => {
      const rows = project.records.filter((row) => row.path === 'src/Panel.vue' && row.zone === 'template');
      assert.ok(
        rows.some(
          (row) =>
            row.name === 'run' &&
            row.targets.some(
              (/** @type {import('../src/frontend-semantic.mjs').SemanticTarget} */ target) =>
                target.path === 'src/data.ts' && target.name === 'run',
            ),
        ),
      );
      assert.ok(
        rows.some(
          (row) =>
            row.name === 'save' &&
            row.targets.some(
              (/** @type {import('../src/frontend-semantic.mjs').SemanticTarget} */ target) =>
                target.path === 'src/data.ts' && target.name === 'save',
            ),
        ),
      );
      assert.ok(
        rows.some(
          (row) =>
            row.group === 'component' &&
            row.targets.some(
              (/** @type {import('../src/frontend-semantic.mjs').SemanticTarget} */ target) => target.path === 'src/Child.vue',
            ),
        ),
      );
      assert.equal(rows.filter((row) => ['size', 'px', '$'].includes(row.name)).length, 0);
    },
  );
});

test('protocol forwarding follows declaration identity through wrappers and excludes a local shadow', async () => {
  await fixture(
    {
      'node_modules/@tauri-apps/api/core.d.ts': 'export declare function invoke<T>(command:string,args?:unknown):Promise<T>;',
      'src/wire.ts':
        "import {invoke} from '@tauri-apps/api/core'; export function send(command:string){return invoke(command);} function local(){function send(value:string){} send('local_only');}",
      'src/main.ts': "import {send as dispatch} from './wire'; dispatch('read_item');",
    },
    async (project, snapshot) => {
      const result = await assembleFrontend(snapshot, [project], new Map());
      assert.equal(result.commands.filter((row) => row.value === 'read_item').length, 1);
      assert.equal(result.commands.filter((row) => row.value === 'local_only').length, 0);
    },
  );
});

test('missing configuration and dynamic values retain every original source position', async () => {
  await fixture({ 'src/main.ts': 'export const value=1;' }, async (project, snapshot) => {
    snapshot.files.push({
      path: 'outside.js',
      text: 'unknown.call();',
      role: 'production',
      hash: 'fixture',
      bytes: 15,
      lines: 1,
      ownership: { status: 'unmatched', owner: null, candidates: [] },
    });
    const result = await assembleFrontend(snapshot, [project], new Map());
    assert.ok(result.records.some((row) => row.path === 'outside.js' && row.state === 'outside-project'));
    assert.ok(result.issues.some((row) => row.path === 'outside.js' && row.line === 1));
  });
});

test('syntax diagnostics retain source lines and Vue script language', async () => {
  await fixture(
    {
      'src/main.ts': 'const value = ;',
      'src/Panel.vue': '<script setup lang="tsx">const view=<div/>;</script><template><div/></template>',
    },
    async (project) => {
      assert.ok(project.issues.some((issue) => issue.path === 'src/main.ts' && issue.line === 1 && issue.kind === 'parse'));
      assert.equal(project.issues.filter((issue) => issue.path === 'src/Panel.vue' && issue.kind === 'parse').length, 0);
    },
  );
});

test('template inventory uses expression syntax for nested string interpolation', () => {
  const source = frontendSource({ path: 'Panel.vue', text: '<template><span>{{`label ${value}px`}}</span></template>' });
  assert.deepEqual(
    source.sites.map((row) => row.name),
    ['value'],
  );
});

test('tuple labels and JSDoc parameter names retain their syntax role without value references', () => {
  const source = frontendSource({
    path: 'sample.ts',
    text: '/** @param {string} input */\nfunction run(input:string) {}\ntype Event = [label:boolean];',
  });
  assert.equal(source.sites.filter((row) => row.name === 'label').length, 0);
  assert.equal(source.sites.filter((row) => row.name === 'input').length, 1);
  assert.ok(source.sites.some((row) => row.name === 'Event'));
});

test('dynamic directive parameters map to identifier characters inside their brackets', async () => {
  const text =
    '<script setup lang="ts">import Child from "./Child.vue";const slot="title";const row={slot:"title"};</script><template><Child><template #[slot]>{{slot}}</template><template #[row.slot]/></Child></template>';
  await fixture({ 'src/Child.vue': '<template><slot name="title"/></template>', 'src/Panel.vue': text }, async (project) => {
    const identifiers = project.records.filter((row) => row.zone === 'template');
    assert.ok(identifiers.every((row) => text.slice(row.start, row.start + row.length) === row.name));
    assert.ok(identifiers.filter((row) => row.name === 'slot').every((row) => row.targets.length));
  });
});

test('finite mapped members keep official type contracts separate from declaration targets', async () => {
  await fixture(
    { 'src/main.ts': 'type Kind="left"|"right";declare const values:Record<Kind,number>; const current=values.left;' },
    async (project) => {
      const member = project.records.find((row) => row.name === 'left' && row.group === 'member');
      assert.equal(member.state, 'synthetic-contract');
      assert.equal(member.targets.length, 0);
      assert.ok(member.typeText.includes('Record'));
      assert.equal(member.valueTypeText, 'number');
      assert.ok(
        member.contractTargets.some(
          (/** @type {import('../src/frontend-semantic.mjs').SemanticTarget} */ target) => target.name === 'Record',
        ),
      );
    },
  );
});

test('destructuring source properties consume the source dictionary contract', async () => {
  await fixture({ 'src/main.ts': 'declare const values:Record<string,unknown>; const {field:local}=values;' }, async (project) => {
    const source = project.records.find((row) => row.name === 'field');
    assert.equal(source.group, 'member');
    assert.equal(source.state, 'indexed-contract');
    assert.ok(source.typeText.includes('Record'));
  });
});

test('typed validation boundaries expose the formal result and consumer signatures', async () => {
  await fixture(
    {
      'src/producer.ts':
        'export interface Confirmation { path:string; reason:string } export function rewriteFiles(error:unknown): Confirmation[] | null {return null;}',
      'src/consumer.ts': "import {rewriteFiles} from './producer'; const files=rewriteFiles({});",
    },
    async (project) => {
      const call = project.calls.find((row) => row.path === 'src/consumer.ts' && row.target?.name === 'rewriteFiles');
      assert.equal(call.target.path, 'src/producer.ts');
      const declaration = project.records.find((row) => row.path === 'src/producer.ts' && row.name === 'rewriteFiles');
      assert.equal(declaration.state, 'declaration');
    },
  );
});

test('dynamic module loading remains an actual dependency alongside structural imports', async () => {
  await fixture({ 'src/data.ts': 'export const value=1;', 'src/main.ts': 'const lazy=import("./data");' }, async (project, snapshot) => {
    const result = await assembleFrontend(snapshot, [project], new Map());
    assert.ok(
      result.edges.some(
        (edge) =>
          edge.source === 'src/main.ts' &&
          edge.target === 'src/data.ts' &&
          edge.kind === 'typescript-module' &&
          edge.dependencyClass === 'usage',
      ),
    );
  });
});

test('ambient build values retain their declarations as structural contracts', async () => {
  await fixture(
    { 'src/environment.d.ts': 'declare const BUILD_LABEL:string;', 'src/main.ts': 'export const label=BUILD_LABEL;' },
    async (project, snapshot) => {
      const row = project.records.find((row) => row.path === 'src/main.ts' && row.name === 'BUILD_LABEL');
      assert.equal(row.targets[0].path, 'src/environment.d.ts');
      assert.equal(row.targets[0].declarationScope, 'global');
      const result = await assembleFrontend(snapshot, [project], new Map());
      assert.ok(
        result.edges.some(
          (edge) => edge.source === 'src/main.ts' && edge.target === 'src/environment.d.ts' && edge.dependencyClass === 'structure',
        ),
      );
    },
  );
});

test('global component contracts preserve external and project implementation sources', async () => {
  await fixture(
    {
      'node_modules/sample-controls/index.d.ts': 'export declare const Panel:(props:{title?:string})=>any;',
      'src/Local.vue': '<template><span>Local</span></template>',
      'src/registry.d.ts':
        "import 'vue';import type {Panel} from 'sample-controls';import type Local from './Local.vue';declare module 'vue' {interface GlobalComponents {ThirdPanel:typeof Panel;ProjectPanel:typeof Local;}}",
      'src/Consumer.vue': '<template><ThirdPanel/><ProjectPanel/></template>',
    },
    async (project, snapshot) => {
      const third = project.records.find((row) => row.path === 'src/Consumer.vue' && row.name === 'ThirdPanel');
      const local = project.records.find((row) => row.path === 'src/Consumer.vue' && row.name === 'ProjectPanel');
      assert.equal(third.targets[0].declarationScope, 'augmentation');
      assert.equal(third.targets[0].valueTargets[0].path, 'node_modules/sample-controls/index.d.ts');
      assert.equal(local.targets[0].valueTargets[0].path, 'src/Local.vue');
      const result = await assembleFrontend(snapshot, [project], new Map());
      assert.ok(
        result.edges.some(
          (edge) => edge.source === 'src/Consumer.vue' && edge.target === 'src/registry.d.ts' && edge.dependencyClass === 'structure',
        ),
      );
      assert.ok(
        result.edges.some(
          (edge) => edge.source === 'src/Consumer.vue' && edge.target === 'src/Local.vue' && edge.dependencyClass === 'usage',
        ),
      );
    },
  );
});

test('exported declarations and typed module implementations keep actual usage edges', async () => {
  await fixture(
    {
      'src/api.d.ts': 'export declare function read():number;',
      'src/external.d.ts': 'declare module "external-api" {export function run():number;}',
      'src/worker.ts': 'export function work(){return 1;}',
      'src/main.ts':
        "import {read} from './api';import {work} from './worker';import {run} from 'external-api';export const values=[read(),work(),run()];",
    },
    async (project, snapshot) => {
      const result = await assembleFrontend(snapshot, [project], new Map());
      for (const target of ['src/api.d.ts', 'src/worker.ts', 'src/external.d.ts'])
        assert.ok(
          result.edges.some(
            (edge) =>
              edge.source === 'src/main.ts' &&
              edge.target === target &&
              edge.kind === 'typescript-call' &&
              edge.dependencyClass === 'usage',
          ),
        );
      assert.ok(
        project.records.some(
          (row) =>
            row.name === 'read' &&
            row.targets.some(
              (/** @type {import('../src/frontend-semantic.mjs').SemanticTarget} */ target) =>
                target.path === 'src/api.d.ts' && target.declarationScope === null,
            ),
        ),
      );
    },
  );
});

test('project scheduling excludes configuration bases and retains physical resource endpoints', async () => {
  await fixture(
    {
      'tsconfig.base.json': '{"compilerOptions":{"strict":true}}',
      'src/assets.d.ts': 'declare module "*.svg" { const value:string; export default value; }',
      'src/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'src/theme.css': '.panel { color: red; }',
      'src/main.ts': 'import icon from "@/icon.svg"; import "./theme.css"; export const image=icon;',
    },
    async (_project, snapshot) => {
      snapshot.files.push({
        path: 'tsconfig.json',
        text: await (await import('node:fs/promises')).readFile(join(snapshot.root, 'tsconfig.json'), 'utf8'),
        role: 'engineering',
        hash: 'fixture',
        bytes: 0,
        lines: 1,
        ownership: { status: 'unmatched', owner: null, candidates: [] },
      });
      const directory = join(snapshot.root, 'commands');
      await mkdir(directory);
      const result = await indexFrontend(snapshot, directory);
      assert.equal(result.engines.projects.length, 1);
      assert.equal(result.engines.projects[0].config, 'tsconfig.json');
      assert.ok(result.edges.some((edge) => edge.source === 'src/main.ts' && edge.target === 'src/icon.svg' && edge.kind === 'asset'));
      assert.ok(result.edges.some((edge) => edge.source === 'src/main.ts' && edge.target === 'src/theme.css' && edge.kind === 'asset'));
    },
  );
});
