/** Undo bookkeeping for the snackbar and for "undone on another device" toasts. */
import type { FactionId } from '../../data/types';
import type { HistoryItem } from '../../engine/types';
import type { LogEntry } from '../../sync/store';

/** Entries of `next` that were not undone in `prev` and are now. */
export function newlyUndone(prev: readonly LogEntry[], next: readonly LogEntry[]): LogEntry[] {
  const was = new Map(prev.map((e) => [e.seq, e.undone]));
  return next.filter((e) => e.undone && was.get(e.seq) === false);
}

/**
 * The log entry a snackbar's Undo means: the entry my command created. `beforeSeq` is the game's `logSeq` just
 * before the command. When the newest known entry is newer than that and mine, it is that one; when my entry is
 * not in this snapshot yet (or is already gone), it is the next seq after `beforeSeq`, and the host refuses if that
 * isn't the latest. Null when someone else's entry is already known to be newer than mine.
 */
export function snackbarUndoSeq(history: readonly HistoryItem[], beforeSeq: number, me: FactionId | null): { seq: number } | null {
  const last = history[history.length - 1];
  if (last === undefined || last.seq <= beforeSeq) return { seq: beforeSeq + 1 };
  return me === null || last.actor === me ? { seq: last.seq } : null;
}
