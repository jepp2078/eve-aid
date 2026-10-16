/**
 * The laptop host's HTTP API, as connect-style middleware so the same handler runs in `server/main.ts`
 * and inside the Vite dev server:
 *
 *   GET  /api/info                        → { mode: 'laptop', urls, you? }   (`you` only when X-Device-Id is sent)
 *   POST /api/games            { name, faction, mode? } → { code }   | { error: RuleError }   (`mode`: 'full' (the default) or 'light')
 *   POST /api/games/:code/commands  { cmd, cmdId? }   → { ok: true }  | { error: RuleError }
 *   POST /api/games/:code/undo      { seq?, cmdId? }  → { ok: true }  | { error: RuleError }
 *   GET  /api/games/:code/stream?device=<secret>[&log=<n>] → Server-Sent Events: `event: snapshot` with
 *        `data: Snapshot` (or `null` when no game has that code) on connect and after every change, and
 *        `event: ping` with `data: <server time in ms>` every 25 s (a heartbeat clients can watch).
 *
 * POSTs send the device secret in `X-Device-Id`. Every error answer is `{ error: RuleError }`. `urls` come back with the
 * likeliest phone-reachable address first (see `orderUrls`). `cmdId` (a random id per command, chosen by the phone)
 * makes a command or an undo idempotent: a phone that never got the answer sends the same body again, and the host
 * answers what it answered the first time instead of applying it twice.
 *
 * Identity: the device id a browser sends (header or `device=`) is its *secret*. The host only ever works with the
 * device's public uid, `publicUid(secret)`; that is what seats are held by and what game state shows to everyone,
 * so reading another player's uid from the game never lets you speak as them. `/api/info` tells a device its own
 * public uid (`you`).
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { FactionId } from '../src/data/types';
import type { Command, RuleError } from '../src/engine/types';
import { err } from '../src/engine/util';
import { PING_MS, type Snapshot } from '../src/sync/store';
import type { GameHost } from './games';
import {
  cmdIdOf,
  cmdOf,
  codeOf,
  HttpError,
  logLimit,
  MAX_BODY,
  notFound,
  parseJsonObject,
  seqOf,
  statusOf,
  tooLarge,
  uidFromSecret,
} from './protocol';

export { MAX_BODY, publicUid, STREAM_LOG } from './protocol';
export { PING_MS };

export interface ApiOptions {
  /** Interval of the heartbeat `ping` event on streams (default 25 s). */
  pingMs?: number;
  /** Server clock for the heartbeat (default `Date.now`). */
  now?: () => number;
  /** Unexpected failures (answered with 500); default `console.error`. */
  onError?: (e: unknown) => void;
}

export type ApiHandler = ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) & {
  /** Ends every open event stream (clients reconnect on their own). */
  close(): void;
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) {
    if (!res.writableEnded) res.end();
    return;
  }
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(json),
  });
  res.end(json);
}

/** The public uid of the device a request comes from (its secret travels in `X-Device-Id`). */
function uidOf(req: IncomingMessage): string {
  return uidFromSecret(req.headers['x-device-id']);
}

function readBody(req: IncomingMessage): Promise<string> {
  if (Number(req.headers['content-length']) > MAX_BODY) return Promise.reject(tooLarge());
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > MAX_BODY) {
        done = true; // Node discards the rest of the body once the answer is out
        reject(tooLarge());
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      if (!done) resolve(Buffer.concat(chunks).toString('utf8'));
      done = true;
    });
    req.on('error', reject);
  });
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return parseJsonObject(await readBody(req));
}

/** 0 = 192.168.x.x, 1 = 10.x.x.x, 2 = 172.16–31.x.x (home and office Wi-Fi ranges), 3 = anything else. */
function urlRank(url: string): number {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return 3;
  }
  const octets = host.split('.').map(Number);
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return 3;
  const [a, b] = octets as [number, number, number, number];
  if (a === 192 && b === 168) return 0;
  if (a === 10) return 1;
  if (a === 172 && b >= 16 && b <= 31) return 2;
  return 3;
}

/** Private-LAN urls first (192.168.*, then 10.*, then 172.16–31.*), then the rest; stable within each group. */
export function orderUrls(urls: string[]): string[] {
  return urls
    .map((url, i) => ({ url, i, rank: urlRank(url) }))
    .sort((x, y) => x.rank - y.rank || x.i - y.i)
    .map((x) => x.url);
}

function isClientAbort(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'ECONNRESET';
}

