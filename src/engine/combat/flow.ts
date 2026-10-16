/**
 * Combat rounds: the retreat offers, the order of the attacks, when destroyed ships
 * leave, the end of a round (repairs, re-aligning orbits that lost their leader) and the manual tools for effects the
 * app does not automate (Sin, Flycatcher, Widow, Panther and corrections).
 *
 * Stage machine of a round: `retreat` (attacker answers, then the defender unless the attacker retreated) → `attack`
 * with `step` = each `{orbit, side}` in turn (small → medium → large; attacker then defender), skipping a side without
 * a present leader in that orbit, the retreating side and a side with nothing to target. After both sides of an orbit,
 * destroyed ships are removed (a destroyed `stayUntilRoundEnd` leader stays until the round ends). After the large
 * orbit the round ends: repairs, the remaining wrecks leave, then `end` (last round or a side eliminated), `realign`
 * (supports without a leader) or the next round's `retreat`. A side left without ships ends the combat at once.
 */
import { ship as shipData } from '../../data/ships';
import { ORBITS, type FactionId, type Orbit, type ShipId } from '../../data/types';
import { andList } from '../turns';
import type { Command, CombatShip, CombatState, Ctx, GameState, Side } from '../types';
import { factionName, fail, isLight, needActor, player, withArticle, type Out } from '../util';
import { distinctNames, effectsOfKind, leaderOf, opponent, shipEffects, shipsOf } from './abilities';
import { computeOutcome, verdict } from './end';
import { isOrbit, knownShip, nameList, needCombat, needSide, needStage, ROLES } from './setup';

type Cmd<T extends Command['type']> = Extract<Command, { type: T }>;
type Step = NonNullable<CombatState['step']>;
type Role = CombatShip['role'];

const SIDES: Side[] = ['attacker', 'defender'];
/** Every attack of a round in order: each orbit small → large, the attacker then the defender. */
const SLOTS: Step[] = ORBITS.flatMap((orbit) => SIDES.map((side) => ({ orbit, side })));

const sideName = (c: CombatState, side: Side): string => factionName(c.sides[side].faction);

/** "Caldari's Crow". */
export function shipLabel(c: CombatState, s: CombatShip): string {
  return `${sideName(c, s.side)}'s ${shipData(s.ship).name}`;
}

/** An attack may target `s`: on the board, not destroyed, and not a support in its own side's Vanguard Ship orbit. */
export function isTargetable(c: CombatState, s: CombatShip): boolean {
  return !s.removed && !s.destroyed && !(s.role === 'support' && c.sides[s.side].vanguardOrbit === s.orbit);
}

/** The enemy ships `side` may target. */
export function targetsFor(c: CombatState, side: Side): CombatShip[] {
  return c.ships.filter((s) => s.side !== side && isTargetable(c, s));
}

/** The present supports of `side` in orbits that have no leader: the ships its `combatRealign` must place. */
export function needsRealign(c: CombatState, side: Side): CombatShip[] {
  return shipsOf(c, side).filter((s) => s.role === 'support' && leaderOf(c, side, s.orbit) === null);
}

/** Stage `end`, with the outcome as it stands. */
function endCombat(g: GameState, c: CombatState, out: Out): void {
  c.stage = 'end';
  c.step = null;
  c.attack = null;
  c.outcome = computeOutcome(g, c);
  out.lines.push(`The combat is over: ${sideName(c, c.outcome.winner)} wins ${verdict(c, c.outcome)}`);
}

/**
 * Destroyed ships leave the board; before the round ends a destroyed leader with an active `stayUntilRoundEnd`
 * (Kronos) stays. If a side has no ships left the combat ends; returns true then.
 */
function removeDestroyed(g: GameState, c: CombatState, out: Out, roundEnd: boolean): boolean {
  const gone = c.ships.filter(
    (s) => s.destroyed && !s.removed && (roundEnd || shipEffects(g, c, s, 'stayUntilRoundEnd').length === 0),
  );
  for (const s of gone) s.removed = true;
  if (gone.length > 0) out.lines.push(`Removed from the battle: ${andList(gone.map((s) => shipLabel(c, s)))}`);
  if (SIDES.some((side) => shipsOf(c, side).length === 0)) {
    endCombat(g, c, out);
    return true;
  }
  return false;
}

function nextRound(c: CombatState, out: Out): void {
  c.round += 1;
  c.stage = 'retreat';
  c.retreatAsked = [];
  c.step = null;
  c.attack = null;
  out.lines.push(`Round ${c.round} begins`);
}

