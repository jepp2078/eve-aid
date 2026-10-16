/**
 * The laptop host's game table: every game in memory, each change applied through the shared commit logic,
 * saved, then pushed to subscribers. Everything here is synchronous, so commands for a game run strictly one at
 * a time (the Node event loop is the per-game queue). Devices are identified by their *public* uid (the API derives
 * it from the device's secret id, see `publicUid` in api.ts); a secret never reaches this class or game state.
 */
import type { FactionId } from '../src/data/types';
import { isError, type Command, type GameState, type PlayerPrivate, type RuleError } from '../src/engine/types';
import { err } from '../src/engine/util';
import { actorFor, HISTORY_CAP, newCode, newGameFor, runCommand, runUndo } from '../src/sync/commit';
import type { LogEntry, Snapshot, UndoRecord } from '../src/sync/store';
import { addTodos, dropTodos, todosFor, type Todo } from '../src/sync/todos';

export type { Snapshot } from '../src/sync/store';

export interface StoredGame {
  game: GameState;
  privs: Partial<Record<FactionId, PlayerPrivate>>;
  log: LogEntry[];
  undo: UndoRecord[];
  /** Every seat's to-dos, kept until their entry is undone (`sync/todos`); each device gets its own (`todosFor`). */
  todos: Todo[];
}

export interface Persistence {
  loadAll(): StoredGame[];
  save(s: StoredGame): void;
  /** Whether anything is saved under `code`, loadable or not: such a code is never given to a new game. */
  has(code: string): boolean;
}

/** Log entries kept per game. Undo records are kept only for the `HISTORY_CAP` entries that can still be undone. */
export const KEEP = 100;
const CODE_ATTEMPTS = 100;
/** Command ids remembered per device: a phone retries a lost POST at once, so a handful is plenty. */
export const REMEMBERED_COMMANDS = 20;

interface Subscriber {
  uid: string;
  cb: (s: Snapshot) => void;
}

function isCommandLike(cmd: unknown): cmd is Command {
  return typeof cmd === 'object' && cmd !== null && !Array.isArray(cmd) && typeof (cmd as { type?: unknown }).type === 'string';
}

function noGame(code: string): RuleError {
  return err('no_game', `There is no game with code ${code}`);
}

export class GameHost {
  private readonly games = new Map<string, StoredGame>();
  private readonly subs = new Map<string, Set<Subscriber>>();
  /** Per device uid: the answers to its latest command ids, oldest first (see `once`). */
  private readonly answered = new Map<string, Map<string, RuleError | null>>();

  constructor(
    private readonly persist: Persistence,
    private readonly now: () => number,
    private readonly rand: () => number,
  ) {
    for (const s of persist.loadAll()) this.games.set(s.game.code, s);
  }

  /**
   * Opens a lobby with `uid` seated as `faction`, a full game unless `mode` says `'light'`; returns the room code.
   * `code` is a code the caller picked (the cloud host, where it names the game's Durable Object): `code_taken` when
   * a game already has it. Without it the host draws a free one.
   */
  create(uid: string, name: string, faction: FactionId, mode?: unknown, code?: string): string | RuleError {
    if (code !== undefined) {
      if (this.games.has(code) || this.persist.has(code)) return err('code_taken', 'That game code is taken');
      return this.open(code, uid, name, faction, mode);
    }
    let drawn = newCode(this.rand);
    for (let i = 1; this.games.has(drawn) || this.persist.has(drawn); i++) {
      if (i >= CODE_ATTEMPTS) return err('no_code', 'Could not find a free game code; try again');
      drawn = newCode(this.rand);
    }
    return this.open(drawn, uid, name, faction, mode);
  }

  /** Whether a game has `code` (in memory: what `snapshot` and `dispatch` can find). */
  has(code: string): boolean {
    return this.games.has(code);
  }

  private open(code: string, uid: string, name: string, faction: FactionId, mode: unknown): string | RuleError {
    const r = newGameFor(code, uid, name, faction, this.now(), mode);
    if (isError(r)) return r;
    this.commit({ game: r.game, privs: { [faction]: r.priv }, log: [], undo: [], todos: [] });
    return code;
  }

  /**
   * Runs `run` once per `cmdId` from `uid`: a repeat (the phone never got the first answer and sent it again) gets the
   * first answer back and changes nothing. Without an id it simply runs. The last `REMEMBERED_COMMANDS` ids of each
   * device are remembered (in memory: a host restart forgets them, as it ends every connection anyway).
   */
  private once(uid: string, cmdId: string | undefined, run: () => RuleError | null): RuleError | null {
    if (cmdId === undefined) return run();
    let mine = this.answered.get(uid);
    if (mine === undefined) this.answered.set(uid, (mine = new Map()));
    const known = mine.get(cmdId);
    if (known !== undefined) return known;
    const answer = run();
    mine.set(cmdId, answer);
    if (mine.size > REMEMBERED_COMMANDS) mine.delete(mine.keys().next().value!);
    return answer;
  }

