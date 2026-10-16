import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { eveApi } from './server/vitePlugin.ts';

/** `--mode cloud` with `--ssr worker/index.ts`: the Cloudflare Worker, one self-contained file Wrangler deploys. */
const workerBuild = {
  ssr: { noExternal: true as const },
  build: { rolldownOptions: { external: ['cloudflare:workers', /^node:/] } },
};

export default defineConfig(({ isSsrBuild, mode }) => ({
  plugins: [react(), eveApi()],
  ...(isSsrBuild && mode === 'cloud' ? { ssr: workerBuild.ssr } : {}),
  // Listen on every interface so phones on the same Wi-Fi can join a dev session.
  server: { host: true, port: 5180, strictPort: true },
  // The client loads as one app (no runtime code-splitting of screens: a lazy chunk that fails on a flaky LAN would
  // blank the app). Two static chunks, loaded up front with the entry, keep every file under the 500 kB warning:
  // React, and the game data (ships CSV, developments, reference text). The server build bundles no React, so it
  // keeps its defaults.
  build: isSsrBuild
    ? mode === 'cloud'
      ? workerBuild.build
      : {}
    : {
        rolldownOptions: {
          output: {
            codeSplitting: {
              groups: [
                { name: 'vendor', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
                { name: 'data', test: /[\\/]src[\\/]data[\\/]/ },
              ],
            },
          },
        },
      },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/rules/**'],
  },
}));
