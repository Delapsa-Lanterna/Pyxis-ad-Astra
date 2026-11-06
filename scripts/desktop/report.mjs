import { createHash } from 'node:crypto';
import { readFile, unlink, mkdir } from 'node:fs/promises';
import { dirname, resolve, basename, join } from 'node:path';
import { reserveTestOutput, TestWorkspace } from '../shared/test-workspace.mjs';
import { cacheDirectory } from './config.mjs';

/** @param {string} path */
export async function fileHash(path) {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

/** @param {string | undefined} output */
export async function reserveReport(output) {
  const directory = output ? dirname(resolve(output)) : (await TestWorkspace.create(join(cacheDirectory, 'reports'), 'run')).root;
  const path = output ? resolve(output) : join(directory, 'report.json');
  const json = await reserveTestOutput(path);
  let markdown;
  try {
    markdown = await reserveTestOutput(path.replace(/\.json$/, '') + '.md');
  } catch (error) {
    await json.handle.close();
    await unlink(path);
    throw error;
  }
  const artifacts = join(directory, basename(path, '.json') + '-artifacts');
  try {
    await mkdir(artifacts);
  } catch (error) {
    await json.handle.close();
    await markdown.handle.close();
    await unlink(path);
    await unlink(markdown.path);
    throw error;
  }
  return {
    path,
    artifacts,
    /** @param {{suite:string,pass:boolean,checks:{name:string,milliseconds:number,pass?:boolean}[],errors:string[],[key:string]:unknown}} report */
    async finish(report) {
      const lines = [
        '# 桌面测试报告',
        '',
        '场景：' + report.suite,
        '',
        '判定：' + (report.pass ? '通过' : '失败'),
        '',
        '运行信息：',
        '',
        '```json',
        JSON.stringify(
          Object.fromEntries(Object.entries(report).filter(([key]) => !['checks', 'samples', 'statistics', 'errors'].includes(key))),
          null,
          2,
        ),
        '```',
        '',
        '| 检查 | 结果 | 耗时 (ms) |',
        '|---|---|---:|',
        ...report.checks.map(
          (check) => '| ' + check.name + ' | ' + (check.pass === false ? '失败' : '通过') + ' | ' + check.milliseconds.toFixed(2) + ' |',
        ),
      ];
      if (report.errors.length) lines.push('', '诊断：', '', ...report.errors.map((error) => '- ' + error));
      if (report.statistics) lines.push('', '测量：', '', '```json', JSON.stringify(report.statistics, null, 2), '```');
      try {
        await json.handle.writeFile(JSON.stringify(report, null, 2) + '\n', 'utf8');
        await markdown.handle.writeFile(lines.join('\n') + '\n', 'utf8');
      } finally {
        await json.handle.close();
        await markdown.handle.close();
      }
    },
  };
}
