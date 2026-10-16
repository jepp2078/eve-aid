import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FactionId } from '../../src/data/types';
import type { GameState } from '../../src/engine/types';
import type { Snapshot } from '../../src/sync/store';
import { createApi, orderUrls, publicUid, type ApiHandler } from '../../server/api';
import { GameHost, type Persistence } from '../../server/games';
import { fileStore, memoryStore } from '../../server/persist';
import { DEFAULT_SETUP, NOW } from '../engine/helpers';

/** Device secrets, as browsers send them; the host only ever sees their public uids. */
const A = 'secret-device-ana-7f3a91';
const B = 'secret-device-cal-0c55e2';
/** A spare device that holds no seat (a borrowed phone, the laptop's browser opened with `?as=spare`). */
const C = 'secret-device-spare-91d0aa';
const PA = publicUid(A);
const PB = publicUid(B);
const PC = publicUid(C);
const URLS = ['http://192.168.1.23:5180'];

interface Running {
  base: string;
  host: GameHost;
  api: ApiHandler;
  errors: unknown[];
}

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
});

async function start(opts: { host?: GameHost; pingMs?: number; urls?: string[]; store?: Persistence } = {}): Promise<Running> {
  const host = opts.host ?? new GameHost(opts.store ?? memoryStore(), () => NOW, Math.random);
  const errors: unknown[] = [];
  const urls = opts.urls ?? URLS;
  const api = createApi(host, () => urls, { pingMs: opts.pingMs, now: () => NOW, onError: (e) => errors.push(e) });
  const server: Server = createServer((req, res) =>
    api(req, res, () => {
      res.statusCode = 418;
      res.end('not api');
    }),
  );
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        api.close();
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, host, api, errors };
}

