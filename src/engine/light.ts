/**
 * The commands only a light game has (spec 4.3, 4.4, 4.6): a game where the board keeps ISK, minerals, ships and cubes and
 * the app tracks VP, systems, development cards, turns, combat and upkeep. None is an action: no cube, no
 * `turn.actionTaken`. Handlers follow the engine's rules: mutate the clones `apply` hands them, reject with `fail()`.
 */
import { DEV } from '../data/developments';
import type { FactionId } from '../data/types';
import { CIVILIAN_RESISTANCE_ISK, andList, needPhase, needTurn, takeCentral, takeFrom } from './turns';
import type { Command, Ctx, GameState, PlayerPrivate } from './types';
import { finalizeIfConfirmed, needUpkeep } from './upkeep';
import { boardISK, factionName, fail, gainVP, hasDev, needActor, needPriv, player, seated, type Out } from './util';

type Cmd<T extends Command['type']> = Extract<Command, { type: T }>;

/** Most research tokens one `gainResearch` adds (a discovery, mission or manufacturing reward is far below it). */
export const MAX_GAINED_RESEARCH = 20;

/**
 * Claims a system on the actor's turn: +1 system for them and, from a rival, -1 for the rival (`no_systems` if they have
 * none, `bad_target` for yourself). Invader scores +1 VP and Civilian Resistance becomes a payment to-do for the claimer
 * (the holder is told they are owed it). `central: true` takes the central system. Corrections go through Adjust.
 */
export function lightClaim(g: GameState, cmd: Cmd<'lightClaim'>, ctx: Ctx, out: Out): void {
  needPhase(g, 'actions');
  const f = needActor(g, ctx);
  needTurn(g, f);
  const me = player(g, f);
  const from = cmd.from ?? null;
  const target = from === null ? null : takeFrom(g, f, from);

  me.systems += 1;
  out.lines.push(
    target === null ? `${factionName(f)} claimed a system` : `${factionName(f)} claimed a system from ${factionName(target.faction)}`,
  );
  if (target !== null) {
    if (hasDev(me, DEV.invader)) gainVP(g, f, 1, out);
    const resistance = hasDev(target, DEV.civilianResistance);
    if (resistance) boardISK(g, f, -CIVILIAN_RESISTANCE_ISK, 'Civilian Resistance', out, target.faction);
    // It happens on the claimer's device: tell the rival who lost the system.
    out.notices.push({
      to: target.faction,
      text: `${factionName(f)} took one of your systems${resistance ? ` and owes you ${CIVILIAN_RESISTANCE_ISK} ISK (Civilian Resistance)` : ''}`,
      kind: 'todo',
    });
  }
  if (cmd.central === true) takeCentral(g, f, out);
}

/**
 * Research tokens the board gave the actor (a discovery, a mission, manufacturing): 1 to `MAX_GAINED_RESEARCH`, added to
 * `pendingResearch`, which the existing overlay then places. Actions or upkeep phase, on anyone's turn.
 */
export function gainResearch(g: GameState, cmd: Cmd<'gainResearch'>, ctx: Ctx, out: Out, priv: PlayerPrivate | null): void {
  needPhase(g, 'actions', 'upkeep');
  const f = needActor(g, ctx);
  const pv = needPriv(priv);
  const n = cmd.research;
  if (!Number.isInteger(n) || n < 1 || n > MAX_GAINED_RESEARCH) {
    fail('bad_amount', `Research gained is a whole number from 1 to ${MAX_GAINED_RESEARCH}`);
  }
  pv.pendingResearch += n;
  out.lines.push(`${factionName(f)} gained ${n} research`);
}

/** The rivals a light upkeep says raided successfully: a list of distinct seated players other than the actor, else `bad_target`. */
function readRaided(g: GameState, f: FactionId, raw: unknown): FactionId[] {
  if (!Array.isArray(raw)) fail('bad_target', 'The raid list is missing: pick the rivals whose raids succeeded');
  const seen = new Set<FactionId>();
  for (const item of raw as unknown[]) {
    if (typeof item !== 'string' || !seated(g, item as FactionId)) fail('bad_target', 'Raid a player in this game');
    const target = item as FactionId;
    if (target === f) fail('bad_target', 'You cannot raid yourself');
    if (seen.has(target)) fail('bad_target', `You can raid ${factionName(target)} only once per upkeep`);
    seen.add(target);
  }
  return [...seen];
}

/**
 * A player's upkeep in a light game, once per player: the board did the mining, refining and income, so the player
 * only says what the app tracks. `research` (0 to `MAX_GAINED_RESEARCH`) becomes `pendingResearch`, to place right after;
 * `researchLab` (needs the completed card, `bad_research_lab`) adds a card to add; `raids` are the rivals whose raids
 * succeeded at the table, each recorded as strength 0 and judged a success; `largeShip` (needs the completed Fleet
 * Supremacy, `bad_fleet_supremacy`) puts the actor in `upkeep.largeShips`. The Research Lab's engineering complex and
 * the large ship are the player's word. Everything is validated before anything changes; the confirm that completes
 * the set also finalises the upkeep.
 */
export function lightUpkeep(g: GameState, cmd: Cmd<'lightUpkeep'>, ctx: Ctx, out: Out, priv: PlayerPrivate | null): void {
  needPhase(g, 'upkeep');
  const f = needActor(g, ctx);
  const pv = needPriv(priv);
  const u = needUpkeep(g);
  if (u.confirmed.includes(f)) fail('already_confirmed', 'You already confirmed your upkeep');
  const p = player(g, f);

  // Validate everything first.
  const research = cmd.research;
  if (!Number.isInteger(research) || research < 0 || research > MAX_GAINED_RESEARCH) {
    fail('bad_amount', `Research gained is a whole number from 0 to ${MAX_GAINED_RESEARCH}`);
  }
  const lab = cmd.researchLab === true;
  if (lab && !hasDev(p, DEV.researchLab)) fail('bad_research_lab', 'A Research Lab card needs Upgraded Eng. Complex – Research Lab');
  const raided = readRaided(g, f, cmd.raids);
  const largeShip = cmd.largeShip === true;
  if (largeShip && !hasDev(p, DEV.fleetSupremacy)) fail('bad_fleet_supremacy', 'Fleet Supremacy needs the completed card');

  // Then apply it.
  const parts: string[] = [];
  if (research > 0) parts.push(`${research} research`);
  if (lab) parts.push('a Research Lab card');
  if (raided.length > 0) parts.push(`raided ${andList(raided.map(factionName))}`);
  if (largeShip) parts.push('a large ship on the board');
  out.lines.push(`${factionName(f)} confirmed upkeep: ${parts.length > 0 ? parts.join(', ') : 'nothing to record'}`);

  pv.pendingResearch += research;
  if (lab) pv.pendingCards += 1;
  u.raids.push(...raided.map((target) => ({ raider: f, target, strength: 0 })));
  if (largeShip) u.largeShips.push(f);
  u.confirmed.push(f);
  finalizeIfConfirmed(g, out);
}
