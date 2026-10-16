/**
 * Developments (spec 6.3): researching cards into the private development area, distributing research tokens,
 * completing cards, and using completed ones.
 *
 * The development area lives in the actor's private doc (`PlayerPrivate.area`, at most 4 cards, each with research
 * tokens on it) and stays secret until a card is completed. Only `PlayerPublic.devAreaCount` mirrors its size, and
 * log lines for research, distribution and adding a card say how many cards, never which. A completed card is public.
 *
 * Handlers mutate the cloned game and private doc `apply` hands them and reject with `fail()`; `apply` discards the
 * clones on rejection, so a command is all or nothing (a failed use never taps the card).
 */
import { DEV, dev } from '../data/developments';
import { BASIC_MINERALS, MINERALS, type DevId, type DevTier, type FactionId, type Material, type Mineral } from '../data/types';
import { applyManufactureOp, applyTradeOp } from './economy';
import { beginAction, needPhase, needTurn } from './turns';
import type { AreaCard, Command, Ctx, GameMode, GameState, PlayerPrivate, PlayerPublic, UseParams } from './types';
import {
  addRes, boardISK, checkCount, factionName, fail, gainVP, hasDev, isDevId, isLight, needActor, needPriv, player, seated,
  spend, stealVP, type Out,
} from './util';

type Cmd<T extends Command['type']> = Extract<Command, { type: T }>;
type ResearchCmd = Extract<Command, { type: 'action'; action: 'research' }>;

/** Cards a development area holds. */
export const AREA_SIZE = 4;
/** Research tokens that fetch a card from the deck into the area. */
export const FETCH_COST = 3;
/** Galactic Trust Fund: ISK per use. */
const TRUST_FUND_ISK = 2;
/** Dirty Politics: ISK paid to the victim. */
const DIRTY_POLITICS_ISK = 5;

/** The ship ability tiers unlocked by the player's completed Systems cards (used by combat). */
export function tiersOf(p: PlayerPublic): Set<DevTier> {
  const tiers = new Set<DevTier>();
  for (const id of p.completed) {
    const tier = dev(id).tier;
    if (tier !== null) tiers.add(tier);
  }
  return tiers;
}

// ---------------------------------------------------------------------------------------------------------------
// helpers

const nameOf = (id: DevId): string => dev(id).name;

/** Keeps the public count of area cards in step with the private area. */
function syncArea(p: PlayerPublic, pv: PlayerPrivate): void {
  p.devAreaCount = pv.area.length;
}

/** The own entries of an object-valued command field; anything else counts as empty. */
function entriesOf(x: unknown): [string, unknown][] {
  return typeof x === 'object' && x !== null && !Array.isArray(x) ? Object.entries(x) : [];
}

/**
 * A development a command wants to bring into the area: a known card that is not completed and not in `taken`
 * (the area so far, plus the cards already chosen in this command). Fails `bad_dev`.
 */
function needFresh(p: PlayerPublic, id: unknown, taken: ReadonlySet<DevId>): DevId {
  if (!isDevId(id)) fail('bad_dev', 'That is not a development card');
  if (hasDev(p, id)) fail('bad_dev', `${nameOf(id)} is already completed`);
  if (taken.has(id)) fail('bad_dev', `${nameOf(id)} is already in your development area, or chosen twice`);
  return id;
}

const cards = (n: number): string => `${n} ${n === 1 ? 'card' : 'cards'}`;

// ---------------------------------------------------------------------------------------------------------------
// research

/**
 * The research action: fill empty slots with new cards (0 tokens) and/or swap cards (the swapped-out card's tokens
 * are discarded; the new card takes its place). A card must be a known one, not completed, and not in the area after
 * the swaps. Everything is checked before the cube is taken. In a light game it takes no cube and no turn (see below).
 */
