/**
 * GameStore for both hosts: commands and undo go to the host over POST, state comes back over one stream per game
 * code, shared (ref-counted) by every subscriber of that code: Server-Sent Events from the laptop, a WebSocket from the
 * cloud (`wsEventSource`, which looks like an EventSource to this class).
 *
 * Identity: `deviceId()` is this browser's secret and is only ever sent to the host (POST header, stream query).
 * Seats are held by the device's public uid, which the host derives from the secret and reports from
 * `/api/info`; `init()` fetches it, and only it is compared with `players[f].uid`.
 *
 * Streams are watched: the host sends a `ping` event every 25 s, so a stream with no event of any kind for 60 s
 * is dead (a sleeping laptop, a dropped Wi-Fi) and is replaced. Waking the page (visible again, pageshow, focus,
 * online) replaces a stream at once if it is closed or has missed a heartbeat (quiet for over 30 s). Every new stream
 * starts with a full snapshot, which is what makes replacing one safe.
 *
 * Commands and undos carry a random `cmdId`; one whose POST got no answer is sent again once, unchanged, and the host
 * applies it at most once.
 */
import type { FactionId } from '../data/types';
import { isError, type Command, type GameMode, type GameState, type PlayerPrivate, type RuleError } from '../engine/types';
import { err } from '../engine/util';
import { actorFor } from './commit';
import { HOST, HOSTED } from './hosting';
import { deviceId } from './session';
import { PING_MS, type GameStore, type LogEntry, type Snapshot } from './store';
import type { Todo } from './todos';
import type { StreamSource, StreamSourceClass } from './wsEventSource';

/** Wait before reopening a stream the browser gave up on (it retries transient drops by itself). */
const REOPEN_MS = 3000;
/** Wait before sending a POST that got no answer once more (a Wi-Fi blip, a phone locking mid-request). */
const RETRY_MS = 750;

/** A random id for one command: the host applies a command once per id, however often a retry sends it. */
function newCommandId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
}
/** A stream without any event for this long is replaced (the host pings every 25 s). */
export const STALE_MS = 60_000;
/**
 * On a wake-up, a stream quiet for longer than one heartbeat (plus slack) is replaced at once: after even a short
 * sleep its socket may be half-open, showing stale state until the 60 s watchdog notices.
 */
export const WAKE_STALE_MS = PING_MS + 5_000;
/** How often streams are checked for staleness. */
const WATCH_MS = 10_000;
const CLOSED = 2; // EventSource.CLOSED

/** "the server" → "The server". */
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** Calls `cb` whenever the page wakes up; returns the function that stops listening. */
export type WakeSource = (cb: () => void) => () => void;

/** The browser's wake-up signals: the page becomes visible, is restored (bfcache), gains focus or goes online. */
export const browserWake: WakeSource = (cb) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return () => {};
  const onVisible = () => {
    if (document.visibilityState === 'visible') cb();
  };
  const events = ['pageshow', 'focus', 'online'] as const;
  for (const e of events) window.addEventListener(e, cb);
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    for (const e of events) window.removeEventListener(e, cb);
    document.removeEventListener('visibilitychange', onVisible);
  };
};

interface Stream {
  es: StreamSource;
  refs: number;
  /** The latest snapshot; undefined until the first one arrives. */
  last: Snapshot | null | undefined;
  listeners: Set<(s: Snapshot | null) => void>;
  reopen: ReturnType<typeof setTimeout> | null;
  /** Date.now() of the stream's last event (or of its start). */
  lastEvent: number;
}

export class ServerStore implements GameStore {
  readonly mode = HOSTED ? ('cloud' as const) : ('laptop' as const);
  private readonly fetchFn: typeof fetch;
  private readonly EventSourceImpl: StreamSourceClass | undefined;
  private readonly base: string;
  private secret: string | null = null;
  /** This device's public uid, once `init()` has learned it from the host. */
  private uid: string | null = null;
  private initing: Promise<string> | null = null;
  private readonly streams = new Map<string, Stream>();
  private readonly connection = new Set<(online: boolean) => void>();
  private online = true;
  private readonly onWake: WakeSource;
  private watch: { timer: ReturnType<typeof setInterval>; stopWake: () => void } | null = null;

  private readonly retryMs: number;

