/**
 * Upkeep (spec 6.4), the Verge of Ascendancy and the end of the game (spec 6.5).
 *
 * Every player confirms their own upkeep on their device (mining, refinery, income, research, Research Lab, raid
 * declarations; in a light game `lightUpkeep`, see light.ts); the confirm that completes the set also finalises the
 * upkeep in the same command: raids, untap, domination (not in an emergency upkeep), Fleet Supremacy, then the next
 * round or the end of the game.
 *
 * Handlers mutate the cloned game `apply` hands them and reject with `fail()`; `apply` discards the clone on
 * rejection, so a confirm is all or nothing. `checkVerge` runs from `gainVP` (util.ts) and after VP corrections.
 */
import { MINERAL_CAP } from '../data/costs';
import { DEV } from '../data/developments';
import { FACTION_INFO } from '../data/factions';
import { SHIPS } from '../data/ships';
import { MINERALS, STRENGTH, type ActionType, type FactionId, type Mineral, type ShipId, type Size, type StructureType } from '../data/types';
import { andList, contentsText, needPhase, readContents } from './turns';
import type { Command, Ctx, GameState, PlayerPrivate, PlayerPublic, RaidDecl, SystemContents } from './types';
import {
  addRes, checkCount, factionName, fail, gainVP, hasDev, isLight, needActor, needPriv, nextSeat, player, seated, seatOrderFrom, stealVP,
  type Out,
} from './util';

type Cmd<T extends Command['type']> = Extract<Command, { type: T }>;
type Upkeep = NonNullable<GameState['upkeep']>;

/** The key of the "pass the first player token" to-do: each round's replaces the last one's. */
export const FIRST_PLAYER_KEY = 'firstPlayer';
/** VP that puts a player on the Verge of Ascendancy. */
export const VERGE_VP = 10;
/** Non-home systems needed for domination VP. */
const DOMINATION_SYSTEMS = 5;
/** A home system's raid defence before citadels. */
const RAID_BASE_DEFENCE = 2;
const CUSTOMS_ISK = 2;
const UPGRADED_CUSTOMS_ISK = 3;
/** Research per engineering complex at upkeep. */
const ENGINEERING_RESEARCH = 1;

const SIZE_OF = new Map<ShipId, Size>(SHIPS.map((s) => [s.id, s.size]));

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** Entries of an object-valued command field; anything else counts as empty. */
function entries(x: unknown): [string, unknown][] {
  return typeof x === 'object' && x !== null ? Object.entries(x) : [];
}

export function needUpkeep(g: GameState): Upkeep {
  if (g.upkeep === null) fail('wrong_phase', 'There is no upkeep in progress');
  return g.upkeep;
}

// ---------------------------------------------------------------------------------------------------------------
// public helpers (also used by the UI)

export interface UpkeepPreview {
  /** Minerals mined: one per owned asteroid belt of that colour. */
  minerals: Record<Mineral, number>;
  /** ISK income: base 4 + 2 per customs office (3 with Upgraded Customs Office). */
  income: number;
  /** Research tokens: base 3 + 1 per engineering complex. */
  research: number;
  /** Refineries owned (each produces one planetary or moon material; both with Upgraded Refinery). */
  refineries: number;
  upgradedRefinery: boolean;
}

/** What makes up an upkeep income or research: the faction's base plus so much per structure. */
export interface UpkeepParts {
  base: number;
  /** Customs offices (income) or engineering complexes (research). */
  structures: number;
  /** What each of them adds. */
  each: number;
}

/**
 * Belts and structures of systems held by enemy ships this upkeep: they pay out nothing (manual p. 15). Only the
 * belts, customs offices, engineering complexes and refineries matter here; the rest is for `confirmUpkeep` to refuse.
 */
export type Occupied = SystemContents;

/** No system occupied. */
export const NOT_OCCUPIED: Occupied = { belts: {}, structures: {} };

/** Structures of `s` that still work: the owned ones less the occupied ones (never below 0). */
const working = (p: PlayerPublic, s: StructureType, occ: Occupied): number => Math.max(0, p.structures[s] - (occ.structures[s] ?? 0));

