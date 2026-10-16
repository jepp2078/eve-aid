/**
 * Turn flow (spec 6.2) and the simple actions: cubes and slots, ending a turn, passing, forcing a stuck turn,
 * move / claim / extract and their follow-ups (discoveries, auto-claim, jump payments), and the free commands
 * (adjustments, missions, events, mineral discards).
 *
 * Handlers mutate the cloned game `apply` hands them and reject with `fail()`; `apply` discards the clone on
 * rejection, so a command is all or nothing. Log lines name factions ("Caldari claimed a system from Amarr");
 * lines written by util (`gainVP`, `addRes`) name the player as they always have.
 */
import { CUBE_COST, MAX_CUBES, SLOT_LIMIT } from '../data/costs';
import { DEV } from '../data/developments';
import { ship } from '../data/ships';
import { BASIC_MINERALS, MINERALS, type ActionType, type FactionId, type Mineral, type ResourceKey, type StructureType } from '../data/types';
import { buildStructure, STRUCTURE_NAME } from './economy';
import type { AdjustDelta, Command, Ctx, DiscoveryReward, GameState, PlayerPrivate, PlayerPublic, SystemContents, TurnState } from './types';
import { checkVerge, startUpkeep } from './upkeep';
import {
  addRes, boardISK, checkCount, factionName, fail, gainVP, hasDev, isLight, needActor, needPriv, player, seated, seatOrderFrom,
  spend, type Out,
} from './util';

type Cmd<T extends Command['type']> = Extract<Command, { type: T }>;
type ActionCmd<A extends Extract<Command, { type: 'action' }>['action']> = Extract<Command, { type: 'action'; action: A }>;
type Phase = GameState['phase'];

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th'];
/** ISK paid to every other Intelligence Network holder when an Event is played. */
const INTELLIGENCE_NETWORK_ISK = 2;
/** Civilian Resistance: ISK a rival pays the holder when taking one of their systems. */
export const CIVILIAN_RESISTANCE_ISK = 3;
const MAX_REASON = 200;
/** Why the turn can't be skipped while a combat is open, and where the way out is. */
export const CANCEL_COMBAT_FIRST = 'Cancel or finish the combat first (Combat → More → Cancel combat)';

// ---------------------------------------------------------------------------------------------------------------
// helpers

export function needPhase(g: GameState, ...allowed: Phase[]): void {
  if (!allowed.includes(g.phase)) fail('wrong_phase', `That is not possible during the ${g.phase} phase`);
}

/** The turn state when it is `f`'s turn; fails `not_your_turn`. */
export function needTurn(g: GameState, f: FactionId): TurnState {
  if (g.turn === null || g.turn.faction !== f) {
    fail('not_your_turn', g.turn === null ? 'There is no turn in progress' : `It is ${factionName(g.turn.faction)}'s turn`);
  }
  return g.turn;
}

export function andList(parts: string[]): string {
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const signed = (n: number): string => (n > 0 ? `+${n}` : String(n));

/** Entries of an object-valued command field; anything else counts as empty. */
function entries(x: unknown): [string, unknown][] {
  return typeof x === 'object' && x !== null ? Object.entries(x) : [];
}

/** An integer >= 1 (a reward or payment of nothing is a mistake); else `bad_amount`. */
function positive(n: unknown, what: string): number {
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) fail('bad_amount', `${what} must be a whole number of 1 or more`);
  return n;
}

/** Marks the player passed and says so. */
function markPassed(p: PlayerPublic, out: Out, why: string): void {
  p.passed = true;
  out.lines.push(`${factionName(p.faction)} ${why}`);
}

/**
 * Sets the central system for `f` and clears it from everyone else. Returns whether anything changed. In a 2-player
 * game the flag means the most tier 3 systems (official errata: that layout has no central system).
 */
