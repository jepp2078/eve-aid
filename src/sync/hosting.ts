/**
 * Which host this build talks to, fixed at build time: the laptop on the Wi-Fi (`npm run host`, the default) or the
 * cloud (`vite build --mode cloud`, a Cloudflare Worker; README → "Host it online"). The UI's words for "where the
 * game lives" come from here, so laptop builds read exactly as before.
 */
export const HOSTED = import.meta.env.MODE === 'cloud';

/** Who keeps the game, in a sentence: "Can't reach the host laptop". */
export const HOST = HOSTED ? 'the server' : 'the host laptop';

/** Where a game is (or isn't): "No game ABC·123 on this laptop". */
export const HOST_HERE = HOSTED ? 'on the server' : 'on this laptop';
