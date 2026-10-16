/**
 * Combat abilities: which ship abilities are in effect, effective stats and DIF, the dice pool of an
 * orbit's attack, and the reminder texts the UI shows at each moment of a battle.
 *
 * Everything here is a pure read of the game and combat state; nothing is mutated.
 *
 * An ability is in effect ("active") when its ship is present (not removed: a destroyed ship that is still on the
 * board keeps its abilities until it is removed), every tier it requires is unlocked by its owner's completed Systems
 * cards, its role fits ("Leader:" and crit abilities only for the orbit leader, "Support:" only for a supporting
 * ship), and it is not suppressed. Suppression comes from a Curse choice (that ability of every enemy ship with that
 * name, for the rest of combat) and from an enemy leader with `suppressEnemySupportsInOrbit` (Redeemer: every
 * ability of the supporting ships in its orbit). Suppression removes abilities, never base stats.
 *
 * Abilities of same-named ships don't stack; different ships' identical effects do. Auras are therefore
 * summed over distinct ship names.
 */
import { DEV, dev } from '../../data/developments';
import { effectFor, type EffectTiming, type ShipEffect, type ShipEffectEntry } from '../../data/shipEffects';
import { ship } from '../../data/ships';
import type { AbilitySlot, DevTier, Orbit, ShipId } from '../../data/types';
import { tiersOf } from '../developments';
import type { CombatShip, CombatState, GameState, Side } from '../types';
import { hasDev, seated } from '../util';

export interface ActiveEffect {
  ship: CombatShip;
  entry: ShipEffectEntry;
  slot: AbilitySlot;
}

/** An active effect narrowed to one effect kind. */
export type ActiveOf<K extends ShipEffect['kind']> = ActiveEffect & { entry: { effect: Extract<ShipEffect, { kind: K }> } };

export interface DicePool {
  total: number;
  white: number;
  black: number;
  /** Dice whose colour the player picks (the odd die of a medium-orbit pool). */
  choice: number;
  /** Where the dice come from, for the attack instruction ("Vargur ATK 7", "2× Crow SUP 1", "Citadel +1"). */
  parts: string[];
}

/** Most dice an attack may roll. */
export const POOL_CAP = 10;
/** DIF bonus of the ships of a side that retreats this round. */
export const RETREAT_DIF = 1;

export const opponent = (side: Side): Side => (side === 'attacker' ? 'defender' : 'attacker');

/** On the board: not yet removed (a destroyed ship stays until the opposing attack in its orbit is done). */
export const present = (s: CombatShip): boolean => !s.removed;

/** Present ships of `side`, optionally only those in `orbit`. */
export function shipsOf(c: CombatState, side: Side, orbit?: Orbit): CombatShip[] {
  return c.ships.filter((s) => s.side === side && present(s) && (orbit === undefined || s.orbit === orbit));
}

/** The present leader of `side` in `orbit`, or null. */
export function leaderOf(c: CombatState, side: Side, orbit: Orbit): CombatShip | null {
  return c.ships.find((s) => s.side === side && s.orbit === orbit && s.role === 'leader' && present(s)) ?? null;
}

function tiersOfSide(g: GameState, c: CombatState, side: Side): Set<DevTier> {
  const p = seated(g, c.sides[side].faction);
  return p ? tiersOf(p) : new Set();
}

/** Abilities of `side` that are unlocked, fit the ship's role and are not cursed (Redeemer suppression not applied). */
function unsuppressed(g: GameState, c: CombatState, side: Side): ActiveEffect[] {
  const tiers = tiersOfSide(g, c, side);
  const curse = c.sides[opponent(side)].curse;
  const out: ActiveEffect[] = [];
  for (const s of shipsOf(c, side)) {
    for (const ability of ship(s.ship).abilities) {
      if (!ability.requires.every((t) => tiers.has(t))) continue;
      if (curse !== null && curse.ship === s.ship && curse.slot === ability.slot) continue;
      const entry = effectFor(s.ship, ability.slot);
      if (entry === null || (entry.role !== 'any' && entry.role !== s.role)) continue;
      out.push({ ship: s, entry, slot: ability.slot });
    }
  }
  return out;
}

