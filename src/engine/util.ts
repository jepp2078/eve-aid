import { ISK_CAP } from '../data/costs';
import { DEV, DEVELOPMENTS } from '../data/developments';
import { FACTION_INFO } from '../data/factions';
import { MINERALS, type DevId, type FactionId, type ResourceKey, type Resources } from '../data/types';
import type { Ctx, GameState, Notice, PlayerPrivate, PlayerPublic, RuleError } from './types';
// Cycle (upkeep imports util): checkVerge is only called at run time, never while the modules load.
import { checkVerge } from './upkeep';

/** Where a command handler writes its public log lines and its notices (to-dos at the table and news, see `NoticeKind`). */
export type Out = { lines: string[]; notices: Notice[] };

export function clone<T>(x: T): T {
  return structuredClone(x);
}

export function err(code: string, message: string): RuleError {
  return { error: true, code, message };
}

/** Thrown by `fail`; `apply` catches it and returns `e`. */
export class RuleFail extends Error {
  e: RuleError;
  constructor(e: RuleError) {
    super(e.message);
    this.name = 'RuleFail';
    this.e = e;
  }
}

export function fail(code: string, message: string): never {
  throw new RuleFail(err(code, message));
}

/** Validates a count from a command: an integer >= 0, else `bad_amount`. */
export function checkCount(n: number, what: string): number {
  if (!Number.isInteger(n) || n < 0) fail('bad_amount', `${what} must be a whole number of 0 or more`);
  return n;
}

/**
 * "an Ares", "an Engineering Complex", "a Crow": the indefinite article for a name in a log line or message. A spelling
 * heuristic (a name starting with a vowel letter takes "an"): right for every ship, faction, structure and action name
 * in the game, which a test pins one by one. A new name said differently from its spelling ("Unity", "Hour") needs an
 * exception here.
 */