export function researchAction(g: GameState, cmd: ResearchCmd, ctx: Ctx, out: Out, priv: PlayerPrivate | null): void {
  const f = needActor(g, ctx);
  const pv = needPriv(priv);
  const p = player(g, f);
  // A light game isn't an action: any time in the actions or upkeep phase, on anyone's turn, with no cube.
  if (isLight(g)) needPhase(g, 'actions', 'upkeep');
  if (!Array.isArray(cmd.fill) || !Array.isArray(cmd.swap)) fail('bad_dev', 'Choose cards to add and/or swap');
  const fill = cmd.fill as unknown[];
  const swap = cmd.swap as { out: unknown; in: unknown }[];
  if (fill.length === 0 && swap.length === 0) fail('no_change', 'Choose at least one card to add or swap');

  const area: AreaCard[] = pv.area.map((c) => ({ ...c }));
  const swapped: number[] = [];
  for (const s of swap) {
    const i = area.findIndex((c, at) => c.dev === s?.out && !swapped.includes(at));
    if (i < 0) fail('not_in_area', 'You can only swap out a card in your development area');
    swapped.push(i);
  }
  const taken = new Set(area.filter((_, i) => !swapped.includes(i)).map((c) => c.dev));
  swap.forEach((s, k) => {
    const id = needFresh(p, s?.in, taken);
    taken.add(id);
    area[swapped[k]!] = { dev: id, tokens: 0 };
  });
  for (const raw of fill) {
    const id = needFresh(p, raw, taken);
    taken.add(id);
    area.push({ dev: id, tokens: 0 });
  }
  if (area.length > AREA_SIZE) fail('area_full', `Your development area holds at most ${AREA_SIZE} cards`);

  if (!isLight(g)) beginAction(g, f, 'research', out);
  pv.area = area;
  syncArea(p, pv);
  out.lines.push(`${factionName(f)} researched (${cards(fill.length + swap.length)})`);
}

/**
 * Spends the pending research: fetches first (3 tokens each; into an empty slot, or replacing a card whose tokens
 * are discarded), then allocations on area cards (fetched ones included). Leftover tokens are discarded.
 * Technological Breakthrough's second clause is a fetch too: during upkeep, a player who completed it may spend 3 to
 * turn it face down into the area (0 tokens), into an empty slot or replacing a card like any fetch, so it can be
 * completed (and score) again.
 */
export function distributeResearch(g: GameState, cmd: Cmd<'distributeResearch'>, ctx: Ctx, out: Out, priv: PlayerPrivate | null): void {
  const f = needActor(g, ctx);
  const pv = needPriv(priv);
  const p = player(g, f);
  const pending = pv.pendingResearch;
  if (pending < 1) fail('no_pending', 'You have no research to distribute');
  if (!Array.isArray(cmd.fetch)) fail('bad_dev', 'The fetch list is missing');
  const fetch = cmd.fetch as { dev: unknown; replace: unknown }[];
  const alloc = entriesOf(cmd.alloc);

  let tokens = FETCH_COST * fetch.length;
  for (const [, n] of alloc) tokens += checkCount(n as number, 'Research tokens');
  if (tokens > pending) fail('too_many_tokens', `That uses ${tokens} research but you have ${pending}`);

  const area: AreaCard[] = pv.area.map((c) => ({ ...c }));
  let breakthroughBack = false;
  for (const fe of fetch) {
    if (fe?.dev === DEV.technologicalBreakthrough && hasDev(p, DEV.technologicalBreakthrough)) {
      returnBreakthrough(g, area, fe.replace ?? null);
      breakthroughBack = true;
      continue;
    }
    const id = needFresh(p, fe?.dev, new Set(area.map((c) => c.dev)));
    const replace = fe.replace ?? null;
    if (replace === null) {
      if (area.length >= AREA_SIZE) fail('area_full', 'Your development area is full; choose a card to replace');
      area.push({ dev: id, tokens: 0 });
    } else {
      const i = area.findIndex((c) => c.dev === replace);
      if (i < 0) fail('not_in_area', 'You can only replace a card in your development area');
      area[i] = { dev: id, tokens: 0 };
    }
  }
  for (const [id, n] of alloc) {
    const card = area.find((c) => c.dev === id);
    if (!card) fail('bad_dev', 'You can only put research on a card in your development area');
    card.tokens += n as number;
  }

  pv.area = area;
  pv.pendingResearch = 0;
  syncArea(p, pv);
  if (breakthroughBack) {
    p.completed = p.completed.filter((id) => id !== DEV.technologicalBreakthrough);
    p.tapped = p.tapped.filter((id) => id !== DEV.technologicalBreakthrough);
    // Public, as at the table: the card visibly leaves the completed ones.
    out.lines.push(`${factionName(f)} turned ${nameOf(DEV.technologicalBreakthrough)} face down into their development area`);
  }
  out.lines.push(`${factionName(f)} distributed ${pending} research tokens`);
}