  constructor(opts: { fetch?: typeof fetch; EventSource?: StreamSourceClass; base?: string; onWake?: WakeSource; retryMs?: number } = {}) {
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.EventSourceImpl = opts.EventSource ?? (globalThis.EventSource as StreamSourceClass | undefined);
    this.base = opts.base ?? '';
    this.onWake = opts.onWake ?? browserWake;
    this.retryMs = opts.retryMs ?? RETRY_MS;
  }

  /** Asks the host for this device's public uid (once; a failed attempt can be retried). */
  init(): Promise<string> {
    this.initing ??= this.whoAmI().catch((e: unknown) => {
      this.initing = null;
      throw e;
    });
    return this.initing;
  }

  private async whoAmI(): Promise<string> {
    let you: unknown;
    try {
      const res = await this.fetchFn(`${this.base}/api/info`, { headers: { 'X-Device-Id': this.deviceSecret() } });
      you = ((await res.json()) as { you?: unknown }).you;
    } catch {
      throw new Error(`Can't reach ${HOST}`);
    }
    if (typeof you !== 'string' || you.length === 0) throw new Error(`${cap(HOST)} did not say who this device is`);
    this.uid = you;
    return you;
  }

  async createGame(name: string, faction: FactionId, mode: GameMode): Promise<string | RuleError> {
    const r = await this.post('/api/games', { name, faction, mode }, false);
    if (isError(r)) return r;
    const code = (r as { code?: unknown }).code;
    return typeof code === 'string' ? code : err('host_error', `${cap(HOST)} sent an unexpected answer`);
  }

  async dispatch(code: string, cmd: Command): Promise<RuleError | null> {
    const r = await this.post(`${this.gamePath(code)}/commands`, { cmd, cmdId: newCommandId() }, true);
    return isError(r) ? r : null;
  }

  async undo(code: string, seq?: number): Promise<RuleError | null> {
    const cmdId = newCommandId();
    const r = await this.post(`${this.gamePath(code)}/undo`, seq === undefined ? { cmdId } : { seq, cmdId }, true);
    return isError(r) ? r : null;
  }

  async shareUrls(): Promise<string[]> {
    try {
      const res = await this.fetchFn(`${this.base}/api/info`);
      const body = (await res.json()) as { urls?: unknown };
      return Array.isArray(body.urls) ? body.urls.filter((u): u is string => typeof u === 'string') : [];
    } catch {
      return [];
    }
  }

  subscribeGame(code: string, cb: (g: GameState | null) => void): () => void {
    return this.listen(code, (s) => cb(s === null ? null : s.game));
  }

  subscribePrivate(code: string, faction: FactionId, cb: (p: PlayerPrivate | null) => void): () => void {
    // The host only ever sends the private doc of the seat this device holds; pass it on for that faction only.
    return this.listen(code, (s) =>
      cb(s !== null && this.uid !== null && actorFor(s.game, this.uid) === faction ? s.priv : null),
    );
  }

  subscribeLog(code: string, limit: number, cb: (entries: LogEntry[]) => void): () => void {
    return this.listen(code, (s) => cb(s === null || limit <= 0 ? [] : s.log.slice(-limit)));
  }

  subscribeTodos(code: string, cb: (todos: Todo[]) => void): () => void {
    return this.listen(code, (s) => cb(s === null ? [] : s.todos));
  }

  subscribeConnection(cb: (online: boolean) => void): () => void {
    this.connection.add(cb);
    cb(this.online);
    return () => {
      this.connection.delete(cb);
    };
  }

  private deviceSecret(): string {
    return (this.secret ??= deviceId());
  }

  private gamePath(code: string): string {
    return `/api/games/${encodeURIComponent(code)}`;
  }