export function withArticle(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

export function factionName(f: FactionId): string {
  return Object.hasOwn(FACTION_INFO, f) ? FACTION_INFO[f].name : String(f);
}

export function isLight(g: GameState): boolean {
  return g.mode === 'light';
}

/** The seated player of `f`, or undefined. Own keys only, so untrusted ids like `__proto__` never resolve. */
export function seated(g: GameState, f: FactionId): PlayerPublic | undefined {
  return Object.hasOwn(g.players, f) ? g.players[f] : undefined;
}

/** The seated actor; fails `not_seated`. */
export function needActor(g: GameState, ctx: Ctx): FactionId {
  if (ctx.actor === null || !seated(g, ctx.actor)) fail('not_seated', 'You are not seated in this game');
  return ctx.actor;
}

/** The actor's private doc; fails `no_private`. */
export function needPriv(priv: PlayerPrivate | null): PlayerPrivate {
  if (priv === null) fail('no_private', 'Your private game data is not available');
  return priv;
}

export function player(g: GameState, f: FactionId): PlayerPublic {
  const p = seated(g, f);
  if (!p) fail('no_player', `${factionName(f)} is not in this game`);
  return p;
}

export function isDevId(id: unknown): id is DevId {
  return typeof id === 'string' && DEVELOPMENTS.some((d) => d.id === id);
}

export function hasDev(p: PlayerPublic, id: DevId): boolean {
  return p.completed.includes(id);
}

const RES_KEYS: ResourceKey[] = ['isk', 'pyrite', 'mexallon', 'tritanium', 'morphite', 'planetary', 'moon', 'component'];
const RES_LABEL: Record<ResourceKey, string> = {
  isk: 'ISK', pyrite: 'pyrite', mexallon: 'mexallon', tritanium: 'tritanium', morphite: 'morphite',
  planetary: 'planetary materials', moon: 'moon materials', component: 'components',
};

/**
 * Adds `n` (may be negative) of a resource. ISK above the cap is lost with a log line;
 * minerals are not capped here (callers enforce the 12 limit). Going below 0 fails `insufficient`.
 */
export function addRes(p: PlayerPublic, key: ResourceKey, n: number, out: Out): void {
  if (!Number.isInteger(n)) fail('bad_amount', `${RES_LABEL[key]} must change by a whole number`);
  const next = p.res[key] + n;
  if (next < 0) fail('insufficient', `Not enough ${RES_LABEL[key]} (need ${-n}, have ${p.res[key]})`);
  if (key === 'isk' && next > ISK_CAP) {
    out.lines.push(`ISK capped at ${ISK_CAP} (${next - ISK_CAP} lost)`);
    p.res.isk = ISK_CAP;
    return;
  }
  p.res[key] = next;
}

/**
 * ISK `n` (may be negative) for `f` from the named rule `why` ("Lobbyist"). A full game moves it (`addRes`: capped at 49,
 * `insufficient` below 0) and leaves the log line to the caller. A light game keeps no ISK: it changes nothing and
 * tells `f` the board step, "Lobbyist: take 2 ISK" or "Dirty Politics: pay 5 ISK", as a to-do and a log line. `payTo`
 * names the rival a payment goes to ("Civilian Resistance: pay Caldari 3 ISK"); it only reads on a payment, `n` < 0.
 * An `n` of 0 does nothing.
 */
export function boardISK(g: GameState, f: FactionId, n: number, why: string, out: Out, payTo: FactionId | null = null): void {
  if (!Number.isInteger(n)) fail('bad_amount', 'ISK must change by a whole number');
  if (n === 0) return;
  const p = player(g, f);
  if (!isLight(g)) {
    addRes(p, 'isk', n, out);
    return;
  }
  const text = n > 0 ? `${why}: take ${n} ISK` : `${why}: pay ${payTo === null ? '' : `${factionName(payTo)} `}${-n} ISK`;
  out.lines.push(`${factionName(f)}: ${text}`);
  out.notices.push({ to: f, text, kind: 'todo' });
}

/** Pays a cost atomically; fails `insufficient` naming the first missing resource. */
export function spend(p: PlayerPublic, cost: Partial<Resources>): void {
  for (const k of RES_KEYS) {
    const need = checkCount(cost[k] ?? 0, RES_LABEL[k]);
    if (need > p.res[k]) fail('insufficient', `Not enough ${RES_LABEL[k]} (need ${need}, have ${p.res[k]})`);
  }
  for (const k of RES_KEYS) p.res[k] -= cost[k] ?? 0;
}

export function mineralTotal(p: PlayerPublic): number {
  return MINERALS.reduce((sum, m) => sum + p.res[m], 0);
}

/**
 * The single way VP is gained (writes its own log line). Positive `n` pays every *other* Lobbyist holder
 * `n` ISK (a to-do at the board in a light game, see `boardISK`) and may set the Verge of Ascendancy (`checkVerge`).
 * Negative `n` is a loss floored at 0 with no Lobbyist.
 */
export function gainVP(g: GameState, f: FactionId, n: number, out: Out): void {
  if (!Number.isInteger(n)) fail('bad_amount', 'VP must change by a whole number');
  const p = player(g, f);
  if (n <= 0) {
    if (n < 0) {
      const lost = Math.min(p.vp, -n);
      p.vp -= lost;
      out.lines.push(`${p.name} loses ${lost} VP (${p.vp} total)`);
    }
    return;
  }
  p.vp += n;
  out.lines.push(`${p.name} gains ${n} VP (${p.vp} total)`);
  for (const other of g.seats) {
    const q = g.players[other];
    if (other === f || !q || !hasDev(q, DEV.lobbyist)) continue;
    // A light game's boardISK writes its own line.
    if (!isLight(g)) out.lines.push(`${q.name} gains ${n} ISK (Lobbyist)`);
    boardISK(g, other, n, 'Lobbyist', out);
  }
  checkVerge(g, f, out);
}

/**
 * Moves 1 VP from `from` to `to` (the gain goes through gainVP) and tells the victim with a notice, since it happens
 * on someone else's device. Returns false if `from` has no VP.
 */
export function stealVP(g: GameState, from: FactionId, to: FactionId, out: Out): boolean {
  const victim = player(g, from);
  const thief = player(g, to);
  if (victim.vp < 1) {
    out.lines.push(`${thief.name} steals no VP: ${victim.name} has none`);
    return false;
  }
  victim.vp -= 1;
  out.lines.push(`${thief.name} steals 1 VP from ${victim.name}`);
  out.notices.push({ to: from, text: `${factionName(to)} stole 1 VP from you`, kind: 'todo' });
  gainVP(g, to, 1, out);
  return true;
}

/** The seat clockwise after `f`. */
export function nextSeat(g: GameState, f: FactionId): FactionId {
  return seatOrderFrom(g, f)[1 % g.seats.length]!;
}

/** All seats clockwise starting with `f`. */
export function seatOrderFrom(g: GameState, f: FactionId): FactionId[] {
  const i = g.seats.indexOf(f);
  if (i < 0) fail('no_player', `${factionName(f)} is not seated in this game`);
  return [...g.seats.slice(i), ...g.seats.slice(0, i)];
}