/**
 * Technological Breakthrough back into `area` (a working copy) face down: upkeep only, into an empty slot or in place
 * of a card (whose tokens are discarded), as an ordinary fetch.
 */
function returnBreakthrough(g: GameState, area: AreaCard[], replace: unknown): void {
  const name = nameOf(DEV.technologicalBreakthrough);
  if (g.phase !== 'upkeep') fail('wrong_phase', `${name} goes back to your development area during upkeep only`);
  if (area.some((c) => c.dev === DEV.technologicalBreakthrough)) fail('bad_dev', `${name} is chosen twice`);
  const card: AreaCard = { dev: DEV.technologicalBreakthrough, tokens: 0 };
  if (replace === null) {
    if (area.length >= AREA_SIZE) fail('area_full', `Your development area is full: choose a card for ${name} to replace`);
    area.push(card);
    return;
  }
  const i = area.findIndex((c) => c.dev === replace);
  if (i < 0) fail('not_in_area', 'You can only replace a card in your development area');
  area[i] = card;
}

/** Takes a card owed by a completed development into an empty slot, or skips it with `dev: null`. */
export function addCard(g: GameState, cmd: Cmd<'addCard'>, ctx: Ctx, out: Out, priv: PlayerPrivate | null): void {
  const f = needActor(g, ctx);
  const pv = needPriv(priv);
  const p = player(g, f);
  if (pv.pendingCards < 1) fail('no_pending_card', 'You have no development card to add');
  if (cmd.dev === null) {
    pv.pendingCards -= 1;
    out.lines.push(`${factionName(f)} skipped a new development card`);
    return;
  }
  if (pv.area.length >= AREA_SIZE) fail('area_full', 'Your development area is full');
  const id = needFresh(p, cmd.dev, new Set(pv.area.map((c) => c.dev)));
  pv.area.push({ dev: id, tokens: 0 });
  pv.pendingCards -= 1;
  syncArea(p, pv);
  out.lines.push(`${factionName(f)} added a development card`);
}

// ---------------------------------------------------------------------------------------------------------------
// completing

/** Makes `id` completed for `f` and runs its triggers: Technological Breakthrough +1 VP; a card symbol owes a new card. */
function grantDev(g: GameState, f: FactionId, pv: PlayerPrivate, id: DevId, out: Out): void {
  player(g, f).completed.push(id);
  if (id === DEV.technologicalBreakthrough) gainVP(g, f, 1, out);
  if (dev(id).addsCard) {
    pv.pendingCards += 1;
    // The Panel's blocking Add card overlay walks the player through it.
    out.notices.push({ to: f, text: 'Choose a new development card for your development area', kind: 'info' });
  }
}

