import type { FactionId } from '../data/types';
import type { Command, GameMode, GameState, Notice, PlayerPrivate, RuleError } from '../engine/types';
import type { Todo } from './todos';

/** One applied command, as players see it in the log. */
export interface LogEntry {
  seq: number;
  at: number;
  actor: FactionId | null;
  type: Command['type'];
  /**
   * The round the command was taken in (0 in the lobby and setup). The confirm that finishes an upkeep belongs to
   * that upkeep's round, even though the game moves on to the next one. (Games saved before entries carried it get it
   * worked out when they load: `server/migrate.ts`.)
   */
  round: number;
  lines: string[];
  notices: Notice[];
  touchedPrivate: boolean;
  undone: boolean;
}

/** The public state from before entry `seq`; kept apart from the log (heavy) and never sent to clients. */
export interface UndoRecord {
  seq: number;
  before: GameState;
}

/**
 * What one device sees of a game: the public state, the private doc of the seat it holds (never anyone else's),
 * the latest log entries and its to-do list (its seat's and everyone's, `todosFor`). The laptop host streams it;
 * `null` means no game has that code.
 */
export interface Snapshot {
  game: GameState;
  priv: PlayerPrivate | null;
  log: LogEntry[];
  todos: Todo[];
}

/** The host sends every event stream a `ping` this often; a client hearing nothing for longer knows the stream is gone. */
export const PING_MS = 25_000;

/** The UI's only door to game state, on either host (`sync/hosting`). */
export interface GameStore {
  readonly mode: 'laptop' | 'cloud';
  /** Resolves to this device's public uid (the id seats are held by; compare with `players[f].uid`). */
  init(): Promise<string>;
  /** Opens a full or a light lobby with this device seated; resolves to the room code. */
  createGame(name: string, faction: FactionId, mode: GameMode): Promise<string | RuleError>;
  /** Applies a command as this device; null on success. */
  dispatch(code: string, cmd: Command): Promise<RuleError | null>;
  /**
   * Reverts the latest change; null on success. With `seq` (the entry the player sees as the latest) the host
   * refuses with `not_latest` when something newer happened meanwhile, instead of undoing that.
   */
  undo(code: string, seq?: number): Promise<RuleError | null>;
  /** URLs other players should open to reach this game's host. */
  shareUrls(): Promise<string[]>;
  /** Public state; null when no game has that code. */
  subscribeGame(code: string, cb: (g: GameState | null) => void): () => void;
  /** `faction`'s private doc, or null unless this device holds that seat. */
  subscribePrivate(code: string, faction: FactionId, cb: (p: PlayerPrivate | null) => void): () => void;
  /** The latest `limit` log entries, oldest first. */
  subscribeLog(code: string, limit: number, cb: (entries: LogEntry[]) => void): () => void;
  /** This device's to-do list (its seat's and everyone's), oldest first; empty for no game. */
  subscribeTodos(code: string, cb: (todos: Todo[]) => void): () => void;
  /** Whether the live connection to the game is up; called at once with the current state. */
  subscribeConnection(cb: (online: boolean) => void): () => void;
}
