/**
 * Developments on the Panel: my private area's rows (tokens against cost, ready, missing prerequisite), when cards
 * can be completed and used, what each usable card asks for, my deck and Research Spy's targets, which blocking
 * overlay applies (derived purely from the docs, so a reload restores it), and the drafts of the Research action and
 * of distributing pending research ("what is left" math, fetches, the command).
 *
 * Privacy: these helpers only shape data for this device. Nothing here builds text that is sent anywhere; commands
 * go through the store like every other command.
 */
import { DEV, DEVELOPMENTS, dev as devById, type Development } from '../../data/developments';
import { MINERAL_CAP } from '../../data/costs';
import { BASIC_MINERALS, FACTIONS, MINERALS, type BasicMineral, type DevId, type FactionId, type Material, type Mineral, type Resources } from '../../data/types';
import { AREA_SIZE, FETCH_COST, useParamsKind, useTimingProblem } from '../../engine/developments';
import type { AreaCard, Command, GameMode, GameState, ManufactureOp, PlayerPrivate, PlayerPublic, TradeOp, UseParams } from '../../engine/types';
import { isRecord } from './drafts';
import { factionName } from './labels';
import { newManufactureOp, newTradeOp, sanitizeManufactureOps, sanitizeTradeOps } from './ops';
import { mineralSum } from './preview';

export { AREA_SIZE, FETCH_COST };

const DEV_IDS = new Set(DEVELOPMENTS.map((d) => d.id));
const isDev = (x: unknown): x is DevId => typeof x === 'string' && DEV_IDS.has(x);
const isFaction = (x: unknown): x is FactionId => typeof x === 'string' && (FACTIONS as string[]).includes(x);
const isBasic = (x: unknown): x is BasicMineral => typeof x === 'string' && (BASIC_MINERALS as string[]).includes(x);
const isMineral = (x: unknown): x is Mineral => typeof x === 'string' && (MINERALS as string[]).includes(x);
const isMaterial = (x: unknown): x is Material => x === 'planetary' || x === 'moon';
const count = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 99;

const cards = (n: number): string => `${n} ${n === 1 ? 'card' : 'cards'}`;

/* ------------------------------------------------------------------ the private area */

export interface AreaRow {
  dev: Development;
  tokens: number;
  /** Tokens reached the cost. */
  ready: boolean;
  /** "Needs Medium Hull completed first" when the prerequisite is missing (it can't be completed yet). */
  prereq: string | null;
}

export function areaRows(area: readonly AreaCard[], p: PlayerPublic): AreaRow[] {
  return area.map((c) => {
    const d = devById(c.dev);
    const missing = d.prerequisite !== null && !p.completed.includes(d.prerequisite);
    return { dev: d, tokens: c.tokens, ready: c.tokens >= d.cost, prereq: missing ? `Needs ${devById(d.prerequisite!).name} completed first` : null };
  });
}

export type Allowed = { ok: true } | { ok: false; reason: string };
const OK: Allowed = { ok: true };

/** Completing costs no action but happens on my turn in the action phase (engine `wrong_phase` / `not_your_turn`). */
export function canComplete(game: GameState, faction: FactionId): Allowed {
  if (game.phase === 'ended') return { ok: false, reason: 'The game is over' };
  if (game.phase !== 'actions' || game.turn === null) return { ok: false, reason: 'Complete developments on your turn in the action phase' };
  if (game.turn.faction !== faction) return { ok: false, reason: `Not your turn: complete it on your turn (${factionName(game.turn.faction)} is playing)` };
  return OK;
}

/**
 * Using a completed card is free and once per round, when its timing allows (the engine's `useTimingProblem`): on my
 * turn or in my combat, in combat for the tactics, and so on per card.
 */
export function canUse(game: GameState, faction: FactionId, id: DevId): Allowed {
  if (game.phase !== 'actions' && game.phase !== 'upkeep') return { ok: false, reason: 'Developments can be used in the action and upkeep phases' };
  const problem = useTimingProblem(game, faction, id);
  return problem === null ? OK : { ok: false, reason: problem };
}

/* ------------------------------------------------------------------ using */

export type UseKind = UseParams['kind'];

/**
 * The params kind of a usable card, as the engine's `useDev` takes them in a game of this `mode`; null for passive
 * cards (no keyword). In a light game every usable card takes none, except Research Spy and Dirty Politics.
 */
export function useKind(id: DevId, mode: GameMode = 'full'): UseKind | null {
  return useParamsKind(id, mode);
}

export interface CompletedRow {
  dev: Development;
  tapped: boolean;
  /** Has a Use (a keyword the app can apply). */
  usable: boolean;
}