/** ISK income: the faction's base + 2 per customs office (3 with Upgraded Customs Office), occupied offices not counting. */
export function incomeParts(p: PlayerPublic, occ: Occupied = NOT_OCCUPIED): UpkeepParts {
  const each = hasDev(p, DEV.upgradedCustomsOffice) ? UPGRADED_CUSTOMS_ISK : CUSTOMS_ISK;
  return { base: FACTION_INFO[p.faction].income, structures: working(p, 'customs', occ), each };
}

/** Research tokens: the faction's base + 1 per engineering complex, occupied complexes not counting. */
export function researchParts(p: PlayerPublic, occ: Occupied = NOT_OCCUPIED): UpkeepParts {
  return { base: FACTION_INFO[p.faction].research, structures: working(p, 'engineering', occ), each: ENGINEERING_RESEARCH };
}

const total = (x: UpkeepParts): number => x.base + x.structures * x.each;

/** What confirming the upkeep gives `p` before their own choices (pure); `occ` is what enemy ships occupy, which pays nothing. */
export function upkeepPreview(p: PlayerPublic, occ: Occupied = NOT_OCCUPIED): UpkeepPreview {
  const minerals = Object.fromEntries(MINERALS.map((m) => [m, Math.max(0, p.belts[m] - (occ.belts[m] ?? 0))])) as Record<Mineral, number>;
  return {
    minerals,
    income: total(incomeParts(p, occ)),
    research: total(researchParts(p, occ)),
    refineries: working(p, 'refinery', occ),
    upgradedRefinery: hasDev(p, DEV.upgradedRefinery),
  };
}

/** Raid strength a home system withstands: 2 + each home citadel (2 each with Upgraded Citadel). A raid must exceed it. */
export function raidDefence(p: PlayerPublic): number {
  return RAID_BASE_DEFENCE + p.homeCitadels * (hasDev(p, DEV.upgradedCitadel) ? 2 : 1);
}

/** Total strength of the ships on the board (small 1, medium 3, large 5). Unknown ids count 0. */
export function fleetStrength(p: PlayerPublic): number {
  let sum = 0;
  for (const [id, n] of Object.entries(p.ships)) {
    const size = SIZE_OF.get(id);
    if (size !== undefined) sum += n * STRENGTH[size];
  }
  return sum;
}

function hasLargeShip(p: PlayerPublic): boolean {
  return Object.entries(p.ships).some(([id, n]) => n > 0 && SIZE_OF.get(id) === 'large');
}

// ---------------------------------------------------------------------------------------------------------------
// starting and confirming

/**
 * Enters the upkeep phase (no turn holder, nobody confirmed yet). `emergency` is the upkeep forced by the Verge of
 * Ascendancy during the actions; it skips domination and clears `verge.emergencyPending`.
 */
export function startUpkeep(g: GameState, emergency: boolean, out: Out): void {
  g.phase = 'upkeep';
  g.turn = null;
  g.upkeep = { emergency, confirmed: [], raids: [], largeShips: [] };
  if (emergency && g.verge !== null) g.verge.emergencyPending = false;
  out.lines.push(emergency ? 'Emergency upkeep begins (Verge of Ascendancy)' : 'Upkeep begins');
  out.notices.push({
    to: 'all',
    text: emergency
      ? 'Emergency upkeep (Verge of Ascendancy, no domination): confirm your upkeep on your device'
      : 'Upkeep: confirm your upkeep on your device',
    kind: 'info', // the Panel's upkeep form is the prompt
  });
}

interface RefineryPick {
  planetary: number;
  moon: number;
  convert: number;
}

/**
 * Validates the refinery picks against R refineries: without Upgraded Refinery `planetary + moon <= R` and no
 * conversion; with it each of planetary, moon and convert `<= R`, and every conversion needs 1 planetary + 1 moon
 * from the holdings after this upkeep's picks. Every problem is `bad_refinery`.
 */
