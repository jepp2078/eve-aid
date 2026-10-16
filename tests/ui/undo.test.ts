import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/sync/store';
import { newlyUndone, snackbarUndoSeq } from '../../src/ui/lib/undo';

function entry(seq: number, undone = false): LogEntry {
  return { seq, at: 0, actor: 'amarr', type: 'endTurn', round: 1, lines: [`line ${seq}`], notices: [], touchedPrivate: false, undone };
}

describe('newlyUndone', () => {
  it('finds entries that flipped to undone', () => {
    expect(newlyUndone([entry(1), entry(2)], [entry(1), entry(2, true)])).toStrictEqual([entry(2, true)]);
  });

  it('ignores entries that were already undone or are new', () => {
    expect(newlyUndone([entry(1, true)], [entry(1, true), entry(2, true)])).toStrictEqual([]);
    expect(newlyUndone([], [entry(1, true)])).toStrictEqual([]);
  });
});

describe('snackbarUndoSeq', () => {
  const item = (seq: number, actor: 'amarr' | 'caldari' | null) => ({ seq, actor, touchedPrivate: false });

  it('names my entry when it is the latest', () => {
    expect(snackbarUndoSeq([item(4, 'caldari'), item(5, 'amarr')], 4, 'amarr')).toStrictEqual({ seq: 5 });
  });

  it('refuses when someone else acted after me', () => {
    expect(snackbarUndoSeq([item(5, 'amarr'), item(6, 'caldari')], 4, 'amarr')).toBeNull();
  });

  it('expects the next seq when my entry has not arrived yet (the host checks it)', () => {
    expect(snackbarUndoSeq([item(4, 'caldari')], 4, 'amarr')).toStrictEqual({ seq: 5 });
    expect(snackbarUndoSeq([], 4, 'amarr')).toStrictEqual({ seq: 5 });
  });

  it('still names the expected seq after my entry was undone elsewhere, so the host refuses it', () => {
    // My entry 5 is gone from the history (undone); 3 is now the latest. Undo must not touch 3.
    expect(snackbarUndoSeq([item(3, 'caldari')], 4, 'amarr')).toStrictEqual({ seq: 5 });
  });
});