export function completedRows(p: PlayerPublic): CompletedRow[] {
  return p.completed.map((id) => ({ dev: devById(id), tapped: p.tapped.includes(id), usable: useKind(id) !== null }));
}

/** Every parameter a use can take, in one draft (only the fields of the card's kind are read). */
export interface UseDraft {
  from: BasicMineral;
  to: BasicMineral;
  trade: TradeOp;
  manufacture: ManufactureOp;
  mineral: Mineral | null;
  material: Material;
  target: FactionId | null;
  dev: DevId | null;
  pay: Material | null;
}

export const EMPTY_USE: UseDraft = {
  from: 'pyrite',
  to: 'mexallon',
  trade: newTradeOp(),
  manufacture: newManufactureOp(),
  mineral: null,
  material: 'planetary',
  target: null,
  dev: null,
  pay: null,
};

/**
 * Mineral Market's give / get: the draft's choice, except that a mineral I don't hold is never offered as the one to
 * give (the default is pyrite): then the first basic mineral I do hold, and "get" moves off it if they clash. With
 * no basic minerals at all the draft stays (the engine's error explains).
 */
export function marketPick(d: UseDraft, res: Resources): { from: BasicMineral; to: BasicMineral } {
  const held = BASIC_MINERALS.find((m) => res[m] > 0);
  const from = res[d.from] > 0 || held === undefined ? d.from : held;
  const to = d.to !== from ? d.to : BASIC_MINERALS.find((m) => m !== from)!;
  return { from, to };
}

/** The `useDev` params for `kind` from the draft; null while a required choice is missing. */
export function useParams(kind: UseKind, d: UseDraft): UseParams | null {
  switch (kind) {
    case 'none':
      return { kind };
    case 'mineralMarket':
      return { kind, from: d.from, to: d.to };
    case 'trade':
      return { kind, op: d.trade };
    case 'manufacture':
      return { kind, op: d.manufacture };
    case 'mineral':
      return d.mineral === null ? null : { kind, mineral: d.mineral };
    case 'material':
      return { kind, material: d.material };
    case 'target':
      return d.target === null ? null : { kind, faction: d.target };
    case 'dev':
      return d.dev === null ? null : { kind, dev: d.dev };
    case 'payMaterial':
      return { kind, material: d.pay };
  }
}

export function sanitizeUse(raw: unknown): UseDraft | null {
  if (!isRecord(raw)) return null;
  const trade = sanitizeTradeOps([raw.trade])?.[0];
  const manufacture = sanitizeManufactureOps([raw.manufacture])?.[0];
  if (!isBasic(raw.from) || !isBasic(raw.to) || trade === undefined || manufacture === undefined || !isMaterial(raw.material)) return null;
  if (raw.mineral !== null && !isMineral(raw.mineral)) return null;
  if (raw.target !== null && !isFaction(raw.target)) return null;
  if (raw.dev !== null && !isDev(raw.dev)) return null;
  if (raw.pay !== null && !isMaterial(raw.pay)) return null;
  return { from: raw.from, to: raw.to, trade, manufacture, mineral: raw.mineral, material: raw.material, target: raw.target, dev: raw.dev, pay: raw.pay };
}

/* ------------------------------------------------------------------ decks and targets */

/** My deck: every card I have not completed, minus my area and `taken` (cards already chosen in a draft). */
export function deckFor(p: PlayerPublic, area: readonly AreaCard[], taken: Iterable<DevId> = []): Development[] {
  const out = new Set<DevId>([...p.completed, ...area.map((c) => c.dev), ...taken]);
  return DEVELOPMENTS.filter((d) => !out.has(d.id));
}

/** Research Spy: cards other seated players completed that I have not completed and that are not in my area. */
export function spyTargets(game: GameState, faction: FactionId, area: readonly AreaCard[]): Development[] {
  const me = game.players[faction];
  if (me === undefined) return [];
  const held = new Set(game.seats.filter((f) => f !== faction).flatMap((f) => game.players[f]?.completed ?? []));
  const mine = new Set([...me.completed, ...area.map((c) => c.dev)]);
  return DEVELOPMENTS.filter((d) => held.has(d.id) && !mine.has(d.id));
}

/* ------------------------------------------------------------------ blocking overlays */

export type Overlay = 'minerals' | 'research' | 'card';

/**
 * The rules-mandated step that blocks my Panel, if any: minerals above 12, then pending research, then a card to
 * add. Only in the action and upkeep phases (the commands are refused otherwise, and nothing is left to play
 * once the game is over).
 */
