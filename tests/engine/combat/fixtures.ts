/**
 * Combat fixtures, shared by every combat test file (Task 9 setup/abilities, Task 10 attacks/flow/end).
 *
 *   const b = battle(
 *     [lead('vargur'), sup('stiletto', 'large'), lead('stiletto')],   // attacker fleet (Minmatar, from its ships)
 *     [lead('golem'), sup('golem', 'large')],                         // defender fleet (Caldari)
 *     { attacker: { tiers: ['O1', 'O2', 'D2'] }, defender: { tiers: ['O1'], devs: [DEV.upgradedCitadel] },
 *       homeOf: 'caldari', citadels: 2 },
 *   );
 *   b.c().stage;                       // 'retreat', round 1 (start choices done)
 *   b.uid('attacker', 'stiletto', 1);  // uid of the 2nd Stiletto in the attacker's fleet (fleet order)
 *   b.uids.defender;                   // ['s4', 's5']: one uid per placement, same order as the fleet array
 *   b.ship(b.uids.defender[0]!);       // the live CombatShip (reads t.game.combat)
 *   b.t.dispatch(b.attacker, cmd);     // the underlying Table from helpers.ts
 *
 * What `battle` does, in order:
 * 1. Factions: `opts.attacker.faction` / `opts.defender.faction`, else the faction of the fleet's first ship, else
 *    amarr (attacker) / caldari (defender). A fleet mixing factions throws (that would be a test bug).
 * 2. Table: `opts.table` if given (the attacker must hold the turn in the actions phase), else
 *    `startedGame([attacker, defender], { firstPlayer: attacker })`.
 * 3. Gives each side what its fleet and options need by editing the table directly: `players[f].ships[id]` is raised
 *    to at least the number of `id` placements (never lowered; a light game keeps no ships, so it is left empty), and
 *    the Systems cards for `tiers` plus any `devs` are pushed onto `players[f].completed`.
 * 4. Dispatches `combatStart` (defender, `homeOf`, `controller`, `citadels`; defaults null / null / 0).
 *    `stopAt: 'assign'` stops here (stage 'assign', nothing placed, `uids` empty).
 * 5. Dispatches the attacker's then the defender's `combatAssign` with the fleets as given (an empty fleet is skipped,
 *    leaving that side unassigned). `stopAt: 'start'` stops here (stage 'start').
 * 6. Dispatches both sides' `combatStartChoices` from `citadelOrbit`, `vanguardOrbit`, `evasive` (indices into that
 *    side's fleet array, turned into uids) and `curse` (all default to none). The combat is then in round 1, stage
 *    'retreat'.
 * Every dispatch throws on a RuleError, so a fixture that sets up an illegal battle fails loudly.
 *
 * Round helpers (Task 10): `dice({ aim: 2 }, { damage2: 1 })` builds a full DiceEntry (white faces, black faces);
 * `noRetreat(b)` answers both retreat prompts; `hit(b, side, uid, dice)` targets and rolls for that side's step;
 * `miss(b, side)` rolls nothing at the first enemy it may target; `expectRejected` / `deepFreeze` as in setup tests.
 */
import { expect } from 'vitest';
import { DEV } from '../../../src/data/developments';
import { ship as shipData } from '../../../src/data/ships';
import type { AbilitySlot, BlackFace, DevId, DevTier, FactionId, Orbit, ShipId, WhiteFace } from '../../../src/data/types';
import { isError, type ApplyResult, type Command, type CombatShip, type CombatState, type DiceEntry, type RuleError, type Side } from '../../../src/engine/types';
import { isLight } from '../../../src/engine/util';
import { startedGame, type Table } from '../helpers';

/** One ship of a fleet: its orbit and role, as `combatAssign` takes it. */
export interface Placement {
  ship: ShipId;
  orbit: Orbit;
  role: 'leader' | 'support';
}

/** The leader of an orbit; the orbit defaults to the ship's size (the only legal one). */
export const lead = (ship: ShipId, orbit: Orbit = shipData(ship).size): Placement => ({ ship, orbit, role: 'leader' });
/** A supporting ship in `orbit` (any size may support any orbit that has a leader). */
export const sup = (ship: ShipId, orbit: Orbit): Placement => ({ ship, orbit, role: 'support' });

/** The Systems card that unlocks each ship ability tier. */
export const TIER_DEV: Record<DevTier, DevId> = {
  O1: DEV.offensiveSystemsT1, O2: DEV.offensiveSystemsT2,
  D1: DEV.defensiveSystemsT1, D2: DEV.defensiveSystemsT2,
  U1: DEV.utilitySystemsT1, U2: DEV.utilitySystemsT2,
};

