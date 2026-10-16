/**
 * The cloud host: a Cloudflare Worker serving the built site (static assets) and the game API (`handleApi`), with one
 * `GameRoom` Durable Object per game code. See `wrangler.jsonc` and README → "Host it online".
 */
import { DurableObject } from 'cloudflare:workers';
import type { FactionId } from '../src/data/types';
import type { Command, RuleError } from '../src/engine/types';
import { newCode } from '../src/sync/commit';
import { handleApi, type CloudEnv } from './api';
import { EXPIRE_MS, PING, PONG, Room, type Listener } from './room';

/** The bindings `wrangler.jsonc` declares. */
interface Env {
  ROOMS: DurableObjectNamespace<GameRoom>;
  ASSETS: Fetcher;
  CREATE_LIMIT: RateLimit;
}

/** The expiry alarm is pushed back at most once a day (each push is a storage write). */
const ALARM_SLACK_MS = 24 * 60 * 60 * 1000;

export class GameRoom extends DurableObject<Env> {
  private readonly room: Room;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair(PING, PONG));
    this.room = new Room({ sql: ctx.storage.sql, sockets: () => ctx.getWebSockets() });
  }

  async create(code: string, uid: string, name: string, faction: FactionId, mode: unknown): Promise<string | RuleError> {
    const r = this.room.create(code, uid, name, faction, mode);
    if (typeof r === 'string') await this.keep();
    return r;
  }

  async dispatch(code: string, uid: string, cmd: Command, cmdId?: string): Promise<RuleError | null> {
    const r = this.room.dispatch(code, uid, cmd, cmdId);
    if (r === null) await this.keep();
    return r;
  }

  async undo(code: string, uid: string, seq?: number, cmdId?: string): Promise<RuleError | null> {
    const r = this.room.undo(code, uid, seq, cmdId);
    if (r === null) await this.keep();
    return r;
  }

  /** A device's WebSocket (forwarded by the Worker, which checked it): accepted for hibernation, sent its snapshot. */
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const l: Listener = { code: url.searchParams.get('code') ?? '', uid: url.searchParams.get('uid') ?? '', log: Number(url.searchParams.get('log')) };
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(l);
    server.send(this.room.frame(l));
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Nothing to do: the only message a device sends is the heartbeat, which the runtime answers. */
  override async webSocketMessage(): Promise<void> {}

  /** Nobody touched the game for `EXPIRE_MS`. */
  override async alarm(): Promise<void> {
    this.room.expire();
  }

  /** Pushes the expiry alarm back to `EXPIRE_MS` from now. */
  private async keep(): Promise<void> {
    const want = Date.now() + EXPIRE_MS;
    const at = await this.ctx.storage.getAlarm();
    if (at === null || at < want - ALARM_SLACK_MS) await this.ctx.storage.setAlarm(want);
  }
}

/** A socket for a code no game can have: it says so (`null`) and stays open, like the laptop's stream. */
function noGameSocket(): Response {
  const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
  server.accept();
  server.addEventListener('message', (e) => {
    if (e.data === PING) server.send(PONG);
  });
  server.send('null');
  return new Response(null, { status: 101, webSocket: client });
}

function cloudEnv(env: Env): CloudEnv {
  return {
    room: (code) => env.ROOMS.getByName(code),
    newCode: () => newCode(Math.random),
    async mayCreate(key) {
      return (await env.CREATE_LIMIT.limit({ key })).success;
    },
    async connect(request, code, uid, log) {
      if (code === null) return noGameSocket();
      const target = new URL('https://room/connect');
      target.search = new URLSearchParams({ code, uid, log: String(log) }).toString();
      return env.ROOMS.getByName(code).fetch(new Request(target, request));
    },
    onError: (e) => console.error('[eve api]', e),
  };
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === '/api' || pathname.startsWith('/api/')) return handleApi(request, cloudEnv(env));
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
