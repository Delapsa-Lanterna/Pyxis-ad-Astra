import { describe, expect, it } from 'vitest';
import type { CsvRowRecord } from '@/shared/types';
import { detailActionKey, detailActionLabel, detailActionsForRow } from './table-detail-actions';

const context = { modRoot: 'C:/mods/alpha', sessionId: 's1', starsectorRoot: null };

describe('detailActionsForRow', () => {
  it('returns no actions without a row', () => {
    expect(detailActionsForRow(context, 'ships', null)).toEqual([]);
    expect(detailActionsForRow(context, 'ships', undefined)).toEqual([]);
  });

  it('returns no actions for comment rows', () => {
    expect(
      detailActionsForRow(context, 'ships', { rowKey: 'ships:row:0', data: { name: '#note', id: 'active' }, isComment: true }),
    ).toEqual([]);
  });

  it('returns no actions for rows without a spec id', () => {
    expect(detailActionsForRow(context, 'ships', { rowKey: 'ships:row:0', data: { name: 'orphan' }, isComment: false })).toEqual([]);
  });

  it('returns the ship editor and the spec file editor for ship rows', () => {
    const actions = detailActionsForRow(context, 'ships', { rowKey: 'ships:row:0', data: { id: 'XY', name: '#quoted' }, isComment: false });
    expect(actions).toHaveLength(3);
    expect(actions[0]).toMatchObject({
      type: 'editor-window',
      kind: 'ship',
      id: 'XY',
      modRoot: context.modRoot,
      sessionId: context.sessionId,
    });
    expect(actions[1]).toMatchObject({ type: 'immersive-editor', kind: 'ship', id: 'XY', rowKey: 'ships:row:0' });
    expect(actions[2]).toMatchObject({ type: 'file-editor', kind: 'ship', id: 'XY' });
  });

  it('returns both weapon editors plus the file editor for weapon rows', () => {
    const actions = detailActionsForRow(context, 'weapons', { rowKey: 'weapons:row:0', data: { id: 'railgun' }, isComment: false });
    expect(actions.map((action) => (action.type === 'editor-window' ? action.kind : action.type))).toEqual([
      'weapon',
      'weapon-preview',
      'immersive-editor',
      'file-editor',
    ]);
    expect(actions[2]).toMatchObject({ kind: 'weapon', id: 'railgun', rowKey: 'weapons:row:0' });
  });

  it('returns only the file editor for skills rows without editor windows', () => {
    const actions = detailActionsForRow(context, 'skills', { rowKey: 'skills:row:0', data: { id: 'helmanship' }, isComment: false });
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ type: 'file-editor', kind: 'skill', id: 'helmanship' });
  });

  it('opens a wing through its own row and complete window identity', () => {
    const row: CsvRowRecord = { rowKey: 'wings:row:0', data: { id: 'wing1' }, isComment: false };
    expect(detailActionsForRow(context, 'wings', row)).toEqual([
      {
        type: 'immersive-editor',
        kind: 'wing',
        modRoot: context.modRoot,
        sessionId: context.sessionId,
        id: 'wing1',
        rowKey: 'wings:row:0',
      },
    ]);
    expect(detailActionsForRow(context, 'industries', row)).toEqual([]);
  });
});

describe('detail action labels and keys', () => {
  const actions = detailActionsForRow(context, 'ships', { rowKey: 'ships:row:0', data: { id: 'XY' }, isComment: false });

  it('labels editor windows with their editor window label', () => {
    expect(detailActionLabel(actions[0]!)).toBe('舰船编辑器');
    expect(detailActionLabel(actions[1]!)).toBe('沉浸式编辑器');
    expect(detailActionLabel(actions[2]!)).toBe('文件编辑器');
  });

  it('builds distinct stable keys from the action identity', () => {
    expect(detailActionKey(actions[0]!)).not.toBe(detailActionKey(actions[1]!));
    const again = detailActionsForRow(context, 'ships', { rowKey: 'ships:row:0', data: { id: 'XY' }, isComment: false });
    expect(detailActionKey(again[0]!)).toBe(detailActionKey(actions[0]!));
  });
});
