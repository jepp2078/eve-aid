/**
 * The end of a combat: who won, what each side earns or owes, and the two commands that close a
 * combat — `combatFinish` (rewards and notices) and `combatCancel` (no effects at all).
 *
 * Strength counts surviving ships only (on the board and not destroyed): small 1, medium 3, large 5. A side with
 * survivors adds its bonuses: +2 in its own home system, and for the system controller its citadels (1 each, 2 with
 * Upgraded Citadel) and +1 with Guerilla Warfare. The higher total wins; a tie or mutual destruction goes to the
 * defender; a side that retreated loses whatever the totals.
 */
import { DEV } from '../../data/developments';
import { ship as shipData } from '../../data/ships';
import { STRENGTH, type FactionId, type Size } from '../../data/types';
import type { Command, CombatOutcome, CombatShip, CombatState, Ctx, GameState, Side } from '../types';
import { boardISK, factionName, fail, gainVP, hasDev, isLight, needActor, player, seated, type Out } from '../util';
import { opponent } from './abilities';
import { nameList, needCombat, needSide, needStage } from './setup';

type Cmd<T extends Command['type']> = Extract<Command, { type: T }>;

const SIDES: Side[] = ['attacker', 'defender'];
/** Strength bonus of a side fighting in its own home system. */
const HOME_STRENGTH = 2;
const CITADEL_STRENGTH = 1;
const UPGRADED_CITADEL_STRENGTH = 2;
const GUERILLA_STRENGTH = 1;
/** Strength lost per reparations Event card. */
const STRENGTH_PER_EVENT = 3;
/** Spaceship Insurance: ISK per own ship destroyed, by size. */
export const INSURANCE_ISK: Record<Size, number> = { small: 2, medium: 4, large: 6 };
/** Manual p.31: the loser's fleet moves to a legal adjacent system and is exhausted. */
export const ESCAPE_NOTICE =
  'Move your surviving fleet to an adjacent explored system that no other player controls and that holds no enemy ships, then give it a Fleet Exhausted token';

const strengthOf = (ships: CombatShip[]): number => ships.reduce((sum, s) => sum + STRENGTH[shipData(s.ship).size], 0);
const cards = (n: number, why: string): string => `Draw ${n} Event ${n === 1 ? 'card' : 'cards'} (${why})`;

/** Ships of `side` still fighting: on the board and not destroyed. */
export function survivors(c: CombatState, side: Side): CombatShip[] {
  return c.ships.filter((s) => s.side === side && !s.removed && !s.destroyed);
}

/** Ships of `side` destroyed in this combat, whether or not they have left the board yet. */
export function losses(c: CombatState, side: Side): CombatShip[] {
  return c.ships.filter((s) => s.side === side && s.destroyed);
}

/** One part of a side's strength: its surviving ships of one size, or one of its bonuses. */
export type StrengthPart =
  | { kind: 'ships'; size: Size; count: number; amount: number }
  | { kind: 'home'; amount: number }
  | { kind: 'citadels'; count: number; upgraded: boolean; amount: number }
  | { kind: 'guerilla'; amount: number };

export interface StrengthBreakdown {
  total: number;
  /** Ships small → large, then the home system, citadels and Guerilla Warfare; parts worth nothing are left out. */
  parts: StrengthPart[];
}

const SIZES: Size[] = ['small', 'medium', 'large'];

/** A side's strength and what makes it up: its survivors plus, only while it has any, its bonuses. */
export function strengthBreakdown(g: GameState, c: CombatState, side: Side): StrengthBreakdown {
  const alive = survivors(c, side);
  const parts: StrengthPart[] = [];
  for (const size of SIZES) {
    const count = alive.filter((s) => shipData(s.ship).size === size).length;
    if (count > 0) parts.push({ kind: 'ships', size, count, amount: count * STRENGTH[size] });
  }
  if (alive.length > 0) {
    const f = c.sides[side].faction;
    const p = seated(g, f);
    if (c.homeOf === f) parts.push({ kind: 'home', amount: HOME_STRENGTH });
    if (c.controller === f && c.citadels > 0) {
      const upgraded = p !== undefined && hasDev(p, DEV.upgradedCitadel);
      parts.push({ kind: 'citadels', count: c.citadels, upgraded, amount: c.citadels * (upgraded ? UPGRADED_CITADEL_STRENGTH : CITADEL_STRENGTH) });
    }
    if (c.controller === f && p !== undefined && hasDev(p, DEV.guerillaWarfare)) parts.push({ kind: 'guerilla', amount: GUERILLA_STRENGTH });
  }
  return { total: parts.reduce((n, x) => n + x.amount, 0), parts };
}