/**
 * The abilities in effect for the present ships of `side` (see the file comment), in ship order then slot order.
 * Curse is applied first; then the enemy leaders that suppress supports in their orbit (leaders can only be cursed,
 * never suppressed, so there is no cycle).
 */
export function activeEffects(g: GameState, c: CombatState, side: Side): ActiveEffect[] {
  const suppressed = new Set<Orbit>(
    unsuppressed(g, c, opponent(side))
      .filter((e) => e.entry.effect.kind === 'suppressEnemySupportsInOrbit' && e.ship.role === 'leader')
      .map((e) => e.ship.orbit),
  );
  return unsuppressed(g, c, side).filter((e) => !(e.ship.role === 'support' && suppressed.has(e.ship.orbit)));
}

/** The active effects of `side` of one kind. */
export function effectsOfKind<K extends ShipEffect['kind']>(g: GameState, c: CombatState, side: Side, kind: K): ActiveOf<K>[] {
  return activeEffects(g, c, side).filter((e): e is ActiveOf<K> => e.entry.effect.kind === kind);
}

/** The active effects of one ship (by uid) of one kind. */
export function shipEffects<K extends ShipEffect['kind']>(g: GameState, c: CombatState, s: CombatShip, kind: K): ActiveOf<K>[] {
  return effectsOfKind(g, c, s.side, kind).filter((e) => e.ship.uid === s.uid);
}

/** One effect per ship name: the first of each. */
export function distinctNames<E extends ActiveEffect>(effects: E[]): E[] {
  const seen = new Set<ShipId>();
  return effects.filter((e) => {
    if (seen.has(e.ship.ship)) return false;
    seen.add(e.ship.ship);
    return true;
  });
}

/** Base ATK/SUP/RED plus the ship's own active `stats` effects and, when evasive, its evasive trade-off; each ≥ 0. */
export function effStats(g: GameState, c: CombatState, s: CombatShip): { atk: number; sup: number; red: number } {
  const base = ship(s.ship);
  let { atk, sup, red } = base;
  for (const { entry } of activeEffects(g, c, s.side).filter((e) => e.ship.uid === s.uid)) {
    const x = entry.effect;
    if (x.kind === 'stats') {
      atk += x.atk;
      sup += x.sup;
      red += x.red;
    } else if (x.kind === 'evasive' && s.evasive) {
      atk += x.atk;
      sup += x.sup;
    }
  }
  return { atk: Math.max(0, atk), sup: Math.max(0, sup), red: Math.max(0, red) };
}

/**
 * Effective DIF of `target` against an attack from `fromOrbit`: base DIF, + evasive,
 * + retreat (+1, plus each distinct enemy `enemyRetreatDif`, Lachesis -2), + its own `difWhenTargetedFrom`
 * (Nighthawk vs small/medium), + each distinct enemy `enemyDifInOrbit` aura in the target's orbit; at least 0.
 */
export function effDif(g: GameState, c: CombatState, target: CombatShip, fromOrbit: Orbit): number {
  let dif = ship(target.ship).dif;
  for (const { entry } of activeEffects(g, c, target.side).filter((e) => e.ship.uid === target.uid)) {
    const x = entry.effect;
    if (x.kind === 'evasive' && target.evasive) dif += x.dif;
    if (x.kind === 'difWhenTargetedFrom' && x.orbits.includes(fromOrbit)) dif += x.amount;
  }
  const enemy = opponent(target.side);
  if (c.retreatedSide === target.side) {
    dif += RETREAT_DIF;
    for (const e of distinctNames(effectsOfKind(g, c, enemy, 'enemyRetreatDif'))) dif += e.entry.effect.amount;
  }
  const auras = effectsOfKind(g, c, enemy, 'enemyDifInOrbit').filter((e) => e.ship.orbit === target.orbit);
  for (const e of distinctNames(auras)) dif += e.entry.effect.amount;
  return Math.max(0, dif);
}

