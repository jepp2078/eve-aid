/**
 * Finding development card and ship names in running text (a log line, a notice, a combat message), so the UI can
 * show each name as one that opens its card. Names match as whole words, case-sensitive, longest first.
 */
import { DEVELOPMENTS, type Development } from '../../data/developments';
import { SHIPS, type Ship } from '../../data/ships';

export type NamedCard = { kind: 'dev'; dev: Development } | { kind: 'ship'; ship: Ship };

const BY_NAME = new Map<string, NamedCard>([
  ...DEVELOPMENTS.map((dev): [string, NamedCard] => [dev.name, { kind: 'dev', dev }]),
  ...SHIPS.map((ship): [string, NamedCard] => [ship.name, { kind: 'ship', ship }]),
]);

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NAME_RE = new RegExp(
  `\\b(${[...BY_NAME.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join('|')})\\b`,
  'g',
);

/** The text split into plain runs and the cards it names. */
export function splitCardNames(text: string): (string | NamedCard)[] {
  const out: (string | NamedCard)[] = [];
  let at = 0;
  for (const m of text.matchAll(NAME_RE)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(BY_NAME.get(m[0])!);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}