async function post(base: string, path: string, body: unknown, device: string | null = A): Promise<{ status: number; json: any }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (device !== null) headers['X-Device-Id'] = device;
  const res = await fetch(base + path, { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

async function createGame(base: string, device = A, name = 'Ana', faction = 'amarr', mode?: unknown): Promise<string> {
  const r = await post(base, '/api/games', mode === undefined ? { name, faction } : { name, faction, mode }, device);
  expect(r.status).toBe(200);
  return r.json.code as string;
}

interface Stream {
  status: number;
  headers: Headers;
  /** The raw data of the next event of this type (others are skipped). */
  nextOf(type: string): Promise<string>;
  /** The next `snapshot` event's parsed data. */
  next(): Promise<Snapshot | null>;
  /** Resolves when the server ends the stream. */
  ended(): Promise<void>;
  close(): void;
}

async function openStream(base: string, path: string): Promise<Stream> {
  const ac = new AbortController();
  const res = await fetch(base + path, { signal: ac.signal });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let done = false;
  cleanups.push(() => ac.abort());

  async function pull(): Promise<boolean> {
    if (done) return false;
    const r = await reader.read().catch(() => ({ done: true, value: undefined }));
    if (r.done) {
      done = true;
      return false;
    }
    buf += dec.decode(r.value, { stream: true });
    return true;
  }

  async function nextOf(type: string): Promise<string> {
    for (;;) {
      const i = buf.indexOf('\n\n');
      if (i >= 0) {
        const block = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const lines = block.split('\n');
        const event = lines.find((l) => l.startsWith('event: '))?.slice(7);
        if (event === type) return lines.filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
        continue; // other events, retry hints
      }
      if (!(await pull())) throw new Error('stream ended');
    }
  }

  return {
    status: res.status,
    headers: res.headers,
    nextOf,
    async next() {
      return JSON.parse(await nextOf('snapshot')) as Snapshot | null;
    },
    async ended() {
      while (await pull());
    },
    close: () => ac.abort(),
  };
}

describe('laptop API', () => {
  it('lists the likeliest phone-reachable url first', async () => {
    const { base } = await start({ urls: ['http://100.64.0.7:5180', 'http://10.0.0.5:5180', 'http://192.168.1.23:5180'] });
    const body = (await (await fetch(`${base}/api/info`)).json()) as { urls: string[] };
    expect(body.urls).toStrictEqual(['http://192.168.1.23:5180', 'http://10.0.0.5:5180', 'http://100.64.0.7:5180']);
  });

  it('reports the mode and the LAN urls', async () => {
    const { base } = await start();
    const res = await fetch(`${base}/api/info`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toStrictEqual({ mode: 'laptop', urls: URLS });
  });

  it('creates a game and answers with its code', async () => {
    const { base, host } = await start();
    const code = await createGame(base);
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(host.snapshot(code, PA, 50)!.game.players.amarr!.uid).toBe(PA);
  });

  it('creates a light game', async () => {
    const { base, host } = await start();
    const code = await createGame(base, A, 'Ana', 'amarr', 'light');
    expect(host.snapshot(code, PA, 50)!.game.mode).toBe('light');
  });

  it('creates a full game when the mode is missing', async () => {
    const { base, host } = await start();
    const code = await createGame(base);
    expect(host.snapshot(code, PA, 50)!.game.mode).toBe('full');
    const full = await createGame(base, B, 'Cal', 'caldari', 'full');
    expect(host.snapshot(full, PB, 50)!.game.mode).toBe('full');
  });

  it('refuses an unknown mode', async () => {
    const store = memoryStore();
    const { base } = await start({ store });
    const r = await post(base, '/api/games', { name: 'Ana', faction: 'amarr', mode: 'heavy' });
    expect(r.status).toBe(400);
    expect(r.json).toStrictEqual({ error: { error: true, code: 'bad_mode', message: 'Choose a full or a scorekeeper game' } });
    for (const mode of [null, 1, '', 'LIGHT', ['light'], {}]) {
      expect((await post(base, '/api/games', { name: 'Ana', faction: 'amarr', mode })).json.error.code).toBe('bad_mode');
    }
    expect(store.loadAll()).toStrictEqual([]); // nothing was created
  });

  it('answers a rule error from create with the RuleError', async () => {
    const { base } = await start();
    const r = await post(base, '/api/games', { name: ' ', faction: 'amarr' });
    expect(r.status).toBe(422);
    expect(r.json).toStrictEqual({ error: { error: true, code: 'bad_name', message: expect.any(String) } });
  });

  it('streams a full snapshot on connect and after every change, private docs only to their owner', async () => {
    const { base } = await start();
    const code = await createGame(base);
    const sa = await openStream(base, `/api/games/${code}/stream?device=${A}`);
    expect(sa.status).toBe(200);
    expect(sa.headers.get('content-type')).toBe('text/event-stream');
    expect(sa.headers.get('cache-control')).toBe('no-cache');
    const first = (await sa.next())!;
    expect(first.game.code).toBe(code);
    expect(first.game.seats).toStrictEqual(['amarr']);
    expect(first.priv).toStrictEqual({ area: [], pendingResearch: 0, pendingCards: 0, history: [] });
    expect(first.log).toStrictEqual([]);

    const sb = await openStream(base, `/api/games/${code}/stream?device=${B}`);
    expect((await sb.next())!.priv).toBeNull();

    const r = await post(base, `/api/games/${code}/commands`, { cmd: { type: 'join', name: 'Cal', faction: 'caldari' } }, B);
    expect(r).toStrictEqual({ status: 200, json: { ok: true } });

    const a2 = (await sa.next())!;
    const b2 = (await sb.next())!;
    expect(a2.game.seats).toStrictEqual(['amarr', 'caldari']);
    expect(a2.log.map((e) => e.type)).toStrictEqual(['join']);
    expect(a2.log[0]).not.toHaveProperty('before');
    expect(a2.priv).toStrictEqual(first.priv);
    expect(b2.game).toStrictEqual(a2.game);
    expect(b2.priv).toStrictEqual({ area: [], pendingResearch: 0, pendingCards: 0, history: [] });
  });

  it('undoes over POST and streams the restored state', async () => {
    const { base } = await start();
    const code = await createGame(base);
    await post(base, `/api/games/${code}/commands`, { cmd: { type: 'join', name: 'Cal', faction: 'caldari' } }, B);
    const s = await openStream(base, `/api/games/${code}/stream?device=${A}`);
    expect((await s.next())!.game.seats).toStrictEqual(['amarr', 'caldari']);
    expect(await post(base, `/api/games/${code}/undo`, {})).toStrictEqual({ status: 200, json: { ok: true } });
    const after = (await s.next())!;
    expect(after.game.seats).toStrictEqual(['amarr']);
    expect(after.log[0]).toMatchObject({ type: 'join', undone: true });
    const again = await post(base, `/api/games/${code}/undo`, {});
    expect(again.status).toBe(422);
    expect(again.json.error.code).toBe('nothing_to_undo');
  });

  it('honours the seq named in the undo body', async () => {
    const { base } = await start();
    const code = await createGame(base);
    await post(base, `/api/games/${code}/commands`, { cmd: { type: 'join', name: 'Cal', faction: 'caldari' } }, B); // seq 1
    const stale = await post(base, `/api/games/${code}/undo`, { seq: 0 });
    expect(stale.status).toBe(422);
    expect(stale.json.error.code).toBe('not_latest');
    const bad = await post(base, `/api/games/${code}/undo`, { seq: 'one' });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('bad_undo');
    expect(await post(base, `/api/games/${code}/undo`, { seq: 1 })).toStrictEqual({ status: 200, json: { ok: true } });
  });

  it('answers rule errors from commands and unknown games', async () => {
    const { base } = await start();
    const code = await createGame(base);
    const r = await post(base, `/api/games/${code}/commands`, { cmd: { type: 'startGame', firstPlayer: 'amarr' } });
    expect(r.status).toBe(422);
    expect(r.json.error).toMatchObject({ error: true, code: 'not_enough_players' });
    const none = await post(base, '/api/games/NOPE42/commands', { cmd: { type: 'endTurn' } });
    expect(none.status).toBe(404);
    expect(none.json.error.code).toBe('no_game');
    const bad = await post(base, `/api/games/${code}/commands`, { command: { type: 'endTurn' } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.code).toBe('bad_command');
  });

  it('applies a command or an undo once when the phone sends it twice with the same cmdId (M1)', async () => {
    const { base, host } = await start();
    const code = await createGame(base);
    const join = { cmd: { type: 'join', name: 'Cal', faction: 'caldari' }, cmdId: 'c0ffee01' };
    expect(await post(base, `/api/games/${code}/commands`, join, B)).toStrictEqual({ status: 200, json: { ok: true } });
    expect(await post(base, `/api/games/${code}/commands`, join, B)).toStrictEqual({ status: 200, json: { ok: true } });
    expect(host.snapshot(code, PA, 100)!.log).toHaveLength(1);
    const undo = { seq: 1, cmdId: 'c0ffee02' };
    expect(await post(base, `/api/games/${code}/undo`, undo)).toStrictEqual({ status: 200, json: { ok: true } });
    expect(await post(base, `/api/games/${code}/undo`, undo)).toStrictEqual({ status: 200, json: { ok: true } });
    expect(host.snapshot(code, PA, 100)!.game.seats).toStrictEqual(['amarr']);
    for (const cmdId of [7, '', 'x'.repeat(65), 'no spaces']) {
      const bad = await post(base, `/api/games/${code}/commands`, { cmd: { type: 'endTurn' }, cmdId });
      expect(bad.status).toBe(400);
      expect(bad.json.error.code).toBe('bad_command');
      expect((await post(base, `/api/games/${code}/undo`, { cmdId })).status).toBe(400);
    }
  });

  it("stops sending a seat's private doc and to-dos to the old device once the seat is taken over (M11)", async () => {
    const { base } = await start();
    const code = await playToResearch(base);
    const sb = await openStream(base, `/api/games/${code}/stream?device=${B}`);
    const before = (await sb.next())!;
    expect(before.priv!.pendingResearch).toBe(1);
    expect(before.todos.map((t) => t.to)).toStrictEqual(['caldari']);
    const sc = await openStream(base, `/api/games/${code}/stream?device=${C}`);
    expect((await sc.next())!.priv).toBeNull();

    expect(await post(base, `/api/games/${code}/commands`, { cmd: { type: 'takeOver', faction: 'caldari' } }, C)).toStrictEqual({ status: 200, json: { ok: true } });
    const oldDevice = (await sb.next())!;
    const newDevice = (await sc.next())!;
    expect(oldDevice.priv).toBeNull();
    expect(oldDevice.todos).toStrictEqual([]);
    expect(newDevice.priv).toStrictEqual(before.priv);
    expect(newDevice.todos).toStrictEqual(before.todos);

    // …and on every later change too.
    expect((await post(base, `/api/games/${code}/commands`, { cmd: { type: 'eventPlayed' } }, A)).status).toBe(200);
    expect((await sb.next())!.priv).toBeNull();
    expect((await sc.next())!.priv!.pendingResearch).toBe(1);
  });

  it('accepts a lower-case game code', async () => {
    const { base } = await start();
    const code = await createGame(base);
    const r = await post(base, `/api/games/${code.toLowerCase()}/commands`, { cmd: { type: 'join', name: 'Cal', faction: 'caldari' } }, B);
    expect(r.status).toBe(200);
  });

  it('streams null for an unknown game', async () => {
    const { base } = await start();
    const s = await openStream(base, `/api/games/NOPE42/stream?device=${A}`);
    expect(s.status).toBe(200);
    expect(await s.next()).toBeNull();
  });

  it('sends the latest 50 log entries by default, or as many as asked', async () => {
    const { base, host } = await start();
    const code = await createGame(base);
    for (let i = 0; i < 55; i++) expect(host.dispatch(code, PA, { type: 'setSeats', seats: ['amarr'] })).toBeNull();
    const s = await openStream(base, `/api/games/${code}/stream?device=${A}`);
    const log = (await s.next())!.log;
    expect(log).toHaveLength(50);
    expect(log.at(-1)!.seq).toBe(55);
    const few = await openStream(base, `/api/games/${code}/stream?device=${A}&log=3`);
    expect((await few.next())!.log.map((e) => e.seq)).toStrictEqual([53, 54, 55]);
  });

  it('sends a heartbeat ping event with the server time', async () => {
    const { base } = await start({ pingMs: 10 });
    const code = await createGame(base);
    const s = await openStream(base, `/api/games/${code}/stream?device=${A}`);
    await s.next();
    expect(await s.nextOf('ping')).toBe(String(NOW));
    expect(await s.nextOf('ping')).toBe(String(NOW));
  });

  it('stops notifying a stream once the client goes away', async () => {
    const { base, host } = await start();
    const code = await createGame(base);
    const s = await openStream(base, `/api/games/${code}/stream?device=${A}`);
    await s.next();
    s.close();
    await new Promise((r) => setTimeout(r, 50));
    let delivered = 0;
    const off = host.subscribe(code, PB, () => delivered++);
    expect(host.dispatch(code, PA, { type: 'setSeats', seats: ['amarr'] })).toBeNull(); // must not throw on the closed stream
    expect(delivered).toBe(1);
    off();
  });

  it('ends every open stream on close()', async () => {
    const { base, api } = await start();
    const code = await createGame(base);
    const s = await openStream(base, `/api/games/${code}/stream?device=${A}`);
    await s.next();
    api.close();
    await s.ended(); // resolves only when the server ends the response
  });

  it('rejects bad JSON with 400', async () => {
    const { base } = await start();
    const r = await post(base, '/api/games', '{"name": ');
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('bad_json');
    const notObject = await post(base, '/api/games', '[1, 2]');
    expect(notObject.status).toBe(400);
  });

  it('rejects a body over 64 KB with 413', async () => {
    const { base } = await start();
    const r = await post(base, '/api/games', { name: 'x'.repeat(70 * 1024), faction: 'amarr' });
    expect(r.status).toBe(413);
    expect(r.json.error.code).toBe('too_large');
  });

  it('requires a device id on POSTs and streams', async () => {
    const { base } = await start();
    const r = await post(base, '/api/games', { name: 'Ana', faction: 'amarr' }, null);
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('no_device');
    const odd = await post(base, '/api/games', { name: 'Ana', faction: 'amarr' }, 'not a device id!');
    expect(odd.status).toBe(400);
    const code = await createGame(base);
    const s = await fetch(`${base}/api/games/${code}/stream`);
    expect(s.status).toBe(400);
    expect((await s.json()).error.code).toBe('no_device');
  });

  it('answers 404 for unknown API routes and 405 for wrong methods', async () => {
    const { base } = await start();
    for (const path of ['/api', '/api/nope', '/api/games/ABC234', '/api/games/ABC234/commands/x']) {
      const res = await fetch(base + path);
      expect(res.status, path).toBe(404);
      expect((await res.json()).error.code).toBe('not_found');
    }
    const wrong = await fetch(`${base}/api/games`);
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('POST');
  });

  it('passes everything outside /api to next()', async () => {
    const { base } = await start();
    for (const path of ['/', '/index.html', '/apiary', '/assets/x.js']) {
      const res = await fetch(base + path);
      expect(res.status, path).toBe(418);
    }
  });

  it('answers 500 and reports the error when the host throws', async () => {
    const boom = new Error('boom');
    const host = { dispatch: () => { throw boom; } } as unknown as GameHost;
    const { base, errors } = await start({ host });
    const r = await post(base, '/api/games/ABC234/commands', { cmd: { type: 'endTurn' } });
    expect(r.status).toBe(500);
    expect(r.json.error.code).toBe('server_error');
    expect(errors).toStrictEqual([boom]);
  });

  it('keeps game state out of the stream for nobody but the game', async () => {
    const { base } = await start();
    const one = await createGame(base);
    const two = await createGame(base, B, 'Cal', 'caldari');
    const s = await openStream(base, `/api/games/${one}/stream?device=${A}`);
    await s.next();
    await post(base, `/api/games/${two}/commands`, { cmd: { type: 'join', name: 'Ana', faction: 'amarr' } }, A);
    await post(base, `/api/games/${one}/commands`, { cmd: { type: 'join', name: 'Gil', faction: 'gallente' } }, 'device-c');
    const next = (await s.next()) as { game: GameState };
    expect(next.game.code).toBe(one); // the other game's change was never sent here
    expect(next.game.seats).toStrictEqual(['amarr', 'gallente']);
  });
});

describe('orderUrls', () => {
  it('puts 192.168.*, then 10.*, then 172.16–31.*, then everything else, keeping the given order within a group', () => {
    const urls = [
      'http://100.70.1.2:5180', // CGNAT / VPN
      'http://172.20.0.4:5180',
      'http://10.0.0.5:5180',
      'http://172.15.0.1:5180', // outside 172.16/12
      'http://192.168.0.162:5180',
      'http://172.31.255.1:5180',
      'http://not a url',
      'http://192.168.1.23:5180',
      'http://10.8.0.1:5180',
      'http://172.32.0.1:5180', // outside 172.16/12
      'http://laptop.local:5180',
    ];
    expect(orderUrls(urls)).toStrictEqual([
      'http://192.168.0.162:5180',
      'http://192.168.1.23:5180',
      'http://10.0.0.5:5180',
      'http://10.8.0.1:5180',
      'http://172.20.0.4:5180',
      'http://172.31.255.1:5180',
      'http://100.70.1.2:5180',
      'http://172.15.0.1:5180',
      'http://not a url',
      'http://172.32.0.1:5180',
      'http://laptop.local:5180',
    ]);
  });

  it('does not change its input', () => {
    const urls = ['http://10.0.0.5:5180', 'http://192.168.1.23:5180'];
    orderUrls(urls);
    expect(urls).toStrictEqual(['http://10.0.0.5:5180', 'http://192.168.1.23:5180']);
  });
});

/** Ana (secret A, amarr) creates, Cal (secret B, caldari) joins, both set up; Cal then discovers 1 research (private). */
async function playToResearch(base: string): Promise<string> {
  const code = await createGame(base, A, 'Ana', 'amarr');
  const ok = async (device: string, cmd: unknown) =>
    expect(await post(base, `/api/games/${code}/commands`, { cmd }, device)).toStrictEqual({ status: 200, json: { ok: true } });
  await ok(B, { type: 'join', name: 'Cal', faction: 'caldari' });
  await ok(A, { type: 'startGame', firstPlayer: 'amarr' });
  for (const [device, f] of [[A, 'amarr'], [B, 'caldari']] as [string, FactionId][]) {
    await ok(device, { type: 'setupFaction', ...DEFAULT_SETUP[f] });
  }
  await ok(B, { type: 'discover', rewards: [{ kind: 'research', amount: 1 }] });
  return code;
}

describe('device identity', () => {
  it('derives a 24-hex public uid from the device secret', () => {
    expect(PA).toMatch(/^[0-9a-f]{24}$/);
    expect(PA).not.toBe(PB);
    expect(publicUid(A)).toBe(PA);
    expect(PA).not.toContain(A);
  });

  it('tells a device its public uid on /api/info, matching the seat it holds', async () => {
    const { base, host } = await start();
    const code = await createGame(base, A, 'Ana', 'amarr');
    await post(base, `/api/games/${code}/commands`, { cmd: { type: 'join', name: 'Cal', faction: 'caldari' } }, B);
    const game = host.snapshot(code, PA, 0)!.game;
    const youA = (await (await fetch(`${base}/api/info`, { headers: { 'X-Device-Id': A } })).json()) as { you: string };
    const youB = (await (await fetch(`${base}/api/info`, { headers: { 'X-Device-Id': B } })).json()) as { you: string };
    expect(youA.you).toBe(game.players.amarr!.uid);
    expect(youB.you).toBe(game.players.caldari!.uid);
    expect(game.uids).toStrictEqual([youA.you, youB.you]);
    const anonymous = (await (await fetch(`${base}/api/info`)).json()) as Record<string, unknown>;
    expect(anonymous).not.toHaveProperty('you');
    expect((await fetch(`${base}/api/info`, { headers: { 'X-Device-Id': 'bad id!' } })).status).toBe(400);
  });

  it("gives no private doc to a stream that presents another seat's public uid", async () => {
    const { base } = await start();
    const code = await playToResearch(base);
    const real = await openStream(base, `/api/games/${code}/stream?device=${B}`);
    const realSnap = (await real.next())!;
    expect(realSnap.priv!.pendingResearch).toBe(1);
    const stolenUid = realSnap.game.players.caldari!.uid; // public: every device can read it
    expect(stolenUid).toBe(PB);

    const thief = await openStream(base, `/api/games/${code}/stream?device=${stolenUid}`);
    const thiefSnap = (await thief.next())!;
    expect(thiefSnap.priv).toBeNull();
    expect(thiefSnap.game).toStrictEqual(realSnap.game);
    // ...because it is a different, unseated device:
    const who = (await (await fetch(`${base}/api/info`, { headers: { 'X-Device-Id': stolenUid } })).json()) as { you: string };
    expect(who.you).not.toBe(PB);
    expect(Object.values(realSnap.game.players).map((p) => p!.uid)).not.toContain(who.you);
  });

  it("cannot act as, or undo for, a seat by POSTing its public uid", async () => {
    const { base, host } = await start();
    const code = await playToResearch(base);
    const before = host.snapshot(code, PB, 100)!;

    const act = await post(base, `/api/games/${code}/commands`, { cmd: { type: 'discover', rewards: [{ kind: 'research', amount: 2 }] } }, PB);
    expect(act.status).toBe(422);
    expect(act.json.error.code).toBe('not_seated');
    const undo = await post(base, `/api/games/${code}/undo`, {}, PB);
    expect(undo.status).toBe(422);
    expect(undo.json.error.code).toBe('not_your_undo');
    expect(host.snapshot(code, PB, 100)).toStrictEqual(before);

    expect(await post(base, `/api/games/${code}/undo`, {}, B)).toStrictEqual({ status: 200, json: { ok: true } });
    expect(host.snapshot(code, PB, 100)!.priv!.pendingResearch).toBe(0);
  });

  it('never puts a device secret into a snapshot or a saved file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'eve-api-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const { base } = await start({ store: fileStore(dir) });
    const code = await createGame(base, A, 'Ana', 'amarr');
    const sa = await openStream(base, `/api/games/${code}/stream?device=${A}`);
    const sb = await openStream(base, `/api/games/${code}/stream?device=${B}`);
    const seen: string[] = [JSON.stringify(await sa.next()), JSON.stringify(await sb.next())];
    const ok = async (device: string, cmd: unknown) => {
      expect((await post(base, `/api/games/${code}/commands`, { cmd }, device)).status).toBe(200);
      seen.push(JSON.stringify(await sa.next()), JSON.stringify(await sb.next()));
    };
    await ok(B, { type: 'join', name: 'Cal', faction: 'caldari' });
    await ok(A, { type: 'startGame', firstPlayer: 'amarr' });
    await ok(A, { type: 'setupFaction', ...DEFAULT_SETUP.amarr });
    await ok(B, { type: 'setupFaction', ...DEFAULT_SETUP.caldari });
    await ok(B, { type: 'discover', rewards: [{ kind: 'research', amount: 1 }] });
    await ok(C, { type: 'takeOver', faction: 'amarr' }); // uids change hands too

    const names = readdirSync(dir).sort();
    expect(names).toStrictEqual([`${code}.json`, `${code}.json.bak`]); // the game and its previous version
    const files = names.map((f) => readFileSync(join(dir, f), 'utf8'));
    for (const text of [...seen, ...files]) {
      expect(text).not.toContain(A);
      expect(text).not.toContain(B);
      expect(text).not.toContain(C);
    }
    expect(files[0]).toContain(PA); // the public uids are what is stored
    expect(files[0]).toContain(PB);
    expect(files[0]).toContain(PC);
  });
});