export function takeCentral(g: GameState, f: FactionId, out: Out): boolean {
  const me = player(g, f);
  let from: FactionId | null = null;
  for (const other of g.seats) {
    const q = g.players[other];
    if (other !== f && q?.central) {
      q.central = false;
      from = other;
    }
  }
  if (me.central && from === null) return false;
  me.central = true;
  if (g.seats.length === 2) {
    out.lines.push(`${factionName(f)} now controls the most tier 3 systems`);
    if (from !== null) out.notices.push({ to: from, text: `${factionName(f)} now controls the most tier 3 systems, not you`, kind: 'todo' });
    return true;
  }
  out.lines.push(
    from === null ? `${factionName(f)} took the central system` : `${factionName(f)} took the central system from ${factionName(from)}`,
  );
  // It happens on the claimer's device: tell the rival who lost it.
  if (from !== null) out.notices.push({ to: from, text: `${factionName(f)} took the central system from you`, kind: 'todo' });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------
// turn flow

/**
 * Starts an action for `actor`: the game must be in the actions phase, it must be their turn and they must not have
 * acted yet, they need a free cube and a free slot of that type, and they pay `CUBE_COST[cubesUsed]` ISK.
 * Takes the cube, fills the slot and records `turn.actionTaken`. Returns the actor.
 */
export function beginAction(g: GameState, actor: FactionId, action: ActionType, out: Out): PlayerPublic {
  needPhase(g, 'actions');
  const turn = needTurn(g, actor);
  if (turn.actionTaken !== null) fail('already_acted', 'You already took an action this turn; end your turn');
  const p = player(g, actor);
  if (p.cubesUsed >= MAX_CUBES) fail('no_cubes', `All ${MAX_CUBES} action cubes are used`);
  if (p.slots[action] >= SLOT_LIMIT[action]) fail('slot_full', `The ${action} action can only be taken ${SLOT_LIMIT[action]} times per round`);
  const cost = CUBE_COST[p.cubesUsed] ?? 0;
  spend(p, { isk: cost });
  if (cost > 0) out.lines.push(`${factionName(actor)} pays ${cost} ISK for their ${ORDINAL[p.cubesUsed]} action`);
  p.cubesUsed += 1;
  p.slots[action] += 1;
  turn.actionTaken = action;
  return p;
}

/**
 * Hands the turn to the next player clockwise who has not passed. Players found with all 5 cubes used are marked
 * passed on the way. The turn holder comes last, so a lone remaining player keeps getting turns. With no current
 * turn it starts from the first player. A pending emergency (verge) ends the round at once; so does everyone
 * having passed (normal upkeep). Never while a combat is open (`combat_active`).
 */
export function advanceTurn(g: GameState, out: Out): void {
  // A combat belongs to the turn it started in: the turn (and so the round and the game) never moves on past one.
  if (g.combat !== null) fail('combat_active', 'Finish or cancel the combat first');
  if (g.verge?.emergencyPending) {
    startUpkeep(g, true, out);
    return;
  }
  const order =
    g.turn === null ? seatOrderFrom(g, g.firstPlayer) : [...seatOrderFrom(g, g.turn.faction).slice(1), g.turn.faction];
  for (const f of order) {
    const p = player(g, f);
    if (p.passed) continue;
    if (p.cubesUsed >= MAX_CUBES) {
      markPassed(p, out, `has used all ${MAX_CUBES} cubes and passes`);
      continue;
    }
    g.turn = { faction: f, actionTaken: null, deployable: false };
    return;
  }
  startUpkeep(g, false, out);
}

export function endTurn(g: GameState, _cmd: Cmd<'endTurn'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions');
  const f = needActor(g, ctx);
  const turn = needTurn(g, f);
  // A light game has no actions to take: the board is where the turn is played.
  if (turn.actionTaken === null && !isLight(g)) fail('no_action', 'Take an action or pass before ending your turn');
  if (g.combat !== null) fail('combat_active', 'Finish the combat before ending the turn');
  if (ctx.priv !== null && ctx.priv.pendingResearch > 0) {
    fail('pending_research', `Distribute your ${ctx.priv.pendingResearch} pending research tokens first`);
  }
  out.lines.push(`${factionName(f)} ended their turn`);
  const p = player(g, f);
  if (p.cubesUsed >= MAX_CUBES) markPassed(p, out, `has used all ${MAX_CUBES} cubes and passes`);
  advanceTurn(g, out);
}

export function pass(g: GameState, _cmd: Cmd<'pass'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions');
  const f = needActor(g, ctx);
  const turn = needTurn(g, f);
  if (g.combat !== null) fail('combat_active', 'Finish or cancel the combat before passing (Combat → More → Cancel combat)');
  if (turn.actionTaken !== null) fail('already_acted', 'You already took an action this turn; end your turn instead');
  markPassed(player(g, f), out, 'passed');
  advanceTurn(g, out);
}

/**
 * Any seated player may move on from a stuck turn. The holder is not marked passed. `expected` names the holder the
 * player means to skip: if that turn has ended meanwhile (the request crossed the holder's own End turn), nothing
 * happens (`stale_turn`), so the next player is never skipped by mistake. An open combat must be finished or
 * cancelled first (`combat_active`): it belongs to the turn being skipped.
 */
export function forceAdvance(g: GameState, cmd: Cmd<'forceAdvance'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions');
  const f = needActor(g, ctx);
  if (g.turn === null) fail('not_your_turn', 'There is no turn in progress');
  if (typeof cmd.expected !== 'string') fail('bad_command', 'Say whose turn to skip');
  if (cmd.expected !== g.turn.faction) {
    fail('stale_turn', `${seated(g, cmd.expected) ? factionName(cmd.expected) : 'That player'}'s turn already ended, so nothing was skipped`);
  }
  if (g.combat !== null) fail('combat_active', CANCEL_COMBAT_FIRST);
  out.lines.push(`${factionName(f)} forced the turn on from ${factionName(g.turn.faction)}`);
  advanceTurn(g, out);
}

// ---------------------------------------------------------------------------------------------------------------
// what a claimed system holds

/**
 * Reads the belts and structures of a claimed system (or the occupied ones of an upkeep) from a command: absent means
 * nothing; counts are whole numbers, minerals and structure types must exist (`bad_contents`). Zero entries are dropped.
 */
export function readContents(raw: unknown): SystemContents {
  const out: SystemContents = { belts: {}, structures: {} };
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== 'object') fail('bad_contents', 'The system contents are not valid');
  const c = raw as { belts?: unknown; structures?: unknown };
  for (const [key, value] of entries(c.belts)) {
    if (!MINERALS.includes(key as Mineral)) fail('bad_contents', `"${key}" is not a mineral`);
    const n = checkCount(value as number, `${key} belts`);
    if (n > 0) out.belts[key as Mineral] = n;
  }
  for (const [key, value] of entries(c.structures)) {
    if (!Object.hasOwn(STRUCTURE_NAME, key)) fail('bad_contents', `"${key}" is not a structure`);
    const n = checkCount(value as number, `${key} structures`);
    if (n > 0) out.structures[key as StructureType] = n;
  }
  return out;
}

