/**
 * The action log on Table (and the big screen): entries newest first, grouped by the round they were taken in; who
 * may undo the newest undoable entry; which notices an entry shows on this device; and the notices that arrive
 * from other devices while the app is open (toasted once; the to-dos also wait on the Panel checklist).
 */
import type { FactionId } from '../../data/types';
import type { HistoryItem } from '../../engine/types';
import type { Notice } from '../../engine/types';
import type { LogEntry } from '../../sync/store';
import { factionName } from './labels';
import { noticeId, type PanelNotice } from './notices';

/** Table shows the last 30 entries. */
export const LOG_LIMIT = 30;

export interface LogGroup {
  key: string;
  /** "Round 3", or "Lobby and setup". */
  title: string;
  /** Newest first. */
  entries: LogEntry[];
}

function roundTitle(round: number): string {
  return round === 0 ? 'Lobby and setup' : `Round ${round}`;
}

/** The newest `limit` entries, newest first, in groups of consecutive entries from the same round. */
export function groupLog(log: readonly LogEntry[], limit = LOG_LIMIT): LogGroup[] {
  const groups: LogGroup[] = [];
  const newest = log.slice(-limit).reverse();
  for (const e of newest) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.entries[0]!.round === e.round) last.entries.push(e);
    else groups.push({ key: `${e.round}:${e.seq}`, title: roundTitle(e.round), entries: [e] });
  }
  return groups;
}

export interface UndoInfo {
  /** The entry Undo reverts: always the newest item of `game.history` (the host undoes only that one). */
  seq: number;
  allowed: boolean;
  /** Who may undo it: "Anyone at the table can undo this", "Only Caldari's device can undo this". */
  hint: string;
}

/**
 * Undo on the newest undoable entry: anyone may undo a public change; a change that touched private data only on
 * its actor's device. Null when nothing can be undone, or for a device without a seat (the big screen is read-only).
 */
export function undoInfo(history: readonly HistoryItem[], me: FactionId | null): UndoInfo | null {
  const last = history[history.length - 1];
  if (last === undefined || me === null) return null;
  if (!last.touchedPrivate) return { seq: last.seq, allowed: true, hint: 'Anyone at the table can undo this' };
  if (last.actor === me) return { seq: last.seq, allowed: true, hint: 'Only your device can undo this' };
  const hint = last.actor === null ? 'Only the device that made this change can undo it' : `Only ${factionName(last.actor)}'s device can undo this`;
  return { seq: last.seq, allowed: false, hint };
}

/** An entry's notices this device shows: those to me and to everyone (another player's to-dos are theirs). */
export function visibleNotices(e: LogEntry, me: FactionId | null): Notice[] {
  return e.notices.filter((n) => n.to === 'all' || n.to === me);
}

/**
 * Notices of both kinds to me or to everyone in entries newer than `afterSeq` that another device made and nobody
 * undid: what happened to me elsewhere (a claim, a raid, an attack, the upkeep starting). My own commands are left
 * out; their snackbar already speaks for them.
 */
export function arrivedNotices(log: readonly LogEntry[], afterSeq: number, me: FactionId): PanelNotice[] {
  const out: PanelNotice[] = [];
  for (const e of log) {
    if (e.seq <= afterSeq || e.undone || e.actor === me) continue;
    e.notices.forEach((n, i) => {
      if (n.to === me || n.to === 'all') out.push({ id: noticeId(e.seq, i), text: n.text, toAll: n.to === 'all', kind: n.kind });
    });
  }
  return out;
}

/** The newest seq in `log`, or `fallback` if that is newer (or the log is empty). */
export function newestSeq(log: readonly LogEntry[], fallback: number): number {
  return log.reduce((n, e) => Math.max(n, e.seq), fallback);
}

/**
 * One toast for newly arrived notices: the first one, plus where the rest are — the to-dos wait on the Panel's
 * checklist; when the rest are all news (`info`), they are only in the Table's log.
 */
export function noticeToast(notices: readonly PanelNotice[]): { text: string; personal: boolean } | null {
  const first = notices[0];
  if (first === undefined) return null;
  const rest = notices.slice(1);
  const todos = rest.filter((n) => n.kind === 'todo').length;
  let more = '';
  if (todos > 0) more = ` · ${todos} more on your Panel`;
  else if (rest.length > 0) more = ` · ${rest.length} more in the Table log`;
  return { text: first.text + more, personal: notices.some((n) => !n.toAll) };
}

export interface RecentLine {
  key: string;
  actor: FactionId | null;
  text: string;
}

/**
 * The newest `n` log lines for the big screen: entries newest first, lines in their own order, undone ones skipped.
 * Short of room, an entry keeps its newest (last) lines, so the end of a long entry — "Game over: …" and the final
 * ranking after an upkeep's domination lines — is never cut.
 */
export function recentLines(log: readonly LogEntry[], n: number): RecentLine[] {
  const out: RecentLine[] = [];
  for (let i = log.length - 1; i >= 0 && out.length < n; i--) {
    const e = log[i]!;
    if (e.undone) continue;
    const from = Math.max(0, e.lines.length - (n - out.length));
    e.lines.slice(from).forEach((text, j) => out.push({ key: `${e.seq}:${from + j}`, actor: e.actor, text }));
  }
  return out;
}