/** A side's strength for deciding the winner: its survivors plus, only while it has any, its bonuses. */
export function sideStrength(g: GameState, c: CombatState, side: Side): number {
  return strengthBreakdown(g, c, side).total;
}

/** Event cards owed for these losses: 1 per full 3 strength, +1 for a defender that lost any ship. */
function reparations(side: Side, lost: CombatShip[]): number {
  return Math.floor(strengthOf(lost) / STRENGTH_PER_EVENT) + (side === 'defender' && lost.length > 0 ? 1 : 0);
}

/** Spaceship Insurance ISK `f` gets for these losses (0 without the card). */
function insurance(g: GameState, f: FactionId, lost: CombatShip[]): number {
  const p = seated(g, f);
  if (!p || !hasDev(p, DEV.spaceshipInsurance)) return 0;
  return lost.reduce((sum, s) => sum + INSURANCE_ISK[shipData(s.ship).size], 0);
}

/** The attacker earns 1 VP when it wins and destroyed at least one enemy ship. */
export const attackerEarnsVP = (c: CombatState, winner: Side): boolean => winner === 'attacker' && losses(c, 'defender').length > 0;

/** Space Warlord: +1 VP to the winner. */
function warlord(g: GameState, c: CombatState, winner: Side): boolean {
  const p = seated(g, c.sides[winner].faction);
  return p !== undefined && hasDev(p, DEV.spaceWarlord);
}

/**
 * The result of the combat as it stands (pure): the winner, both strengths, the VP the winner's side earns
 * (attacker victory and Space Warlord, per faction), each side's reparations and each faction's insurance ISK.
 */
export function computeOutcome(g: GameState, c: CombatState): CombatOutcome {
  const strength = { attacker: sideStrength(g, c, 'attacker'), defender: sideStrength(g, c, 'defender') };
  const winner: Side =
    c.retreatedSide !== null ? opponent(c.retreatedSide) : strength.attacker > strength.defender ? 'attacker' : 'defender';
  const vp: Partial<Record<FactionId, number>> = {};
  const addVP = (f: FactionId): void => {
    vp[f] = (vp[f] ?? 0) + 1;
  };
  if (attackerEarnsVP(c, winner)) addVP(c.attacker);
  if (warlord(g, c, winner)) addVP(c.sides[winner].faction);
  const insured: Partial<Record<FactionId, number>> = {};
  for (const side of SIDES) {
    const f = c.sides[side].faction;
    const n = insurance(g, f, losses(c, side));
    if (n > 0) insured[f] = n;
  }
  return {
    winner,
    strength,
    vp,
    events: { attacker: reparations('attacker', losses(c, 'attacker')), defender: reparations('defender', losses(c, 'defender')) },
    insurance: insured,
  };
}

/** Why the winner won, for log lines: "(strength 3 against 1)", "(strength 1 each: …)" or "(Amarr retreated)". */
export function verdict(c: CombatState, o: CombatOutcome): string {
  if (c.retreatedSide !== null) return `(${factionName(c.sides[c.retreatedSide].faction)} retreated)`;
  const { attacker, defender } = o.strength;
  if (attacker === defender) return `(strength ${attacker} each: a tie goes to the defender)`;
  return `(strength ${o.strength[o.winner]} against ${o.strength[opponent(o.winner)]})`;
}

// ---------------------------------------------------------------------------------------------------------------
// combatFinish

/**
 * Either fighting side closes a combat that is over (stage `end`). The outcome is recomputed, then: attacker victory
 * VP and Space Warlord through `gainVP`; with `noEscape` the loser's survivors are destroyed too; every destroyed ship
 * leaves its owner's `ships` (a light game has none to update); Spaceship Insurance pays (a light game gets a "take N
 * ISK" to-do instead, see `boardISK`); notices for reparations (the no-escape losses as a separate notice of the
 * extra cards they cause), the loser's escape move, discarding strategy cards, and — after a retreat — every other
 * untapped Pacifist holder. The combat is then cleared.
 */