export function blockingOverlay(game: GameState | null, me: PlayerPublic | null, priv: PlayerPrivate | null): Overlay | null {
  if (game === null || me === null || priv === null) return null;
  if (game.phase !== 'actions' && game.phase !== 'upkeep') return null;
  if (mineralSum(me) > MINERAL_CAP) return 'minerals';
  if (priv.pendingResearch > 0) return 'research';
  if (priv.pendingCards > 0) return 'card';
  return null;
}

/* ------------------------------------------------------------------ Technological Breakthrough */

/**
 * Whether this draft can turn my completed Technological Breakthrough face down into my area (its second clause:
 * during upkeep, for 3 research, into an empty slot or replacing a card, as any fetch). Null when I haven't completed
 * it or the draft already does it.
 */
export function breakthroughBack(game: GameState, me: PlayerPublic, view: DistributeView, draft: DistributeDraft): Allowed | null {
  const tb = DEV.technologicalBreakthrough;
  if (!me.completed.includes(tb) || draft.fetch.some((f) => f.dev === tb)) return null;
  if (game.phase !== 'upkeep') return { ok: false, reason: `${devById(tb).name} goes back face down during upkeep only.` };
  if (view.remaining < FETCH_COST) return { ok: false, reason: `It needs ${FETCH_COST} research left to place.` };
  return OK;
}

/* ------------------------------------------------------------------ the Research action */

export interface ResearchDraft {
  /** New cards into empty slots. */
  fill: DevId[];
  /** In-progress cards swapped for new ones (the old card's tokens are discarded). */
  swap: { out: DevId; in: DevId }[];
}

export const NO_RESEARCH: ResearchDraft = { fill: [], swap: [] };

export function researchCommand(d: ResearchDraft): Command | null {
  if (d.fill.length === 0 && d.swap.length === 0) return null;
  return { type: 'action', action: 'research', fill: d.fill, swap: d.swap };
}

/**
 * "Research 2 cards", or just "Research" while nothing is chosen. A light game has no Research action to name (the
 * sheet records cards added or swapped any time): "Add 2 cards · swap 1 card", or "Add or swap cards".
 */
export function researchHead(d: ResearchDraft, mode: GameMode = 'full'): string {
  const n = d.fill.length + d.swap.length;
  if (mode === 'full') return n === 0 ? 'Research' : `Research ${cards(n)}`;
  if (n === 0) return 'Add or swap cards';
  const parts: string[] = [];
  if (d.fill.length > 0) parts.push(`Add ${cards(d.fill.length)}`);
  if (d.swap.length > 0) parts.push(`${parts.length === 0 ? 'Swap' : 'swap'} ${cards(d.swap.length)}`);
  return parts.join(' · ');
}

export function sanitizeResearch(raw: unknown): ResearchDraft | null {
  if (!isRecord(raw) || !Array.isArray(raw.fill) || !Array.isArray(raw.swap)) return null;
  if (!raw.fill.every(isDev) || raw.fill.length > AREA_SIZE) return null;
  const swap = raw.swap.map((s: unknown) => (isRecord(s) && isDev(s.out) && isDev(s.in) ? { out: s.out, in: s.in } : null));
  if (swap.length > AREA_SIZE || !swap.every((s) => s !== null)) return null;
  return { fill: [...raw.fill], swap };
}

/* ------------------------------------------------------------------ distributing research */

export interface FetchPick {
  dev: DevId;
  /** The area card it replaces (its tokens are discarded), or null for an empty slot. */
  replace: DevId | null;
}

export interface DistributeDraft {
  /** The pending amount this draft was made for (a different amount starts over). */
  for: number;
  /** Research to put on each card (fetched ones included). */
  alloc: Record<DevId, number>;
  fetch: FetchPick[];
}

export function newDistribute(pending: number): DistributeDraft {
  return { for: pending, alloc: {}, fetch: [] };
}

/** The draft if it was made for `pending`, else a fresh one. */
export function draftFor(d: DistributeDraft, pending: number): DistributeDraft {
  return d.for === pending ? d : newDistribute(pending);
}

export function sanitizeDistribute(raw: unknown): DistributeDraft | null {
  if (!isRecord(raw) || !count(raw.for) || !isRecord(raw.alloc) || !Array.isArray(raw.fetch)) return null;
  const alloc: Record<DevId, number> = {};
  for (const [k, v] of Object.entries(raw.alloc)) {
    if (!isDev(k) || !count(v)) return null;
    alloc[k] = v;
  }
  const fetch = raw.fetch.map((f: unknown) => (isRecord(f) && isDev(f.dev) && (f.replace === null || isDev(f.replace)) ? { dev: f.dev, replace: f.replace } : null));
  if (!fetch.every((f) => f !== null)) return null;
  return { for: raw.for, alloc, fetch };
}