/** End of a round: repairs, the remaining wrecks leave, then the end of the combat, a re-align or the next round. */
function roundEnd(g: GameState, c: CombatState, out: Out): void {
  out.lines.push(`Round ${c.round} ends`);
  for (const side of SIDES) {
    for (const e of effectsOfKind(g, c, side, 'healSelfRoundEnd')) {
      const s = e.ship;
      const n = Math.min(s.damage, e.entry.effect.amount);
      if (s.destroyed || n <= 0) continue;
      s.damage -= n;
      out.lines.push(`${shipLabel(c, s)} repairs ${n} damage`);
    }
  }
  if (removeDestroyed(g, c, out, true)) return;
  if (c.round >= c.lastRound) {
    endCombat(g, c, out);
    return;
  }
  if (!enterRealign(c, out)) nextRound(c, out);
}

/** When some side has supports without a leader, the stage becomes `realign` (logged on entry); returns whether so. */
function enterRealign(c: CombatState, out: Out): boolean {
  const realigning = SIDES.filter((side) => needsRealign(c, side).length > 0);
  if (realigning.length === 0) return false;
  if (c.stage !== 'realign') {
    c.stage = 'realign';
    out.lines.push(`${andList(realigning.map((side) => sideName(c, side)))} must re-align ships that lost their leader`);
  }
  return true;
}

/**
 * Nothing is left to re-align. A re-align that followed a played round (its retreat prompts were both answered: any
 * retreat would have made it the last round) leads to the next round; one that interrupted the retreat prompts
 * (`settle` cleared them) returns to them in the same round.
 */
function leaveRealign(c: CombatState, out: Out): void {
  if (c.retreatAsked.length === SIDES.length) {
    nextRound(c, out);
    return;
  }
  c.stage = 'retreat';
  out.lines.push(`Round ${c.round} resumes with the retreat decisions`);
}

/** Sets whether `s` is destroyed, keeping `kills` (ships of the other side destroyed in this combat) in step. */
export function markDestroyed(c: CombatState, s: CombatShip, destroyed: boolean): void {
  if (s.destroyed === destroyed) return;
  s.destroyed = destroyed;
  const by = opponent(s.side);
  c.kills[by] = Math.max(0, c.kills[by] + (destroyed ? 1 : -1));
}

/**
 * Moves on from the current step (or, with `step` null, starts the round's attacks): after a defender slot the orbit
 * is done and its destroyed ships leave; the next slot whose side has a present leader there, is not retreating and
 * has a target becomes `step` (a side with nothing to target is skipped with a log line); after the large orbit the
 * round ends.
 */
export function advanceStep(g: GameState, c: CombatState, out: Out): void {
  const from = c.step;
  let i = from === null ? -1 : SLOTS.findIndex((s) => s.orbit === from.orbit && s.side === from.side);
  c.step = null;
  c.attack = null;
  for (;;) {
    if (i >= 0 && SLOTS[i]!.side === 'defender' && removeDestroyed(g, c, out, false)) return;
    i += 1;
    const slot = SLOTS[i];
    if (slot === undefined) {
      roundEnd(g, c, out);
      return;
    }
    if (slot.side === c.retreatedSide || leaderOf(c, slot.side, slot.orbit) === null) continue;
    if (targetsFor(c, slot.side).length === 0) {
      out.lines.push(`${sideName(c, slot.side)} has no target for its ${slot.orbit}-orbit attack`);
      continue;
    }
    c.step = { orbit: slot.orbit, side: slot.side };
    c.attack = { target: null, overflow: null };
    return;
  }
}

function beginAttacks(g: GameState, c: CombatState, out: Out): void {
  c.stage = 'attack';
  c.step = null;
  c.attack = null;
  advanceStep(g, c, out);
}

// ---------------------------------------------------------------------------------------------------------------
// combatRetreat

/**
 * The side being asked says whether it retreats: the attacker first, then the defender (not asked once the attacker
 * retreats). A retreat makes this the last round; the retreating side makes no attacks and its ships get +1 DIF. It
 * is recorded in `retreatsThisRound` (Pacifist).
 * In round 1 an enemy's active `noEnemyRetreatRound1` (destroyer U2) forbids it (`retreat_blocked`).
 */
