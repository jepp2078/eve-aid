import { combatContinue, combatOverflow, combatRoll, combatTarget } from './combat/attack';
import { combatCancel, combatFinish } from './combat/end';
import { combatAddShips, combatDamage, combatDestroy, combatRealign, combatRetreat } from './combat/flow';
import { combatAssign, combatStart, combatStartChoices } from './combat/setup';
import { addCard, completeDev, distributeResearch, researchAction, useDev } from './developments';
import { buildAction, manufactureAction, tradeAction } from './economy';
import { gainResearch, lightClaim, lightUpkeep } from './light';
import { join, setSeats, setupFaction, startGame, takeOver } from './lobby';
import {
  adjust, autoClaim, claimAction, deployableInfrastructure, discardMinerals, discover, endTurn, eventPlayed, extractAction,
  forceAdvance, missionComplete, moveAction, pass, payJump,
} from './turns';
import type { ApplyResult, Command, Ctx, GameMode, GameState, PlayerPrivate, RuleError } from './types';
import { confirmUpkeep } from './upkeep';
import { clone, err, isLight, needActor, needPriv, RuleFail, type Out } from './util';

type ActionCommand = Extract<Command, { type: 'action' }>;

/** Commands route by `type`, except `action` commands, which route by `action:<kind>` (e.g. `action:trade`). */
export type RouteKey = Exclude<Command['type'], 'action'> | `action:${ActionCommand['action']}`;
export type CommandFor<K extends RouteKey> = K extends `action:${infer A}`
  ? Extract<ActionCommand, { action: A }>
  : Extract<Command, { type: K }>;

/**
 * A command handler. `g` and `priv` are clones it may mutate; reject with `fail()`.
 * Return a PlayerPrivate to replace the private doc, `null` for none, or nothing to keep `priv` (as mutated).
 */
export type Handler<C extends Command = Command> = (
  g: GameState,
  cmd: C,
  ctx: Ctx,
  out: Out,
  priv: PlayerPrivate | null,
) => PlayerPrivate | null | void;

/** `none`: any device; `actor`: a seated actor (`not_seated`); `priv`: actor + its private doc (`no_private`). */
export type Needs = 'none' | 'actor' | 'priv';

interface Route<K extends RouteKey> {
  needs: Needs;
  /** The game modes this command serves; absent means both. Outside them it answers `wrong_mode` before anything else. */
  modes?: readonly GameMode[];
  run: Handler<CommandFor<K>>;
}

/** Add a command by adding one line here. Unrouted commands answer `not_implemented`. */
const ROUTES: { [K in RouteKey]?: Route<K> } = {
  join: { needs: 'none', run: join },
  takeOver: { needs: 'none', run: takeOver },
  setSeats: { needs: 'actor', run: setSeats },
  startGame: { needs: 'actor', run: startGame },
  setupFaction: { needs: 'priv', run: setupFaction },
  'action:move': { needs: 'actor', modes: ['full'], run: moveAction },
  'action:claim': { needs: 'actor', modes: ['full'], run: claimAction },
  'action:extract': { needs: 'actor', modes: ['full'], run: extractAction },
  lightClaim: { needs: 'actor', modes: ['light'], run: lightClaim },
  gainResearch: { needs: 'priv', modes: ['light'], run: gainResearch },
  endTurn: { needs: 'actor', run: endTurn },
  pass: { needs: 'actor', run: pass },
  forceAdvance: { needs: 'actor', run: forceAdvance },
  discover: { needs: 'priv', modes: ['full'], run: discover },
  autoClaim: { needs: 'actor', modes: ['full'], run: autoClaim },
  payJump: { needs: 'actor', modes: ['full'], run: payJump },
  adjust: { needs: 'actor', run: adjust },
  missionComplete: { needs: 'actor', run: missionComplete },
  eventPlayed: { needs: 'actor', run: eventPlayed },
  discardMinerals: { needs: 'actor', modes: ['full'], run: discardMinerals },
  'action:trade': { needs: 'actor', modes: ['full'], run: tradeAction },
  'action:manufacture': { needs: 'priv', modes: ['full'], run: manufactureAction },
  'action:build': { needs: 'actor', modes: ['full'], run: buildAction },
  deployableInfrastructure: { needs: 'actor', modes: ['full'], run: deployableInfrastructure },
  'action:research': { needs: 'priv', run: researchAction },
  distributeResearch: { needs: 'priv', run: distributeResearch },
  addCard: { needs: 'priv', run: addCard },
  completeDev: { needs: 'priv', run: completeDev },
  useDev: { needs: 'priv', run: useDev },
  confirmUpkeep: { needs: 'priv', modes: ['full'], run: confirmUpkeep },
  lightUpkeep: { needs: 'priv', modes: ['light'], run: lightUpkeep },
  combatStart: { needs: 'actor', run: combatStart },
  combatAssign: { needs: 'actor', run: combatAssign },
  combatStartChoices: { needs: 'actor', run: combatStartChoices },
  combatRetreat: { needs: 'actor', run: combatRetreat },
  combatTarget: { needs: 'actor', run: combatTarget },
  combatRoll: { needs: 'actor', run: combatRoll },
  combatOverflow: { needs: 'actor', run: combatOverflow },
  combatContinue: { needs: 'actor', run: combatContinue },
  combatRealign: { needs: 'actor', run: combatRealign },
  combatDamage: { needs: 'actor', run: combatDamage },
  combatDestroy: { needs: 'actor', run: combatDestroy },
  combatAddShips: { needs: 'actor', run: combatAddShips },
  combatFinish: { needs: 'actor', run: combatFinish },
  combatCancel: { needs: 'actor', run: combatCancel },
};

export function routeKey(cmd: Command): RouteKey {
  return cmd.type === 'action' ? `action:${cmd.action}` : cmd.type;
}

/**
 * Applies one command. Pure: inputs are cloned, never mutated. `priv` is the actor's private doc
 * (for `join`, the joined faction's new one); `privOwner` names whose it is, and both are null together.
 */
export function apply(game: GameState, cmd: Command, ctx: Ctx): ApplyResult | RuleError {
  const key = routeKey(cmd);
  const route = Object.hasOwn(ROUTES, key) ? (ROUTES[key] as Route<RouteKey>) : undefined;
  if (!route) return err('not_implemented', `"${key}" is not supported`);
  if (route.modes && !route.modes.includes(game.mode)) {
    return err('wrong_mode', isLight(game) ? 'Not used in a scorekeeper game' : 'Not used in a full game');
  }

  const g = clone(game);
  const c = clone(cmd);
  const priv = ctx.priv === null ? null : clone(ctx.priv);
  const out: Out = { lines: [], notices: [] };
  try {
    if (route.needs !== 'none') needActor(g, ctx);
    if (route.needs === 'priv') needPriv(priv);
    const returned = route.run(g, c, { ...ctx, priv }, out, priv);
    const nextPriv = returned === undefined ? priv : returned;
    const owner = c.type === 'join' ? c.faction : ctx.actor;
    const withPriv = owner !== null && nextPriv !== null;
    return {
      game: g,
      priv: withPriv ? nextPriv : null,
      privOwner: withPriv ? owner : null,
      lines: out.lines,
      notices: out.notices,
    };
  } catch (e) {
    if (e instanceof RuleFail) return e.e;
    throw e;
  }
}
