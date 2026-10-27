import { afterEach, expect, it, vi } from 'vitest';
import { installCanvas2DStub } from './unit/canvas-stub';
import { createCanvasRecorder } from './unit/canvas-recorder';
import { shipJointFixture } from './fixtures/joint-edit/ship-joint-edit';
import { weaponJointFixture } from './fixtures/joint-edit/weapon-joint-edit';
import { wingJointFixture } from './fixtures/joint-edit/wing-joint-edit';
import { variantJointFixture } from './fixtures/joint-edit/variant-joint-edit';
import { jointObject } from '@/domain/joint-edit';
import { entityContentId } from '@/domain/project/entity-definitions';
import { summarize } from '../../scripts/shared/sample-statistics.mjs';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('gives each canvas an independent writable context and restores installation', () => {
  const original = HTMLCanvasElement.prototype.getContext;
  const restore = installCanvas2DStub(true);
  const first = document.createElement('canvas'),
    second = document.createElement('canvas');
  const a = first.getContext('2d')!,
    b = second.getContext('2d')!;
  a.fillStyle = '#123456';
  expect(first.getContext('2d')).toBe(a);
  expect(a.canvas).toBe(first);
  expect(b.fillStyle).not.toBe(a.fillStyle);
  expect(matchMedia('(prefers-color-scheme: dark)').matches).toBe(true);
  expect(matchMedia('(prefers-color-scheme: light)').matches).toBe(false);
  restore();
  expect(HTMLCanvasElement.prototype.getContext).toBe(original);
});

it('records drawing arguments and restores declared paint state', () => {
  const { ctx, calls } = createCanvasRecorder();
  ctx.fillStyle = '#123456';
  ctx.globalAlpha = 0.5;
  ctx.setLineDash([2, 3]);
  ctx.save();
  ctx.fillStyle = '#abcdef';
  ctx.globalAlpha = 1;
  ctx.setLineDash([1]);
  ctx.fillRect(1, 2, 3, 4);
  ctx.restore();
  ctx.fillRect(5, 6, 7, 8);
  expect(calls('fillRect').map((op) => [op.args, op.alpha])).toEqual([
    [[1, 2, 3, 4], 1],
    [[5, 6, 7, 8], 0.5],
  ]);
  expect(ctx.fillStyle).toBe('#123456');
  expect(ctx.getLineDash()).toEqual([2, 3]);
});

it.each([shipJointFixture, weaponJointFixture, wingJointFixture, variantJointFixture])(
  'constructs independent records with matching targets and version paths: %s',
  (builder) => {
    const a = builder(),
      b = builder();
    expect(a.records).not.toBe(b.records);
    for (const record of a.records) {
      const data = jointObject(record.value);
      if (record.target.kind === 'spec') expect(record.target.target.id).toBe(entityContentId(record.target.target.kind, data));
      if (record.target.kind === 'csv')
        for (const [key, value] of Object.entries(record.target.identity)) expect(value).toBe(String(data[key]));
      expect(record.sourceVersion?.path).toBe(record.source?.path);
      expect(record.baseVersions).toEqual([record.sourceVersion]);
    }
    expect(new Set(a.baseVersions.map((v) => v.path)).size).toBe(a.baseVersions.length);
    const root = a.records.find((record) => record.key === a.bindings[a.root.kind === 'wing' ? 'csv' : 'spec'])!;
    expect(root.target.kind === 'spec' ? root.target.target.id : root.target.kind === 'csv' ? root.target.identity.id : null).toBe(
      a.root.id,
    );
    const hullId = a.hull ? jointObject(a.records.find((record) => record.key === a.hull!.hullKey)!.value).hullId : a.root.id;
    const description = a.records.find((record) => record.key === (a.hull?.displayBindings.description ?? a.bindings.description))!;
    expect(jointObject(description.value).id).toBe(hullId);
    if (a.hull) expect(jointObject(a.records.find((record) => record.key === a.hull!.fields.name![0]!.recordKey)!.value).id).toBe(hullId);
    a.records[0]!.value = { state: 'missing' };
    expect(b.records[0]!.value.state).toBe('present');
  },
);

it('computes even and odd medians and nearest-rank P95 without changing samples', () => {
  const values = Array.from({ length: 30 }, (_, i) => 30 - i);
  expect(summarize(values)).toEqual({ n: 30, min: 1, max: 30, mean: 15.5, median: 15.5, p95: 29 });
  expect(summarize([9, 1, 4]).median).toBe(4);
  expect(values[0]).toBe(30);
});
