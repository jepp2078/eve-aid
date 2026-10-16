import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, emptyPrivate } from '../../src/engine/create';
import type { GameState, PlayerPrivate } from '../../src/engine/types';
import { ServerStore, WAKE_STALE_MS } from '../../src/sync/serverStore';
import { deviceId } from '../../src/sync/session';
import type { Todo } from '../../src/sync/todos';
import type { LogEntry, Snapshot } from '../../src/sync/store';
import { NOW } from '../engine/helpers';

type Listener = (ev: { data?: string }) => void;

/** A minimal EventSource stand-in; each test gets its own class so instances don't leak between tests. */
function fakeEventSource() {
  class FakeEventSource {
    static instances: FakeEventSource[] = [];
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 2;
    readyState = 0;
    closed = false;
    private listeners = new Map<string, Set<Listener>>();
    constructor(readonly url: string) {
      FakeEventSource.instances.push(this);
    }
    addEventListener(type: string, fn: Listener): void {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type)!.add(fn);
    }
    removeEventListener(type: string, fn: Listener): void {
      this.listeners.get(type)?.delete(fn);
    }
    close(): void {
      this.closed = true;
      this.readyState = 2;
    }
    // test controls
    fire(type: string, ev: { data?: string } = {}): void {
      for (const fn of this.listeners.get(type) ?? []) fn(ev);
    }
    open(): void {
      this.readyState = 1;
      this.fire('open');
    }
    snapshot(s: Snapshot | null): void {
      this.fire('snapshot', { data: JSON.stringify(s) });
    }
    ping(): void {
      this.fire('ping', { data: String(Date.now()) });
    }
    fail(readyState: 0 | 2 = 0): void {
      this.readyState = readyState;
      this.fire('error');
    }
  }
  return FakeEventSource;
}

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** The public uid the fake host hands out (`you`). */
const YOU = 'a1b2c3d4e5f6a7b8c9d0e1f2';

/**
 * fetch that records calls and answers from a queue (default: `{ ok: true }`). The identity request of `init()`
 * (`/api/info` with a device header) is answered with `{ you: YOU }` and recorded apart, in `infoCalls`.
 */
