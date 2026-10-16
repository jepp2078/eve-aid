import { HOSTED } from './hosting';
import { ServerStore } from './serverStore';
import type { GameStore } from './store';
import { wsEventSource } from './wsEventSource';

let store: Promise<GameStore> | null = null;

/**
 * The app's one GameStore, initialised (it knows this device's uid): the laptop's event streams, or the cloud's
 * WebSockets (`sync/hosting`). Rejects when the host can't be reached; the next call tries again.
 */
export function getStore(): Promise<GameStore> {
  if (store === null) {
    const s = new ServerStore(HOSTED ? { EventSource: wsEventSource() } : {});
    const p = s.init().then(() => s);
    p.catch(() => {
      if (store === p) store = null;
    });
    store = p;
  }
  return store;
}
