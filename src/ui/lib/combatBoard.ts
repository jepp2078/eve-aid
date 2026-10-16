/**
 * Read models for the orbit board: the step rail (`R1 · S·Att ▸ S·Def ▸ …` with the current
 * attack highlighted), each ship token's effective DIF/ATK/SUP/RED with a "why is it this number?" breakdown, dice
 * pools in words, and one-line summaries of a side's ships in an orbit.
 *
 * Values come from the engine (`effStats`, `effDif`, `dicePool`); the breakdowns are rebuilt from the same active
 * effects the engine sums (tests check that they add up to the engine's values).
 */
import { ship as shipData } from '../../data/ships';
import { ORBITS, type AbilitySlot, type Orbit, type ShipId } from '../../data/types';
import {
  activeEffects,
  distinctNames,
  effectsOfKind,
  leaderOf,
  opponent,
  POOL_CAP,
  RETREAT_DIF,
  shipsOf,
  type DicePool,
} from '../../engine/combat/abilities';
import { nameList } from '../../engine/combat/setup';
import type { CombatShip, CombatState, GameState, Side } from '../../engine/types';
import { factionName, signed, SIZE_LABEL } from './labels';
import { STAGE_LABEL } from './table';

/* ------------------------------------------------------------------ step rail */

export const SIDES: Side[] = ['attacker', 'defender'];
export const ORBIT_SHORT: Record<Orbit, string> = { small: 'S', medium: 'M', large: 'L' };
export const SIDE_SHORT: Record<Side, string> = { attacker: 'Att', defender: 'Def' };

export type RailState = 'done' | 'current' | 'upcoming';

export interface RailStep {
  orbit: Orbit;
  side: Side;
  /** "S·Att" */
  short: string;
  /** "Small orbit: Amarr (attacker)" */
  label: string;
  state: RailState;
  /** This side won't attack from here: no leader in the orbit (once placed), or it is retreating. */
  idle: boolean;
}

export interface Rail {
  /** Null while the fleets are being set up. */
  round: number | null;
  /** "Round 1 of 3" or "Setup". */
  title: string;
  /** The stage in words ("Retreat decisions"). */
  detail: string;
  steps: RailStep[];
}

const SLOTS = ORBITS.flatMap((orbit) => SIDES.map((side) => ({ orbit, side })));

/** The six attacks of a round in order (each orbit small → large, attacker then defender) and where the fight is. */
export function stepRail(c: CombatState): Rail {
  const setup = c.stage === 'assign' || c.stage === 'start';
  const current = c.stage === 'attack' && c.step !== null ? SLOTS.findIndex((s) => s.orbit === c.step?.orbit && s.side === c.step.side) : -1;
  // A re-align after a played round (both sides answered the retreat prompt) follows the round's attacks.
  const allDone = c.stage === 'end' || (c.stage === 'realign' && c.retreatAsked.length === 2);
  const steps = SLOTS.map(({ orbit, side }, i): RailStep => {
    const state: RailState = allDone ? 'done' : current === -1 ? 'upcoming' : i < current ? 'done' : i === current ? 'current' : 'upcoming';
    const idle = c.sides[side].assigned && (leaderOf(c, side, orbit) === null || c.retreatedSide === side);
    return {
      orbit,
      side,
      short: `${ORBIT_SHORT[orbit]}·${SIDE_SHORT[side]}`,
      label: `${SIZE_LABEL[orbit]} orbit: ${factionName(c.sides[side].faction)} (${side})`,
      state,
      idle,
    };
  });
  return {
    round: setup ? null : c.round,
    title: setup ? 'Setup' : `Round ${c.round} of ${c.lastRound}`,
    detail: STAGE_LABEL[c.stage],
    steps,
  };
}

/* ------------------------------------------------------------------ token stats */

export interface StatPart {
  /** Signed change. */
  amount: number;
  /** What it is and where it comes from: "evasive (D1)", "Malediction aura (Amarr, U2)". */
  label: string;
}

export interface StatLine {
  label: 'DIF' | 'ATK' | 'SUP' | 'RED';
  value: number;
  /** The printed value. */
  base: number;
  /** Changes on top of the printed value, in the engine's order. */
  parts: StatPart[];
  /** The sum was below 0 and the value is held at 0. */
  floored: boolean;
}

export interface TokenStats {
  dif: StatLine;
  atk: StatLine;
  sup: StatLine;
  red: StatLine;
  hp: number;
  damage: number;
  /** Effects that apply only to some attacks and are not in the values (Nighthawk without an attacking orbit). */
  notes: string[];
}

/** The tier an ability needs ("D1", "O2+D2"), or "basic". */
function tierOf(id: ShipId, slot: AbilitySlot): string {
  const a = shipData(id).abilities.find((x) => x.slot === slot);
  return a === undefined || a.requires.length === 0 ? 'basic' : a.requires.join('+');
}

function line(label: StatLine['label'], base: number, parts: StatPart[]): StatLine {
  const sum = parts.reduce((n, p) => n + p.amount, base);
  return { label, value: Math.max(0, sum), base, parts, floored: sum < 0 };
}

const orList = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

/**
 * A ship's effective DIF/ATK/SUP/RED and how each is made. `fromOrbit`: the orbit attacking it now, if any (it only
 * matters for "+DIF against attacks from …" abilities; without it those become `notes`).
 */
