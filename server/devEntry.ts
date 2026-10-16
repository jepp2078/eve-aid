/**
 * The API inside `npm run dev`. Loaded by the Vite plugin through `ssrLoadModule`, so it is re-evaluated after a
 * code change: the new instance then ends the previous instance's event streams (browsers reconnect to the new one)
 * and reloads every game from the data directory, which each change was saved to synchronously.
 */
import { createApi, type ApiHandler } from './api';
import { GameHost } from './games';
import { fileStore } from './persist';

const CURRENT = Symbol.for('eve-companion.devApi');
type Slot = { [CURRENT]?: ApiHandler };

let api: ApiHandler | null = null;

export function devApi(dataDir: string, urls: () => string[]): ApiHandler {
  if (api === null) {
    const slot = globalThis as Slot;
    slot[CURRENT]?.close();
    api = createApi(new GameHost(fileStore(dataDir), Date.now, Math.random), urls);
    slot[CURRENT] = api;
  }
  return api;
}