export interface SideOpts {
  /** Overrides the faction taken from the fleet's first ship. */
  faction?: FactionId;
  /** Ability tiers to unlock (their Systems cards are added to `completed`). */
  tiers?: DevTier[];
  /** Other completed developments (e.g. DEV.upgradedCitadel, DEV.vanguardShip, DEV.offensiveTactic). */
  devs?: DevId[];
  citadelOrbit?: Orbit | null;
  vanguardOrbit?: Orbit | null;
  /** Indices into this side's fleet array of the explorers to make evasive. */
  evasive?: number[];
  curse?: { ship: ShipId; slot: AbilitySlot } | null;
}

export interface BattleOpts {
  /** An existing table to fight on; the attacker must hold the turn. Default: a new two-player started game. */
  table?: Table;
  homeOf?: FactionId | null;
  controller?: FactionId | null;
  citadels?: number;
  attacker?: SideOpts;
  defender?: SideOpts;
  /** Stop after `combatStart` ('assign') or after both assignments ('start'). Default: run the start choices too. */
  stopAt?: 'assign' | 'start';
}

export interface Battle {
  t: Table;
  attacker: FactionId;
  defender: FactionId;
  /** The uid of each placement, in fleet order (empty until that side is assigned). */
  uids: Record<Side, string[]>;
  /** The live combat state (`t.game.combat`); throws when there is none. */
  c(): CombatState;
  /** The live CombatShip with this uid; throws when there is none. */
  ship(uid: string): CombatShip;
  /** The uid of the `n`-th (0-based, fleet order) placement of `shipId` on `side`. */
  uid(side: Side, shipId: ShipId, n?: number): string;
}

function fleetFaction(fleet: Placement[]): FactionId | null {
  const factions = new Set(fleet.map((p) => shipData(p.ship).faction));
  if (factions.size > 1) throw new Error(`A fleet mixes factions: ${[...factions].join(', ')}`);
  return [...factions][0] ?? null;
}

function equip(t: Table, f: FactionId, fleet: Placement[], o: SideOpts | undefined): void {
  const p = t.p(f);
  const need = new Map<ShipId, number>();
  for (const pl of fleet) need.set(pl.ship, (need.get(pl.ship) ?? 0) + 1);
  if (!isLight(t.game)) for (const [id, n] of need) p.ships[id] = Math.max(p.ships[id] ?? 0, n);
  for (const tier of o?.tiers ?? []) p.completed.push(TIER_DEV[tier]);
  p.completed.push(...(o?.devs ?? []));
}

/** Runs `combatAssign` for `f` and returns the new ships' uids in placement order. */
function assign(t: Table, f: FactionId, fleet: Placement[]): string[] {
  if (fleet.length === 0) return [];
  t.dispatch(f, { type: 'combatAssign', ships: fleet.map((p) => ({ ...p })) });
  const ships = t.game.combat?.ships ?? [];
  return ships.slice(ships.length - fleet.length).map((s) => s.uid);
}

function choose(t: Table, f: FactionId, uids: string[], o: SideOpts | undefined): void {
  const evasive = (o?.evasive ?? []).map((i) => {
    const uid = uids[i];
    if (uid === undefined) throw new Error(`evasive index ${i} is not in the fleet`);
    return uid;
  });
  t.dispatch(f, {
    type: 'combatStartChoices',
    citadelOrbit: o?.citadelOrbit ?? null,
    vanguardOrbit: o?.vanguardOrbit ?? null,
    evasive,
    curse: o?.curse ?? null,
  });
}

