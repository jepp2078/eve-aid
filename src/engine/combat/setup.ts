/**
 * Combat setup: the attacker opens a combat, both sides place ships in orbits
 * (attacker first), then each side makes its start-of-combat choices (attacker first: manual p.28); when both are
 * ready, round 1 begins with the retreat stage.
 *
 * Handlers mutate the cloned game `apply` hands them and reject with `fail()`; `apply` discards the clone on
 * rejection, so a command is all or nothing.
 */
import { DEV } from '../../data/developments';
import { ship as shipData, type Ship } from '../../data/ships';
import { ORBITS, type AbilitySlot, type FactionId, type Orbit, type ShipId } from '../../data/types';
import { needPhase, needTurn } from '../turns';
import type { Command, CombatShip, CombatSide, CombatState, Ctx, GameState, PlayerPublic, Side } from '../types';
import { checkCount, factionName, fail, hasDev, isLight, needActor, player, seated, withArticle, type Out } from '../util';
import { activeEffects, opponent } from './abilities';

type Cmd<T extends Command['type']> = Extract<Command, { type: T }>;
type Role = CombatShip['role'];
type Stage = CombatState['stage'];

/** Rounds in a combat unless a retreat ends it sooner. */
export const COMBAT_ROUNDS = 3;
export const ROLES: Role[] = ['leader', 'support'];
const SLOTS: AbilitySlot[] = ['basic', 'first', 'second'];
const SLOT_NAME: Record<AbilitySlot, string> = { basic: 'basic ability', first: '1st researched ability', second: '2nd researched ability' };

// ---------------------------------------------------------------------------------------------------------------
// guards (shared with the other combat handlers)

/**
 * The combat in progress; fails `no_combat`. Combats are fought in the action phase only (`wrong_phase`), so one left
 * open past it (a game saved before the turn guarded its combat) can never score after the round or the game moved
 * on: Cancel is the only way out of it.
 */
export function needCombat(g: GameState): CombatState {
  if (g.combat === null) fail('no_combat', 'There is no combat in progress');
  if (g.phase !== 'actions') fail('wrong_phase', 'The action phase is over; cancel this combat (Combat → More → Cancel combat)');
  return g.combat;
}

/** The side `f` fights on, or null. */
export function sideOf(c: CombatState, f: FactionId): Side | null {
  if (f === c.attacker) return 'attacker';
  if (f === c.defender) return 'defender';
  return null;
}

/** The side the actor fights on; fails `not_in_combat`. */
export function needSide(c: CombatState, f: FactionId): Side {
  const side = sideOf(c, f);
  if (side === null) fail('not_in_combat', 'You are not part of this combat');
  return side;
}

/** Fails `wrong_stage` unless the combat is at one of `stages`. */
export function needStage(c: CombatState, ...stages: Stage[]): void {
  if (!stages.includes(c.stage)) fail('wrong_stage', `That is not possible now (combat stage: ${c.stage})`);
}

/** The ship with this id, or null for anything else (`ship()` throws on an unknown id). */
export function knownShip(id: unknown): Ship | null {
  if (typeof id !== 'string') return null;
  try {
    return shipData(id);
  } catch {
    return null;
  }
}

export const isOrbit = (x: unknown): x is Orbit => ORBITS.includes(x as Orbit);

/** A command's optional orbit: null, or a real orbit (else `bad_orbit`). A missing field counts as null. */
function optOrbit(x: unknown): Orbit | null {
  if (x === null || x === undefined) return null;
  if (!isOrbit(x)) fail('bad_orbit', 'Choose the small, medium or large orbit');
  return x;
}

/** A command's optional faction: null, or a seated faction (else `bad_faction`). A missing field counts as null. */
function optFaction(g: GameState, x: unknown, what: string): FactionId | null {
  if (x === null || x === undefined) return null;
  if (typeof x !== 'string' || !seated(g, x as FactionId)) fail('bad_faction', `The ${what} must be a player in this game`);
  return x as FactionId;
}

