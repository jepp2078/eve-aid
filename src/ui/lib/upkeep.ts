/**
 * The upkeep on the Panel: "why is it this number?" breakdowns (`Income 10 = base 4 + 2×Customs 3`), the minerals
 * after mining against the 12 cap, refinery limits, the Research Lab, raid outcomes against a home's defence, the
 * draft behind `confirmUpkeep`, the toast that sums up a finished upkeep, and the final ranking rows.
 */
import { DEV } from '../../data/developments';
import { MINERAL_CAP } from '../../data/costs';
import { FACTIONS, MINERALS, type FactionId, type Mineral } from '../../data/types';
import type { Command, GameState, PlayerPublic } from '../../engine/types';
import { fleetStrength, incomeParts, raidDefence, researchParts, upkeepPreview, type UpkeepParts, type UpkeepPreview } from '../../engine/upkeep';
import { isRecord } from './drafts';
import { andList, factionName, RESOURCE_LABEL, signed } from './labels';
import { contentsOf, EMPTY_CONTENTS, sanitizeContents, type ContentsDraft } from './ops';

const count = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 99;

/* ------------------------------------------------------------------ breakdowns */

/**
 * "Income 4 = base 4", "Income 10 = base 4 + 2×Customs 3" (3 each with Upgraded Customs Office). The total is the
 * engine's (`upkeepPreview`); the parts explain it.
 */
export function incomeBreakdown(p: PlayerPublic, occupied: ContentsDraft = EMPTY_CONTENTS): string {
  const occ = contentsOf(occupied);
  return breakdown('Income', upkeepPreview(p, occ).income, incomeParts(p, occ), 'Customs');
}

/** "Research 3 = base 3", "Research 4 = base 3 + 1×Eng. Complex 1"; the total and the parts are the engine's. */
export function researchBreakdown(p: PlayerPublic, occupied: ContentsDraft = EMPTY_CONTENTS): string {
  const occ = contentsOf(occupied);
  return breakdown('Research', upkeepPreview(p, occ).research, researchParts(p, occ), 'Eng. Complex');
}

/** The upkeep preview with the occupied belts and structures taken out (they pay nothing, manual p. 15). */
export function previewWith(p: PlayerPublic, occupied: ContentsDraft): UpkeepPreview {
  return upkeepPreview(p, contentsOf(occupied));
}

function breakdown(what: string, total: number, x: UpkeepParts, structure: string): string {
  return x.structures === 0 ? `${what} ${total} = base ${x.base}` : `${what} ${total} = base ${x.base} + ${x.structures}×${structure} ${x.each}`;
}

/** "+2 Pyrite, +1 Morphite" (one per belt), or "No asteroid belts". */
export function miningText(pre: UpkeepPreview): string {
  const parts = MINERALS.filter((m) => pre.minerals[m] > 0).map((m) => `+${pre.minerals[m]} ${RESOURCE_LABEL[m]}`);
  return parts.length === 0 ? 'No asteroid belts' : parts.join(', ');
}

/** My minerals once the belts are mined. */
export function afterMining(p: PlayerPublic, pre: UpkeepPreview): Record<Mineral, number> {
  return Object.fromEntries(MINERALS.map((m) => [m, p.res[m] + pre.minerals[m]])) as Record<Mineral, number>;
}

/** The total after mining and `discard`, and how many more must go to stay at 12. */
export function mineralsAfter(p: PlayerPublic, pre: UpkeepPreview, discard: Partial<Record<Mineral, number>>): { total: number; over: number } {
  const mined = afterMining(p, pre);
  const total = MINERALS.reduce((n, m) => n + mined[m] - (discard[m] ?? 0), 0);
  return { total, over: Math.max(0, total - MINERAL_CAP) };
}

/* ------------------------------------------------------------------ the draft */

export interface RefineryPick {
  planetary: number;
  moon: number;
  convert: number;
}

export interface UpkeepDraft {
  /** The round it was made for (a new upkeep starts over). */
  round: number;
  refinery: RefineryPick;
  discard: Record<Mineral, number>;
  /** Raiding fleet strength per target; 0 = no raid. */
  raids: Partial<Record<FactionId, number>>;
  researchLab: boolean;
  /** Belts and structures held by enemy ships this upkeep: they pay out nothing. */
  occupied: ContentsDraft;
}

