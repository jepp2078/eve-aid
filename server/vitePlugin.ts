import { resolve } from 'node:path';
import type { Plugin } from 'vite';

type DevEntry = typeof import('./devEntry');

const DEV_ENTRY = '/server/devEntry.ts';

/**
 * Mounts the laptop API (`/api/*`) into the Vite dev server. The server code is loaded through Vite
 * (`ssrLoadModule`), so TypeScript and `?raw` imports work and code changes take effect on the next request.
 * Games persist in `.eve-data/` (or `EVE_DATA_DIR`) exactly as in `npm run host`.
 */
export function eveApi(): Plugin {
  return {
    name: 'eve-api',
    apply: 'serve',
    configureServer(server) {
      const dataDir = resolve(server.config.root, process.env.EVE_DATA_DIR ?? '.eve-data');
      const urls = () => (server.resolvedUrls?.network ?? []).map((u) => u.replace(/\/$/, ''));
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split('?')[0] ?? '';
        if (path !== '/api' && !path.startsWith('/api/')) return next();
        server.ssrLoadModule(DEV_ENTRY).then(
          (mod) => (mod as DevEntry).devApi(dataDir, urls)(req, res, next),
          (e: unknown) => {
            if (e instanceof Error) server.ssrFixStacktrace(e);
            next(e);
          },
        );
      });
    },
  };
}