/** Sets up a combat between two fleets; see the file comment. */
export function battle(attackerFleet: Placement[], defenderFleet: Placement[], opts: BattleOpts = {}): Battle {
  const attacker = opts.attacker?.faction ?? fleetFaction(attackerFleet) ?? 'amarr';
  const defender = opts.defender?.faction ?? fleetFaction(defenderFleet) ?? 'caldari';
  if (attacker === defender) throw new Error(`Attacker and defender are both ${attacker}`);
  const t = opts.table ?? startedGame([attacker, defender], { firstPlayer: attacker });
  equip(t, attacker, attackerFleet, opts.attacker);
  equip(t, defender, defenderFleet, opts.defender);

  const fleets: Record<Side, Placement[]> = { attacker: attackerFleet, defender: defenderFleet };
  const b: Battle = {
    t,
    attacker,
    defender,
    uids: { attacker: [], defender: [] },
    c() {
      const c = t.game.combat;
      if (c === null) throw new Error('No combat in progress');
      return c;
    },
    ship(uid) {
      const s = b.c().ships.find((x) => x.uid === uid);
      if (!s) throw new Error(`No combat ship ${uid}`);
      return s;
    },
    uid(side, shipId, n = 0) {
      const at = fleets[side].map((p, i) => (p.ship === shipId ? i : -1)).filter((i) => i >= 0)[n];
      const uid = at === undefined ? undefined : b.uids[side][at];
      if (uid === undefined) throw new Error(`No placement #${n} of ${shipId} on the ${side} side (or not assigned yet)`);
      return uid;
    },
  };

  t.dispatch(attacker, {
    type: 'combatStart',
    defender,
    homeOf: opts.homeOf ?? null,
    controller: opts.controller ?? null,
    citadels: opts.citadels ?? 0,
  });
  if (opts.stopAt === 'assign') return b;

  b.uids.attacker = assign(t, attacker, attackerFleet);
  b.uids.defender = assign(t, defender, defenderFleet);
  if (opts.stopAt === 'start') return b;

  choose(t, attacker, b.uids.attacker, opts.attacker);
  choose(t, defender, b.uids.defender, opts.defender);
  return b;
}

/**
 * Gives `side` a destroyed Panther that has left the board, with U2 unlocked: the add-ships tool then lets it add two
 * small ships (once per Panther). Edits the state directly; `n` Panthers allow 2n ships.
 */
export function losePanther(b: Battle, side: Side, n = 1): void {
  const c = b.c();
  const f = side === 'attacker' ? b.attacker : b.defender;
  const p = b.t.p(f);
  if (!p.completed.includes(TIER_DEV.U2)) p.completed.push(TIER_DEV.U2);
  for (let i = 0; i < n; i += 1) {
    c.ships.push({ uid: `s${c.nextUid}`, ship: 'panther', side, orbit: 'large', role: 'support', damage: 6, destroyed: true, removed: true, evasive: false });
    c.nextUid += 1;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// round helpers (Task 10)

/** A full DiceEntry: the given face counts, every other face 0. */
export function dice(white: Partial<Record<WhiteFace, number>> = {}, black: Partial<Record<BlackFace, number>> = {}): DiceEntry {
  return {
    white: { blank: 0, aim: 0, damage: 0, crit: 0, aim2: 0, ...white },
    black: { blank: 0, aim: 0, damage: 0, crit: 0, aimDamage: 0, damage2: 0, ...black },
  };
}

export const NO_ADJUST = { aim: 0, damage: 0, crit: 0 };

/** The faction fighting on `side`. */
export const factionOf = (b: Battle, side: Side): FactionId => (side === 'attacker' ? b.attacker : b.defender);

/** Both sides decline to retreat (attacker first): the round's attacks begin. */
export function noRetreat(b: Battle): void {
  b.t.dispatch(b.attacker, { type: 'combatRetreat', retreat: false });
  b.t.dispatch(b.defender, { type: 'combatRetreat', retreat: false });
}

/** `side` targets `target` and rolls `d` (the step must be that side's); returns the roll's result. */
export function hit(b: Battle, side: Side, target: string, d: DiceEntry = dice(), adjust = NO_ADJUST): ApplyResult {
  b.t.dispatch(factionOf(b, side), { type: 'combatTarget', target });
  return b.t.dispatch(factionOf(b, side), { type: 'combatRoll', dice: d, adjust });
}

/** `side` targets the first enemy ship it may and rolls nothing (a miss). */
export function miss(b: Battle, side: Side): ApplyResult {
  const target = b.c().ships.find((s) => s.side !== side && !s.removed && !s.destroyed);
  if (!target) throw new Error(`No target for the ${side}`);
  return hit(b, side, target.uid, dice());
}

export function codeOf(r: ApplyResult | RuleError): string {
  if (!isError(r)) throw new Error(`expected a RuleError, got success: ${r.lines.join(' | ')}`);
  return r.code;
}

/** Rejected commands must leave the table exactly as it was. */
export function expectRejected(t: Table, f: FactionId, cmd: Command, code: string): void {
  const game = structuredClone(t.game);
  const privs = structuredClone(t.privs);
  expect(codeOf(t.tryDispatch(f, cmd))).toBe(code);
  expect(t.game).toStrictEqual(game);
  expect(t.privs).toStrictEqual(privs);
}

export function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null && !Object.isFrozen(x)) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}
