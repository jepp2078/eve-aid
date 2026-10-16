/**
 * The cloud host's game API: the laptop's routes (`server/api.ts`) on Cloudflare's fetch API, each game in its own
 * Durable Object (`Room`). The Worker checks every request first (device id, body, code), so a bad one never wakes a
 * game. Differences from the laptop:
 *
 *   GET  /api/info                    → { mode: 'cloud', urls: [<this site>], you? }
 *   GET  /api/games/:code/stream      → a WebSocket (not Server-Sent Events): each frame is a snapshot (see `Room`)
 *   POST /api/games                   → limited per client address (`mayCreate`), 429 past it
 *
 * The rest (commands, undo, the JSON answers and their statuses) is the same.
 */
import type { FactionId } from '../src/data/types';
import type { Command, RuleError } from '../src/engine/types';
import { err } from '../src/engine/util';
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
} from '../server/protocol';

/** Codes tried for a new game before giving up (a clash needs two of ~10⁹ codes to meet). */
const CODE_ATTEMPTS = 5;

/** A game's Durable Object, as the Worker calls it (RPC: every answer is a promise). */
export interface RoomStub {
  create(code: string, uid: string, name: string, faction: FactionId, mode: unknown): Promise<string | RuleError>;
  dispatch(code: string, uid: string, cmd: Command, cmdId?: string): Promise<RuleError | null>;
  undo(code: string, uid: string, seq?: number, cmdId?: string): Promise<RuleError | null>;
}

export interface CloudEnv {
  room(code: string): RoomStub;
  /** A fresh random game code. */
  newCode(): string;
  /** Whether the client at `key` (its address) may open another game now. */
  mayCreate(key: string): Promise<boolean>;
  /** Hands a WebSocket upgrade to the game's room; `code` null (no game can have it) gets a socket that says so. */
  connect(request: Request, code: string | null, uid: string, log: number): Promise<Response>;
  /** Unexpected failures (answered with 500). */
  onError(e: unknown): void;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

function answer(r: RuleError | null): Response {
  return r === null ? json(200, { ok: true }) : json(statusOf(r), { error: r });
}

function method(req: Request, allowed: 'GET' | 'POST'): void {
  if (req.method !== allowed) throw new HttpError(405, err('method_not_allowed', `Use ${allowed} for this route`), allowed);
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length')) > MAX_BODY) throw tooLarge();
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_BODY) throw tooLarge();
  return parseJsonObject(text);
}

const uidOf = (req: Request): string => uidFromSecret(req.headers.get('x-device-id') ?? undefined);

async function route(req: Request, url: URL, env: CloudEnv): Promise<Response> {
  const parts = url.pathname.split('/').slice(2); // drop '' and 'api'
  if (parts.length === 1 && parts[0] === 'info') {
    method(req, 'GET');
    const info = { mode: 'cloud', urls: [url.origin] };
    const secret = req.headers.get('x-device-id');
    return json(200, secret === null ? info : { ...info, you: uidFromSecret(secret) });
  }
  if (parts[0] !== 'games') throw notFound();
  if (parts.length === 1) {
    method(req, 'POST');
    const uid = uidOf(req);
    const body = await readJson(req);
    if (!(await env.mayCreate(req.headers.get('cf-connecting-ip') ?? 'unknown'))) {
      return json(429, { error: err('too_many_games', 'Too many new games from this network; wait a minute and try again') });
    }
    for (let i = 0; i < CODE_ATTEMPTS; i++) {
      const code = env.newCode();
      const r = await env.room(code).create(code, uid, body.name as string, body.faction as FactionId, body.mode);
      if (typeof r === 'string') return json(200, { code: r });
      if (r.code !== 'code_taken') return json(statusOf(r), { error: r });
    }
    return json(422, { error: err('no_code', 'Could not find a free game code; try again') });
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
      return answer(code !== null ? await env.room(code).dispatch(code, uid, cmd as Command, cmdId) : unknown);
    }
    case 'undo': {
      method(req, 'POST');
      const uid = uidOf(req);
      const body = await readJson(req);
      const seq = seqOf(body);
      const cmdId = cmdIdOf(body);
      return answer(code !== null ? await env.room(code).undo(code, uid, seq, cmdId) : unknown);
    }
    case 'stream': {
      method(req, 'GET');
      const uid = uidFromSecret(url.searchParams.get('device') ?? undefined);
      if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return json(426, { error: err('websocket_only', 'This host streams games over WebSocket') }, { Upgrade: 'websocket' });
      }
      return env.connect(req, code, uid, logLimit(url.searchParams.get('log')));
    }
    default:
      throw notFound();
  }
}

/** Answers an `/api/…` request. */
export async function handleApi(req: Request, env: CloudEnv): Promise<Response> {
  const url = new URL(req.url);
  try {
    return await route(req, url, env);
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.error }, e.allow === null ? {} : { Allow: e.allow });
    env.onError(e);
    return json(500, { error: err('server_error', 'The server hit an unexpected error') });
  }
}