function fakeFetch(...answers: (Response | Error)[]) {
  const calls: Call[] = [];
  const infoCalls: Call[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (String(url).endsWith('/api/info') && new Headers(init?.headers).has('X-Device-Id')) {
      infoCalls.push({ url: String(url), init });
      return json({ mode: 'laptop', urls: [], you: YOU });
    }
    calls.push({ url: String(url), init });
    const next = answers.shift() ?? json({ ok: true });
    if (next instanceof Error) throw next;
    return next;
  };
  return { fetch: fn as typeof fetch, calls, infoCalls };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Stands in for the page's wake-up events (visibilitychange to visible, pageshow, focus, online). */
function fakeWake() {
  const callbacks = new Set<() => void>();
  return {
    onWake(cb: () => void): () => void {
      callbacks.add(cb);
      return () => callbacks.delete(cb);
    },
    fire: () => [...callbacks].forEach((cb) => cb()),
    get listening() {
      return callbacks.size;
    },
  };
}

function setup(...answers: (Response | Error)[]) {
  const ES = fakeEventSource();
  const f = fakeFetch(...answers);
  const wake = fakeWake();
  const store = new ServerStore({ fetch: f.fetch, EventSource: ES as unknown as typeof EventSource, onWake: wake.onWake, retryMs: 0 });
  return { store, ES, calls: f.calls, infoCalls: f.infoCalls, wake };
}

const bodyOf = (call: Call): Record<string, unknown> => JSON.parse(String(call.init?.body)) as Record<string, unknown>;
const CMD_ID = /^[0-9a-f]{32}$/;

function header(call: Call, name: string): string | null {
  return new Headers(call.init?.headers).get(name);
}

function gameFor(device: string): GameState {
  return createGame('ABC234', device, 'Ana', 'amarr', NOW);
}

function entry(seq: number): LogEntry {
  return { seq, at: NOW, actor: 'amarr', type: 'eventPlayed', round: 1, lines: [`line ${seq}`], notices: [], touchedPrivate: false, undone: false };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('ServerStore commands', () => {
  it('is in laptop mode and learns its public uid from the host', async () => {
    const { store, infoCalls } = setup();
    expect(store.mode).toBe('laptop');
    expect(await store.init()).toBe(YOU);
    expect(await store.init()).toBe(YOU);
    expect(infoCalls).toHaveLength(1); // asked once
    expect(infoCalls[0]!.url).toBe('/api/info');
    expect(header(infoCalls[0]!, 'X-Device-Id')).toBe(deviceId()); // the secret goes only to the host
    expect(YOU).not.toBe(deviceId());
  });

  it('fails init when the host cannot say who this device is, and can try again', async () => {
    const ES = fakeEventSource();
    let attempt = 0;
    const answers = [() => Promise.reject(new TypeError('Failed to fetch')), () => Promise.resolve(json({ mode: 'laptop', urls: [] })),
      () => Promise.resolve(json({ mode: 'laptop', urls: [], you: YOU }))];
    const store = new ServerStore({ fetch: (() => answers[attempt++]!()) as unknown as typeof fetch, EventSource: ES as unknown as typeof EventSource });
    await expect(store.init()).rejects.toThrow(/host laptop/);
    await expect(store.init()).rejects.toThrow(/host laptop/);
    expect(await store.init()).toBe(YOU);
  });

  it('posts a command with the device header and resolves null on success', async () => {
    const { store, calls } = setup(json({ ok: true }));
    await store.init();
    expect(await store.dispatch('ABC234', { type: 'endTurn' })).toBeNull();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/games/ABC234/commands');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(header(calls[0]!, 'X-Device-Id')).toBe(deviceId());
    expect(header(calls[0]!, 'Content-Type')).toBe('application/json');
    expect(bodyOf(calls[0]!)).toStrictEqual({ cmd: { type: 'endTurn' }, cmdId: expect.stringMatching(CMD_ID) });
  });

  it('gives every dispatch its own command id', async () => {
    const { store, calls } = setup();
    await store.init();
    await store.dispatch('ABC234', { type: 'endTurn' });
    await store.dispatch('ABC234', { type: 'endTurn' });
    expect(bodyOf(calls[0]!).cmdId).not.toBe(bodyOf(calls[1]!).cmdId);
  });

  it('retries a POST that never got an answer once, with the same command id, so the host applies it once (M1)', async () => {
    const { store, calls } = setup(new TypeError('Failed to fetch'), json({ ok: true }));
    await store.init();
    expect(await store.dispatch('ABC234', { type: 'eventPlayed' })).toBeNull();
    expect(calls).toHaveLength(2);
    expect(bodyOf(calls[1]!)).toStrictEqual(bodyOf(calls[0]!));
    expect(bodyOf(calls[0]!).cmdId).toMatch(CMD_ID);

    const undo = setup(new TypeError('Failed to fetch'), json({ ok: true }));
    await undo.store.init();
    expect(await undo.store.undo('ABC234', 7)).toBeNull();
    expect(undo.calls).toHaveLength(2);
    expect(bodyOf(undo.calls[1]!)).toStrictEqual({ seq: 7, cmdId: bodyOf(undo.calls[0]!).cmdId });
  });

  it('reports offline only after the retry failed too, saying the command may have gone through', async () => {
    const { store, calls } = setup(new TypeError('Failed to fetch'), new TypeError('Failed to fetch'));
    await store.init();
    expect(await store.dispatch('ABC234', { type: 'eventPlayed' })).toStrictEqual({
      error: true,
      code: 'offline',
      message: "Can't reach the host laptop. It may have gone through — check the log.",
    });
    expect(calls).toHaveLength(2);
  });

  it('never retries an answered POST, nor the creation of a game', async () => {
    const error = { error: true, code: 'not_your_turn', message: 'It is not your turn' };
    const answered = setup(json({ error }, 422));
    await answered.store.init();
    expect(await answered.store.dispatch('ABC234', { type: 'endTurn' })).toStrictEqual(error);
    expect(answered.calls).toHaveLength(1);
    const create = setup(new TypeError('Failed to fetch'));
    await create.store.init();
    expect(await create.store.createGame('Ana', 'amarr', 'full')).toMatchObject({ code: 'offline', message: "Can't reach the host laptop" });
    expect(create.calls).toHaveLength(1);
  });

  it('returns the error body as a RuleError', async () => {
    const error = { error: true, code: 'not_your_turn', message: 'It is not your turn' };
    const { store } = setup(json({ error }, 422));
    await store.init();
    expect(await store.dispatch('ABC234', { type: 'endTurn' })).toStrictEqual(error);
  });

  it('turns a network failure or a non-JSON answer into a RuleError', async () => {
    const { store } = setup(new TypeError('Failed to fetch'), new TypeError('Failed to fetch'), new Response('oops', { status: 502 }));
    await store.init();
    expect(await store.dispatch('ABC234', { type: 'endTurn' })).toMatchObject({ error: true, code: 'offline' });
    expect(await store.dispatch('ABC234', { type: 'endTurn' })).toMatchObject({ error: true, code: 'host_error' });
  });

  it('creates a game and returns its code, or the RuleError', async () => {
    const error = { error: true, code: 'bad_name', message: 'Enter a name' };
    const { store, calls } = setup(json({ code: 'XYZ789' }), json({ error }, 422));
    await store.init();
    expect(await store.createGame('Ana', 'amarr', 'full')).toBe('XYZ789');
    expect(calls[0]!.url).toBe('/api/games');
    expect(header(calls[0]!, 'X-Device-Id')).toBe(deviceId());
    expect(JSON.parse(String(calls[0]!.init?.body))).toStrictEqual({ name: 'Ana', faction: 'amarr', mode: 'full' });
    expect(await store.createGame('', 'amarr', 'full')).toStrictEqual(error);
  });

  it('creates a light game by posting its mode', async () => {
    const { store, calls } = setup(json({ code: 'XYZ789' }));
    await store.init();
    expect(await store.createGame('Ana', 'amarr', 'light')).toBe('XYZ789');
    expect(JSON.parse(String(calls[0]!.init?.body))).toStrictEqual({ name: 'Ana', faction: 'amarr', mode: 'light' });
  });

  it('undoes through its own route', async () => {
    const { store, calls } = setup(json({ ok: true }));
    await store.init();
    expect(await store.undo('ABC234')).toBeNull();
    expect(calls[0]!.url).toBe('/api/games/ABC234/undo');
    expect(calls[0]!.init?.method).toBe('POST');
    expect(bodyOf(calls[0]!)).toStrictEqual({ cmdId: expect.stringMatching(CMD_ID) });
  });

  it('names the entry it means to undo, so the host can refuse a stale undo', async () => {
    const { store, calls } = setup(json({ ok: true }));
    await store.init();
    expect(await store.undo('ABC234', 7)).toBeNull();
    expect(bodyOf(calls[0]!)).toStrictEqual({ seq: 7, cmdId: expect.stringMatching(CMD_ID) });
  });

  it('reads the share urls from /api/info, or none when the host is unreachable', async () => {
    const { store, calls } = setup(json({ mode: 'laptop', urls: ['http://192.168.1.23:5180'] }), new TypeError('down'));
    expect(await store.shareUrls()).toStrictEqual(['http://192.168.1.23:5180']);
    expect(calls[0]!.url).toBe('/api/info');
    expect(await store.shareUrls()).toStrictEqual([]);
  });

  it('prefixes every url with the base', async () => {
    const ES = fakeEventSource();
    const f = fakeFetch(json({ ok: true }));
    const store = new ServerStore({ fetch: f.fetch, EventSource: ES as unknown as typeof EventSource, base: 'http://laptop:5180' });
    await store.init();
    expect(f.infoCalls[0]!.url).toBe('http://laptop:5180/api/info');
    await store.dispatch('ABC234', { type: 'endTurn' });
    expect(f.calls[0]!.url).toBe('http://laptop:5180/api/games/ABC234/commands');
    store.subscribeGame('ABC234', () => {})();
    expect(ES.instances[0]!.url).toMatch(/^http:\/\/laptop:5180\/api\/games\/ABC234\/stream\?device=/);
  });
});

describe('ServerStore subscriptions', () => {
  it('shares one EventSource per code and closes it with the last unsubscribe', async () => {
    const { store, ES } = setup();
    await store.init();
    const off1 = store.subscribeGame('ABC234', () => {});
    const off2 = store.subscribeGame('ABC234', () => {});
    const off3 = store.subscribeLog('ABC234', 10, () => {});
    expect(ES.instances).toHaveLength(1);
    expect(ES.instances[0]!.url).toBe(`/api/games/ABC234/stream?device=${encodeURIComponent(deviceId())}`);
    off1();
    off2();
    off1(); // a second call is harmless
    expect(ES.instances[0]!.closed).toBe(false);
    off3();
    expect(ES.instances[0]!.closed).toBe(true);
    store.subscribeGame('ABC234', () => {});
    expect(ES.instances).toHaveLength(2);
    store.subscribeGame('OTHER9', () => {});
    expect(ES.instances).toHaveLength(3);
  });

  it('delivers the game, the own private doc, the latest log entries and the to-dos from each snapshot', async () => {
    const { store, ES } = setup();
    const id = await store.init();
    const games: (GameState | null)[] = [];
    const mine: (PlayerPrivate | null)[] = [];
    const theirs: (PlayerPrivate | null)[] = [];
    const logs: LogEntry[][] = [];
    const todos: Todo[][] = [];
    store.subscribeGame('ABC234', (g) => games.push(g));
    store.subscribePrivate('ABC234', 'amarr', (p) => mine.push(p));
    store.subscribePrivate('ABC234', 'caldari', (p) => theirs.push(p));
    store.subscribeLog('ABC234', 2, (l) => logs.push(l));
    store.subscribeTodos('ABC234', (t) => todos.push(t));
    const priv = { ...emptyPrivate(), pendingResearch: 2 };
    const game = gameFor(id);
    const todo: Todo = { id: 'setup:0', seq: 1, to: 'amarr', text: 'Draw 1 Event card, then draw 3 Mission cards and keep 1', key: null };
    ES.instances[0]!.snapshot({ game, priv, log: [entry(1), entry(2), entry(3)], todos: [todo] });
    expect(games).toStrictEqual([game]);
    expect(mine).toStrictEqual([priv]);
    expect(theirs).toStrictEqual([null]);
    expect(logs).toStrictEqual([[entry(2), entry(3)]]);
    expect(todos).toStrictEqual([[todo]]);
  });

  it('gives a late subscriber the latest snapshot at once', async () => {
    const { store, ES } = setup();
    const id = await store.init();
    store.subscribeGame('ABC234', () => {});
    const game = gameFor(id);
    ES.instances[0]!.snapshot({ game, priv: null, log: [], todos: [] });
    const late: (GameState | null)[] = [];
    store.subscribeGame('ABC234', (g) => late.push(g));
    expect(late).toStrictEqual([game]);
  });

  it('reports a missing game as null', async () => {
    const { store, ES } = setup();
    await store.init();
    const games: (GameState | null)[] = [];
    const privs: (PlayerPrivate | null)[] = [];
    const logs: LogEntry[][] = [];
    store.subscribeGame('NOPE42', (g) => games.push(g));
    store.subscribePrivate('NOPE42', 'amarr', (p) => privs.push(p));
    store.subscribeLog('NOPE42', 5, (l) => logs.push(l));
    const todos: Todo[][] = [];
    store.subscribeTodos('NOPE42', (t) => todos.push(t));
    ES.instances[0]!.snapshot(null);
    expect(games).toStrictEqual([null]);
    expect(privs).toStrictEqual([null]);
    expect(logs).toStrictEqual([[]]);
    expect(todos).toStrictEqual([[]]);
  });

  it('stops calling a callback once unsubscribed', async () => {
    const { store, ES } = setup();
    const id = await store.init();
    const seen: (GameState | null)[] = [];
    const off = store.subscribeGame('ABC234', (g) => seen.push(g));
    store.subscribeGame('ABC234', () => {}); // keeps the stream open
    off();
    ES.instances[0]!.snapshot({ game: gameFor(id), priv: null, log: [], todos: [] });
    expect(seen).toStrictEqual([]);
  });

  it('reports the connection going down and coming back', async () => {
    const { store, ES } = setup();
    await store.init();
    const states: boolean[] = [];
    store.subscribeConnection((online) => states.push(online));
    expect(states).toStrictEqual([true]);
    store.subscribeGame('ABC234', () => {});
    const es = ES.instances[0]!;
    es.open();
    es.fail();
    es.fail();
    es.open();
    expect(states).toStrictEqual([true, false, true]);
  });

  it('reopens a stream the browser gave up on', async () => {
    vi.useFakeTimers();
    const { store, ES } = setup();
    await store.init();
    const off = store.subscribeGame('ABC234', () => {});
    ES.instances[0]!.fail(2); // e.g. the host answered with an error page
    expect(ES.instances).toHaveLength(1);
    vi.advanceTimersByTime(5000);
    expect(ES.instances).toHaveLength(2);
    expect(ES.instances[0]!.closed).toBe(true);
    ES.instances[1]!.fail(2);
    off(); // unsubscribing cancels the pending reopen
    vi.advanceTimersByTime(60_000);
    expect(ES.instances).toHaveLength(2);
  });
});

describe('ServerStore watchdog', () => {
  it('restarts a stream that has been silent for over 60 s and reports offline until it opens', async () => {
    vi.useFakeTimers();
    const { store, ES } = setup();
    await store.init();
    const states: boolean[] = [];
    store.subscribeConnection((online) => states.push(online));
    const games: (GameState | null)[] = [];
    store.subscribeGame('ABC234', (g) => games.push(g));
    const first = ES.instances[0]!;
    first.open();
    vi.advanceTimersByTime(50_000);
    first.ping(); // heartbeats keep it fresh
    vi.advanceTimersByTime(50_000);
    expect(ES.instances).toHaveLength(1);
    vi.advanceTimersByTime(20_000); // 70 s since the last event
    expect(ES.instances).toHaveLength(2);
    expect(first.closed).toBe(true);
    expect(states).toStrictEqual([true, false]);
    const second = ES.instances[1]!;
    expect(second.url).toBe(first.url);
    second.open();
    expect(states).toStrictEqual([true, false, true]);
    const game = gameFor(await store.init());
    second.snapshot({ game, priv: null, log: [], todos: [] }); // the full snapshot on connect makes the restart safe
    expect(games).toStrictEqual([game]);
    first.snapshot({ game: gameFor('stale'), priv: null, log: [], todos: [] }); // the old stream is ignored
    expect(games).toStrictEqual([game]);
  });

  it('counts every event, not only heartbeats, as a sign of life', async () => {
    vi.useFakeTimers();
    const { store, ES } = setup();
    const id = await store.init();
    store.subscribeGame('ABC234', () => {});
    const es = ES.instances[0]!;
    es.open();
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(40_000);
      es.snapshot({ game: gameFor(id), priv: null, log: [], todos: [] });
    }
    expect(ES.instances).toHaveLength(1);
  });

  it('restarts a stream that never opens', async () => {
    vi.useFakeTimers();
    const { store, ES } = setup();
    await store.init();
    store.subscribeGame('ABC234', () => {});
    vi.advanceTimersByTime(75_000);
    expect(ES.instances).toHaveLength(2);
  });

  it('reconnects at once on wake-up when the stream is closed', async () => {
    vi.useFakeTimers();
    const { store, ES, wake } = setup();
    await store.init();
    store.subscribeGame('ABC234', () => {});
    ES.instances[0]!.open();
    ES.instances[0]!.fail(2);
    wake.fire();
    expect(ES.instances).toHaveLength(2);
    vi.advanceTimersByTime(5000); // the delayed reopen was cancelled
    expect(ES.instances).toHaveLength(2);
  });

  it('reconnects at once on wake-up when the stream is stale, and leaves a live one alone', async () => {
    vi.useFakeTimers();
    const { store, ES, wake } = setup();
    await store.init();
    store.subscribeGame('ABC234', () => {});
    const es = ES.instances[0]!;
    es.open();
    wake.fire();
    expect(ES.instances).toHaveLength(1); // fresh and open
    vi.setSystemTime(Date.now() + 61_000); // e.g. the phone slept: no timers ran
    wake.fire();
    expect(ES.instances).toHaveLength(2);
    expect(es.closed).toBe(true);
  });

  it('on wake-up, replaces a stream that missed a heartbeat (over 30 s quiet: a half-open socket after a short sleep, M2)', async () => {
    vi.useFakeTimers();
    const { store, ES, wake } = setup();
    await store.init();
    store.subscribeGame('ABC234', () => {});
    const es = ES.instances[0]!;
    es.open();
    expect(WAKE_STALE_MS).toBe(30_000); // the 25 s ping + 5 s of slack
    vi.setSystemTime(Date.now() + 29_000);
    wake.fire();
    expect(ES.instances).toHaveLength(1); // a ping may still be on its way
    vi.setSystemTime(Date.now() + 2_000); // 31 s quiet: no timers ran while the phone slept
    wake.fire();
    expect(ES.instances).toHaveLength(2);
    expect(es.closed).toBe(true);
  });

  it('stops watching once the last subscriber leaves', async () => {
    vi.useFakeTimers();
    const { store, ES, wake } = setup();
    await store.init();
    const off1 = store.subscribeGame('ABC234', () => {});
    const off2 = store.subscribeGame('OTHER9', () => {});
    expect(wake.listening).toBe(1);
    off1();
    expect(wake.listening).toBe(1);
    off2();
    expect(wake.listening).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(120_000);
    expect(ES.instances).toHaveLength(2);
  });
});
