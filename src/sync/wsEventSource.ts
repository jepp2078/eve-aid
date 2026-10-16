/**
 * The cloud host's game stream (a WebSocket, see `worker/room.ts`) behind the slice of the `EventSource` interface
 * `ServerStore` uses, so the store treats both hosts alike. Each frame from the host is a snapshot and becomes a
 * `snapshot` event; the heartbeat goes the other way round: this end sends `ping` every `PING_MS` and the host's
 * `pong` becomes a `ping` event (what the store's stale-stream watchdog listens for). A WebSocket never reconnects by
 * itself: when it closes, `readyState` is CLOSED and an `error` event fires, which is what makes the store reopen it.
 */
import { PING_MS } from './store';

const CONNECTING = 0;
const OPEN = 1;
const CLOSED = 2;
const PING = 'ping';
const PONG = 'pong';

/** The parts of `EventSource` that `ServerStore` relies on. */
export interface StreamSource {
  readonly readyState: number;
  addEventListener(type: string, listener: (ev: Event) => void): void;
  close(): void;
}

export type StreamSourceClass = new (url: string) => StreamSource;

/** `http(s)://…/stream` (or a path on this page's host) as the `ws(s)://` url of the same route. */
export function socketUrl(url: string, page: string): string {
  const u = new URL(url, page);
  u.protocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
  return u.toString();
}

export function wsEventSource(WebSocketImpl: typeof WebSocket = globalThis.WebSocket, pingMs = PING_MS): StreamSourceClass {
  return class WsEventSource extends EventTarget implements StreamSource {
    readyState = CONNECTING;
    private readonly ws: WebSocket;
    private timer: ReturnType<typeof setInterval> | null = null;

    constructor(url: string) {
      super();
      this.ws = new WebSocketImpl(socketUrl(url, globalThis.location?.href ?? 'http://localhost/'));
      this.ws.addEventListener('open', () => {
        if (this.readyState === CLOSED) return;
        this.readyState = OPEN;
        this.timer = setInterval(() => {
          if (this.ws.readyState === OPEN) this.ws.send(PING);
        }, pingMs);
        this.dispatchEvent(new Event('open'));
      });
      this.ws.addEventListener('message', (ev) => {
        if (this.readyState === CLOSED || typeof ev.data !== 'string') return;
        this.dispatchEvent(ev.data === PONG ? new Event('ping') : new MessageEvent('snapshot', { data: ev.data }));
      });
      this.ws.addEventListener('close', () => {
        if (this.readyState === CLOSED) return;
        this.stop();
        this.dispatchEvent(new Event('error'));
      });
    }

    close(): void {
      if (this.readyState === CLOSED) return;
      this.stop();
      this.ws.close();
    }

    private stop(): void {
      this.readyState = CLOSED;
      if (this.timer !== null) clearInterval(this.timer);
      this.timer = null;
    }
  };
}