/** "2 pyrite belts, 1 Customs Office": the parts of a system's contents, for log lines and notices ('' for nothing). */
export function contentsText(c: SystemContents): string {
  const belts = MINERALS.filter((m) => (c.belts[m] ?? 0) > 0).map((m) => `${c.belts[m]} ${m} ${c.belts[m] === 1 ? 'belt' : 'belts'}`);
  const structures = (Object.keys(STRUCTURE_NAME) as StructureType[])
    .filter((s) => (c.structures[s] ?? 0) > 0)
    .map((s) => `${c.structures[s]} ${STRUCTURE_NAME[s]}${c.structures[s] === 1 ? '' : 's'}`);
  return [...belts, ...structures].join(', ');
}

/**
 * A claimed system's belts and structures change hands: the claimer gains them (manual pp. 17, 23: you mine the belts
 * and get the structures' bonus only in systems you control) and, from a rival, the rival loses them. The rival must
 * actually have them (`rival_lacks`), and home Citadels can't be taken (home systems can't be claimed, p. 10). An
 * unclaimed system holds belts but no structures (`bad_contents`). Returns `contentsText` of what moved.
 */
function moveContents(me: PlayerPublic, rival: PlayerPublic | null, c: SystemContents): string {
  const name = rival === null ? '' : factionName(rival.faction);
  if (rival === null && Object.keys(c.structures).length > 0) {
    fail('bad_contents', 'An unclaimed system has no structures: say whose system it was to take theirs');
  }
  for (const m of MINERALS) {
    const n = c.belts[m] ?? 0;
    if (n === 0) continue;
    if (rival !== null) {
      if (n > rival.belts[m]) fail('rival_lacks', `${name} has only ${rival.belts[m]} ${m} ${rival.belts[m] === 1 ? 'belt' : 'belts'}, not ${n}`);
      rival.belts[m] -= n;
    }
    me.belts[m] += n;
  }
  for (const s of Object.keys(STRUCTURE_NAME) as StructureType[]) {
    const n = c.structures[s] ?? 0;
    if (n === 0 || rival === null) continue;
    const takeable = rival.structures[s] - (s === 'citadel' ? rival.homeCitadels : 0);
    if (n > takeable) {
      fail('rival_lacks', `${name} has only ${Math.max(0, takeable)} ${STRUCTURE_NAME[s]}${takeable === 1 ? '' : 's'} outside their home systems, not ${n}`);
    }
    rival.structures[s] -= n;
    me.structures[s] += n;
  }
  return contentsText(c);
}

