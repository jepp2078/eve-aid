import { afterEach, describe, expect, it, vi } from 'vitest';
import { socketUrl, wsEventSource } from '../../src/sync/wsEventSource';

class FakeWebSocket extends EventTarget {
  static last: FakeWebSocket;
  readyState = 0;
  readonly sent: string[] = [];
  closed = false;
  constructor(readonly url: string) {
    super();
    FakeWebSocket.last = this;
  }
  send(text: string): void {
    this.sent.push(text);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  receive(data: string): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
  drop(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }
}

const Source = () => wsEventSource(FakeWebSocket as unknown as typeof WebSocket, 1000);

afterEach(() => {
  vi.useRealTimers();
});

describe('wsEventSource', () => {
  it('turns the stream url into a WebSocket url', () => {
    expect(socketUrl('/api/games/ABC/stream?device=x', 'https://eve.example/#/game')).toBe('wss://eve.example/api/games/ABC/stream?device=x');
    expect(socketUrl('/api/games/ABC/stream', 'http://localhost:8787/')).toBe('ws://localhost:8787/api/games/ABC/stream');
  });

  it('passes snapshots on as `snapshot` events and pongs as `ping`', () => {
    vi.useFakeTimers();
    const es = new (Source())('/api/games/ABC/stream?device=x');
    const ws = FakeWebSocket.last;
    const seen: string[] = [];
    es.addEventListener('open', () => seen.push('open'));
    es.addEventListener('ping', () => seen.push('ping'));
    es.addEventListener('snapshot', (ev) => seen.push(`snapshot ${(ev as MessageEvent<string>).data}`));

    ws.open();
    expect(es.readyState).toBe(1);
    ws.receive('{"game":1}');
    vi.advanceTimersByTime(1000);
    expect(ws.sent).toEqual(['ping']);
    ws.receive('pong');
    expect(seen).toEqual(['open', 'snapshot {"game":1}', 'ping']);
  });

  it('reports a dropped socket as an error with readyState CLOSED, and stops pinging', () => {
    vi.useFakeTimers();
    const es = new (Source())('/x');
    const ws = FakeWebSocket.last;
    let errors = 0;
    es.addEventListener('error', () => errors++);
    ws.open();
    ws.drop();
    expect(es.readyState).toBe(2);
    expect(errors).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(ws.sent).toEqual([]);
  });

  it('closes quietly when asked', () => {
    const es = new (Source())('/x');
    const ws = FakeWebSocket.last;
    let errors = 0;
    es.addEventListener('error', () => errors++);
    es.close();
    ws.drop();
    expect(ws.closed).toBe(true);
    expect(errors).toBe(0);
  });
});
