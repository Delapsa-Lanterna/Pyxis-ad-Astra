import type {
  CsvDraftRow,
  CsvValidationContext,
  CsvTableIndex,
  CsvTableKey,
  CsvValidationRequest,
  DeepReadonly,
  EntityKind,
  FieldProblem,
  JointEditSnapshot,
  JointEditRecord,
  JointValue,
  RowData,
  ProjectInvalidation,
} from '@/shared/types';
import { getSchema } from '@/domain/schema/config-schema-registry';
import { schemaDocumentIssues } from '@/domain/schema/schema-validation';
import { composeJson } from '@/domain/json-composition';
import { entityContentIdField } from '@/domain/project/entity-definitions';
import { jointObject } from '@/domain/joint-edit';
import { csvTableProblems } from '@/domain/csv-editor/csv-validation';
import { CSV_SPEC_KINDS, csvValidationRequest, hasCsvValidationInvalidation } from '@/domain/csv-editor/csv-rule-context';
import { cell } from '@/shared/lib/starsector';
import { queryCsvValidation, queryTableIndex } from '@/services/csv-table.service';
import { shipSpecIssues } from '@/domain/spec-editor/ship/spec-ship-fields';
import { weaponSpecIssues } from '@/domain/spec-editor/weapon/spec-weapon-fields';
import { projectileSpecIssues } from '@/domain/spec-editor/projectile/spec-projectile-fields';
import { systemSpecIssues } from '@/domain/spec-editor/system/spec-system-fields';
import { projectVariantPanel } from '@/domain/immersive/variant/variant-panel';
import { stableDeepEqual } from '@/shared/lib/stable-compare';
import { cloneQuerySnapshot } from '@/shared/lib/query-snapshot';
import { AppError, errorDiagnosticOf, formatError } from '@/shared/lib/errors';
import { fieldProblemKey } from '@/shared/runtime/editor-problems';
import { normalizeFsPath } from '@/shared/lib/paths';
import { queryJointEditPreview } from '@/services/joint-edit.service';

export function createJointFileValidation() {
  let dependencies: CsvValidationRequest | null = null;
  return {
    validate: async (
      snapshot: JointEditSnapshot,
      values: Record<string, JointValue>,
      signal?: AbortSignal,
      overrides?: readonly string[],
      prepared?: JointEditSnapshot,
    ) => {
      let captured: CsvValidationRequest | null = null;
      const issues = await validateJointFiles(snapshot, values, signal, overrides, prepared, (request) => {
        captured = request;
      });
      if (!signal?.aborted) dependencies = captured;
      return issues;
    },
    affected: (snapshot: JointEditSnapshot, invalidation: ProjectInvalidation) =>
      invalidation.session ||
      snapshot.records.some((record) => record.target.kind === 'csv' && invalidation.tables.includes(record.target.table)) ||
      Boolean(
        dependencies &&
        hasCsvValidationInvalidation(invalidation, dependencies, (source) =>
          invalidation.queryScopes.some((scope) => scope.kind === 'csv-source-options' && scope.source === source),
        ),
      ),
  };
}

const specChecks: Partial<Record<EntityKind, (value: RowData, partial: boolean) => FieldProblem[]>> = {
  ship: shipSpecIssues,
  weapon: weaponSpecIssues,
  projectile: projectileSpecIssues,
  system: systemSpecIssues,
};