/** Completes a card from the area: it needs tokens >= its cost and its prerequisite completed. Costs no action. */
export function completeDev(g: GameState, cmd: Cmd<'completeDev'>, ctx: Ctx, out: Out, priv: PlayerPrivate | null): void {
  const f = needActor(g, ctx);
  const pv = needPriv(priv);
  needPhase(g, 'actions');
  needTurn(g, f);
  const p = player(g, f);
  const i = pv.area.findIndex((c) => c.dev === cmd.dev);
  if (i < 0) fail('not_in_area', 'That card is not in your development area');
  const card = pv.area[i]!;
  const d = dev(card.dev);
  if (card.tokens < d.cost) fail('not_enough_research', `${d.name} needs ${d.cost} research (it has ${card.tokens})`);
  if (d.prerequisite !== null && !hasDev(p, d.prerequisite)) {
    fail('prereq_missing', `${d.name} needs ${nameOf(d.prerequisite)} completed first`);
  }
  pv.area.splice(i, 1);
  syncArea(p, pv);
  out.lines.push(`${factionName(f)} completed ${d.name}`);
  grantDev(g, f, pv, d.id, out);
}

// ---------------------------------------------------------------------------------------------------------------
// using

/** What a use needs: the user, their private doc, the validated-by-the-handler params and the log. */
interface Use {
  g: GameState;
  f: FactionId;
  p: PlayerPublic;
  pv: PlayerPrivate;
  params: unknown;
  out: Out;
}

/** The params of a use, which must be of `kind`; else `bad_params`. */
function paramsOf<K extends UseParams['kind']>(params: unknown, kind: K): Extract<UseParams, { kind: K }> {
  if (typeof params !== 'object' || params === null || (params as { kind?: unknown }).kind !== kind) {
    fail('bad_params', `This development takes "${kind}" parameters`);
  }
  return params as Extract<UseParams, { kind: K }>;
}

function basicMineral(x: unknown): (typeof BASIC_MINERALS)[number] {
  if (typeof x !== 'string' || !(BASIC_MINERALS as string[]).includes(x)) fail('bad_params', 'Choose pyrite, mexallon or tritanium');
  return x as (typeof BASIC_MINERALS)[number];
}

type UseKind = UseParams['kind'];
type ParamsOf<K extends UseKind> = Extract<UseParams, { kind: K }>;

/** How a usable card is used: the kind of params it takes, and its effect (returns the detail for the log line). */
interface UseRule {
  kind: UseKind;
  run: (u: Use) => string;
}

/** A use rule whose effect gets its params already checked to be of `kind`. */
function use<K extends UseKind>(kind: K, run: (u: Use, params: ParamsOf<K>) => string): UseRule {
  return { kind, run: (u) => run(u, paramsOf(u.params, kind)) };
}

/**
 * Tap, paying 1 planetary or moon. Defensive/Offensive Tactic and Strategic Reposition take it as an option for the
 * stronger effect; Guerilla Warfare's whole Use is spending it (`required`).
 */
const useWithPayment = (required: boolean): UseRule =>
  use('payMaterial', (u, { material }) => {
    if (material === null && !required) return '';
    if (material !== 'planetary' && material !== 'moon') {
      fail('bad_params', required ? 'Pay 1 planetary or moon material' : 'Pay with a planetary or moon material, or nothing');
    }
    spend(u.p, { [material as Material]: 1 });
    return `paid 1 ${material}`;
  });

/** A use that only reminds the player of a physical-world step. */
function useWithReminder(text: string): UseRule {
  return use('none', (u) => {
    u.out.notices.push({ to: u.f, text, kind: 'todo' });
    return '';
  });
}

/** Dirty Politics' target: another seated player with VP to steal. */
function dirtyPoliticsVictim(u: Use, faction: FactionId): PlayerPublic {
  const victim = seated(u.g, faction);
  if (!victim) fail('bad_target', 'Choose a player in this game');
  if (victim.faction === u.f) fail('bad_target', 'Choose another player');
  if (victim.vp < 1) fail('no_vp', `${factionName(victim.faction)} has no VP to steal`);
  return victim;
}