// ---------------------------------------------------------------------------------------------------------------
// move, claim, extract

export function moveAction(g: GameState, _cmd: ActionCmd<'move'>, ctx: Ctx, out: Out): void {
  const f = needActor(g, ctx);
  beginAction(g, f, 'move', out);
  out.lines.push(`${factionName(f)} took a Move action`);
}

/** Marks the claim as a chance to build with Deployable Infrastructure (`deployableInfrastructure` consumes `turn.deployable`). */
function offerDeployable(g: GameState, p: PlayerPublic): void {
  if (g.turn !== null) g.turn.deployable = hasDev(p, DEV.deployableInfrastructure);
}

export function claimAction(g: GameState, cmd: ActionCmd<'claim'>, ctx: Ctx, out: Out): void {
  const f = needActor(g, ctx);
  const me = beginAction(g, f, 'claim', out);
  const from = cmd.from ?? null;
  const target = from === null ? null : takeFrom(g, f, from);
  const contents = readContents(cmd.contents);

  me.systems += 1;
  const moved = moveContents(me, target, contents);
  out.lines.push(
    `${target === null ? `${factionName(f)} claimed a system` : `${factionName(f)} claimed a system from ${factionName(target.faction)}`}${moved === '' ? '' : ` with ${moved}`}`,
  );
  if (target !== null) {
    if (hasDev(me, DEV.invader)) gainVP(g, f, 1, out);
    const resistance = hasDev(target, DEV.civilianResistance);
    if (resistance) {
      if (me.res.isk < CIVILIAN_RESISTANCE_ISK) {
        fail('insufficient', `${factionName(target.faction)}'s Civilian Resistance needs ${CIVILIAN_RESISTANCE_ISK} ISK from you (you have ${me.res.isk})`);
      }
      addRes(me, 'isk', -CIVILIAN_RESISTANCE_ISK, out);
      addRes(target, 'isk', CIVILIAN_RESISTANCE_ISK, out);
      out.lines.push(`${factionName(target.faction)}'s Civilian Resistance: ${factionName(f)} pays ${factionName(target.faction)} ${CIVILIAN_RESISTANCE_ISK} ISK`);
    }
    // It happens on the claimer's device: tell the rival who lost the system.
    out.notices.push({
      to: target.faction,
      text: `${factionName(f)} took one of your systems${moved === '' ? '' : ` (with ${moved}: take them off your board)`}${resistance ? ` and paid you ${CIVILIAN_RESISTANCE_ISK} ISK (Civilian Resistance)` : ''}`,
      kind: 'todo',
    });
  }
  if (cmd.central === true) takeCentral(g, f, out);
  offerDeployable(g, me);
}

/** Takes one system from the rival `from` (what it held moves with `moveContents`). */
export function takeFrom(g: GameState, f: FactionId, from: FactionId): PlayerPublic {
  if (from === f) fail('bad_target', 'You cannot claim a system from yourself');
  const target = player(g, from);
  if (target.systems < 1) fail('no_systems', `${factionName(from)} has no systems to take`);
  target.systems -= 1;
  return target;
}