export function combatRetreat(g: GameState, cmd: Cmd<'combatRetreat'>, ctx: Ctx, out: Out): void {
  const f = needActor(g, ctx);
  const c = needCombat(g);
  const side = needSide(c, f);
  needStage(c, 'retreat');
  const asked: Side = c.retreatAsked.includes('attacker') ? 'defender' : 'attacker';
  if (side !== asked) fail('not_your_step', `Wait for ${sideName(c, asked)} to decide whether to retreat`);
  if (typeof cmd.retreat !== 'boolean') fail('bad_command', 'Say whether you retreat');
  const blockers = distinctNames(effectsOfKind(g, c, opponent(side), 'noEnemyRetreatRound1'));
  if (cmd.retreat && c.round === 1 && blockers.length > 0) {
    const names = andList(blockers.map((e) => shipData(e.ship.ship).name));
    fail('retreat_blocked', `You cannot retreat in the first round (enemy ${names})`);
  }
  c.retreatAsked.push(side);
  if (!cmd.retreat) {
    out.lines.push(`${factionName(f)} does not retreat`);
    if (side === 'defender') beginAttacks(g, c, out);
    return;
  }
  c.retreatedSide = side;
  c.lastRound = c.round;
  if (!g.retreatsThisRound.includes(f)) g.retreatsThisRound.push(f); // Pacifist holders may now use it
  out.lines.push(`${factionName(f)} retreats: round ${c.round} is the last round`);
  beginAttacks(g, c, out);
}

// ---------------------------------------------------------------------------------------------------------------
// combatRealign

interface Move {
  ship: CombatShip;
  orbit: Orbit;
  role: Role;
}

/**
 * A side places exactly its supports that lost their leader (`needsRealign`). Per orbit that lost its leader (manual
 * p.30 step 8): either one size-matched support is promoted to lead it and the others stay, or all of its supports
 * move to other orbits that have a leader (possibly one promoted in this same re-align). The attacker re-aligns first. When no side needs
 * to re-align any more, the next round begins.
 */
export function combatRealign(g: GameState, cmd: Cmd<'combatRealign'>, ctx: Ctx, out: Out): void {
  const f = needActor(g, ctx);
  const c = needCombat(g);
  const side = needSide(c, f);
  needStage(c, 'realign');
  const must = needsRealign(c, side);
  if (must.length === 0) fail('no_realign', 'None of your ships needs re-aligning');
  if (side === 'defender' && needsRealign(c, 'attacker').length > 0) {
    fail('wait_attacker', `Wait for ${sideName(c, 'attacker')} to re-align first`);
  }
  if (!Array.isArray(cmd.assign) || cmd.assign.length === 0) fail('no_ships', 'Place the ships that lost their leader');

  const listed = must.map((s) => shipData(s.ship).name).join(', ');
  const moves: Move[] = cmd.assign.map((raw: unknown) => {
    const { uid, orbit, role } = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
    const s = must.find((x) => x.uid === uid);
    if (s === undefined) fail('bad_realign', `Re-align exactly the ships that lost their leader: ${listed}`);
    const name = shipData(s.ship).name;
    if (!isOrbit(orbit)) fail('bad_orbit', `Place the ${name} in the small, medium or large orbit`);
    if (!ROLES.includes(role as Role)) fail('bad_role', `The ${name} must be a leader or a support`);
    return { ship: s, orbit, role: role as Role };
  });
  if (new Set(moves.map((m) => m.ship.uid)).size !== moves.length || moves.length !== must.length) {
    fail('bad_realign', `Re-align exactly the ships that lost their leader: ${listed}`);
  }
  const led = new Set<Orbit>(ORBITS.filter((o) => leaderOf(c, side, o) !== null));
  const promoted = new Map<Orbit, string>(); // orphaned orbit → the support promoted to lead it
  for (const { ship: s, orbit, role } of moves) {
    if (role !== 'leader') continue;
    const data = shipData(s.ship);
    if (data.size !== orbit) fail('bad_leader', `The ${data.name} is a ${data.size} ship; it can only lead the ${data.size} orbit`);
    if (led.has(orbit)) fail('two_leaders', `The ${orbit} orbit can only have one leader`);
    if (s.orbit !== orbit) fail('bad_leader', `The ${data.name} can only be promoted to lead the ${orbit} orbit it was supporting`);
    led.add(orbit);
    promoted.set(orbit, s.uid);
  }
  for (const { ship: s, orbit, role } of moves) {
    if (role === 'support' && !led.has(orbit)) {
      fail('no_leader', `The ${shipData(s.ship).name} can only support an orbit that has a leader (${orbit})`);
    }
  }
  // Manual p.30 step 8, per orbit that lost its leader: promote one support (the others stay) or move them all away.
  for (const m of moves) {
    const name = shipData(m.ship.ship).name;
    if (promoted.has(m.ship.orbit) && m.role === 'support' && m.orbit !== m.ship.orbit) {
      fail('bad_realign', `The ${m.ship.orbit} orbit gets a new leader, so its other supports stay: the ${name} cannot move`);
    }
    if (!promoted.has(m.ship.orbit) && m.orbit === m.ship.orbit) {
      fail('bad_realign', `Without a new leader the ${m.ship.orbit} orbit's supports must all move to other orbits: the ${name} cannot stay`);
    }
  }

  for (const m of moves) {
    m.ship.orbit = m.orbit;
    m.ship.role = m.role;
  }
  const said = [...moves]
    .sort((x, y) => (x.role === 'leader' ? 0 : 1) - (y.role === 'leader' ? 0 : 1))
    .map((m) => `${shipData(m.ship.ship).name} ${m.role === 'leader' ? 'leads' : 'supports'} the ${m.orbit} orbit`);
  out.lines.push(`${factionName(f)} re-aligned: ${said.join('; ')}`);
  if (SIDES.every((s) => needsRealign(c, s).length === 0)) leaveRealign(c, out);
}

