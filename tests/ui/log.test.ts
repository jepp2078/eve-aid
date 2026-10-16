import { describe, expect, it } from 'vitest';
import type { FactionId } from '../../src/data/types';
import type { HistoryItem, Notice } from '../../src/engine/types';
import type { LogEntry } from '../../src/sync/store';
import { arrivedNotices, groupLog, newestSeq, noticeToast, recentLines, undoInfo, visibleNotices } from '../../src/ui/lib/log';

function entry(seq: number, opts: { round?: number; actor?: FactionId | null; lines?: string[]; notices?: Notice[]; undone?: boolean } = {}): LogEntry {
  return {
    seq,
    at: 0,
    actor: opts.actor === undefined ? 'amarr' : opts.actor,
    type: 'endTurn',
    round: opts.round ?? 1,
    lines: opts.lines ?? [`line ${seq}`],
    notices: opts.notices ?? [],
    touchedPrivate: false,
    undone: opts.undone ?? false,
  };
}

describe('groupLog', () => {
  it('lists the newest entries first, grouped by the round they were taken in', () => {
    const log = [entry(1, { round: 0 }), entry(2, { round: 0 }), entry(3, { round: 1 }), entry(4, { round: 1 }), entry(5, { round: 2 })];
    const groups = groupLog(log);
    expect(groups.map((g) => g.title)).toStrictEqual(['Round 2', 'Round 1', 'Lobby and setup']);
    expect(groups.map((g) => g.entries.map((e) => e.seq))).toStrictEqual([[5], [4, 3], [2, 1]]);
    expect(new Set(groups.map((g) => g.key)).size).toBe(3);
  });

  it('keeps only the newest `limit` entries (30 by default)', () => {
    const log = Array.from({ length: 40 }, (_, i) => entry(i + 1, { round: 1 }));
    expect(groupLog(log)[0]!.entries).toHaveLength(30);
    expect(groupLog(log)[0]!.entries[29]!.seq).toBe(11);
    expect(groupLog(log, 5)[0]!.entries.map((e) => e.seq)).toStrictEqual([40, 39, 38, 37, 36]);
  });

  it('is empty for an empty log', () => {
    expect(groupLog([])).toStrictEqual([]);
  });
});

describe('undoInfo', () => {
  const item = (seq: number, actor: FactionId | null, touchedPrivate: boolean): HistoryItem => ({ seq, actor, touchedPrivate });

  it('offers the newest undoable entry (the last history item) to anyone when it touched no private data', () => {
    expect(undoInfo([item(3, 'amarr', true), item(4, 'caldari', false)], 'amarr')).toStrictEqual({
      seq: 4,
      allowed: true,
      hint: 'Anyone at the table can undo this',
    });
  });

  it("allows a private change only on its actor's device", () => {
    const history = [item(4, 'caldari', true)];
    expect(undoInfo(history, 'caldari')).toStrictEqual({ seq: 4, allowed: true, hint: 'Only your device can undo this' });
    expect(undoInfo(history, 'amarr')).toStrictEqual({ seq: 4, allowed: false, hint: "Only Caldari's device can undo this" });
    expect(undoInfo([item(4, null, true)], 'amarr')).toStrictEqual({
      seq: 4,
      allowed: false,
      hint: 'Only the device that made this change can undo it',
    });
  });

  it('offers nothing when there is nothing to undo, or to a device without a seat (read-only)', () => {
    expect(undoInfo([], 'amarr')).toBeNull();
    expect(undoInfo([item(4, 'caldari', false)], null)).toBeNull();
  });
});

describe('visibleNotices', () => {
  const e = entry(7, { notices: [{ to: 'amarr', text: 'A', kind: 'todo' }, { to: 'all', text: 'B', kind: 'info' }, { to: 'caldari', text: 'C', kind: 'todo' }] });

  it("shows notices to me and to everyone, never another player's", () => {
    expect(visibleNotices(e, 'amarr').map((n) => n.text)).toStrictEqual(['A', 'B']);
    expect(visibleNotices(e, 'caldari').map((n) => n.text)).toStrictEqual(['B', 'C']);
    expect(visibleNotices(e, null).map((n) => n.text)).toStrictEqual(['B']);
  });
});