export function extractAction(g: GameState, cmd: ActionCmd<'extract'>, ctx: Ctx, out: Out): void {
  const f = needActor(g, ctx);
  const p = beginAction(g, f, 'extract', out);
  const planetary = cmd.planetary === true;
  const moon = cmd.moon === true;
  if (!planetary && !moon) fail('bad_extract', 'Extract planetary and/or moon materials');
  if (planetary) addRes(p, 'planetary', 1, out);
  if (moon) addRes(p, 'moon', 1, out);
  out.lines.push(`${factionName(f)} extracted ${andList([...(planetary ? ['planetary'] : []), ...(moon ? ['moon'] : [])])} materials`);
}

// ---------------------------------------------------------------------------------------------------------------
// move follow-ups

/** Records discovery token rewards (research needs the private doc, so the route requires it). */
export function discover(g: GameState, cmd: Cmd<'discover'>, ctx: Ctx, out: Out, priv: PlayerPrivate | null): void {
  needPhase(g, 'actions');
  const f = needActor(g, ctx);
  const pv = needPriv(priv);
  const p = player(g, f);
  if (!Array.isArray(cmd.rewards) || cmd.rewards.length === 0) fail('bad_reward', 'Record at least one discovery reward');

  const got: string[] = [];
  for (const r of cmd.rewards as DiscoveryReward[]) {
    switch (r?.kind) {
      case 'minerals': {
        if (!Array.isArray(r.minerals) || r.minerals.length === 0) fail('bad_amount', 'Choose at least 1 mineral');
        for (const m of r.minerals) {
          if (!BASIC_MINERALS.includes(m)) fail('bad_mineral', 'Discovery minerals must be pyrite, mexallon or tritanium');
          addRes(p, m, 1, out);
        }
        got.push(`${r.minerals.length} ${r.minerals.length === 1 ? 'mineral' : 'minerals'} (${r.minerals.join(', ')})`);
        break;
      }
      case 'research': {
        const n = positive(r.amount, 'Research');
        pv.pendingResearch += n;
        got.push(`${n} research`);
        break;
      }
      case 'control': {
        // Discovery tokens sit in unclaimed systems: belts only.
        const moved = moveContents(p, null, readContents(r.contents));
        p.systems += 1;
        got.push(`control of a system${moved === '' ? '' : ` with ${moved}`}`);
        break;
      }
      case 'moon':
      case 'planetary':
      case 'component': {
        const n = positive(r.amount, 'The reward');
        addRes(p, r.kind, n, out);
        got.push(`${n} ${r.kind === 'component' ? (n === 1 ? 'component' : 'components') : `${r.kind} material${n === 1 ? '' : 's'}`}`);
        break;
      }
      case 'card':
        out.notices.push({ to: f, text: 'Draw an Event or Mission card', kind: 'todo' });
        got.push('a card');
        break;
      case 'isk': {
        const n = positive(r.amount, 'ISK');
        addRes(p, 'isk', n, out);
        got.push(`${n} ISK`);
        break;
      }
      default:
        fail('bad_reward', 'Unknown discovery reward');
    }
  }
  out.lines.push(`${factionName(f)} discovered: ${got.join(', ')}`);
}

/** A fleet of strength 3 or more entering an unclaimed system claims it. Only after a Move this turn. */
export function autoClaim(g: GameState, cmd: Cmd<'autoClaim'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions');
  const f = needActor(g, ctx);
  const turn = needTurn(g, f);
  if (turn.actionTaken !== 'move') fail('no_move', 'An automatic claim follows a Move action this turn');
  const me = player(g, f);
  const moved = moveContents(me, null, readContents(cmd.contents));
  me.systems += 1;
  out.lines.push(`${factionName(f)} claimed a system by fleet strength${moved === '' ? '' : ` with ${moved}`}`);
  if (cmd.central === true) takeCentral(g, f, out);
  offerDeployable(g, me);
}

/**
 * Deployable Infrastructure: after a claim (or auto-claim) this turn, build one structure in that system paying its
 * cost but ignoring build points. It costs no cube, and the offer is used up (`turn.deployable` -> false).
 */
export function deployableInfrastructure(g: GameState, cmd: Cmd<'deployableInfrastructure'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions');
  const f = needActor(g, ctx);
  const turn = needTurn(g, f);
  if (!turn.deployable) fail('no_deployable', 'Deployable Infrastructure can only be used right after claiming a system');
  out.lines.push(`${factionName(f)} used Deployable Infrastructure`);
  buildStructure(g, player(g, f), cmd.structure, cmd.home, cmd.discount, true, out);
  turn.deployable = false;
}