const NO_DISCARD: Record<Mineral, number> = { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 };

/** The refinery at its most: R of one material without the upgrade (planetary; switch freely), R of each with it. */
export function defaultUpkeep(round: number, pre: Pick<UpkeepPreview, 'refineries' | 'upgradedRefinery'>): UpkeepDraft {
  const R = pre.refineries;
  return { round, refinery: { planetary: R, moon: pre.upgradedRefinery ? R : 0, convert: 0 }, discard: { ...NO_DISCARD }, raids: {}, researchLab: false, occupied: EMPTY_CONTENTS };
}

/**
 * Each refinery stepper's limit for the current pick: without Upgraded Refinery the R materials are shared; with it
 * each is up to R, and conversions (1 planetary + 1 moon → 1 component, up to R) come from what I would hold.
 */
export function refineryLimits(p: PlayerPublic, pre: UpkeepPreview, pick: RefineryPick): RefineryPick {
  const R = pre.refineries;
  if (!pre.upgradedRefinery) return { planetary: Math.max(0, R - pick.moon), moon: Math.max(0, R - pick.planetary), convert: 0 };
  return { planetary: R, moon: R, convert: Math.min(R, p.res.planetary + pick.planetary, p.res.moon + pick.moon) };
}

export type ResearchLabState = 'none' | 'needs_engineering' | 'ok';

/** Upgraded Eng. Complex – Research Lab: may add a development card in upkeep, with an engineering complex that isn't occupied. */
export function researchLabState(p: PlayerPublic, occupied: ContentsDraft = EMPTY_CONTENTS): ResearchLabState {
  if (!p.completed.includes(DEV.researchLab)) return 'none';
  return p.structures.engineering - occupied.structures.engineering > 0 ? 'ok' : 'needs_engineering';
}

/**
 * The draft with `occupied` changed, and the refinery picks pulled back to what the working refineries allow (an
 * occupied refinery produces nothing), so the form never asks for more than the engine accepts.
 */
export function withOccupied(d: UpkeepDraft, p: PlayerPublic, occupied: ContentsDraft): UpkeepDraft {
  const pre = previewWith(p, occupied);
  const R = pre.refineries;
  const r = d.refinery;
  const planetary = Math.min(r.planetary, R);
  const moon = Math.min(r.moon, pre.upgradedRefinery ? R : R - planetary);
  const refinery = { planetary, moon, convert: pre.upgradedRefinery ? Math.min(r.convert, R, p.res.planetary + planetary, p.res.moon + moon) : 0 };
  return { ...d, occupied, refinery };
}

/**
 * Technological Breakthrough's second clause happens while distributing the upkeep research, which only exists once
 * I confirm; my confirm ends the upkeep when everyone else has confirmed, and the clause is upkeep-only. Null without
 * the card.
 */
export function breakthroughNote(game: GameState, faction: FactionId, me: PlayerPublic): string | null {
  if (!me.completed.includes(DEV.technologicalBreakthrough) || game.upkeep === null) return null;
  const last = game.seats.every((f) => f === faction || game.players[f] === undefined || game.upkeep!.confirmed.includes(f));
  return last
    ? 'Technological Breakthrough: you confirm last, which ends the upkeep, so it can’t go back face down this time.'
    : 'Technological Breakthrough: once you have confirmed, 3 of this research can turn it face down into your area (while the upkeep lasts).';
}

/** The `confirmUpkeep` command; zero discards, raids of strength 0 and an empty `occupied` are left out. */
export function upkeepCommand(d: UpkeepDraft, labAllowed: boolean): Command {
  return {
    type: 'confirmUpkeep',
    refinery: { ...d.refinery },
    discard: Object.fromEntries(MINERALS.filter((m) => d.discard[m] > 0).map((m) => [m, d.discard[m]])),
    raids: FACTIONS.flatMap((f) => ((d.raids[f] ?? 0) > 0 ? [{ target: f, strength: d.raids[f]! }] : [])),
    researchLab: labAllowed && d.researchLab,
    ...(hasOccupied(d) ? { occupied: contentsOf(d.occupied) } : {}),
  };
}

const hasOccupied = (d: UpkeepDraft): boolean => contentsOf(d.occupied) !== undefined;