export async function validateJointFiles(
  baseline: JointEditSnapshot,
  values: Record<string, JointValue>,
  signal?: AbortSignal,
  createOverrides: readonly string[] = [],
  preparedSnapshot?: JointEditSnapshot,
  referencesRead?: (request: CsvValidationRequest) => void,
): Promise<FieldProblem[]> {
  const issues: FieldProblem[] = [];
  const snapshot = cloneQuerySnapshot<JointEditSnapshot>(preparedSnapshot ?? (await queryJointEditPreview({ baseline, values }, signal)));
  for (const record of baseline.records)
    if (Object.hasOwn(values, record.key) && !snapshot.records.some((entry) => entry.key === record.key))
      snapshot.records.push(cloneQuerySnapshot(record));
  const changed = (record: JointEditRecord) =>
    Object.hasOwn(values, record.key) &&
    !stableDeepEqual(baseline.records.find((entry) => entry.key === record.key)?.value, values[record.key]);
  const current = Object.fromEntries(snapshot.records.map((record) => [record.key, values[record.key] ?? record.value]));
  const data = new Map(
    snapshot.records.map((record) => [record.key, composeJson(jointObject(current[record.key]) as RowData, record.composition)]),
  );
  const file = (record: JointEditRecord) => {
    const write = record.target.kind === 'spec' ? record.target.target.write : record.target.write;
    return changed(record) || createOverrides.includes(record.key) ? write.path : (record.source?.path ?? write.path);
  };
  const locate = (record: JointEditRecord, problems: FieldProblem[]) =>
    problems.map((issue) => ({
      ...issue,
      path: JSON.stringify([record.key, issue.path]),
      location: {
        path: file(record),
        field: issue.path,
        rowKey: record.target.kind === 'csv' ? record.target.rowKey : undefined,
        line: null,
        column: null,
      },
    }));
  const readFailure = (path: string, error: unknown) => {
    issues.push({
      severity: 'error' as const,
      code: errorDiagnosticOf(error).code,
      path,
      message: formatError(error),
      location: { path, line: null, column: null },
    });
  };
  for (const record of snapshot.records) {
    const expected = baseline.records.find((entry) => entry.key === record.key)?.sourceVersion;
    if (expected && record.sourceVersion && !stableDeepEqual(expected, record.sourceVersion))
      readFailure(expected.path, new AppError('文件来源已变化，请刷新联合内容', { code: 'write.version_conflict' }));
  }
  for (const record of snapshot.records) {
    if (record.target.kind !== 'spec' || current[record.key]?.state !== 'present') continue;
    const kind = record.target.target.kind,
      local = jointObject(current[record.key]),
      effective = data.get(record.key)!;
    const partial = !local[entityContentIdField(kind)];
    const checked = partial ? local : effective;
    const schema = getSchema(kind === 'faction' || kind === 'skin' || kind === 'variant' ? kind : `spec-${kind}`);
    const content = kind === 'faction' ? { file: checked } : checked;
    const problems = specChecks[kind]?.(checked, partial) ?? (schema ? schemaDocumentIssues(schema, content, partial) : []);
    issues.push(...locate(record, problems));
    for (const layer of record.composition?.layers ?? []) {
      const layerContent = kind === 'faction' ? { file: layer.data } : layer.data;
      const layerPartial = !layer.data[entityContentIdField(kind)];
      const layerIssues =
        specChecks[kind]?.(layer.data, layerPartial) ?? (schema ? schemaDocumentIssues(schema, layerContent, layerPartial) : []);
      issues.push(
        ...locate(record, layerIssues).map((issue) => ({
          ...issue,
          location: { ...issue.location, path: layer.source.path },
        })),
      );
    }
    const references = kind === 'variant' ? ['hullId'] : kind === 'skin' ? ['baseHullId'] : kind === 'weapon' ? ['projectileSpecId'] : [];
    for (const key of references) {
      const id = effective[key];
      if (typeof id !== 'string' || !id) continue;
      const targets = snapshot.records.filter(
        (entry) =>
          entry.target.kind === 'spec' &&
          entry.target.target.id === id &&
          (key === 'projectileSpecId' ? entry.target.target.kind === 'projectile' : ['ship', 'skin'].includes(entry.target.target.kind)),
      );
      if (targets.length && targets.every((entry) => current[entry.key]?.state === 'missing'))
        issues.push(
          ...locate(record, [{ severity: 'error', code: 'config.reference_missing', path: key, message: `引用 ${id} 的文件缺失` }]),
        );
    }
  }
  const groups = new Map<string, JointEditRecord[]>();
  const specIds = new Map<string, string>(
    snapshot.records.flatMap((record) =>
      record.target.kind === 'spec' && current[record.key]?.state === 'present'
        ? [
            [
              `${record.target.target.kind}:${record.target.target.id}`,
              cell(data.get(record.key)![entityContentIdField(record.target.target.kind)]) || record.target.target.id,
            ] as const,
          ]
        : [],
    ),
  );
  for (const record of snapshot.records) {
    if (record.target.kind !== 'csv') continue;
    const key = record.target.write.path;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const prepared: Array<{
    path: string;
    records: JointEditRecord[];
    table: CsvTableKey;
    index: DeepReadonly<CsvTableIndex>;
    rows: CsvDraftRow[];
    externalTables: Array<{ path: string; index: CsvTableIndex }>;
    request: CsvValidationRequest;
  }> = [];
  for (const [path, records] of groups) {
    const first = records[0]!,
      target = first.target;
    if (target.kind !== 'csv') continue;
    try {
      const index = await queryTableIndex(snapshot.root.sessionId, target.table, 0, null, 'id-name', signal);
      for (const actual of index.baseVersions) {
        const expected = baseline.baseVersions.find((version) => normalizeFsPath(version.path) === normalizeFsPath(actual.path));
        if (expected && expected.fingerprint !== actual.fingerprint)
          throw new AppError('表格来源已变化，请刷新联合内容', { code: 'write.version_conflict' });
      }
      const rows = cloneQuerySnapshot<CsvDraftRow[]>(index.validationRows);
      for (const record of records) {
        if (record.target.kind !== 'csv') continue;
        const rowKey = record.target.rowKey;
        const nextId = specIds.get(`${CSV_SPEC_KINDS[target.table]}:${record.target.identity.id}`);
        const renamed = nextId !== undefined && nextId !== record.target.identity.id;
        const value = values[record.key] ?? (renamed ? current[record.key] : undefined);
        if (!value || (record.source?.source !== 'mod' && !changed(record) && !createOverrides.includes(record.key) && !renamed)) continue;
        const found = rows.findIndex((row) => row.rowKey === rowKey);
        if (value.state === 'missing') {
          if (found >= 0) rows.splice(found, 1);
        } else {
          const row = {
            rowKey: record.target.rowKey,
            isComment: false,
            data: { ...jointObject(value), ...(renamed ? { id: nextId } : {}) },
          };
          if (found >= 0) rows[found] = row;
          else rows.push(row);
        }
      }
      const sources = new Map(
        records.filter((record) => record.source && record.source.source !== 'mod').map((record) => [record.source!.path, record.source!]),
      );
      const externalTables: Array<{ path: string; index: CsvTableIndex }> = [];
      for (const source of sources.values()) {
        try {
          externalTables.push({
            path: source.path,
            index: cloneQuerySnapshot<CsvTableIndex>(
              await queryTableIndex(snapshot.root.sessionId, target.table, 0, null, 'id-name', signal, source),
            ),
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          readFailure(source.path, error);
        }
      }
      const request = csvValidationRequest(target.table, [...rows, ...externalTables.flatMap((external) => external.index.validationRows)]);
      prepared.push({ path, records, table: target.table, index, rows, externalTables, request });
    } catch (error) {
      if (signal?.aborted) throw error;
      readFailure(path, error);
    }
  }
  let context: CsvValidationContext | null = null;
  if (prepared.length) {
    // All physical tables share one reference read while retaining their complete row checks.
    const requests = prepared.map((file) => file.request);
    const request: CsvValidationRequest = {
      entities: [
        ...new Map(requests.flatMap((request) => request.entities).map((entity) => [`${entity.kind}:${entity.id}`, entity])).values(),
      ],
      sources: [...new Set(requests.flatMap((request) => request.sources))],
      files: [...new Set(requests.flatMap((request) => request.files))],
      classes: [...new Set(requests.flatMap((request) => request.classes))],
    };
    referencesRead?.(request);
    try {
      context = cloneQuerySnapshot<CsvValidationContext>(await queryCsvValidation(snapshot.root.sessionId, request, signal));
    } catch (error) {
      if (signal?.aborted) throw error;
      for (const { path } of prepared) readFailure(path, error);
    }
  }
  const candidate = context && { ...context, entities: { ...context.entities } };
  for (const record of snapshot.records) {
    if (!candidate || record.target.kind !== 'spec') continue;
    const target = record.target.target;
    const nextId = specIds.get(`${target.kind}:${target.id}`);
    if (record.source?.source === 'mod' && nextId !== target.id) {
      delete candidate.entities[`${target.kind}:${target.id}`];
      if (record.composition?.layers.length) {
        const base = composeJson({}, { ...record.composition, replace: false });
        const id = cell(base[entityContentIdField(target.kind)]) || target.id;
        candidate.entities[`${target.kind}:${id}`] = base;
      }
    }
    if (nextId !== undefined) candidate.entities[`${target.kind}:${nextId}`] = data.get(record.key)!;
  }
  for (const { path, records, table, index, rows, externalTables } of prepared) {
    try {
      const header = [
        ...new Set([
          ...index.header,
          ...records
            .filter((record) => changed(record) || createOverrides.includes(record.key))
            .flatMap((record) => Object.keys(jointObject(current[record.key]))),
        ]),
      ];
      const mapProblems = (problems: FieldProblem[], sourcePath: string, problemRows: readonly CsvDraftRow[]) =>
        problems.map((issue) => {
          const row = problemRows.find((row) => issue.path === row.rowKey || issue.path.startsWith(row.rowKey + '/'));
          const field = row ? issue.path.slice(row.rowKey.length + 1) || 'id' : issue.path;
          const record = records.find(
            (record) =>
              record.target.kind === 'csv' &&
              (record.target.rowKey === row?.rowKey ||
                (row && Object.entries(record.target.identity).every(([key, value]) => row.data[key] === value))),
          );
          return {
            ...issue,
            path: record ? JSON.stringify([record.key, field]) : issue.path,
            location: {
              path: sourcePath,
              rowKey: record?.target.kind === 'csv' ? record.target.rowKey : row?.rowKey,
              field,
              line: null,
              column: null,
            },
          };
        });
      issues.push(...mapProblems(csvTableProblems(table, rows, header, candidate), path, rows));
      for (const external of externalTables) {
        issues.push(
          ...mapProblems(
            csvTableProblems(table, external.index.validationRows, external.index.header, context),
            external.path,
            external.index.validationRows,
          ),
        );
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      readFailure(path, error);
    }
  }
  if (snapshot.root.kind === 'variant' && snapshot.hull) {
    const panel = projectVariantPanel(snapshot, current);
    for (const variant of panel.variants) {
      const record = snapshot.records.find((record) => record.key === variant.key)!;
      issues.push(...locate(record, variant.diagnostics));
    }
  }
  return [...new Map(issues.map((issue) => [fieldProblemKey(issue), issue])).values()];
}