/**
 * The dice `side` rolls for its attack from `orbit`: the leader's ATK + the SUP of its
 * supports in that orbit + the SUP of its supports elsewhere with `supToAllOrbits` (Paladin; one per ship name)
 * + citadel SUP for the system controller (Upgraded Citadel: +1 per citadel to every orbit; otherwise +1 to the chosen
 * citadel orbit), capped at 10. Small orbit: white dice; large: black; medium: half each, the odd die's colour chosen.
 * No present leader in the orbit: no attack, an empty pool.
 */
export function dicePool(g: GameState, c: CombatState, side: Side, orbit: Orbit): DicePool {
  const leader = leaderOf(c, side, orbit);
  if (leader === null) return { total: 0, white: 0, black: 0, choice: 0, parts: [] };
  let sum = 0;
  const parts: string[] = [];
  const add = (n: number, part: string): void => {
    sum += n;
    parts.push(part);
  };

  const atk = effStats(g, c, leader).atk;
  add(atk, `${ship(leader.ship).name} ATK ${atk}`);

  const groups = new Map<string, { name: string; sup: number; n: number }>();
  for (const s of shipsOf(c, side, orbit).filter((x) => x.role === 'support')) {
    const supValue = effStats(g, c, s).sup;
    const key = `${s.ship}:${supValue}`;
    const group = groups.get(key) ?? { name: ship(s.ship).name, sup: supValue, n: 0 };
    group.n += 1;
    groups.set(key, group);
  }
  for (const { name, sup, n } of groups.values()) add(n * sup, `${n > 1 ? `${n}× ` : ''}${name} SUP ${sup}`);

  const elsewhere = effectsOfKind(g, c, side, 'supToAllOrbits').filter((e) => e.ship.role === 'support' && e.ship.orbit !== orbit);
  const best = new Map<ShipId, { s: CombatShip; sup: number }>();
  for (const { ship: s } of elsewhere) {
    const supValue = effStats(g, c, s).sup;
    const prev = best.get(s.ship);
    if (prev === undefined || supValue > prev.sup) best.set(s.ship, { s, sup: supValue });
  }
  for (const { s, sup } of best.values()) add(sup, `${ship(s.ship).name} SUP ${sup} (from the ${s.orbit} orbit)`);

  const me = c.sides[side];
  const p = seated(g, me.faction);
  if (p && me.faction === c.controller && c.citadels > 0) {
    if (hasDev(p, DEV.upgradedCitadel)) add(c.citadels, `Upgraded citadels +${c.citadels}`);
    else if (me.citadelOrbit === orbit) add(1, 'Citadel +1');
  }

  const total = Math.min(POOL_CAP, sum);
  if (sum > POOL_CAP) parts.push(`Capped at ${POOL_CAP}`);
  if (orbit === 'small') return { total, white: total, black: 0, choice: 0, parts };
  if (orbit === 'large') return { total, white: 0, black: total, choice: 0, parts };
  const half = Math.floor(total / 2);
  return { total, white: half, black: half, choice: total % 2, parts };
}

/** Combat developments whose reminder belongs to a timing: rolling dice, and being targeted. */
const TACTIC: Partial<Record<EffectTiming, string>> = { roll: DEV.offensiveTactic, targeted: DEV.defensiveTactic };

/**
 * Texts the UI shows `side` at `timing`: its active `reminder` abilities ("<Ship>: <ability text>", once per ship
 * name and slot), then Offensive Tactic (`roll`) or Defensive Tactic (`targeted`) when completed and untapped.
 */
export function reminders(g: GameState, c: CombatState, side: Side, timing: EffectTiming): string[] {
  const texts: string[] = [];
  const seen = new Set<string>();
  for (const e of effectsOfKind(g, c, side, 'reminder')) {
    const key = `${e.ship.ship}:${e.slot}`;
    if (e.entry.effect.timing !== timing || seen.has(key)) continue;
    seen.add(key);
    const data = ship(e.ship.ship);
    const ability = data.abilities.find((a) => a.slot === e.slot);
    if (ability) texts.push(`${data.name}: ${ability.text}`);
  }
  const tactic = TACTIC[timing];
  const p = seated(g, c.sides[side].faction);
  if (tactic !== undefined && p && hasDev(p, tactic) && !p.tapped.includes(tactic)) {
    texts.push(`${dev(tactic).name}: ${dev(tactic).text}`);
  }
  return texts;
}