/** Black-ops jump: pay planetary and/or moon materials. */
export function payJump(g: GameState, cmd: Cmd<'payJump'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions');
  const f = needActor(g, ctx);
  const planetary = checkCount(cmd.planetary, 'Planetary materials');
  const moon = checkCount(cmd.moon, 'Moon materials');
  if (planetary + moon < 1) fail('bad_amount', 'Pay at least 1 material for the jump');
  spend(player(g, f), { planetary, moon });
  const paid = [...(planetary > 0 ? [`${planetary} planetary`] : []), ...(moon > 0 ? [`${moon} moon`] : [])];
  out.lines.push(`${factionName(f)} paid ${andList(paid)} materials for a jump`);
}

// ---------------------------------------------------------------------------------------------------------------
// free commands (actions and upkeep phases)

/** `ship()` throws on an unknown id; report that as a rule error. */
function shipName(id: string): string {
  try {
    return ship(id).name;
  } catch {
    return fail('bad_ship', `Unknown ship "${id}"`);
  }
}

/** An optional whole-number delta; a missing field means no change. */
function whole(n: unknown, what: string): number {
  if (n === undefined) return 0;
  if (typeof n !== 'number' || !Number.isInteger(n)) fail('bad_amount', `${what} must change by a whole number`);
  return n;
}

/** `cur + n`, which may not go below 0 (`insufficient`). */
function bumped(cur: number, n: number, what: string): number {
  if (cur + n < 0) fail('insufficient', `Not enough ${what} (have ${cur}, change ${signed(n)})`);
  return cur + n;
}

/** Whether `d` changes anything a light game leaves to the board: a field that is neither absent nor 0. */
function changesBoard(d: AdjustDelta): boolean {
  const set = (n: unknown): boolean => n !== undefined && n !== 0;
  return (
    [d.res, d.structures, d.belts, d.ships].some((field) => entries(field).some(([, n]) => set(n))) ||
    set(d.homeCitadels) || set(d.lockedHomeBelts)
  );
}

/**
 * Manual adjustment of the actor's own public state. Every field of `delta` is a change. With `correction: false`
 * a VP gain goes through `gainVP` (Lobbyist, verge); with `correction: true` VP is changed directly without Lobbyist,
 * though reaching 10 VP still sets the verge. A light game adjusts only VP, systems and the central system.
 */
