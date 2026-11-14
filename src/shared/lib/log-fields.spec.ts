import { expect, it, vi } from 'vitest';
import { logIdentity } from './log-fields';
import type { JavaDocumentEdit, JavaInspection, JavaSourceEdit, ResourceRef, SourceCatalogPayload, JsonFileContent } from '@/shared/types';

it('projects source sizes while retaining paths, revisions and categorical resource identities', () => {
  const source = 'class Sample {String value="私有正文";}';
  const edit: JavaSourceEdit = {
    file: 'M:/sample/Sample.java',
    version: 2,
    source,
    target: 'M:/sample/Next.java',
    edits: [{ from: 6, to: 12, text: 'Next' }],
  };
  const document: JavaDocumentEdit = { file: edit.file, version: 2, source, edits: [] };
  const inspection: JavaInspection = {
    purpose: 'source',
    project: 'sample',
    revision: 3,
    file: edit.file,
    version: 2,
    source,
    origin: null,
    binding: null,
    diagnostics: [],
    outline: [],
    locations: [],
  };
  const content: JsonFileContent = {
    content: { kind: 'object', value: [] },
    source: '{"private":"正文"}',
    original: { root: 0, nodes: [] },
  };
  const resource: ResourceRef = {
    source: 'reference',
    relPath: 'graphics/sample.png',
    ownerKind: 'ship',
    ownerId: 'sample',
    key: 'sprite',
  };
  const catalog: SourceCatalogPayload = { sessionId: 'sample', source: 'csv:ships.name' };
  for (const value of [edit, document, inspection, content]) {
    const fields = logIdentity(value);
    expect(fields.sourceCharacters).toBe(String(value.source!.length));
    expect(JSON.stringify(fields)).not.toContain('正文');
    expect(fields).not.toHaveProperty('source');
  }
  expect(logIdentity({ files: [edit] })).toMatchObject({
    'files.count': '1',
  });
  expect(logIdentity({ source: { path: edit.file, source: 'core' }, resources: [resource] })).toMatchObject({
    'source.path': edit.file,
    'source.source': 'core',
    'resources.count': '1',
  });
  expect(logIdentity({ payload: catalog, catalogSource: catalog.source })).toMatchObject({
    'payload.sessionId': 'sample',
    catalogSource: 'csv:ships.name',
  });
});

it('records collection sizes with constant work across command, query, save and cache metadata', () => {
  const id = vi.fn(() => 'sample');
  const records = Array.from({ length: 10000 }, () => ({
    get id() {
      return id();
    },
  }));
  for (const value of [
    { result: records },
    { payload: { files: records } },
    { state: { rows: records } },
    { identity: { parameters: { rowKeys: records } } },
  ]) {
    expect(Object.keys(logIdentity(value))).toHaveLength(1);
  }
  expect(id).toHaveBeenCalledTimes(0);
});