export function createApi(host: GameHost, urls: () => string[], opts: ApiOptions = {}): ApiHandler {
  const pingMs = opts.pingMs ?? PING_MS;
  const now = opts.now ?? Date.now;
  const onError = opts.onError ?? ((e: unknown) => console.error('[eve api]', e));
  const openStreams = new Set<() => void>();

  function method(req: IncomingMessage, allowed: 'GET' | 'POST'): void {
    if (req.method !== allowed) {
      throw new HttpError(405, err('method_not_allowed', `Use ${allowed} for this route`), allowed);
    }
  }

  function answer(res: ServerResponse, r: RuleError | null): void {
    if (r === null) sendJson(res, 200, { ok: true });
    else sendJson(res, statusOf(r), { error: r });
  }

  function stream(req: IncomingMessage, res: ServerResponse, code: string, url: URL): void {
    const uid = uidFromSecret(url.searchParams.get('device'));
    const limit = logLimit(url.searchParams.get('log'));

    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const write = (text: string) => {
      if (!res.destroyed && !res.writableEnded) res.write(text);
    };
    const send = (s: Snapshot | null) => {
      const data = s === null ? null : { ...s, log: limit > 0 ? s.log.slice(-limit) : [] };
      write(`event: snapshot\ndata: ${JSON.stringify(data)}\n\n`);
    };

    write('retry: 2000\n\n');
    send(host.snapshot(code, uid, limit));
    const unsubscribe = host.subscribe(code, uid, send);
    const ping = setInterval(() => write(`event: ping\ndata: ${now()}\n\n`), pingMs);
    ping.unref();

    let open = true;
    const cleanup = () => {
      if (!open) return;
      open = false;
      unsubscribe();
      clearInterval(ping);
      openStreams.delete(close);
    };
    const close = () => {
      cleanup();
      if (!res.writableEnded) res.end();
    };
    openStreams.add(close);
    req.on('close', cleanup);
    res.on('close', cleanup);
    res.on('error', cleanup);
  }

  async function route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const parts = url.pathname.split('/').slice(2); // drop '' and 'api'
    if (parts.length === 1 && parts[0] === 'info') {
      method(req, 'GET');
      const info = { mode: 'laptop', urls: orderUrls(urls()) };
      const secret = req.headers['x-device-id'];
      return sendJson(res, 200, secret === undefined ? info : { ...info, you: uidFromSecret(secret) });
    }
    if (parts[0] !== 'games') throw notFound();
    if (parts.length === 1) {
      method(req, 'POST');
      const uid = uidOf(req);
      const body = await readJson(req);
      const r = host.create(uid, body.name as string, body.faction as FactionId, body.mode);
      return typeof r === 'string' ? sendJson(res, 200, { code: r }) : sendJson(res, statusOf(r), { error: r });
    }
    if (parts.length !== 3) throw notFound();
    const [, rawCode, action] = parts as [string, string, string];
    const code = codeOf(rawCode);
    const unknown = err('no_game', 'There is no game with that code');

    switch (action) {
      case 'commands': {
        method(req, 'POST');
        const uid = uidOf(req);
        const body = await readJson(req);
        const cmd = cmdOf(body);
        const cmdId = cmdIdOf(body);
        return answer(res, code !== null ? host.dispatch(code, uid, cmd as Command, cmdId) : unknown);
      }
      case 'undo': {
        method(req, 'POST');
        const uid = uidOf(req);
        const body = await readJson(req); // optional { seq }: the entry the device means to undo
        const seq = seqOf(body);
        const cmdId = cmdIdOf(body);
        return answer(res, code !== null ? host.undo(code, uid, seq, cmdId) : unknown);
      }
      case 'stream':
        method(req, 'GET');
        return stream(req, res, code ?? '', url);
      default:
        throw notFound();
    }
  }

  function fail(res: ServerResponse, e: unknown): void {
    if (e instanceof HttpError) {
      if (e.allow !== null && !res.headersSent) res.setHeader('Allow', e.allow);
      return sendJson(res, e.status, { error: e.error });
    }
    if (isClientAbort(e)) return;
    onError(e);
    sendJson(res, 500, { error: err('server_error', 'The host laptop hit an unexpected error (see its console)') });
  }

  const handler = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      return next();
    }
    if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return next();
    route(req, res, url).catch((e: unknown) => fail(res, e));
  };

  return Object.assign(handler, {
    close() {
      for (const close of [...openStreams]) close();
    },
  });
}