/** Each usable development: its params and its effect ("Amarr used X: <detail>"). */
const USES: Record<DevId, UseRule> = {
  [DEV.galacticTrustFund]: use('none', (u) => {
    addRes(u.p, 'isk', TRUST_FUND_ISK, u.out);
    return `+${TRUST_FUND_ISK} ISK`;
  }),

  [DEV.underdog]: use('none', (u) => {
    const others = u.g.seats.filter((s) => s !== u.f).map((s) => player(u.g, s));
    if (others.length === 0 || !others.every((q) => u.p.vp < q.vp)) {
      fail('not_underdog', 'You need strictly fewer VP than every other player');
    }
    gainVP(u.g, u.f, 1, u.out);
    return '';
  }),

  [DEV.pacifist]: use('none', (u) => {
    if (!u.g.retreatsThisRound.some((f) => f !== u.f)) {
      fail('no_retreat', 'Pacifist needs another player to have retreated from a combat this round');
    }
    gainVP(u.g, u.f, 1, u.out);
    return '';
  }),

  [DEV.mineralMarket]: use('mineralMarket', (u, { from, to }) => {
    const a = basicMineral(from);
    const b = basicMineral(to);
    if (a === b) fail('bad_params', 'Choose two different minerals');
    addRes(u.p, a, -1, u.out);
    addRes(u.p, b, 1, u.out);
    return `1 ${a} to ${b}`;
  }),

  [DEV.tradeContracts]: use('trade', (u, { op }) => {
    applyTradeOp(u.g, u.p, op, u.out);
    return '';
  }),

  [DEV.manufacturingHub]: use('manufacture', (u, { op }) => {
    applyManufactureOp(u.g, u.p, op, u.out, u.pv);
    return '';
  }),

  [DEV.asteroidMining]: use('mineral', (u, { mineral }) => {
    if (typeof mineral !== 'string' || !(MINERALS as string[]).includes(mineral)) fail('bad_params', 'Choose a mineral');
    const m = mineral as Mineral;
    if (u.p.belts[m] < 1) fail('no_belt', `You have no ${m} asteroid belt`);
    // Past 12 the gain still happens (manual p.10): the Panel's blocking overlay has the player discard down to 12.
    addRes(u.p, m, 1, u.out);
    return `1 ${m}`;
  }),

  [DEV.extractingCrew]: use('material', (u, { material }) => {
    if (material !== 'planetary' && material !== 'moon') fail('bad_params', 'Choose planetary or moon materials');
    addRes(u.p, material, 1, u.out);
    return `1 ${material}`;
  }),

  [DEV.dirtyPolitics]: use('target', (u, { faction }) => {
    const victim = dirtyPoliticsVictim(u, faction);
    addRes(u.p, 'isk', -DIRTY_POLITICS_ISK, u.out);
    addRes(victim, 'isk', DIRTY_POLITICS_ISK, u.out);
    stealVP(u.g, victim.faction, u.f, u.out);
    return `paid ${factionName(victim.faction)} ${DIRTY_POLITICS_ISK} ISK`;
  }),

  [DEV.researchSpy]: use('dev', (u, { dev: wanted }) => {
    if (!isDevId(wanted)) fail('bad_dev', 'That is not a development card');
    const name = nameOf(wanted);
    if (hasDev(u.p, wanted)) fail('bad_dev', `You have already completed ${name}`);
    if (u.pv.area.some((c) => c.dev === wanted)) fail('bad_dev', `${name} is in your development area`);
    const held = u.g.seats.some((s) => s !== u.f && seated(u.g, s)?.completed.includes(wanted));
    if (!held) fail('bad_dev', `No other player has completed ${name}`);
    const prerequisite = dev(wanted).prerequisite;
    if (prerequisite !== null && !hasDev(u.p, prerequisite)) {
      fail('prereq_missing', `${name} needs ${nameOf(prerequisite)} completed first`);
    }
    u.p.completed = u.p.completed.filter((id) => id !== DEV.researchSpy);
    u.p.tapped = u.p.tapped.filter((id) => id !== DEV.researchSpy);
    grantDev(u.g, u.f, u.pv, wanted, u.out);
    return `completed ${name} (${nameOf(DEV.researchSpy)} discarded)`;
  }),

  [DEV.defensiveTactic]: useWithPayment(false),
  [DEV.offensiveTactic]: useWithPayment(false),
  [DEV.guerillaWarfare]: useWithPayment(true),
  [DEV.strategicReposition]: useWithPayment(false),

  [DEV.starMap]: useWithReminder(
    'Star Map: if you have no Mission cards, draw 1 Mission card; otherwise discard 1 Mission card, then draw 1 Mission card',
  ),
  [DEV.sequentialJump]: useWithReminder('Sequential Jump: remove one exhausted fleet token from a system with your fleet'),
};