// ---------------------------------------------------------------------------------------------------------------
// manual tools: combatDamage, combatDestroy, combatAddShips

/** The actor's side, for a manual tool: any stage once the start-of-combat choices are made. */
function manualSide(g: GameState, ctx: Ctx): { f: FactionId; c: CombatState; side: Side } {
  const f = needActor(g, ctx);
  const c = needCombat(g);
  const side = needSide(c, f);
  needStage(c, 'retreat', 'attack', 'realign', 'end');
  return { f, c, side };
}

function onBoard(c: CombatState, uid: unknown): CombatShip {
  const s = typeof uid === 'string' ? c.ships.find((x) => x.uid === uid && !x.removed) : undefined;
  if (s === undefined) fail('bad_ship', 'Choose a ship that is still in the battle');
  return s;
}

/**
 * After a manual change. In `attack` a wreck waits for its orbit's attacks like any other. Between rounds (`retreat`,
 * `realign`) a ship destroyed now leaves at once and the round-end checks run again: a side without ships ends the
 * combat; supports left without a leader mean `realign` (from `retreat` the retreat prompts are cleared, to be asked
 * again afterwards); a `realign` with nothing left to place moves on. In `end` the outcome is refreshed.
 */
function settle(g: GameState, c: CombatState, out: Out): void {
  if (c.stage === 'end') {
    c.outcome = computeOutcome(g, c);
    return;
  }
  if (c.stage !== 'retreat' && c.stage !== 'realign') return;
  if (removeDestroyed(g, c, out, true)) return;
  const fromRetreat = c.stage === 'retreat';
  if (enterRealign(c, out)) {
    if (fromRetreat) c.retreatAsked = [];
    return;
  }
  if (c.stage === 'realign') leaveRealign(c, out);
}

/**
 * Either fighting side adds (delta > 0) or removes damage on any ship still on the board, within 0..HP; reaching HP
 * destroys it (see `settle`), dropping below HP revives a wreck that has not left yet.
 */
export function combatDamage(g: GameState, cmd: Cmd<'combatDamage'>, ctx: Ctx, out: Out): void {
  const { f, c } = manualSide(g, ctx);
  const s = onBoard(c, cmd.ship);
  if (!Number.isInteger(cmd.delta) || cmd.delta === 0) fail('bad_amount', 'Change the damage by a whole number other than 0');
  const hp = shipData(s.ship).hp;
  const next = Math.min(hp, Math.max(0, s.damage + cmd.delta));
  const change = next - s.damage;
  if (change === 0) fail('no_change', `${shipLabel(c, s)} already has ${s.damage} of ${hp} damage`);
  s.damage = next;
  markDestroyed(c, s, next >= hp);
  const what = change > 0 ? `added ${change} damage to` : `removed ${-change} damage from`;
  out.lines.push(`${factionName(f)} ${what} ${shipLabel(c, s)} (now ${next} of ${hp}${s.destroyed ? ', destroyed' : ''})`);
  settle(g, c, out);
}

/** Either fighting side marks a ship destroyed (see `settle` for when it leaves the board). */
export function combatDestroy(g: GameState, cmd: Cmd<'combatDestroy'>, ctx: Ctx, out: Out): void {
  const { f, c } = manualSide(g, ctx);
  const s = onBoard(c, cmd.ship);
  if (s.destroyed) fail('already_destroyed', `${shipLabel(c, s)} is already destroyed`);
  s.damage = shipData(s.ship).hp;
  markDestroyed(c, s, true);
  out.lines.push(`${factionName(f)} marked ${shipLabel(c, s)} as destroyed`);
  settle(g, c, out);
}