export function adjust(g: GameState, cmd: Cmd<'adjust'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions', 'upkeep');
  const f = needActor(g, ctx);
  const p = player(g, f);
  const d = cmd.delta;
  if (typeof d !== 'object' || d === null) fail('bad_delta', 'The adjustment is missing');
  if (isLight(g) && changesBoard(d)) fail('wrong_mode', 'Scorekeeper games only adjust VP, systems and the central system');
  const correction = cmd.correction === true;
  const reason = typeof cmd.reason === 'string' ? cmd.reason.trim().slice(0, MAX_REASON) : '';
  const summaryAt = out.lines.length;
  const parts: string[] = [];

  for (const [key, raw] of entries(d.res)) {
    if (!Object.hasOwn(p.res, key)) fail('bad_key', `Unknown resource "${key}"`);
    const n = whole(raw, key);
    if (n === 0) continue;
    addRes(p, key as ResourceKey, n, out);
    parts.push(`${key === 'isk' ? 'ISK' : key} ${signed(n)}`);
  }

  const vp = whole(d.vp, 'VP');
  if (vp !== 0) {
    if (vp > 0 && !correction) {
      gainVP(g, f, vp, out);
    } else {
      p.vp = bumped(p.vp, vp, 'VP');
      checkVerge(g, f, out); // a correction skips Lobbyist but can still reach the verge
    }
    parts.push(`VP ${signed(vp)}`);
  }

  for (const [label, key] of [['systems', 'systems'], ['home citadels', 'homeCitadels'], ['locked home belts', 'lockedHomeBelts']] as const) {
    const n = whole(d[key], label);
    if (n === 0) continue;
    p[key] = bumped(p[key], n, label);
    parts.push(`${label} ${signed(n)}`);
  }

  for (const [key, raw] of entries(d.structures)) {
    if (!Object.hasOwn(p.structures, key)) fail('bad_key', `Unknown structure "${key}"`);
    const n = whole(raw, key);
    if (n === 0) continue;
    p.structures[key as StructureType] = bumped(p.structures[key as StructureType], n, `${key} structures`);
    parts.push(`${key} structures ${signed(n)}`);
  }

  for (const [key, raw] of entries(d.belts)) {
    if (!Object.hasOwn(p.belts, key)) fail('bad_key', `Unknown belt "${key}"`);
    const n = whole(raw, key);
    if (n === 0) continue;
    p.belts[key as Mineral] = bumped(p.belts[key as Mineral], n, `${key} belts`);
    parts.push(`${key} belts ${signed(n)}`);
  }

  for (const [id, raw] of entries(d.ships)) {
    const name = shipName(id);
    const n = whole(raw, name);
    if (n === 0) continue;
    const next = bumped(Object.hasOwn(p.ships, id) ? (p.ships[id] as number) : 0, n, name);
    if (next === 0) delete p.ships[id];
    else p.ships[id] = next;
    parts.push(`${name} ${signed(n)}`);
  }

  const twoPlayer = g.seats.length === 2;
  if (d.central === true) {
    if (takeCentral(g, f, out)) parts.push(twoPlayer ? 'now most tier 3 systems' : 'took central');
  } else if (d.central === false) {
    if (p.central) {
      p.central = false;
      parts.push(twoPlayer ? 'no longer most tier 3 systems' : 'gave up central');
    }
  } else if (d.central !== null && d.central !== undefined) {
    fail('bad_delta', 'central must be true, false or null');
  }

  if (parts.length === 0) fail('no_change', 'The adjustment changes nothing');
  out.lines.splice(
    summaryAt,
    0,
    `${factionName(f)} ${correction ? 'corrected' : 'adjusted'}: ${parts.join(', ')}${reason === '' ? '' : ` (${reason})`}`,
  );
}

export function missionComplete(g: GameState, cmd: Cmd<'missionComplete'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions', 'upkeep');
  const f = needActor(g, ctx);
  if (!Number.isInteger(cmd.vp) || cmd.vp < 1) fail('bad_amount', 'A mission is worth a whole number of VP, at least 1');
  out.lines.push(`${factionName(f)} completed a mission`);
  gainVP(g, f, cmd.vp, out);
}

/** An Event card was played: every *other* Intelligence Network holder gets 2 ISK (a to-do in a light game). */
export function eventPlayed(g: GameState, _cmd: Cmd<'eventPlayed'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions', 'upkeep');
  const f = needActor(g, ctx);
  out.lines.push(`${factionName(f)} played an Event card`);
  for (const other of g.seats) {
    const q = seated(g, other);
    if (other === f || !q || !hasDev(q, DEV.intelligenceNetwork)) continue;
    // A light game's boardISK writes its own line.
    if (!isLight(g)) out.lines.push(`${factionName(other)} gains ${INTELLIGENCE_NETWORK_ISK} ISK (Intelligence Network)`);
    boardISK(g, other, INTELLIGENCE_NETWORK_ISK, 'Intelligence Network', out);
  }
}

export function discardMinerals(g: GameState, cmd: Cmd<'discardMinerals'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions', 'upkeep');
  const f = needActor(g, ctx);
  const p = player(g, f);
  const dropped: string[] = [];
  for (const [key, raw] of entries(cmd.minerals)) {
    if (!MINERALS.includes(key as Mineral)) fail('bad_mineral', `"${key}" is not a mineral`);
    const n = checkCount(raw as number, key);
    if (n === 0) continue;
    const m = key as Mineral;
    if (n > p.res[m]) fail('insufficient', `Not enough ${m} (need ${n}, have ${p.res[m]})`);
    p.res[m] -= n;
    dropped.push(`${n} ${m}`);
  }
  if (dropped.length === 0) fail('bad_amount', 'Choose at least 1 mineral to discard');
  out.lines.push(`${factionName(f)} discarded ${andList(dropped)}`);
}
