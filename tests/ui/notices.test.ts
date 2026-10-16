import { describe, expect, it } from 'vitest';
import type { Todo } from '../../src/sync/todos';
import { noticeId, noticesPref, panelTodos, parseTicks, serializeTicks, SETUP_NOTICE_ID, withTick } from '../../src/ui/lib/notices';
import { valueDeltas } from '../../src/ui/lib/deltas';

describe('notices', () => {
  it('turns my to-dos into checklist cards, oldest first, marking those for everyone', () => {
    const todos: Todo[] = [
      { id: 'setup:0', seq: 2, to: 'amarr', text: 'Draw 1 Event card, then draw 3 Mission cards and keep 1', key: null },
      { id: '4:0', seq: 4, to: 'all', text: 'Round 2: pass the first player token to Caldari', key: 'firstPlayer' },
    ];
    expect(panelTodos(todos)).toStrictEqual([
      { id: 'setup:0', text: 'Draw 1 Event card, then draw 3 Mission cards and keep 1', toAll: false, kind: 'todo' },
      { id: '4:0', text: 'Round 2: pass the first player token to Caldari', toAll: true, kind: 'todo' },
    ]);
    expect(SETUP_NOTICE_ID).toBe('setup:0');
  });

  it('stores ticks per game under a key made of seq and index', () => {
    expect(noticeId(12, 3)).toBe('12:3');
    expect(noticesPref('ABC234')).toBe('notices:ABC234');
    expect(parseTicks(null)).toStrictEqual(new Set());
    expect(parseTicks('not json')).toStrictEqual(new Set());
    expect(parseTicks('["3:0", 7, "4:0"]')).toStrictEqual(new Set(['3:0', '4:0']));
  });

  it('ticks and unticks without touching the original set', () => {
    const ticks = new Set(['3:0']);
    expect(withTick(ticks, 'setup:0', true)).toStrictEqual(new Set(['3:0', 'setup:0']));
    expect(withTick(ticks, '3:0', false)).toStrictEqual(new Set());
    expect(ticks).toStrictEqual(new Set(['3:0']));
  });

  it('forgets ticks for to-dos that are no longer listed', () => {
    expect(serializeTicks(new Set(['1:0', '3:0', '6:1']), ['3:0', '4:0', '6:1'])).toBe('["3:0","6:1"]');
  });
});

describe('valueDeltas', () => {
  it('reports only the values that changed', () => {
    expect(valueDeltas({ isk: 4, vp: 0, pyrite: 2 }, { isk: 8, vp: 0, pyrite: 1 })).toStrictEqual({ isk: 4, pyrite: -1 });
    expect(valueDeltas({ isk: 4 }, { isk: 4 })).toStrictEqual({});
  });
});
