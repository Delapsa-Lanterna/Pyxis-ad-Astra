import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { architectureFixtures } from '../../../testing/fixtures.mjs';
import { schemaModuleBoundaryRule } from './schema-module-boundary.mjs';

test('CSV defaults accept the existing schema assets and keep source positions', () => {
  const source = 'src-tauri/src/domain/csv_column_order.rs';
  for (const expression of [
    '"../../../schemas/csv/ships.schema.json"',
    'r#"../../../schemas/csv/ships.schema.json"#',
    '/* before */ "../../../schemas/csv/ships.schema.json", /* after */',
  ]) {
    const context = architectureFixtures({ [source]: '\nfn columns(){let asset=include_str!(' + expression + ');}' });
    assert.deepEqual(schemaModuleBoundaryRule.check(context), []);
    const facts = context.byPath.get(source)?.rust.embeddedAssets;
    assert.equal(facts?.length, 1);
    assert.equal(facts?.[0]?.path, 'schemas/csv/ships.schema.json');
    assert.equal(facts?.[0]?.line, 2);
    assert.ok((facts?.[0]?.column ?? 0) > 0);
  }
});
test('CSV defaults reject an independent column asset and a missing schema source', () => {
  const source = 'src-tauri/src/domain/csv_column_order.rs';
  for (const code of ['\nfn columns(){let asset=include_str!("../../../schemas/alternate-columns.json");}', 'fn columns(){}']) {
    const context = architectureFixtures({ [source]: code });
    const [diagnostic] = schemaModuleBoundaryRule.check(context);
    assert.equal(diagnostic?.ruleId, 'schema-module-boundary');
    assert.equal(diagnostic?.file, source);
    assert.equal(diagnostic?.expected, 'schemas/csv/*.schema.json');
    assert.ok((diagnostic?.line ?? 0) > 0);
    assert.ok((diagnostic?.column ?? 0) > 0);
  }
});
test('comments, source strings and test-only embedded assets do not become production dependencies', () => {
  const source = 'src-tauri/src/domain/csv_column_order.rs';
  const code =
    '// include_str!("fake.json")\nfn columns(){let text=r#"include_str!("fake.json")"#;let asset=include_str!("../../../schemas/csv/ships.schema.json");}\n#[cfg(test)] mod tests{fn sample(){let asset=include_str!("test.json");}}';
  const context = architectureFixtures({ [source]: code });
  assert.deepEqual(schemaModuleBoundaryRule.check(context), []);
  assert.equal(context.byPath.get(source)?.rust.embeddedAssets.length, 1);
});
test('CSV display sorting consumes its schema registry and rejects another JSON authority', () => {
  const source = 'src/domain/csv-editor/csv-column-schema.ts';
  const legal = architectureFixtures({
    [source]: 'import {getCsvColumnSchemas} from "@/domain/schema/csv-schema-registry";',
    'src/domain/schema/csv-schema-registry.ts': 'export function getCsvColumnSchemas(){}',
  });
  assert.deepEqual(schemaModuleBoundaryRule.check(legal), []);
  const invalid = architectureFixtures({
    [source]: '\nimport data from "../../../schemas/alternate-columns.json";',
    'schemas/alternate-columns.json': '{}',
  });
  const [diagnostic] = schemaModuleBoundaryRule.check(invalid);
  assert.equal(diagnostic?.ruleId, 'schema-module-boundary');
  assert.equal(diagnostic?.line, 2);
  assert.equal(diagnostic?.target, 'schemas/alternate-columns.json');
  assert.equal(diagnostic?.expected, 'schema registry');
});

test('generated CSV sources retain the build directory and output identity', () => {
  const source = 'src-tauri/src/domain/csv_column_order.rs';
  const code = 'fn columns(){include!(concat!(env!("OUT_DIR"), "/csv_schemas.rs"));}';
  const build = readFileSync(new URL('../../../../../src-tauri/build.rs', import.meta.url), 'utf8');
  const legal = architectureFixtures({ [source]: code, 'src-tauri/build.rs': build });
  assert.deepEqual(schemaModuleBoundaryRule.check(legal), []);
  assert.equal(legal.byPath.get(source)?.rust.embeddedAssets[0]?.macro, 'include');
  for (const changed of [
    '',
    build.replace('bundle_schemas("../schemas/csv", "csv_schemas.rs")', 'bundle_schemas("../schemas", "csv_schemas.rs")'),
    build.replace('bundle_schemas("../schemas/csv", "csv_schemas.rs")', 'bundle_schemas("../schemas/csv", "other.rs")'),
    build.replace('fs::read_dir(directory)', 'fs::read_dir("../schemas")'),
    build.replace('.join(filename)', '.join("other.rs")'),
  ]) {
    const context = architectureFixtures({ [source]: code, 'src-tauri/build.rs': changed });
    assert.equal(schemaModuleBoundaryRule.check(context).length, 1);
  }
  for (const hidden of ['// ' + code, 'fn hidden(){let text=r#"' + code + '"#;}', '#[cfg(test)] mod tests{' + code + '}']) {
    const context = architectureFixtures({ [source]: hidden, 'src-tauri/build.rs': build });
    assert.equal(schemaModuleBoundaryRule.check(context).length, 1);
  }
});