  /** Applies `cmd` as `uid` (once per `cmdId`, see `once`). Nothing is saved or sent when it fails. */
  dispatch(code: string, uid: string, cmd: Command, cmdId?: string): RuleError | null {
    return this.once(uid, cmdId, () => this.apply(code, uid, cmd));
  }

  private apply(code: string, uid: string, cmd: Command): RuleError | null {
    const s = this.games.get(code);
    if (!s) return noGame(code);
    if (!isCommandLike(cmd)) return err('bad_command', 'That command could not be read');
    const actor = actorFor(s.game, uid);
    const r = runCommand(s.game, actor === null ? null : (s.privs[actor] ?? null), cmd, uid, this.now());
    if (isError(r)) return r;
    this.commit({
      game: r.game,
      privs: r.privOwner === null || r.priv === null ? s.privs : { ...s.privs, [r.privOwner]: r.priv },
      log: [...s.log, r.entry].slice(-KEEP),
      undo: [...s.undo, r.undo].slice(-HISTORY_CAP), // exactly the entries game.history can still undo
      todos: addTodos(s.todos, r.entry),
    });
    return null;
  }

  /**
   * Reverts the latest change still in the game's history. `seq` names the entry the device means (the newest it
   * shows): when something newer happened meanwhile, nothing is undone (`not_latest`), so an undo never reverts a
   * change its player hasn't seen. Once per `cmdId`, like `dispatch`.
   */
  undo(code: string, uid: string, seq?: number, cmdId?: string): RuleError | null {
    return this.once(uid, cmdId, () => this.revert(code, uid, seq));
  }

  private revert(code: string, uid: string, seq: number | undefined): RuleError | null {
    const s = this.games.get(code);
    if (!s) return noGame(code);
    const last = s.game.history.at(-1);
    if (last === undefined) return err('nothing_to_undo', 'There is nothing to undo');
    if (seq !== undefined && last.seq !== seq) {
      return err('not_latest', 'Something newer happened first, so nothing was undone. Check the log.');
    }
    const entry = s.log.find((e) => e.seq === last.seq);
    const record = s.undo.find((u) => u.seq === last.seq);
    if (entry === undefined || record === undefined) return err('no_undo', 'That change can no longer be undone');
    const owner = entry.touchedPrivate ? entry.actor : null;
    const r = runUndo(s.game, entry, record, owner === null ? null : (s.privs[owner] ?? null), uid);
    if (isError(r)) return r;

    const privs: StoredGame['privs'] = {};
    for (const [f, p] of Object.entries(s.privs) as [FactionId, PlayerPrivate][]) {
      if (r.game.players[f]) privs[f] = f === owner && r.priv !== null ? r.priv : p; // an undone join frees the seat
    }
    this.commit({
      game: r.game,
      privs,
      log: s.log.map((e) => (e.seq === entry.seq ? { ...e, undone: true } : e)),
      undo: s.undo.filter((u) => u.seq !== entry.seq),
      todos: dropTodos(s.todos, entry.seq),
    });
    return null;
  }

  /** What `uid` may see of the game: never another seat's private doc or to-dos. Null for an unknown code. */
  snapshot(code: string, uid: string, logLimit: number): Snapshot | null {
    const s = this.games.get(code);
    if (!s) return null;
    const actor = actorFor(s.game, uid);
    return {
      game: s.game,
      priv: actor === null ? null : (s.privs[actor] ?? null),
      log: logLimit > 0 ? s.log.slice(-logLimit) : [],
      todos: todosFor(s.todos, actor),
    };
  }

  /** Calls `cb` with `uid`'s snapshot (all kept log entries) after every successful change to the game. */
  subscribe(code: string, uid: string, cb: (s: Snapshot) => void): () => void {
    const sub: Subscriber = { uid, cb };
    let set = this.subs.get(code);
    if (!set) this.subs.set(code, (set = new Set()));
    set.add(sub);
    return () => {
      set.delete(sub);
      if (set.size === 0 && this.subs.get(code) === set) this.subs.delete(code);
    };
  }

  /** Saves first (a failed save changes nothing), then swaps the game in and tells its subscribers. */
  private commit(next: StoredGame): void {
    const code = next.game.code;
    this.persist.save(next);
    this.games.set(code, next);
    for (const sub of [...(this.subs.get(code) ?? [])]) {
      const snap = this.snapshot(code, sub.uid, KEEP);
      if (snap !== null) sub.cb(snap);
    }
  }
}