/** "Malediction + 2× Crow": names in order, repeats grouped. */
export function nameList(ids: ShipId[]): string {
  const counts = new Map<ShipId, number>();
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  return [...counts].map(([id, n]) => `${n > 1 ? `${n}× ` : ''}${shipData(id).name}`).join(' + ');
}

// ---------------------------------------------------------------------------------------------------------------
// combatStart

/** Whether `p` has a ship on the board: a side without one could never be assigned (`combatAssign` needs one). */
export function hasShips(p: PlayerPublic): boolean {
  return Object.values(p.ships).some((n) => n > 0);
}

/**
 * The turn holder attacks another seated player (usually after a Move). `homeOf`: whose home system it is, if any;
 * `controller`: who controls the system (defaults to `homeOf`); `citadels`: citadels in the system. In a full game both
 * sides need a ship on the board (`no_ships`), or the combat could never get past the assignment; a light game keeps
 * no fleets, so it asks nothing of them (the ships come from the box when they are placed).
 */
export function combatStart(g: GameState, cmd: Cmd<'combatStart'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions');
  const f = needActor(g, ctx);
  needTurn(g, f);
  if (g.combat !== null) fail('combat_active', 'A combat is already in progress');
  const defender = cmd.defender;
  if (typeof defender !== 'string' || defender === f || !seated(g, defender)) {
    fail('bad_target', 'Attack another player in this game');
  }
  if (!isLight(g)) {
    if (!hasShips(player(g, f))) fail('no_ships', 'You have no ships on the board to attack with');
    if (!hasShips(player(g, defender))) fail('no_ships', `${factionName(defender)} has no ships on the board to fight with`);
  }
  const homeOf = optFaction(g, cmd.homeOf, 'home system owner');
  const controller = optFaction(g, cmd.controller, 'system controller') ?? homeOf;
  const citadels = checkCount(cmd.citadels, 'Citadels');

  const side = (faction: FactionId): CombatSide => ({
    faction, assigned: false, ready: false, citadelOrbit: null, vanguardOrbit: null, curse: null,
  });
  g.combat = {
    attacker: f, defender, homeOf, controller, citadels,
    stage: 'assign', round: 0, lastRound: COMBAT_ROUNDS,
    sides: { attacker: side(f), defender: side(defender) },
    ships: [], nextUid: 1, retreatAsked: [], retreatedSide: null, step: null, attack: null,
    results: [], kills: { attacker: 0, defender: 0 }, outcome: null,
  };

  const where: string[] = [];
  if (homeOf !== null) where.push(`in ${factionName(homeOf)}'s home system`);
  if (controller !== null) {
    where.push(`controlled by ${factionName(controller)}${citadels > 0 ? ` with ${citadels} ${citadels === 1 ? 'citadel' : 'citadels'}` : ''}`);
  }
  const a = factionName(f);
  out.lines.push(`${a} attacked ${factionName(defender)}${where.length > 0 ? ` (${where.join('; ')})` : ''}`);
  out.notices.push({
    to: defender,
    text: `${a} is attacking you: choose a strategy card face down, then assign your ships once ${a} has placed theirs`,
    kind: 'info', // the combat banner and screen walk both sides through each stage
  });
}

// ---------------------------------------------------------------------------------------------------------------
// combatAssign

interface Placement {
  ship: Ship;
  orbit: Orbit;
  role: Role;
}

function checkPlacement(raw: unknown): Placement {
  if (typeof raw !== 'object' || raw === null) fail('bad_ship', 'Choose a ship to place');
  const { ship: id, orbit, role } = raw as Record<string, unknown>;
  const s = knownShip(id);
  if (s === null) fail('bad_ship', `Unknown ship "${String(id)}"`);
  if (!isOrbit(orbit)) fail('bad_orbit', `Place the ${s.name} in the small, medium or large orbit`);
  if (!ROLES.includes(role as Role)) fail('bad_role', `The ${s.name} must be a leader or a support`);
  return { ship: s, orbit, role: role as Role };
}

