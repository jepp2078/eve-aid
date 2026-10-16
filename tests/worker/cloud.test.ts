/**
 * The cloud host without Cloudflare: `handleApi` with each game's `Room` on a real SQLite database (`node:sqlite`).
 * Every call builds a fresh `Room` over the game's database, as an evicted Durable Object would, so these tests also
 * prove a game lives in its storage and not in memory.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import type { FactionId } from '../../src/data/types';
import type { Command, RuleError } from '../../src/engine/types';
import type { Snapshot } from '../../src/sync/store';
import { publicUid } from '../../server/protocol';
import { handleApi, type CloudEnv, type RoomStub } from '../../worker/api';
import { Room, type Listener, type Socket } from '../../worker/room';
import type { Sql } from '../../worker/sqlStore';

const ORIGIN = 'https://eve.example.workers.dev';

/** Cloudflare's `exec` runs the statement at once (the cursor only hands out the rows); so does this. */
function sqlOf(db: DatabaseSync): Sql {
  return {
    exec(query, ...bindings) {
      const stmt = db.prepare(query);
      const rows = /^\s*SELECT/i.test(query) ? (stmt.all(...(bindings as never[])) as Record<string, unknown>[]) : (stmt.run(...(bindings as never[])), []);
      return { toArray: () => rows };
    },
  };
}

class FakeSocket implements Socket {
  readonly frames: (Snapshot | null)[] = [];
  constructor(readonly listener: Listener) {}
  send(text: string): void {
    this.frames.push(JSON.parse(text) as Snapshot | null);
  }
  deserializeAttachment(): unknown {
    return this.listener;
  }
  get last(): Snapshot | null | undefined {
    return this.frames.at(-1);
  }
}

/** A cloud of rooms: one database and socket list per code; a new Room (a woken object) for every call. */
function cloud(opts: { codes?: string[]; allowCreate?: () => boolean } = {}) {
  const dbs = new Map<string, DatabaseSync>();
  const sockets = new Map<string, FakeSocket[]>();
  const codes = [...(opts.codes ?? [])];
  let drawn = 0;
  const roomFor = (code: string): Room => {
    if (!dbs.has(code)) dbs.set(code, new DatabaseSync(':memory:'));
    return new Room({ sql: sqlOf(dbs.get(code)!), sockets: () => sockets.get(code) ?? [] });
  };
  const env: CloudEnv = {
    room: (code): RoomStub => ({
      create: async (...a) => roomFor(code).create(...a),
      dispatch: async (...a) => roomFor(code).dispatch(...a),
      undo: async (...a) => roomFor(code).undo(...a),
    }),
    newCode: () => codes.shift() ?? `GAME${String(++drawn).padStart(2, '0')}`,
    mayCreate: async () => opts.allowCreate?.() ?? true,
    connect: async () => new Response('socket'),
    onError: (e) => {
      throw e;
    },
  };
  /** Connects a device's socket to `code` the way the Durable Object does: attach, then send its first frame. */
  const listen = (code: string, secret: string, log = 50): FakeSocket => {
    const ws = new FakeSocket({ code, uid: publicUid(secret), log });
    sockets.set(code, [...(sockets.get(code) ?? []), ws]);
    ws.send(roomFor(code).frame(ws.listener));
    return ws;
  };
  return { env, listen, roomFor };
}

