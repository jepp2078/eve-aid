/**
 * Reference navigation: the topic chips (which rules sections each shows, or a data browser), anchors for scrolling
 * to an entry, the remembered text size, and the recent searches / recently viewed entries kept per device.
 */
import { DEVELOPMENTS, type DevCategory } from '../../data/developments';
import { COST_TABLES, isRefId, refSection, type RefId, type SearchKind } from '../../data/reference';
import { SHIPS } from '../../data/ships';
import type { FactionId, Size } from '../../data/types';

export type Topic = 'actions' | 'costs' | 'discovery' | 'upkeep' | 'combat' | 'dice' | 'victory' | 'structures' | 'ships' | 'devs' | 'interpretations';

export interface TopicInfo {
  id: Topic;
  label: string;
  /** Rules sections shown, in order; empty for the data views (costs, ships, developments). */
  sections: RefId[];
}

export const TOPICS: TopicInfo[] = [
  { id: 'actions', label: 'Turn & actions', sections: ['turn', 'move', 'claim', 'extract', 'trade', 'manufacture', 'build', 'research'] },
  { id: 'costs', label: 'Costs', sections: [] },
  { id: 'discovery', label: 'Discovery', sections: ['discovery'] },
  { id: 'upkeep', label: 'Upkeep', sections: ['upkeep', 'raids'] },
  { id: 'combat', label: 'Combat', sections: ['combat', 'strength', 'combat-rewards'] },
  { id: 'dice', label: 'Dice', sections: ['dice'] },
  { id: 'victory', label: 'Victory', sections: ['victory', 'small-games', 'light-games'] },
  { id: 'structures', label: 'Structures', sections: ['structures'] },
  { id: 'ships', label: 'Ships', sections: [] },
  { id: 'devs', label: 'Developments', sections: [] },
  { id: 'interpretations', label: 'Interpretations', sections: ['interpretations'] },
];

export function isTopic(x: unknown): x is Topic {
  return TOPICS.some((t) => t.id === x);
}

export function topicInfo(t: Topic): TopicInfo {
  return TOPICS.find((x) => x.id === t)!;
}

/** The topic chip that shows a rules section. */
export function topicOf(section: RefId): Topic {
  return TOPICS.find((t) => t.sections.includes(section))!.id;
}

/** Something the reference can show and remember: a rules section, cost table, ship or development. */
export interface RefEntry {
  kind: SearchKind;
  id: string;
}

export function topicFor(e: RefEntry): Topic {
  switch (e.kind) {
    case 'rule':
      return isRefId(e.id) ? topicOf(e.id) : 'actions';
    case 'cost':
      return 'costs';
    case 'ship':
      return 'ships';
    case 'dev':
      return 'devs';
  }
}

export type SizeFilter = Size | 'all';
export type ShipSort = 'size' | 'name';
export type CategoryFilter = DevCategory | 'all';

/** What the Reference shows: the topic chip plus the ships and developments filters. */
export interface NavState {
  topic: Topic;
  faction: FactionId;
  size: SizeFilter;
  sort: ShipSort;
  cat: CategoryFilter;
}

/** The topic and filters that show an entry; filters that already show it are kept. */
export function navFor(nav: NavState, e: RefEntry): NavState {
  const topic = topicFor(e);
  if (e.kind === 'ship') {
    const s = SHIPS.find((x) => x.id === e.id);
    return s === undefined ? { ...nav, topic } : { ...nav, topic, faction: s.faction, size: 'all' };
  }
  if (e.kind === 'dev') {
    // "All" already shows the card; another category switches to the card's own.
    const d = DEVELOPMENTS.find((x) => x.id === e.id);
    return d === undefined || nav.cat === 'all' ? { ...nav, topic } : { ...nav, topic, cat: d.category };
  }
  return { ...nav, topic };
}

/** The `data-anchor` of an entry on the page. */
export function anchorOf(e: RefEntry): string {
  return `${e.kind}:${e.id}`;
}

/** A house-rule item in the Rule interpretations section. */
export function interpretationAnchor(n: number): string {
  return `interp:${n}`;
}

/** The entry's title from the data; null when it no longer exists. */
export function entryTitle(e: RefEntry): string | null {
  switch (e.kind) {
    case 'rule':
      return isRefId(e.id) ? refSection(e.id).title : null;
    case 'cost':
      return COST_TABLES.find((t) => t.id === e.id)?.title ?? null;
    case 'ship':
      return SHIPS.find((s) => s.id === e.id)?.name ?? null;
    case 'dev':
      return DEVELOPMENTS.find((d) => d.id === e.id)?.name ?? null;
  }
}

/* ------------------------------------------------------------ text size */

/** Reference text sizes (× the normal size). The normal size is the smallest: body text never drops below 16 px. */
export const TEXT_SCALES = [1, 1.125, 1.25, 1.375, 1.5] as const;

export function parseScale(raw: string | null): number {
  const n = Number(raw);
  return (TEXT_SCALES as readonly number[]).includes(n) ? n : 1;
}

export function stepScale(scale: number, dir: 1 | -1): number {
  const i = (TEXT_SCALES as readonly number[]).indexOf(scale);
  const next = Math.min(TEXT_SCALES.length - 1, Math.max(0, (i === -1 ? 0 : i) + dir));
  return TEXT_SCALES[next]!;
}

/* -------------------------------------------------------------- recents */

export interface Recents {
  /** Latest first. */
  searches: string[];
  /** Latest first. */
  viewed: RefEntry[];
}

export const MAX_RECENT_SEARCHES = 5;
export const MAX_RECENT_VIEWED = 6;
const MIN_SEARCH = 2;
const KINDS: SearchKind[] = ['rule', 'cost', 'ship', 'dev'];

export function addSearch(r: Recents, query: string): Recents {
  const q = query.trim().replace(/\s+/g, ' ');
  if (q.length < MIN_SEARCH) return r;
  const rest = r.searches.filter((s) => s.toLowerCase() !== q.toLowerCase());
  return { ...r, searches: [q, ...rest].slice(0, MAX_RECENT_SEARCHES) };
}

export function addViewed(r: Recents, e: RefEntry): Recents {
  const rest = r.viewed.filter((v) => v.kind !== e.kind || v.id !== e.id);
  return { ...r, viewed: [{ kind: e.kind, id: e.id }, ...rest].slice(0, MAX_RECENT_VIEWED) };
}

/** Reads stored recents, keeping only well-formed searches and entries that still exist. */
export function parseRecents(raw: string | null): Recents {
  const empty: Recents = { searches: [], viewed: [] };
  if (raw === null) return empty;
  try {
    const data = JSON.parse(raw) as { searches?: unknown; viewed?: unknown } | null;
    if (typeof data !== 'object' || data === null) return empty;
    const searches = Array.isArray(data.searches)
      ? data.searches.filter((q): q is string => typeof q === 'string' && q.trim().length >= MIN_SEARCH).slice(0, MAX_RECENT_SEARCHES)
      : [];
    const viewed = Array.isArray(data.viewed)
      ? data.viewed
          .filter((v): v is RefEntry => typeof v === 'object' && v !== null && KINDS.includes((v as RefEntry).kind) && typeof (v as RefEntry).id === 'string')
          .filter((v) => entryTitle(v) !== null)
          .map((v) => ({ kind: v.kind, id: v.id }))
          .slice(0, MAX_RECENT_VIEWED)
      : [];
    return { searches, viewed };
  } catch {
    return empty;
  }
}