/**
 * The cards a light game uses differently (spec 4.4): the board keeps the resources, so each of these only reminds the
 * player of the step (`useWithReminder`) or of the ISK payment (`boardISK`). Underdog, Pacifist, Research Spy, Star Map
 * and Sequential Jump are not here: they work as in a full game.
 */
const LIGHT_USES: Partial<Record<DevId, UseRule>> = {
  [DEV.galacticTrustFund]: use('none', (u) => {
    boardISK(u.g, u.f, TRUST_FUND_ISK, nameOf(DEV.galacticTrustFund), u.out);
    return '';
  }),

  // The payer's to-do names the victim; the victim is told too (as Civilian Resistance tells its holder).
  [DEV.dirtyPolitics]: use('target', (u, { faction }) => {
    const victim = dirtyPoliticsVictim(u, faction);
    boardISK(u.g, u.f, -DIRTY_POLITICS_ISK, nameOf(DEV.dirtyPolitics), u.out, victim.faction);
    u.out.notices.push({
      to: victim.faction,
      text: `${factionName(u.f)} owes you ${DIRTY_POLITICS_ISK} ISK (${nameOf(DEV.dirtyPolitics)})`,
      kind: 'todo',
    });
    stealVP(u.g, victim.faction, u.f, u.out);
    return '';
  }),

  [DEV.mineralMarket]: useWithReminder('Mineral Market: change 1 basic mineral into another'),
  [DEV.tradeContracts]: useWithReminder('Trade Contracts: make 1 trade at the market'),
  [DEV.manufacturingHub]: useWithReminder(
    'Manufacturing Hub: make 1 manufacturing operation (record research, VP or a card on the Panel)',
  ),
  [DEV.asteroidMining]: useWithReminder('Asteroid Mining: take 1 mineral from a belt in a system you control'),
  [DEV.extractingCrew]: useWithReminder('Extracting Crew: take 1 planetary or moon material from a system you control'),
  [DEV.defensiveTactic]: useWithReminder(
    'Defensive Tactic: cancel 1 damage result (pay 1 planetary or moon to cancel 1 more damage or crit)',
  ),
  [DEV.offensiveTactic]: useWithReminder('Offensive Tactic: reroll 1 die (pay 1 planetary or moon to reroll any number)'),
  [DEV.guerillaWarfare]: useWithReminder('Guerilla Warfare: pay 1 planetary or moon for +1 strength in the system being claimed'),
  [DEV.strategicReposition]: useWithReminder(
    'Strategic Reposition: move 1 small ship to an adjacent system (pay 1 planetary or moon to move a medium ship)',
  ),
};

/** The rule that uses `id` in a game of this mode (a light game's own rule first), if the card has one. */
function useRule(id: DevId, mode: GameMode): UseRule | undefined {
  if (mode === 'light' && Object.hasOwn(LIGHT_USES, id)) return LIGHT_USES[id];
  return Object.hasOwn(USES, id) ? USES[id] : undefined;
}