function readRefinery(raw: unknown, p: PlayerPublic, pre: UpkeepPreview): RefineryPick {
  if (typeof raw !== 'object' || raw === null) fail('bad_refinery', 'Choose what your refineries produce');
  const r = raw as Record<string, unknown>;
  const count = (key: keyof RefineryPick): number => {
    const n = r[key];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0) {
      fail('bad_refinery', `Refinery ${key} must be a whole number of 0 or more`);
    }
    return n;
  };
  const pick: RefineryPick = { planetary: count('planetary'), moon: count('moon'), convert: count('convert') };
  const R = pre.refineries;
  const yours = `Your ${plural(R, 'refinery', 'refineries')}`;
  if (!pre.upgradedRefinery) {
    if (pick.convert > 0) fail('bad_refinery', 'Converting materials into components needs Upgraded Refinery');
    if (pick.planetary + pick.moon > R) fail('bad_refinery', `${yours} produce ${plural(R, 'material', 'materials')} in total`);
    return pick;
  }
  if (pick.planetary > R || pick.moon > R) {
    fail('bad_refinery', `${yours} produce up to ${R} planetary and ${R} moon materials`);
  }
  if (pick.convert > R) fail('bad_refinery', `${yours} convert up to ${plural(R, 'component', 'components')}`);
  const planetary = p.res.planetary + pick.planetary;
  const moon = p.res.moon + pick.moon;
  if (pick.convert > Math.min(planetary, moon)) {
    fail('bad_refinery', `Converting ${pick.convert} needs ${pick.convert} planetary and ${pick.convert} moon materials (you would have ${planetary} and ${moon})`);
  }
  return pick;
}

const OCCUPIABLE: readonly StructureType[] = ['customs', 'engineering', 'refinery'];

/**
 * The occupied belts and structures of an upkeep: at most what the player owns, and only customs offices, engineering
 * complexes and refineries (a citadel gives nothing in upkeep); else `bad_occupied`. Absent means none.
 */
function readOccupied(raw: unknown, p: PlayerPublic): Occupied {
  const c = readContents(raw);
  for (const m of MINERALS) {
    const n = c.belts[m] ?? 0;
    if (n > p.belts[m]) fail('bad_occupied', `You have ${p.belts[m]} ${m} ${p.belts[m] === 1 ? 'belt' : 'belts'}, so ${n} can't be occupied`);
  }
  for (const s of Object.keys(c.structures) as StructureType[]) {
    if (!OCCUPIABLE.includes(s)) fail('bad_occupied', 'Only belts, customs offices, engineering complexes and refineries give anything in upkeep');
    if ((c.structures[s] ?? 0) > p.structures[s]) fail('bad_occupied', `You have only ${p.structures[s]} of those, so ${c.structures[s]} can't be occupied`);
  }
  return c;
}

/** Discards per mineral, each at most what the player holds after mining (`have`). */
function readDiscard(raw: unknown, have: Record<Mineral, number>): Record<Mineral, number> {
  const discard = Object.fromEntries(MINERALS.map((m) => [m, 0])) as Record<Mineral, number>;
  for (const [key, value] of entries(raw)) {
    if (!MINERALS.includes(key as Mineral)) fail('bad_mineral', `"${key}" is not a mineral`);
    const m = key as Mineral;
    const n = checkCount(value as number, `Discarded ${m}`);
    if (n > have[m]) fail('insufficient', `Not enough ${m} to discard (discarding ${n}, you would have ${have[m]})`);
    discard[m] = n;
  }
  return discard;
}

/** Raid declarations: each target a seated rival, raided once, with a strength that is a whole number >= 1. */
function readRaids(g: GameState, f: FactionId, raw: unknown): RaidDecl[] {
  if (!Array.isArray(raw)) fail('bad_raid', 'The raid list is missing');
  const seen = new Set<FactionId>();
  return raw.map((item: unknown): RaidDecl => {
    const r = (typeof item === 'object' && item !== null ? item : {}) as { target?: unknown; strength?: unknown };
    const target = r.target;
    if (typeof target !== 'string' || !seated(g, target as FactionId)) fail('bad_raid', 'Raid a player in this game');
    const t = target as FactionId;
    if (t === f) fail('bad_raid', 'You cannot raid yourself');
    if (seen.has(t)) fail('bad_raid', `You can raid ${factionName(t)} only once per upkeep`);
    seen.add(t);
    const strength = r.strength;
    if (typeof strength !== 'number' || !Number.isInteger(strength) || strength < 1) {
      fail('bad_raid', 'Raid strength must be a whole number of 1 or more');
    }
    return { raider: f, target: t, strength };
  });
}