/** Small ships a destroyed Panther (U2) lets its owner add. */
export const PANTHER_ADD = 2;

/** Ships added mid-battle are flagged `added` (see `combatAddShips`), which is how the ones already added are counted. */
const isAdded = (s: CombatShip): boolean => s.added === true;

/**
 * How many more small ships `side` may add: `PANTHER_ADD` for each of its destroyed ships with an active "if this ship
 * is destroyed" ability (Panther U2) — judged as if the wreck were still there, as it may have left the board — less
 * the ships it has already added.
 */
export function addAllowance(g: GameState, c: CombatState, side: Side): number {
  const view: CombatState = { ...c, ships: c.ships.map((s) => (s.side === side && s.destroyed ? { ...s, removed: false } : s)) };
  const lost = effectsOfKind(g, view, side, 'reminder').filter((e) => e.entry.effect.timing === 'destroyed' && e.ship.destroyed).length;
  return Math.max(0, lost * PANTHER_ADD - c.ships.filter((s) => s.side === side && isAdded(s)).length);
}

/**
 * A fighting side adds new small ships of its own for a destroyed Panther (U2: up to two per Panther, once; see
 * `addAllowance`), within the model limit: to its `ships` and to the battle in `orbit`, as supports when that orbit has
 * a leader; in an empty small orbit the first one leads. A light game keeps no `ships`: the limit is the box less
 * that side's ships of the type already in the battle.
 */
export function combatAddShips(g: GameState, cmd: Cmd<'combatAddShips'>, ctx: Ctx, out: Out): void {
  const { f, c, side } = manualSide(g, ctx);
  if (!Array.isArray(cmd.ships) || cmd.ships.length === 0) fail('no_ships', 'Choose at least one small ship to add');
  const ids: ShipId[] = cmd.ships.map((raw: unknown) => {
    const s = knownShip(raw);
    if (s === null) fail('bad_ship', `Unknown ship "${String(raw)}"`);
    if (s.faction !== f) fail('wrong_faction', `${s.name} is ${withArticle(factionName(s.faction))} ship`);
    if (s.size !== 'small') fail('bad_ship', `Only small ships can be added; the ${s.name} is ${s.size}`);
    return s.id;
  });
  const room = addAllowance(g, c, side);
  if (ids.length > room) {
    fail('no_panther', room === 0 ? 'Adding ships needs a destroyed Panther with its U2 ability, and it can be used once' : `A destroyed Panther lets you add up to ${room} more small ${room === 1 ? 'ship' : 'ships'}`);
  }
  const orbit: unknown = cmd.orbit;
  if (!isOrbit(orbit)) fail('bad_orbit', 'Choose the small, medium or large orbit');
  const p = player(g, f);
  const owned = (id: ShipId): number => (Object.hasOwn(p.ships, id) ? (p.ships[id] as number) : 0);
  // A light game keeps no fleet: the ships of the type already in this side's battle are what the box has given out.
  const light = isLight(g);
  const inBattle = (id: ShipId): number => c.ships.filter((s) => s.side === side && s.ship === id).length;
  for (const id of new Set(ids)) {
    const { qty, name } = shipData(id);
    const n = ids.filter((x) => x === id).length;
    if (light) {
      const left = qty - inBattle(id);
      if (n > left) fail('no_models', left > 0 ? `Only ${left} more ${name} in the box` : `No more ${name} in the box`);
    } else if (owned(id) + n > qty) fail('no_models', `Only ${qty - owned(id)} more ${name} models are available`);
  }
  const hasLeader = leaderOf(c, side, orbit) !== null;
  if (!hasLeader && orbit !== 'small') fail('bad_orbit', `The ${orbit} orbit has no leader, and small ships can only lead the small orbit`);

  ids.forEach((id, i) => {
    c.ships.push({
      uid: `s${c.nextUid}`, ship: id, side, orbit, role: !hasLeader && i === 0 ? 'leader' : 'support',
      damage: 0, destroyed: false, removed: false, evasive: false, added: true,
    });
    c.nextUid += 1;
    if (!light) p.ships[id] = owned(id) + 1;
  });
  const leads = hasLeader ? '' : ` (${shipData(ids[0]!).name} leads it)`;
  out.lines.push(`${factionName(f)} added ${nameList(ids)} to the ${orbit} orbit${leads}`);
  settle(g, c, out);
}
