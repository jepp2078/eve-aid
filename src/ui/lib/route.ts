/**
 * Hash routes (the query string stays untouched, so a `?as=<profile>` survives every navigation):
 *   #/            home: resume, host, join
 *   #/host        host a new game
 *   #/join[/CODE] join; the QR code on the laptop points here with the code filled in
 *   #/game        the current game (lobby room, setup or the tabs, by phase)
 *   #/table?big[&code=CODE]   big-screen table for the laptop or a TV (the saved session's game without a code)
 *   #/rules       the rules reference, outside any game
 *   #/gallery     component gallery (dev server only; not linked)
 */
import { normalizeCode, safeDecode } from './code';

export type Route =
  | { name: 'home' }
  | { name: 'host' }
  | { name: 'join'; code: string }
  | { name: 'game' }
  | { name: 'table'; big: boolean; code: string }
  | { name: 'rules' }
  | { name: 'gallery' };

export function parseRoute(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const q = raw.indexOf('?');
  const path = (q === -1 ? raw : raw.slice(0, q)).replace(/\/+$/, '');
  const params = new URLSearchParams(q === -1 ? '' : raw.slice(q + 1));
  const parts = path.split('/').filter((p) => p.length > 0);
  if (path !== '' && !path.startsWith('/')) return { name: 'home' };
  switch (parts[0]) {
    case undefined:
      return { name: 'home' };
    case 'host':
      return { name: 'host' };
    case 'join':
      return { name: 'join', code: normalizeCode(safeDecode(parts[1] ?? '')) };
    case 'game':
      return { name: 'game' };
    case 'table':
      return { name: 'table', big: params.has('big'), code: normalizeCode(params.get('code') ?? '') };
    case 'rules':
      return { name: 'rules' };
    case 'gallery':
      return { name: 'gallery' };
    default:
      return { name: 'home' };
  }
}

export function routeHash(r: Route): string {
  switch (r.name) {
    case 'home':
      return '#/';
    case 'join':
      return r.code === '' ? '#/join' : `#/join/${r.code}`;
    case 'table':
      return `#/table${r.big ? '?big' : ''}${r.code === '' ? '' : `${r.big ? '&' : '?'}code=${r.code}`}`;
    default:
      return `#/${r.name}`;
  }
}