/**
 * A player's upkeep (steps 1–6), validated in full before anything changes: mine one mineral per belt, apply the
 * discard (the total must end at or below 12, `mineral_cap`), refinery picks, income (ISK capped at 49), research
 * into `priv.pendingResearch`, an optional Research Lab card (`priv.pendingCards`) and raid declarations. `occupied`
 * belts and structures (enemy ships, manual p. 15) pay and give nothing: see `upkeepPreview`.
 * The confirm that completes the set finalises the upkeep.
 */
export function confirmUpkeep(g: GameState, cmd: Cmd<'confirmUpkeep'>, ctx: Ctx, out: Out, priv: PlayerPrivate | null): void {
  needPhase(g, 'upkeep');
  const f = needActor(g, ctx);
  const pv = needPriv(priv);
  const u = needUpkeep(g);
  if (u.confirmed.includes(f)) fail('already_confirmed', 'You already confirmed your upkeep');
  const p = player(g, f);
  const occupied = readOccupied(cmd.occupied, p);
  const pre = upkeepPreview(p, occupied);

  // Validate everything first.
  const minerals = Object.fromEntries(MINERALS.map((m) => [m, p.res[m] + pre.minerals[m]])) as Record<Mineral, number>;
  const discard = readDiscard(cmd.discard, minerals);
  for (const m of MINERALS) minerals[m] -= discard[m];
  const total = MINERALS.reduce((sum, m) => sum + minerals[m], 0);
  if (total > MINERAL_CAP) {
    fail('mineral_cap', `You would hold ${total} minerals; discard ${total - MINERAL_CAP} to stay at ${MINERAL_CAP}`);
  }
  const refinery = readRefinery(cmd.refinery, p, pre);
  const lab = cmd.researchLab === true;
  if (lab && !hasDev(p, DEV.researchLab)) fail('bad_research_lab', 'A Research Lab card needs Upgraded Eng. Complex – Research Lab');
  if (lab && p.structures.engineering - (occupied.structures.engineering ?? 0) < 1) {
    fail('bad_research_lab', 'A Research Lab card needs at least one engineering complex that is not occupied');
  }
  const raids = readRaids(g, f, cmd.raids);

  // Then apply it.
  const parts: string[] = [];
  const held = contentsText(occupied);
  if (held !== '') parts.push(`occupied: ${held}`);
  const mined = MINERALS.filter((m) => pre.minerals[m] > 0).map((m) => `${pre.minerals[m]} ${m}`);
  if (mined.length > 0) parts.push(`mined ${andList(mined)}`);
  const dropped = MINERALS.filter((m) => discard[m] > 0).map((m) => `${discard[m]} ${m}`);
  if (dropped.length > 0) parts.push(`discarded ${andList(dropped)}`);
  const refined = [
    ...(refinery.planetary > 0 ? [`${refinery.planetary} planetary`] : []),
    ...(refinery.moon > 0 ? [`${refinery.moon} moon`] : []),
  ];
  if (refined.length > 0) parts.push(`refined ${andList(refined)}`);
  const c = refinery.convert;
  if (c > 0) parts.push(`converted ${c} planetary + ${c} moon into ${plural(c, 'component', 'components')}`);
  parts.push(`${pre.income} ISK income`, `${pre.research} research`);
  if (lab) parts.push('a Research Lab card');
  if (raids.length > 0) parts.push(`raids ${andList(raids.map((r) => `${factionName(r.target)} (strength ${r.strength})`))}`);
  out.lines.push(`${factionName(f)} confirmed upkeep: ${parts.join(', ')}`);

  for (const m of MINERALS) p.res[m] = minerals[m];
  p.res.planetary += refinery.planetary - c;
  p.res.moon += refinery.moon - c;
  p.res.component += c;
  addRes(p, 'isk', pre.income, out);
  pv.pendingResearch += pre.research;
  if (lab) pv.pendingCards += 1;
  u.raids.push(...raids);
  u.confirmed.push(f);
  finalizeIfConfirmed(g, out);
}

/** The confirm that completes the set (every seated player has confirmed) also finalises the upkeep, in the same command. */
export function finalizeIfConfirmed(g: GameState, out: Out): void {
  const u = needUpkeep(g);
  if (g.seats.every((s) => !seated(g, s) || u.confirmed.includes(s))) finalizeUpkeep(g, out);
}

