/**
 * Pure commit logic shared by every store and the laptop host: run a command through the engine and do the
 * bookkeeping the engine leaves alone (log sequence, undo history, private snapshots), or undo the latest change.
 */
import { FACTIONS, type FactionId } from '../data/types';
import { apply } from '../engine/apply';
import { createGame, emptyPrivate } from '../engine/create';
import { MAX_NAME } from '../engine/lobby';
import { isError, type Command, type GameState, type PlayerPrivate, type PrivateSnapshot, type RuleError } from '../engine/types';
import { clone, err } from '../engine/util';
import type { LogEntry, UndoRecord } from './store';

/** Undoable entries kept in `game.history`. */
export const HISTORY_CAP = 50;
/** Private snapshots kept in `priv.history`. */
export const PRIVATE_HISTORY_CAP = 20;

/** Room-code characters: no I, O, 0 or 1, so a code read aloud or off a screen can't be mistyped. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/**
 * A new lobby with `uid` seated. `mode` comes straight off the wire, so it is checked here: absent means a full game
 * (older clients never sent one), anything but `'full'` or `'light'` is refused.
 */
export function newGameFor(
  code: string,
  uid: string,
  name: string,
  faction: FactionId,
  now: number,
  mode: unknown = 'full',
): { game: GameState; priv: PlayerPrivate } | RuleError {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (trimmed.length === 0 || trimmed.length > MAX_NAME) return err('bad_name', `Enter a name of 1 to ${MAX_NAME} characters`);
  if (!FACTIONS.includes(faction)) return err('bad_faction', 'Unknown faction');
  if (mode !== 'full' && mode !== 'light') return err('bad_mode', 'Choose a full or a scorekeeper game');
  return { game: createGame(code, uid, trimmed, faction, now, mode), priv: emptyPrivate() };
}

/** The first seat (in seat order) held by `uid`, or null. */
export function actorFor(game: GameState, uid: string): FactionId | null {
  return game.seats.find((f) => game.players[f]?.uid === uid) ?? null;
}

/** The part of a private doc that commands change (everything but its own history). */
function privateState(p: PlayerPrivate): Omit<PrivateSnapshot, 'seq'> {
  return { area: p.area, pendingResearch: p.pendingResearch, pendingCards: p.pendingCards };
}

/**
 * Runs `cmd` as the device `uid`. `priv` is the private doc of the seat that device holds (null if none).
 * On success the game carries the new `logSeq` and history item, and a private doc the command changed carries a
 * snapshot of its state from before, so the owner can undo it.
 */
export function runCommand(
  game: GameState,
  priv: PlayerPrivate | null,
  cmd: Command,
  uid: string,
  now: number,
): { game: GameState; priv: PlayerPrivate | null; privOwner: FactionId | null; entry: LogEntry; undo: UndoRecord } | RuleError {
  const actor = actorFor(game, uid);
  const r = apply(game, cmd, { actor, uid, priv, now });
  if (isError(r)) return r;

  const seq = game.logSeq + 1;
  // `apply` hands back the private doc whenever one was supplied, so compare contents. A seat's first doc (join)
  // replaces a doc that did not exist yet, which counts as empty: creating a seat is not a private change.
  const before = priv ?? emptyPrivate();
  const touchedPrivate =
    r.privOwner !== null && r.priv !== null && JSON.stringify(privateState(r.priv)) !== JSON.stringify(privateState(before));

  const next: GameState = {
    ...r.game,
    logSeq: seq,
    history: [...r.game.history, { seq, actor, touchedPrivate }].slice(-HISTORY_CAP),
  };
  const nextPriv: PlayerPrivate | null =
    touchedPrivate && r.priv !== null
      ? { ...r.priv, history: [...r.priv.history, { seq, ...clone(privateState(before)) }].slice(-PRIVATE_HISTORY_CAP) }
      : r.priv;

  return {
    game: next,
    priv: nextPriv,
    privOwner: r.privOwner,
    entry: { seq, at: now, actor, type: cmd.type, round: game.round, lines: r.lines, notices: r.notices, touchedPrivate, undone: false },
    undo: { seq, before: clone(game) },
  };
}

/**
 * Undoes `entry`, which must be the latest item of `game.history`. Public state comes back from `record.before`
 * (keeping the current `logSeq` and `uids`); a private change can only be undone from the device holding that seat,
 * and comes back from the private doc's own history. `priv` is the private doc of `entry.actor`.
 */
export function runUndo(
  game: GameState,
  entry: LogEntry,
  record: UndoRecord,
  priv: PlayerPrivate | null,
  uid: string,
): { game: GameState; priv: PlayerPrivate | null } | RuleError {
  const last = game.history.at(-1);
  if (last === undefined || last.seq !== entry.seq) return err('not_latest', 'Only the latest change can be undone');
  if (record.seq !== entry.seq) return err('no_undo', 'This change can no longer be undone');

  let nextPriv = priv;
  if (entry.touchedPrivate) {
    if (actorFor(game, uid) !== entry.actor) return err('not_your_undo', 'Only the player who made this change can undo it');
    const at = priv === null ? -1 : priv.history.findIndex((s) => s.seq === entry.seq);
    if (priv === null || at < 0) return err('no_undo', 'This change can no longer be undone');
    const { area, pendingResearch, pendingCards } = clone(priv.history[at]!);
    nextPriv = { area, pendingResearch, pendingCards, history: priv.history.slice(0, at) };
  }

  const restored: GameState = {
    ...clone(record.before),
    logSeq: game.logSeq,
    uids: [...game.uids],
    history: game.history.slice(0, -1),
  };
  return { game: restored, priv: nextPriv };
}

/** A room code: 6 characters from an alphabet without look-alikes. */
export function newCode(rand: () => number): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    const at = Math.floor(rand() * CODE_ALPHABET.length);
    code += CODE_ALPHABET[Math.min(CODE_ALPHABET.length - 1, Math.max(0, at))];
  }
  return code;
}