export interface DistributeRow {
  dev: Development;
  /** Tokens already on the card (0 for a fetched one). */
  tokens: number;
  /** Research this draft adds. */
  add: number;
  /** The stepper's limit: what is on it plus what is left. */
  max: number;
  fetched: boolean;
}

export interface FetchRow {
  dev: Development;
  /** Technological Breakthrough going back face down (completed, upkeep only), not a card from the deck. */
  back: boolean;
  replace: DevId | null;
  /** Where it can go: null = an empty slot (offered while there is room), then the cards it can replace. */
  options: (DevId | null)[];
  /** The area card it replaces, with the tokens that will be discarded. */
  replaced: AreaCard | null;
}

export interface DistributeView {
  pending: number;
  /** Research placed plus 3 per fetched card. */
  spent: number;
  /** pending − spent; discarded on confirm. */
  remaining: number;
  /** The area after the fetches, in order, with this draft's research. */
  rows: DistributeRow[];
  fetches: FetchRow[];
  /** 3 research left and somewhere to put a card. */
  canFetch: boolean;
  /** Why the draft can't be sent (a fetch with nowhere to go), else null. */
  problem: string | null;
  command: Command | null;
  /** Confirm's verb phrase: "Fetch 1 card · place 2 research", "Place 3 research · discard 2", "Discard 5 research". */
  head: string;
}

/**
 * Applies the fetches like the engine (a replacing card takes the old one's place, else it is appended). `completed`
 * (mine): a fetch of a completed Technological Breakthrough is it going back face down (labelled so; it places like any fetch).
 */
export function distributeView(area: readonly AreaCard[], pending: number, draft: DistributeDraft, completed: readonly DevId[] = []): DistributeView {
  const work: (AreaCard & { fetched: boolean })[] = area.map((c) => ({ ...c, fetched: false }));
  const fetches: FetchRow[] = [];
  let problem: string | null = null;
  for (const f of draft.fetch) {
    const back = f.dev === DEV.technologicalBreakthrough && completed.includes(f.dev);
    const room: (DevId | null)[] = work.length < AREA_SIZE ? [null] : [];
    const options: (DevId | null)[] = [...room, ...work.filter((c) => !c.fetched).map((c) => c.dev)];
    const at = f.replace === null ? -1 : work.findIndex((c) => c.dev === f.replace && !c.fetched);
    const replaced = at < 0 ? null : { dev: work[at]!.dev, tokens: work[at]!.tokens };
    fetches.push({ dev: devById(f.dev), back, replace: f.replace, options, replaced });
    if (!options.includes(f.replace)) {
      problem ??= `Choose which card ${devById(f.dev).name} replaces`;
      continue;
    }
    const card = { dev: f.dev, tokens: 0, fetched: true };
    if (at < 0) work.push(card);
    else work[at] = card;
  }
  const rows0 = work.map((c) => ({ dev: devById(c.dev), tokens: c.tokens, add: draft.alloc[c.dev] ?? 0, fetched: c.fetched }));
  const placed = rows0.reduce((n, r) => n + r.add, 0);
  const spent = placed + FETCH_COST * draft.fetch.length;
  const remaining = pending - spent;
  const rows = rows0.map((r) => ({ ...r, max: r.add + Math.max(0, remaining) }));
  if (remaining < 0) problem ??= `That uses ${spent} research but you have ${pending}`;
  const room = work.length < AREA_SIZE || work.some((c) => !c.fetched);
  const alloc = Object.fromEntries(rows.filter((r) => r.add > 0).map((r) => [r.dev.id, r.add]));

  const parts: string[] = [];
  const backs = fetches.filter((f) => f.back).length;
  if (backs > 0) parts.push(`${devById(DEV.technologicalBreakthrough).name} back`);
  if (draft.fetch.length > backs) parts.push(`${parts.length === 0 ? 'Fetch' : 'fetch'} ${cards(draft.fetch.length - backs)}`);
  if (placed > 0) parts.push(`${parts.length === 0 ? 'Place' : 'place'} ${placed} research`);
  if (remaining > 0) parts.push(`${parts.length === 0 ? 'Discard' : 'discard'} ${remaining}${parts.length === 0 ? ' research' : ''}`);
  return {
    pending,
    spent,
    remaining,
    rows,
    fetches,
    canFetch: remaining >= FETCH_COST && room,
    problem,
    command: problem === null ? { type: 'distributeResearch', alloc, fetch: draft.fetch.map((f) => ({ dev: f.dev, replace: f.replace })) } : null,
    head: parts.length === 0 ? 'Place research' : parts.join(' · '),
  };
}