// ---------------------------------------------------------------------------------------------------------------
// finalising

/** Manual p. 24: where the raiding fleet goes, and what happens when it has nowhere to go. */
function raidMoveText(name: string): string {
  return `Raid on ${name}: move your raiding fleet from ${name}'s home system to an adjacent system that is explored, not a home system, not controlled by another player and free of enemy ships (no exhausted token). If there is none it is destroyed: draw 1 event per full 3 of its strength (reparations)`;
}

/**
 * Raids by raider in seat order from the first player; each succeeds if its strength exceeds the home's defence. In a
 * light game every declared raid succeeded (it was judged at the table), so none is compared with a defence.
 */
function resolveRaids(g: GameState, raids: RaidDecl[], out: Out): void {
  const light = isLight(g);
  for (const raider of seatOrderFrom(g, g.firstPlayer)) {
    for (const r of raids) {
      if (r.raider !== raider) continue;
      const target = player(g, r.target);
      const name = factionName(r.target);
      let success = true;
      if (light) {
        out.lines.push(`${factionName(raider)}'s raid on ${name} succeeds`);
      } else {
        const defence = raidDefence(target);
        success = r.strength > defence;
        out.lines.push(`${factionName(raider)}'s raid on ${name} ${success ? 'succeeds' : 'fails'} (strength ${r.strength} against ${defence})`);
      }
      if (success) stealVP(g, r.target, raider, out);
      out.notices.push({ to: raider, text: raidMoveText(name), kind: 'todo' });
    }
  }
}

/**
 * +1 VP each with 5+ non-home systems, +1 more to the sole player with the most (5+), +1 for the central system. The
 * 2-player layout has no central system: the official errata gives that VP to the sole player with the most tier 3
 * systems instead (none on a tie), and the `central` flag records who that is.
 */
function scoreDomination(g: GameState, out: Out): void {
  const order = seatOrderFrom(g, g.firstPlayer).filter((f) => seated(g, f));
  for (const f of order) {
    const n = player(g, f).systems;
    if (n < DOMINATION_SYSTEMS) continue;
    out.lines.push(`Domination: ${factionName(f)} controls ${n} systems`);
    gainVP(g, f, 1, out);
  }
  const most = Math.max(...order.map((f) => player(g, f).systems));
  const leaders = order.filter((f) => player(g, f).systems === most);
  if (most >= DOMINATION_SYSTEMS && leaders.length === 1) {
    out.lines.push(`Domination: ${factionName(leaders[0]!)} controls the most systems`);
    gainVP(g, leaders[0]!, 1, out);
  }
  for (const f of order) {
    if (!player(g, f).central) continue;
    out.lines.push(`Domination: ${factionName(f)} ${g.seats.length === 2 ? 'controls the most tier 3 systems' : 'holds the central system'}`);
    gainVP(g, f, 1, out);
  }
}

/**
 * Fleet Supremacy: +1 VP to each holder with at least one large ship on the board (every upkeep). A light game keeps
 * no ships: a holder scores when they declared a large ship (`largeShips`) in their upkeep.
 */
function scoreFleetSupremacy(g: GameState, largeShips: readonly FactionId[], out: Out): void {
  const light = isLight(g);
  for (const f of seatOrderFrom(g, g.firstPlayer)) {
    const p = seated(g, f);
    if (!p || !hasDev(p, DEV.fleetSupremacy) || !(light ? largeShips.includes(f) : hasLargeShip(p))) continue;
    out.lines.push(`Fleet Supremacy: ${factionName(f)} has a large ship`);
    gainVP(g, f, 1, out);
  }
}

