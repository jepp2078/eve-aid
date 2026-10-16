/**
 * One game in the cloud: what a `GameRoom` Durable Object (`worker/index.ts`) does, without Cloudflare's classes, so
 * it runs in the Node tests too. It wraps the laptop's `GameHost` around the object's own SQLite (`sqlStore`) and,
 * after every change, sends each connected device its own snapshot.
 *
 * Devices listen over hibernatable WebSockets. A socket carries what it needs in its attachment (code, uid, log
 * size), because the object is evicted from memory between moves and comes back with only its storage and its
 * sockets. Each frame the room sends is one snapshot as JSON (`null`: no game has that code), the same `data` the
 * laptop's event stream sends. The client's heartbeat is answered by the runtime (`PING` → `PONG`) without waking
 * the object.
 *
 * In memory only: `GameHost`'s per-device command ids (a retried POST arrives within a second, long before the
 * object is evicted).
 */
import type { FactionId } from '../src/data/types';
import { isError, type Command, type RuleError } from '../src/engine/types';
import { GameHost } from '../server/games';
import { sqlStore, type Sql } from './sqlStore';

/** The heartbeat a client sends, and the answer the runtime gives without waking the object. */
export const PING = 'ping';
export const PONG = 'pong';
/** A game nobody has touched for this long is deleted (an alarm the room pushes back on every change). */
export const EXPIRE_MS = 30 * 24 * 60 * 60 * 1000;

/** What a socket remembers across hibernation. */
export interface Listener {
  code: string;
  uid: string;
  log: number;
}

export interface Socket {
  send(text: string): void;
  deserializeAttachment(): unknown;
}

export interface RoomContext {
  sql: Sql;
  /** The room's open sockets (after a hibernation too). */
  sockets(): Socket[];
}

function listenerOf(ws: Socket): Listener | null {
  const a = ws.deserializeAttachment() as Partial<Listener> | null;
  return a !== null && typeof a.code === 'string' && typeof a.uid === 'string' && typeof a.log === 'number' ? (a as Listener) : null;
}

export class Room {
  private host: GameHost | null = null;

  constructor(
    private readonly ctx: RoomContext,
    private readonly now: () => number = Date.now,
    private readonly rand: () => number = Math.random,
  ) {}

  /** The game, loaded from storage on first use after the object (re)starts. */
  private get games(): GameHost {
    return (this.host ??= new GameHost(sqlStore(this.ctx.sql), this.now, this.rand));
  }

  /** Opens the lobby under `code` (the object's name); `code_taken` when this room already has a game. */
  create(code: string, uid: string, name: string, faction: FactionId, mode: unknown): string | RuleError {
    const r = this.games.create(uid, name, faction, mode, code);
    if (!isError(r)) this.broadcast();
    return r;
  }

  dispatch(code: string, uid: string, cmd: Command, cmdId?: string): RuleError | null {
    const r = this.games.dispatch(code, uid, cmd, cmdId);
    if (r === null) this.broadcast();
    return r;
  }

  undo(code: string, uid: string, seq?: number, cmdId?: string): RuleError | null {
    const r = this.games.undo(code, uid, seq, cmdId);
    if (r === null) this.broadcast();
    return r;
  }

  /** The frame a listener gets: its own snapshot, or `null` when no game has the code. */
  frame(l: Listener): string {
    return JSON.stringify(this.games.snapshot(l.code, l.uid, l.log));
  }

  /** Deletes the game (it expired); connected devices are told it is gone. */
  expire(): void {
    this.ctx.sql.exec('DROP TABLE IF EXISTS game');
    this.host = null;
    this.broadcast();
  }

  private broadcast(): void {
    for (const ws of this.ctx.sockets()) {
      const l = listenerOf(ws);
      if (l === null) continue;
      try {
        ws.send(this.frame(l));
      } catch {
        // closing or closed: the device reconnects and gets a full snapshot
      }
    }
  }
}