describe('arrivedNotices and noticeToast', () => {
  const log = [
    entry(4, { actor: 'caldari', notices: [{ to: 'amarr', text: 'old', kind: 'todo' }] }),
    entry(5, { actor: 'caldari', notices: [{ to: 'amarr', text: 'Caldari took one of your systems', kind: 'todo' }, { to: 'gallente', text: 'not mine', kind: 'todo' }] }),
    entry(6, { actor: 'amarr', notices: [{ to: 'amarr', text: 'Draw an Event or Mission card', kind: 'todo' }] }),
    entry(7, { actor: 'gallente', notices: [{ to: 'all', text: 'Upkeep: confirm your upkeep on your device', kind: 'info' }] }),
    entry(8, { actor: 'gallente', notices: [{ to: 'amarr', text: 'undone later', kind: 'todo' }], undone: true }),
  ];

  it('finds notices to me or everyone in entries after `afterSeq`, made on other devices and not undone (both kinds)', () => {
    expect(arrivedNotices(log, 4, 'amarr')).toStrictEqual([
      { id: '5:0', text: 'Caldari took one of your systems', toAll: false, kind: 'todo' },
      { id: '7:0', text: 'Upkeep: confirm your upkeep on your device', toAll: true, kind: 'info' },
    ]);
    expect(arrivedNotices(log, 3, 'amarr')[0]).toStrictEqual({ id: '4:0', text: 'old', toAll: false, kind: 'todo' });
    expect(arrivedNotices(log, 8, 'amarr')).toStrictEqual([]);
    expect(arrivedNotices(log, 0, 'gallente').map((n) => n.text)).toStrictEqual(['not mine']);
  });

  it('knows the newest seq it has seen', () => {
    expect(newestSeq(log, 3)).toBe(8);
    expect(newestSeq([], 3)).toBe(3);
    expect(newestSeq([entry(2)], 3)).toBe(3);
  });

  it('toasts the first notice and says where the rest are: to-dos on the Panel, news only in the log', () => {
    expect(noticeToast([])).toBeNull();
    expect(noticeToast(arrivedNotices(log, 3, 'amarr'))).toStrictEqual({
      text: 'old · 1 more on your Panel',
      personal: true,
    });
    expect(noticeToast(arrivedNotices(log, 4, 'amarr'))).toStrictEqual({
      text: 'Caldari took one of your systems · 1 more in the Table log',
      personal: true,
    });
    expect(noticeToast(arrivedNotices(log, 6, 'amarr'))).toStrictEqual({ text: 'Upkeep: confirm your upkeep on your device', personal: false });
  });
});

describe('recentLines', () => {
  it('gives the newest lines first, skipping undone entries', () => {
    const log = [
      entry(1, { lines: ['a'] }),
      entry(2, { lines: ['b', 'c'], actor: 'caldari' }),
      entry(3, { lines: ['x'], undone: true }),
      entry(4, { lines: ['d'], actor: null }),
    ];
    expect(recentLines(log, 3)).toStrictEqual([
      { key: '4:0', actor: null, text: 'd' },
      { key: '2:0', actor: 'caldari', text: 'b' },
      { key: '2:1', actor: 'caldari', text: 'c' },
    ]);
    expect(recentLines(log, 10).map((l) => l.text)).toStrictEqual(['d', 'b', 'c', 'a']);
    // Short of room, an entry keeps its newest lines.
    expect(recentLines(log, 2).map((l) => l.text)).toStrictEqual(['d', 'c']);
  });

  it('keeps "Game over" and the ranking from the end of a long final entry (K4)', () => {
    const end = entry(9, {
      actor: 'caldari',
      lines: [
        'Caldari confirmed upkeep: 4 ISK income, 3 research',
        'Everyone confirmed: finishing the upkeep',
        'Domination: Amarr controls 5 systems',
        'Ana gains 1 VP (11 total)',
        'Domination: Amarr holds the central system',
        'Ana gains 1 VP (12 total)',
        'Game over: Amarr wins',
        'Final ranking: 1. Amarr (12 VP, 5 systems, strength 9), 2. Caldari (8 VP, 2 systems, strength 4)',
      ],
    });
    const lines = recentLines([entry(8), end], 5).map((l) => l.text);
    expect(lines).toHaveLength(5);
    expect(lines.slice(-2)).toStrictEqual(['Game over: Amarr wins', 'Final ranking: 1. Amarr (12 VP, 5 systems, strength 9), 2. Caldari (8 VP, 2 systems, strength 4)']);
    expect(lines[0]).toBe('Ana gains 1 VP (11 total)');
  });
});