/** First player passes clockwise; cubes, slots, passes and the round's retreats reset; the new first player takes the first turn. */
function startNextRound(g: GameState, out: Out): void {
  g.firstPlayer = nextSeat(g, g.firstPlayer);
  g.round += 1;
  g.retreatsThisRound = [];
  for (const f of g.seats) {
    const p = seated(g, f);
    if (!p) continue;
    p.cubesUsed = 0;
    for (const a of Object.keys(p.slots) as ActionType[]) p.slots[a] = 0;
    p.passed = false;
  }
  g.turn = { faction: g.firstPlayer, actionTaken: null, deployable: false };
  g.phase = 'actions';
  g.upkeep = null;
  const first = factionName(g.firstPlayer);
  out.lines.push(`Round ${g.round} begins: ${player(g, g.firstPlayer).name} (${first}) is first player and takes the first turn`);
  out.notices.push({ to: 'all', text: `Round ${g.round}: pass the first player token to ${first}`, kind: 'todo', key: FIRST_PLAYER_KEY });
  if (g.verge !== null && g.round >= g.verge.finalRound) {
    out.notices.push({ to: 'all', text: "Final round: the game ends after this round's upkeep", kind: 'info' }); // the verge banner says so
  }
}

/**
 * Runs once every player has confirmed: raids, untap all developments, domination (not in an emergency upkeep),
 * Fleet Supremacy; then the game ends after the final round's (non-emergency) upkeep, or the next round begins.
 */
export function finalizeUpkeep(g: GameState, out: Out): void {
  const u = needUpkeep(g);
  out.lines.push(u.emergency ? 'Everyone confirmed: finishing the emergency upkeep' : 'Everyone confirmed: finishing the upkeep');
  resolveRaids(g, u.raids, out);
  for (const f of g.seats) {
    const p = seated(g, f);
    if (p) p.tapped = [];
  }
  if (!u.emergency) scoreDomination(g, out);
  scoreFleetSupremacy(g, u.largeShips, out);
  if (g.verge !== null && !u.emergency && g.round >= g.verge.finalRound) {
    endGame(g, out);
    return;
  }
  startNextRound(g, out);
}

// ---------------------------------------------------------------------------------------------------------------
// verge and end

/**
 * The first time any player has 10+ VP, sets the Verge of Ascendancy: the next round is the final one. Reached
 * during the actions, the round ends when the current turn ends (`emergencyPending`, see `advanceTurn`); reached
 * during an upkeep, that upkeep finishes normally. Never re-triggers.
 */
export function checkVerge(g: GameState, f: FactionId, out: Out): void {
  if (g.verge !== null) return;
  const p = seated(g, f);
  if (!p || p.vp < VERGE_VP) return;
  const emergencyPending = g.phase === 'actions';
  g.verge = { by: f, finalRound: g.round + 1, emergencyPending };
  const name = factionName(f);
  out.lines.push(`${name} reached ${p.vp} VP and is on the Verge of Ascendancy: round ${g.round + 1} is the final round`);
  out.notices.push({
    to: 'all',
    text: `${name} is on the Verge of Ascendancy — one more round${emergencyPending ? ' (this round ends when the current turn ends)' : ''}`,
    kind: 'info', // the verge banner stays up until the game ends
  });
}

/**
 * Ends the game. Ranking by VP, then non-home systems, then total ship strength (ties keep seat order);
 * `winners` is everyone tied with the top on all three. A light game keeps no ships, so it ranks by VP, then systems.
 */
export function endGame(g: GameState, out: Out): void {
  const light = isLight(g);
  const rows = g.seats.flatMap((f) => {
    const p = seated(g, f);
    return p ? [{ f, vp: p.vp, systems: p.systems, strength: light ? 0 : fleetStrength(p) }] : [];
  });
  rows.sort((a, b) => b.vp - a.vp || b.systems - a.systems || b.strength - a.strength);
  const top = rows[0];
  const winners = rows
    .filter((r) => top !== undefined && r.vp === top.vp && r.systems === top.systems && r.strength === top.strength)
    .map((r) => r.f);
  g.phase = 'ended';
  g.turn = null;
  g.upkeep = null;
  g.result = { ranking: rows.map((r) => r.f), winners };

  const names = winners.map(factionName);
  const verdict = names.length === 1 ? `Game over: ${names[0]} wins` : `Game over: ${andList(names)} share the victory`;
  out.lines.push(verdict);
  out.lines.push(
    `Final ranking: ${rows
      .map((r, i) => `${i + 1}. ${factionName(r.f)} (${r.vp} VP, ${plural(r.systems, 'system', 'systems')}${light ? '' : `, strength ${r.strength}`})`)
      .join(', ')}`,
  );
  out.notices.push({ to: 'all', text: verdict, kind: 'info' }); // the final ranking replaces the Panel's top
}