async function call(env: CloudEnv, path: string, init: { method?: string; device?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...init.headers };
  if (init.device !== undefined) headers['X-Device-Id'] = init.device;
  const res = await handleApi(
    new Request(ORIGIN + path, { method: init.method ?? 'GET', headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }),
    env,
  );
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

async function create(env: CloudEnv, device: string, faction: FactionId = 'amarr'): Promise<string> {
  const r = await call(env, '/api/games', { method: 'POST', device, body: { name: 'Ana', faction } });
  expect(r.status).toBe(200);
  return r.body.code as string;
}

const command = (env: CloudEnv, code: string, device: string, cmd: Command, cmdId?: string) =>
  call(env, `/api/games/${code}/commands`, { method: 'POST', device, body: { cmd, cmdId } });

describe('cloud host', () => {
  it('says it is the cloud and who the device is', async () => {
    const { env } = cloud();
    expect((await call(env, '/api/info')).body).toEqual({ mode: 'cloud', urls: [ORIGIN] });
    expect((await call(env, '/api/info', { device: 'secret-a' })).body).toEqual({ mode: 'cloud', urls: [ORIGIN], you: publicUid('secret-a') });
  });

  it('keeps a game in its room storage and streams each device its own snapshot', async () => {
    const { env, listen } = cloud();
    const code = await create(env, 'secret-a');
    const a = listen(code, 'secret-a');
    const b = listen(code, 'secret-b');
    expect(a.last?.game.players.amarr?.uid).toBe(publicUid('secret-a'));
    expect(a.last?.priv).not.toBeNull();
    expect(b.last?.priv).toBeNull();

    expect((await command(env, code, 'secret-b', { type: 'join', name: 'Cal', faction: 'caldari' })).status).toBe(200);
    expect(a.last?.game.players.caldari?.name).toBe('Cal');
    expect(b.last?.priv).not.toBeNull(); // now b holds a seat: its own private doc
  });

  it('applies a retried command once while the room is awake', async () => {
    const { env, roomFor } = cloud();
    const code = await create(env, 'secret-a');
    const room = roomFor(code);
    const join: Command = { type: 'join', name: 'Cal', faction: 'caldari' };
    const uid = publicUid('secret-b');
    expect(room.dispatch(code, uid, join, 'c1')).toBeNull();
    expect(room.dispatch(code, uid, join, 'c1')).toBeNull(); // the first answer again, not `seat_taken`
    expect(room.dispatch(code, uid, join)?.code).toBeDefined();
  });

  it('undoes through the room', async () => {
    const { env, listen } = cloud();
    const code = await create(env, 'secret-a');
    await command(env, code, 'secret-b', { type: 'join', name: 'Cal', faction: 'caldari' });
    const a = listen(code, 'secret-a');
    const seq = a.last!.log.at(-1)!.seq;
    expect((await call(env, `/api/games/${code}/undo`, { method: 'POST', device: 'secret-a', body: { seq } })).status).toBe(200);
    expect(a.last?.game.players.caldari).toBeUndefined();
  });

  it('draws another code when the first is taken', async () => {
    const { env } = cloud({ codes: ['AAAAAA', 'AAAAAA', 'BBBBBB'] });
    expect(await create(env, 'secret-a')).toBe('AAAAAA');
    expect(await create(env, 'secret-b')).toBe('BBBBBB');
  });

  it('limits new games per client address', async () => {
    const { env } = cloud({ allowCreate: () => false });
    const r = await call(env, '/api/games', { method: 'POST', device: 'secret-a', body: { name: 'Ana', faction: 'amarr' } });
    expect(r.status).toBe(429);
    expect((r.body.error as RuleError).code).toBe('too_many_games');
  });

  it('answers bad requests without a room', async () => {
    const { env } = cloud();
    expect((await call(env, '/api/games', { method: 'POST', body: {} })).status).toBe(400); // no device id
    expect((await command(env, 'NOPE00', 'secret-a', { type: 'pass' } as Command)).status).toBe(404);
    expect((await call(env, '/api/games/x!y/commands', { method: 'POST', device: 'secret-a', body: { cmd: {} } })).status).toBe(404);
    expect((await call(env, '/api/games/AAAAAA/stream?device=secret-a')).status).toBe(426); // no WebSocket upgrade
    expect((await call(env, '/api/games', { method: 'POST', device: 'secret-a', body: { name: 'x'.repeat(70_000) } })).status).toBe(413);
    expect((await call(env, '/api/nothing')).status).toBe(404);
  });

  it('deletes an expired game and tells its devices', async () => {
    const { env, listen, roomFor } = cloud();
    const code = await create(env, 'secret-a');
    const a = listen(code, 'secret-a');
    roomFor(code).expire();
    expect(a.last).toBeNull();
    expect((await command(env, code, 'secret-a', { type: 'join', name: 'X', faction: 'caldari' })).status).toBe(404);
    expect(listen(code, 'secret-b').last).toBeNull();
  });
});