/**
 * A side places its participating ships: owned ships of its faction (in a light game, as many of a ship as the box
 * holds: `no_models`), at most one size-matched leader per orbit, every other ship supporting an orbit that has a
 * leader. The attacker places first. Both placed → stage `start`.
 */
export function combatAssign(g: GameState, cmd: Cmd<'combatAssign'>, ctx: Ctx, out: Out): void {
  const f = needActor(g, ctx);
  const c = needCombat(g);
  const side = needSide(c, f);
  needStage(c, 'assign');
  if (c.sides[side].assigned) fail('already_assigned', 'Your ships are already placed');
  if (side === 'defender' && !c.sides.attacker.assigned) {
    fail('wait_attacker', `Wait for ${factionName(c.attacker)} to place their ships first`);
  }
  if (!Array.isArray(cmd.ships) || cmd.ships.length === 0) fail('no_ships', 'Place every ship you have in this system (at least one)'); // all ships in the system fight (manual p.27)

  const placements = cmd.ships.map(checkPlacement);
  const p = player(g, f);
  const count = new Map<ShipId, number>();
  for (const { ship: s } of placements) {
    if (s.faction !== f) fail('wrong_faction', `${s.name} is ${withArticle(factionName(s.faction))} ship`);
    count.set(s.id, (count.get(s.id) ?? 0) + 1);
  }
  for (const [id, n] of count) {
    const { qty, name } = shipData(id);
    if (isLight(g)) {
      if (n > qty) fail('no_models', `The box has ${qty} ${name}`);
      continue;
    }
    const owned = Object.hasOwn(p.ships, id) ? (p.ships[id] as number) : 0;
    if (n > owned) fail('not_owned', `You have ${owned} ${name} on the board, not ${n}`);
  }
  const led = new Set<Orbit>();
  for (const { ship: s, orbit, role } of placements) {
    if (role !== 'leader') continue;
    if (s.size !== orbit) fail('bad_leader', `The ${s.name} is a ${s.size} ship; it can only lead the ${s.size} orbit`);
    if (led.has(orbit)) fail('two_leaders', `The ${orbit} orbit can only have one leader`);
    led.add(orbit);
  }
  for (const { ship: s, orbit, role } of placements) {
    if (role === 'support' && !led.has(orbit)) fail('no_leader', `The ${s.name} can only support an orbit that has a leader (${orbit})`);
  }

  for (const { ship: s, orbit, role } of placements) {
    c.ships.push({
      uid: `s${c.nextUid}`, ship: s.id, side, orbit, role, damage: 0, destroyed: false, removed: false, evasive: false,
    });
    c.nextUid += 1;
  }
  c.sides[side].assigned = true;

  const byOrbit = ORBITS.filter((o) => led.has(o)).map((o) => {
    const here = placements.filter((x) => x.orbit === o).sort((x, y) => (x.role === 'leader' ? 0 : 1) - (y.role === 'leader' ? 0 : 1));
    return `${o}: ${nameList(here.map((x) => x.ship.id))}`;
  });
  const n = placements.length;
  out.lines.push(`${factionName(f)} assigned ${n} ${n === 1 ? 'ship' : 'ships'} (${byOrbit.join('; ')})`);
  if (side === 'attacker') {
    out.notices.push({ to: c.defender, text: `${factionName(f)} has placed their ships: assign yours`, kind: 'info' });
  } else {
    c.stage = 'start';
    out.lines.push('Both fleets are in place: reveal strategy cards');
    for (const to of [c.attacker, c.defender]) out.notices.push({ to, text: 'Reveal your strategy card', kind: 'info' });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// combatStartChoices

/**
 * A side's start-of-combat choices: the citadel orbit (system controller with citadels), the Vanguard Ship orbit
 * (Vanguard Ship completed), which of its explorers go evasive (active evasive ability), and a Curse (an active
 * Curse; an enemy ship in a Curse's orbit and one of that ship's abilities). The attacker chooses first (manual p.28);
 * the defender may only choose once the attacker has, and is checked against those choices (a Curse takes away the
 * ability it names, so a cursed explorer can't go evasive). Both ready → round 1, `retreat`.
 */
export function combatStartChoices(g: GameState, cmd: Cmd<'combatStartChoices'>, ctx: Ctx, out: Out): void {
  const f = needActor(g, ctx);
  const c = needCombat(g);
  const side = needSide(c, f);
  needStage(c, 'start');
  const me = c.sides[side];
  if (me.ready) fail('already_ready', 'Your start-of-combat choices are already made');
  if (side === 'defender' && !c.sides.attacker.ready) {
    fail('wait_attacker', `Wait for ${factionName(c.attacker)} to make their start-of-combat choices first`);
  }
  const p = player(g, f);
  const enemy = opponent(side);

  const citadelOrbit = optOrbit(cmd.citadelOrbit);
  if (citadelOrbit !== null && !(f === c.controller && c.citadels > 0)) {
    fail('bad_citadel', 'Only the system controller with a citadel here chooses a citadel orbit');
  }
  const vanguardOrbit = optOrbit(cmd.vanguardOrbit);
  if (vanguardOrbit !== null && !hasDev(p, DEV.vanguardShip)) fail('bad_vanguard', 'Choosing a vanguard orbit needs Vanguard Ship');

  // The attacker's choices are already in (the enemy's Curse is null while the attacker chooses), so judge as it stands.
  const mine = activeEffects(g, c, side);

  const evasive: unknown = cmd.evasive;
  if (!Array.isArray(evasive)) fail('bad_evasive', 'The evasive list is missing');
  const canEvade = new Set(mine.filter((e) => e.entry.effect.kind === 'evasive').map((e) => e.ship.uid));
  if (new Set(evasive).size !== evasive.length || !evasive.every((uid) => canEvade.has(uid as string))) {
    fail('bad_evasive', 'Only your own explorers with D1 unlocked can go evasive, each once');
  }
  const evaders = c.ships.filter((s) => evasive.includes(s.uid));

  let curse: CombatSide['curse'] = null;
  if (cmd.curse !== null && cmd.curse !== undefined) {
    const raw: unknown = cmd.curse;
    const { ship: id, slot } = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const target = knownShip(id);
    const curseOrbits = new Set(mine.filter((e) => e.entry.effect.kind === 'curse').map((e) => e.ship.orbit));
    const valid =
      target !== null &&
      target.abilities.some((a) => a.slot === slot) &&
      c.ships.some((s) => s.side === enemy && !s.removed && s.ship === target.id && curseOrbits.has(s.orbit));
    if (!valid || !SLOTS.includes(slot as AbilitySlot)) {
      fail('bad_curse', "A Curse (U1) picks an enemy ship in its own orbit and one of that ship's abilities");
    }
    curse = { ship: target.id, slot: slot as AbilitySlot };
  }

  for (const s of evaders) s.evasive = true;
  me.citadelOrbit = citadelOrbit;
  me.vanguardOrbit = vanguardOrbit;
  me.curse = curse;
  me.ready = true;

  const said: string[] = [];
  if (citadelOrbit !== null) said.push(`citadel: ${citadelOrbit} orbit`);
  if (vanguardOrbit !== null) said.push(`Vanguard Ship: ${vanguardOrbit} orbit`);
  if (evaders.length > 0) said.push(`evasive: ${nameList(evaders.map((s) => s.ship))}`);
  if (curse !== null) said.push(`Curse: ${shipData(curse.ship).name}'s ${SLOT_NAME[curse.slot]}`);
  out.lines.push(`${factionName(f)} is ready for combat${said.length > 0 ? ` (${said.join('; ')})` : ''}`);

  if (side === 'attacker') {
    out.notices.push({ to: c.defender, text: `${factionName(f)} has made their start-of-combat choices: make yours`, kind: 'info' });
  } else {
    c.stage = 'retreat';
    c.round = 1;
    c.retreatAsked = [];
    out.lines.push('Round 1 begins');
  }
}