export function combatFinish(g: GameState, cmd: Cmd<'combatFinish'>, ctx: Ctx, out: Out): void {
  const f = needActor(g, ctx);
  const c = needCombat(g);
  needSide(c, f);
  needStage(c, 'end');
  if (typeof cmd.noEscape !== 'boolean') fail('bad_command', 'Say whether the losing fleet can escape');

  const o = computeOutcome(g, c);
  const winner = c.sides[o.winner].faction;
  const loserSide = opponent(o.winner);
  const loser = c.sides[loserSide].faction;
  out.lines.push(`${factionName(f)} finished the combat: ${factionName(winner)} won ${verdict(c, o)}`);

  if (attackerEarnsVP(c, o.winner)) {
    const n = losses(c, 'defender').length;
    out.lines.push(`${factionName(c.attacker)} won the attack and destroyed ${n} ${n === 1 ? 'ship' : 'ships'}`);
    gainVP(g, c.attacker, 1, out);
  }
  if (warlord(g, c, o.winner)) {
    out.lines.push(`Space Warlord: ${factionName(winner)} won a combat`);
    gainVP(g, winner, 1, out);
  }

  const stranded = cmd.noEscape ? survivors(c, loserSide) : [];
  for (const s of stranded) {
    s.damage = shipData(s.ship).hp;
    s.destroyed = true;
  }
  if (stranded.length > 0) {
    out.lines.push(`${factionName(loser)}'s surviving fleet could not escape and is destroyed: ${nameList(stranded.map((s) => s.ship))}`);
  }

  const lostLines: string[] = [];
  for (const side of SIDES) {
    const lost = losses(c, side);
    if (lost.length === 0) continue;
    const p = player(g, c.sides[side].faction);
    // A light game keeps no fleet record: the players take the destroyed models off the board themselves.
    if (!isLight(g)) {
      for (const s of lost) {
        const left = (Object.hasOwn(p.ships, s.ship) ? (p.ships[s.ship] as number) : 0) - 1;
        if (left > 0) p.ships[s.ship] = left;
        else delete p.ships[s.ship];
      }
    }
    lostLines.push(`${factionName(p.faction)} lost ${nameList(lost.map((s) => s.ship))}`);
  }
  if (lostLines.length > 0) out.lines.push(lostLines.join('; '));

  for (const side of SIDES) {
    const sf = c.sides[side].faction;
    const isk = insurance(g, sf, losses(c, side));
    if (isk === 0) continue;
    // A light game's boardISK writes its own line and the to-do ("Spaceship Insurance: take 4 ISK").
    if (!isLight(g)) out.lines.push(`Spaceship Insurance: ${factionName(sf)} gains ${isk} ISK`);
    boardISK(g, sf, isk, 'Spaceship Insurance', out);
  }

  for (const side of SIDES) {
    if (o.events[side] > 0) out.notices.push({ to: c.sides[side].faction, text: cards(o.events[side], 'reparations'), kind: 'todo' });
  }
  if (stranded.length > 0) {
    const extra = reparations(loserSide, losses(c, loserSide)) - o.events[loserSide];
    if (extra > 0) out.notices.push({ to: loser, text: cards(extra, 'reparations for the fleet that could not escape'), kind: 'todo' });
  }
  if (!cmd.noEscape && survivors(c, loserSide).length > 0) out.notices.push({ to: loser, text: ESCAPE_NOTICE, kind: 'todo' });
  for (const side of SIDES) out.notices.push({ to: c.sides[side].faction, text: 'Discard the strategy cards used', kind: 'todo' });
  if (c.retreatedSide !== null) {
    const retreater = c.sides[c.retreatedSide].faction;
    for (const other of g.seats) {
      const p = seated(g, other);
      if (other === retreater || !p || !hasDev(p, DEV.pacifist) || p.tapped.includes(DEV.pacifist)) continue;
      // Nothing else points the holder at this chance, so it stays on their checklist until they use or tick it.
      out.notices.push({ to: other, text: `${factionName(retreater)} retreated — you may Use Pacifist`, kind: 'todo' });
    }
  }
  g.combat = null;
}

// ---------------------------------------------------------------------------------------------------------------
// combatCancel

/**
 * Any seated player clears the combat in any stage and any phase, with no rewards (e.g. when a fighting device is
 * gone).
 */
export function combatCancel(g: GameState, _cmd: Cmd<'combatCancel'>, ctx: Ctx, out: Out): void {
  const f = needActor(g, ctx);
  const c = g.combat;
  if (c === null) fail('no_combat', 'There is no combat in progress');
  out.lines.push(`${factionName(f)} cancelled the combat between ${factionName(c.attacker)} and ${factionName(c.defender)} (no rewards)`);
  g.combat = null;
}