/**
 * The kind of params `useDev` takes for a usable card in a game of this `mode` (the UI's use form follows it); null
 * for a card without a Use. In a light game every usable card takes none, except Research Spy (a card) and Dirty
 * Politics (a target).
 */
export function useParamsKind(id: DevId, mode: GameMode = 'full'): UseKind | null {
  return dev(id).keyword === null ? null : (useRule(id, mode)?.kind ?? null);
}

/** Cards used in combat only (their printed trigger is "Use in combat"). */
const COMBAT_USES: ReadonlySet<DevId> = new Set([DEV.defensiveTactic, DEV.offensiveTactic]);

/** Whether `f` is the attacker or defender of the open combat. */
function inCombat(g: GameState, f: FactionId): boolean {
  return g.combat !== null && (g.combat.attacker === f || g.combat.defender === f);
}

/**
 * Why `f` can't use `id` now, else null (the UI's Use button asks too). A Use is for your own turn or for combat
 * (manual p.21) unless the card names another trigger:
 * - Defensive and Offensive Tactic: "Use in combat", so an open combat `f` fights in, on any turn.
 * - Pacifist: "after another player retreats from combat"; the retreat itself is checked by the card (`no_retreat`),
 *   so it works in the actions and upkeep phases on anyone's turn, until the next round begins.
 * - Guerilla Warfare: "when another player attempts to claim a system you control", so during another player's turn.
 * - Every other Use: in the actions phase on your own turn, or in a combat you fight in. Not in upkeep, which is no one's turn.
 */
export function useTimingProblem(g: GameState, f: FactionId, id: DevId): string | null {
  const name = nameOf(id);
  if (id === DEV.pacifist) {
    return g.phase === 'actions' || g.phase === 'upkeep' ? null : `That is not possible during the ${g.phase} phase`;
  }
  if (g.phase !== 'actions') return `${name} is used during the action phase, not the ${g.phase} phase`;
  if (COMBAT_USES.has(id)) return inCombat(g, f) ? null : `${name} is used in combat, in a combat you are fighting`;
  if (id === DEV.guerillaWarfare) {
    return g.turn !== null && g.turn.faction !== f ? null : `${name} is used when another player attempts to claim a system you control`;
  }
  if ((g.turn !== null && g.turn.faction === f) || inCombat(g, f)) return null;
  return `${name} is used on your own turn or in combat${g.turn === null ? '' : ` (it is ${factionName(g.turn.faction)}'s turn)`}`;
}

/**
 * Uses a completed, untapped development (no action cube; the timing is `useTimingProblem`). The card taps on success; the
 * effects and their params are per card (`USES`, or `LIGHT_USES` first in a light game). Research Spy discards itself,
 * so it ends up neither completed nor tapped.
 */
export function useDev(g: GameState, cmd: Cmd<'useDev'>, ctx: Ctx, out: Out, priv: PlayerPrivate | null): void {
  const f = needActor(g, ctx);
  const pv = needPriv(priv);
  needPhase(g, 'actions', 'upkeep');
  const p = player(g, f);
  const id = cmd.dev;
  if (!isDevId(id) || !hasDev(p, id)) fail('not_completed', 'You have not completed that development');
  const d = dev(id);
  if (p.tapped.includes(id)) fail('tapped', `${d.name} is already used this round`);
  const rule = d.keyword === null ? undefined : useRule(id, g.mode);
  if (!rule) fail('not_usable', `${d.name} cannot be used`);
  const late = useTimingProblem(g, f, id);
  if (late !== null) fail(g.phase === 'actions' ? 'not_now' : 'wrong_phase', late);

  p.tapped.push(id);
  const at = out.lines.length;
  const detail = rule.run({ g, f, p, pv, params: cmd.params, out });
  out.lines.splice(at, 0, `${factionName(f)} used ${d.name}${detail === '' ? '' : `: ${detail}`}`);
}