export function sanitizeUpkeep(raw: unknown): UpkeepDraft | null {
  if (!isRecord(raw) || !count(raw.round) || !isRecord(raw.refinery) || !isRecord(raw.discard) || !isRecord(raw.raids)) return null;
  const { planetary, moon, convert } = raw.refinery;
  if (!count(planetary) || !count(moon) || !count(convert)) return null;
  const discard = { ...NO_DISCARD };
  for (const m of MINERALS) {
    const n = raw.discard[m];
    if (!count(n)) return null;
    discard[m] = n;
  }
  const raids: Partial<Record<FactionId, number>> = {};
  for (const [k, v] of Object.entries(raw.raids)) {
    if (!(FACTIONS as string[]).includes(k) || !count(v)) return null;
    raids[k as FactionId] = v;
  }
  return { round: raw.round, refinery: { planetary, moon, convert }, discard, raids, researchLab: raw.researchLab === true, occupied: sanitizeContents(raw.occupied) };
}

/* ------------------------------------------------------------------ raids */

export interface RaidOutcome {
  kind: 'none' | 'fail' | 'win';
  text: string;
}

/** What a raid of `strength` on `target`'s home would do (it must beat 2 + home citadels, ×2 with Upgraded Citadel). */
export function raidOutcome(target: PlayerPublic, strength: number): RaidOutcome {
  const d = raidDefence(target);
  if (strength <= 0) return { kind: 'none', text: `No raid · defence ${d}` };
  if (strength <= d) return { kind: 'fail', text: `Fails: strength ${strength} against defence ${d} (needs ${d + 1}+)` };
  return { kind: 'win', text: `Succeeds: strength ${strength} against defence ${d} · ${target.vp > 0 ? 'steal 1 VP' : 'they have no VP to steal'}` };
}

/* ------------------------------------------------------------------ after the upkeep */

/**
 * The toast when the last confirm lands: "Round 2 begins · Caldari is first player · VP: Amarr +2" (VP from raids,
 * domination and Fleet Supremacy), "· Final round" when it is; or the verdict when the game ended. Null for any
 * other change.
 */
export function roundSummary(prev: GameState, next: GameState): string | null {
  if (prev.phase !== 'upkeep') return null;
  if (next.phase === 'ended') {
    const w = (next.result?.winners ?? []).map(factionName);
    if (w.length === 0) return 'Game over';
    return w.length === 1 ? `Game over: ${w[0]} wins` : `Game over: ${andList(w)} share the victory`;
  }
  if (next.phase !== 'actions' || next.round !== prev.round + 1) return null;
  const parts = [`Round ${next.round} begins`, `${factionName(next.firstPlayer)} is first player`];
  const vp = next.seats.flatMap((f) => {
    const d = (next.players[f]?.vp ?? 0) - (prev.players[f]?.vp ?? 0);
    return d === 0 ? [] : [`${factionName(f)} ${signed(d)}`];
  });
  if (vp.length > 0) parts.push(`VP: ${vp.join(', ')}`);
  if (next.verge !== null && next.round >= next.verge.finalRound) parts.push('Final round');
  return parts.join(' · ');
}

export interface RankRow {
  faction: FactionId;
  name: string;
  /** 1-based; a full tie (VP, systems, strength) shares the place. */
  place: number;
  vp: number;
  systems: number;
  /** Total ship strength; null in a light game, which keeps no ships (it ranks by VP, then systems). */
  strength: number | null;
  winner: boolean;
}

/**
 * The final ranking with the tie-break values (VP, then non-home systems, then total ship strength; a light game stops
 * at systems).
 */
export function finalRanking(game: GameState): RankRow[] {
  const result = game.result;
  if (result === null) return [];
  const light = game.mode === 'light';
  const rows: RankRow[] = [];
  result.ranking.forEach((f, i) => {
    const p = game.players[f];
    if (p === undefined) return;
    const strength = light ? null : fleetStrength(p);
    const row = { faction: f, name: p.name, place: i + 1, vp: p.vp, systems: p.systems, strength, winner: result.winners.includes(f) };
    const prev = rows[rows.length - 1];
    if (prev !== undefined && prev.vp === row.vp && prev.systems === row.systems && prev.strength === row.strength) row.place = prev.place;
    rows.push(row);
  });
  return rows;
}