  /**
   * POSTs JSON as this device; resolves to the answer body, or the RuleError the host (or the network) gave. With
   * `retry` (a body carrying a `cmdId`, which makes it idempotent on the host), a POST that got no answer at all is
   * sent once more, unchanged, before it counts as offline: the host may have applied it before the answer was lost.
   */
  private async post(path: string, body: unknown, retry: boolean): Promise<unknown> {
    const send = () =>
      this.fetchFn(this.base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Device-Id': this.deviceSecret() },
        body: JSON.stringify(body),
      });
    let res: Response;
    try {
      res = await send();
    } catch {
      if (!retry) return err('offline', `Can't reach ${HOST}`);
      await new Promise((resolve) => setTimeout(resolve, this.retryMs));
      try {
        res = await send();
      } catch {
        return err('offline', `Can't reach ${HOST}. It may have gone through — check the log.`);
      }
    }
    let data: unknown = null;
    try {
      data = await res.json();
    } catch {
      // not JSON: judged by the status below
    }
    const error = typeof data === 'object' && data !== null ? (data as { error?: unknown }).error : undefined;
    if (isError(error)) return error;
    if (!res.ok) return err('host_error', `${cap(HOST)} answered with status ${res.status}`);
    return data;
  }

  private setOnline(online: boolean): void {
    if (online === this.online) return;
    this.online = online;
    for (const cb of [...this.connection]) cb(online);
  }

  /** Adds a listener to the code's shared stream (opening it if needed); it gets the latest snapshot at once. */
  private listen(code: string, fn: (s: Snapshot | null) => void): () => void {
    let stream = this.streams.get(code);
    if (!stream) {
      stream = { es: this.open(code), refs: 0, last: undefined, listeners: new Set(), reopen: null, lastEvent: Date.now() };
      this.streams.set(code, stream);
      this.startWatch();
    }
    const s = stream;
    s.refs++;
    s.listeners.add(fn);
    if (s.last !== undefined) fn(s.last);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      s.listeners.delete(fn);
      if (--s.refs > 0) return;
      s.es.close();
      if (s.reopen !== null) clearTimeout(s.reopen);
      if (this.streams.get(code) === s) this.streams.delete(code);
      if (this.streams.size === 0) this.stopWatch();
    };
  }

  private startWatch(): void {
    if (this.watch !== null) return;
    const timer = setInterval(() => this.check(false), WATCH_MS);
    (timer as { unref?: () => void }).unref?.(); // never keeps a Node process (tests) alive
    this.watch = { timer, stopWake: this.onWake(() => this.check(true)) };
  }

  private stopWatch(): void {
    if (this.watch === null) return;
    clearInterval(this.watch.timer);
    this.watch.stopWake();
    this.watch = null;
  }

  /** Replaces stale streams; on a wake-up also streams the browser gave up on and those that missed a heartbeat. */
  private check(wake: boolean): void {
    const now = Date.now();
    for (const [code, s] of [...this.streams]) {
      const quiet = now - s.lastEvent;
      if (quiet > STALE_MS || (wake && (s.es.readyState === CLOSED || quiet > WAKE_STALE_MS))) this.restart(code, s);
    }
  }

  private restart(code: string, s: Stream): void {
    if (s.reopen !== null) {
      clearTimeout(s.reopen);
      s.reopen = null;
    }
    s.es.close();
    this.setOnline(false);
    s.es = this.open(code);
    s.lastEvent = Date.now();
  }

  /** The stream `es` belongs to, while `es` is still that stream's current EventSource. */
  private current(code: string, es: StreamSource): Stream | undefined {
    const s = this.streams.get(code);
    return s !== undefined && s.es === es ? s : undefined;
  }

  private open(code: string): StreamSource {
    const Impl = this.EventSourceImpl;
    if (Impl === undefined) throw new Error('EventSource is not available');
    const es = new Impl(`${this.base}${this.gamePath(code)}/stream?device=${encodeURIComponent(this.deviceSecret())}`);
    es.addEventListener('open', () => {
      const s = this.current(code, es);
      if (s === undefined) return;
      s.lastEvent = Date.now();
      this.setOnline(true);
    });
    es.addEventListener('ping', () => {
      const s = this.current(code, es);
      if (s !== undefined) s.lastEvent = Date.now();
    });
    es.addEventListener('snapshot', (ev) => {
      const s = this.current(code, es);
      if (s === undefined) return;
      s.lastEvent = Date.now();
      let snap: Snapshot | null;
      try {
        snap = JSON.parse((ev as MessageEvent<string>).data) as Snapshot | null;
      } catch {
        return;
      }
      s.last = snap;
      for (const fn of [...s.listeners]) fn(snap);
    });
    es.addEventListener('error', () => {
      const s = this.current(code, es);
      if (s === undefined) return;
      this.setOnline(false);
      // The browser retries dropped connections itself; one it gave up on (an error answer) is reopened here.
      if (es.readyState !== CLOSED || s.reopen !== null) return;
      s.reopen = setTimeout(() => {
        s.reopen = null;
        if (this.streams.get(code) === s && s.es === es) this.restart(code, s);
      }, REOPEN_MS);
    });
    return es;
  }
}