export function tokenStats(g: GameState, c: CombatState, s: CombatShip, fromOrbit: Orbit | null): TokenStats {
  const data = shipData(s.ship);
  const atk: StatPart[] = [];
  const sup: StatPart[] = [];
  const red: StatPart[] = [];
  const dif: StatPart[] = [];
  const notes: string[] = [];
  const add = (into: StatPart[], amount: number, label: string) => {
    if (amount !== 0) into.push({ amount, label });
  };

  for (const e of activeEffects(g, c, s.side).filter((x) => x.ship.uid === s.uid)) {
    const x = e.entry.effect;
    const tier = tierOf(s.ship, e.slot);
    if (x.kind === 'stats') {
      add(atk, x.atk, `${tier} ability`);
      add(sup, x.sup, `${tier} ability`);
      add(red, x.red, `${tier} ability`);
    } else if (x.kind === 'evasive' && s.evasive) {
      add(dif, x.dif, `evasive (${tier})`);
      add(atk, x.atk, `evasive (${tier})`);
      add(sup, x.sup, `evasive (${tier})`);
    } else if (x.kind === 'difWhenTargetedFrom') {
      if (fromOrbit === null) notes.push(`${signed(x.amount)} DIF against attacks from the ${orList(x.orbits)} orbit (${tier})`);
      else if (x.orbits.includes(fromOrbit)) add(dif, x.amount, `vs ${fromOrbit}-orbit attacks (${tier})`);
    }
  }

  const enemy = opponent(s.side);
  const enemyName = factionName(c.sides[enemy].faction);
  if (c.retreatedSide === s.side) {
    add(dif, RETREAT_DIF, 'retreating');
    for (const e of distinctNames(effectsOfKind(g, c, enemy, 'enemyRetreatDif'))) {
      add(dif, e.entry.effect.amount, `${shipData(e.ship.ship).name} vs retreating ships (${enemyName}, ${tierOf(e.ship.ship, e.slot)})`);
    }
  }
  const auras = effectsOfKind(g, c, enemy, 'enemyDifInOrbit').filter((e) => e.ship.orbit === s.orbit);
  for (const e of distinctNames(auras)) {
    add(dif, e.entry.effect.amount, `${shipData(e.ship.ship).name} aura (${enemyName}, ${tierOf(e.ship.ship, e.slot)})`);
  }

  return {
    dif: line('DIF', data.dif, dif),
    atk: line('ATK', data.atk, atk),
    sup: line('SUP', data.sup, sup),
    red: line('RED', data.red, red),
    hp: data.hp,
    damage: s.damage,
    notes,
  };
}

/** Whether a stat differs from (or is built on top of) the printed value. */
export function modified(l: StatLine): boolean {
  return l.parts.length > 0 || l.value !== l.base;
}

/** "DIF 5 = 3 base + 2 evasive (D1)", or "ATK 4 as printed". */
export function lineText(l: StatLine): string {
  if (!modified(l)) return `${l.label} ${l.value} as printed`;
  const parts = l.parts.map((p) => ` ${p.amount < 0 ? '−' : '+'} ${Math.abs(p.amount)} ${p.label}`).join('');
  return `${l.label} ${l.value} = ${l.base} base${parts}${l.floored ? ', never below 0' : ''}`;
}

/** The orbit attacking `s` right now (an enemy attack in progress), else null. */
export function difOrbit(c: CombatState, s: CombatShip): Orbit | null {
  return c.stage === 'attack' && c.step !== null && c.step.side !== s.side ? c.step.orbit : null;
}

/* ------------------------------------------------------------------ pools and lines */

/** The dice each orbit rolls, in words (lane headers). */
export const ORBIT_DICE: Record<Orbit, string> = { small: 'white dice', medium: 'white and black dice', large: 'black dice' };

/** "4 white", "3 white, 3 black, 1 of either colour", "no dice". */
export function poolDice(pool: DicePool): string {
  const parts: string[] = [];
  if (pool.white > 0) parts.push(`${pool.white} white`);
  if (pool.black > 0) parts.push(`${pool.black} black`);
  if (pool.choice > 0) parts.push(`${pool.choice} of either colour`);
  return parts.length === 0 ? 'no dice' : parts.join(', ');
}

/** "Pool 7 = Zealot ATK 5 + 2× Anathema SUP 1 · capped at 10". */
export function poolBreakdown(pool: DicePool): string {
  if (pool.parts.length === 0) return 'No leader: no attack';
  const cap = `Capped at ${POOL_CAP}`;
  const parts = pool.parts.filter((p) => p !== cap);
  return `Pool ${pool.total} = ${parts.join(' + ')}${pool.parts.includes(cap) ? ` · capped at ${POOL_CAP}` : ''}`;
}

/** One side's ships in one orbit: "Zealot (leader) + 2× Anathema", "2× Anathema (no leader)", or null when none. */
export function fleetLine(c: CombatState, side: Side, orbit: Orbit): string | null {
  const ships = shipsOf(c, side, orbit);
  if (ships.length === 0) return null;
  const leader = ships.find((s) => s.role === 'leader');
  const supports = ships.filter((s) => s !== leader).map((s) => s.ship);
  if (leader === undefined) return `${nameList(supports)} (no leader)`;
  return `${shipData(leader.ship).name} (leader)${supports.length > 0 ? ` + ${nameList(supports)}` : ''}`;
}
