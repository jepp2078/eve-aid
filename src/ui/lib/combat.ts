/**
 * Combat status and the setup drafts:
 *   - what this device has to do in the combat now (`combatTask`), and the persistent banner for the two players
 *     involved ("Minmatar attacks you · Assign your fleet");
 *   - the Start combat sheet: defender, whose home system, who controls it (defaults to the home owner) and how many
 *     citadels (defaults to the home owner's home citadels), turned into `combatStart`;
 *   - the start-of-combat choices: citadel orbit, Vanguard Ship orbit, evasive explorers and a Curse, each offered
 *     only when it applies (judged like the engine does), turned into `combatStartChoices`.
 */
import { STRUCTURE_SUPPLY } from '../../data/costs';
import { DEV } from '../../data/developments';
import { ship as shipData, type ShipAbility } from '../../data/ships';
import { FACTIONS, ORBITS, type AbilitySlot, type FactionId, type Orbit, type ShipId } from '../../data/types';
import { activeEffects, dicePool, effDif, effStats, opponent, shipsOf } from '../../engine/combat/abilities';
import { needsRealign } from '../../engine/combat/flow';
import { hasShips, isOrbit, knownShip, nameList, sideOf } from '../../engine/combat/setup';
import type { Command, CombatShip, CombatState, GameState, Side } from '../../engine/types';
import { hasDev } from '../../engine/util';
import { isRecord } from './drafts';
import { factionName } from './labels';
import { seatedFactions } from './table';

/* ------------------------------------------------------------------ status */

export type CombatTask =
  /** Not part of this combat (or no seat): watch only. */
  | 'spectate'
  /** Place my fleet now. */
  | 'assign'
  /** Defender: the attacker places first. */
  | 'waitAttacker'
  /** My fleet is placed; the enemy's isn't yet. */
  | 'waitAssign'
  /** Defender: the attacker makes their start-of-combat choices first (manual p.28). */
  | 'waitAttackerChoices'
  /** Make my start-of-combat choices. */
  | 'choices'
  /** My choices are in; the enemy's aren't yet. */
  | 'waitChoices'
  /** Decide whether to retreat (I'm the side being asked). */
  | 'retreat'
  /** The enemy decides whether to retreat. */
  | 'waitRetreat'
  /** My attack: choose a target and enter the roll. */
  | 'attack'
  /** My attack destroyed its target: choose where the remaining aims and damage go, or stop. */
  | 'overflow'
  /** The enemy attacks. */
  | 'waitAttack'
  /** Re-align my ships that lost their leader. */
  | 'realign'
  /** The enemy re-aligns (the attacker first), or only the enemy has to. */
  | 'waitRealign'
  /** The combat is over: see the result; either side finishes it. */
  | 'finish';

/** The side `faction` fights on, or null (no seat, or not in this combat). */
export function combatSide(c: CombatState, faction: FactionId | null): Side | null {
  return faction === null ? null : sideOf(c, faction);
}

export function combatTask(c: CombatState, faction: FactionId | null): CombatTask {
  const side = combatSide(c, faction);
  if (side === null) return 'spectate';
  const me = c.sides[side];
  if (c.stage === 'assign') {
    if (me.assigned) return 'waitAssign';
    return side === 'defender' && !c.sides.attacker.assigned ? 'waitAttacker' : 'assign';
  }
  if (c.stage === 'start') {
    if (me.ready) return 'waitChoices';
    return side === 'defender' && !c.sides.attacker.ready ? 'waitAttackerChoices' : 'choices';
  }
  if (c.stage === 'retreat') return retreatAskedSide(c) === side ? 'retreat' : 'waitRetreat';
  if (c.stage === 'attack') {
    if (c.step?.side !== side) return 'waitAttack';
    return c.attack?.overflow != null ? 'overflow' : 'attack';
  }
  if (c.stage === 'realign') return realignTurn(c) === side ? 'realign' : 'waitRealign';
  return 'finish';
}

/** The side whose retreat decision the combat waits for: the attacker first, then the defender. */
export function retreatAskedSide(c: CombatState): Side {
  return c.retreatAsked.includes('attacker') ? 'defender' : 'attacker';
}

/** The side that re-aligns now (the attacker first), or null when nobody has to. */
export function realignTurn(c: CombatState): Side | null {
  if (needsRealign(c, 'attacker').length > 0) return 'attacker';
  return needsRealign(c, 'defender').length > 0 ? 'defender' : null;
}

export interface CombatBannerInfo {
  side: Side;
  enemy: FactionId;
  /** "Minmatar attacks you" / "You attack Caldari" */
  title: string;
  /** What happens now ("Assign your fleet"). */
  detail: string;
  /** The combat waits for this device. */
  urgent: boolean;
}

/** The banner the two involved players see outside the Combat tab; null for everyone else or without a combat. */
export function combatBanner(game: GameState, faction: FactionId | null): CombatBannerInfo | null {
  const c = game.combat;
  if (c === null) return null;
  const side = combatSide(c, faction);
  if (side === null) return null;
  const enemy = c.sides[opponent(side)].faction;
  const them = factionName(enemy);
  const title = side === 'attacker' ? `You attack ${them}` : `${them} attacks you`;
  const task = combatTask(c, faction);
  const round = `Round ${c.round} · `;
  const orbit = c.step?.orbit ?? 'small';
  const detail: Record<CombatTask, string> = {
    spectate: '',
    assign: 'Assign your fleet',
    waitAttacker: `${them} is placing their fleet · choose a strategy card face down`,
    waitAssign: `Waiting for ${them} to place their fleet`,
    waitAttackerChoices: `${them} makes their start choices first`,
    choices: 'Reveal strategy cards · make your start choices',
    waitChoices: `Waiting for ${them}'s start choices`,
    retreat: `${round}Decide whether to retreat`,
    waitRetreat: `${round}Waiting for ${them} to decide on retreat`,
    attack: `${round}Your ${orbit}-orbit attack`,
    overflow: `${round}Choose where the remaining damage goes`,
    waitAttack: `${round}${them}'s ${orbit}-orbit attack`,
    realign: `${round}Re-align your orbits`,
    waitRealign: `${round}Waiting for ${them} to re-align`,
    finish: 'Combat over · see the result and finish',
  };
  return { side, enemy, title, detail: detail[task], urgent: URGENT.has(task) };
}

/** Tasks where the combat waits for this device (the banner turns warn-coloured, the tab badge says so). */
const URGENT = new Set<CombatTask>(['assign', 'choices', 'retreat', 'attack', 'overflow', 'realign', 'finish']);

/** The draft names of the combat stages (fleet assignment, start choices, dice pads, re-aligns, dismissed loss prompts). */
export const STAGE_DRAFTS = ['combat-assign:', 'combat-choices:', 'combat-roll:', 'combat-realign:', 'combat-loss:'];

/**
 * Which combat drafts are stale now (draft-name prefixes to forget). While a fight is on, none: a dice pad stays after
 * its roll, so an Undo of the attack brings the taps back. While a combat is being set up (assign, start), the dice
 * pads, which can only be an earlier combat's (pad names repeat between combats of the same pair). With no combat,
 * every stage draft.
 */
export function staleCombatDrafts(game: GameState): string[] {
  const c = game.combat;
  if (c === null) return [...STAGE_DRAFTS];
  return c.stage === 'assign' || c.stage === 'start' ? ['combat-roll:'] : [];
}

/**
 * Names this combat for its drafts ("amarr-caldari-1x9k2"): the two factions and a hash of the placed ships (uid,
 * ship, side, orbit, role — not damage or evasive, which change under an open draft). Ship uids restart at s1 in
 * every combat, so without it a cancelled combat's draft could pre-select ships of the next one.
 */
export function combatKey(c: CombatState, exceptSide: Side | null = null): string {
  const text = c.ships
    .filter((s) => s.side !== exceptSide)
    .map((s) => `${s.uid}:${s.ship}:${s.side}:${s.orbit}:${s.role}`)
    .join(',');
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) >>> 0;
  return `${c.attacker}-${c.defender}-${h.toString(36)}`;
}

/**
 * The fleet-assignment draft of `side`, named by the enemy's fleet only: it stays the same through my own Confirm
 * and an Undo of it, so the Undo brings my placements back.
 */
export function assignDraftName(c: CombatState, side: Side): string {
  return `combat-assign:${combatKey(c, side)}`;
}

/** The start-choices draft (the fleets don't change during the start stage, nor through a Ready and its Undo). */
export function choicesDraftName(c: CombatState): string {
  return `combat-choices:${combatKey(c)}`;
}

/* ------------------------------------------------------------------ start combat */

export interface StartDraft {
  defender: FactionId | null;
  /** Whose home system the battle is in (null: nobody's). */
  homeOf: FactionId | null;
  /** Who controls the system: 'home' follows the home owner (none when it is nobody's home). */
  controller: FactionId | null | 'home';
  /** Citadels in the system; null: automatic (the home owner's home citadels when they control it, else 0). */
  citadels: number | null;
}

export const EMPTY_START: StartDraft = { defender: null, homeOf: null, controller: 'home', citadels: null };

export interface StartPlan {
  /** Everyone I may attack, in seat order: seated rivals with ships on the board (every seated rival in a light game). */
  rivals: FactionId[];
  /** Seated rivals left out because they have no ships on the board (the engine refuses them: `no_ships`); none in a light game. */
  shipless: FactionId[];
  defender: FactionId | null;
  homeOf: FactionId | null;
  controller: FactionId | null;
  citadels: number;
  /** `citadels` was filled in automatically. */
  citadelsAuto: boolean;
  /**
   * The stepper's limit: the controller's citadels on the board (never below the current value); in a light game,
   * which keeps no structures, every citadel there is.
   */
  citadelMax: number;
}

/**
 * The draft resolved against the game: an unseated choice falls back, the only rival is preselected. A light game
 * keeps no fleets or structures: every seated rival may be attacked (the engine asks for no ships)
 * and the citadels are counted on the board.
 */
export function startPlan(game: GameState, me: FactionId, d: StartDraft): StartPlan {
  const light = game.mode === 'light';
  const seated = seatedFactions(game);
  const others = seated.filter((f) => f !== me);
  const armed = (f: FactionId): boolean => {
    const p = game.players[f];
    return p !== undefined && (light || hasShips(p));
  };
  const rivals = others.filter(armed);
  const shipless = others.filter((f) => !armed(f));
  const defender = d.defender !== null && rivals.includes(d.defender) ? d.defender : rivals.length === 1 ? (rivals[0] as FactionId) : null;
  const homeOf = d.homeOf !== null && seated.includes(d.homeOf) ? d.homeOf : null;
  // Like the engine: no controller in someone's home system means the home owner.
  const picked = d.controller;
  const follows = picked === 'home' || (picked === null && homeOf !== null);
  const controller = follows ? homeOf : picked !== null && seated.includes(picked) ? picked : null;
  const owner = controller === null ? null : (game.players[controller] ?? null);
  const auto = owner !== null && controller === homeOf ? owner.homeCitadels : 0;
  const citadels = owner === null ? 0 : (d.citadels ?? auto);
  return {
    rivals,
    shipless,
    defender,
    homeOf,
    controller,
    citadels,
    citadelsAuto: d.citadels === null,
    citadelMax: owner === null ? 0 : Math.max(citadels, light ? STRUCTURE_SUPPLY : owner.structures.citadel),
  };
}

/** Why some rivals can't be attacked: "Gallente has no ships on the board to fight with."; null for none. */
export function shiplessText(shipless: readonly FactionId[]): string | null {
  if (shipless.length === 0) return null;
  const names = shipless.map(factionName);
  const who = names.length === 1 ? `${names[0]} has` : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]} have`;
  return `${who} no ships on the board to fight with.`;
}

/** A home-system pick: the controller follows the (new) home owner again, and the citadel count is automatic again. */
export function pickHome(d: StartDraft, homeOf: FactionId | null): StartDraft {
  return { ...d, homeOf, controller: 'home', citadels: null };
}

/** A controller pick: the home owner means "follow the home owner"; the citadel count is automatic again. */
export function pickController(d: StartDraft, controller: FactionId | null): StartDraft {
  return { ...d, controller: controller !== null && controller === d.homeOf ? 'home' : controller, citadels: null };
}

/** `combatStart` for the plan; null until a defender is chosen. */
export function startCommand(plan: StartPlan): Command | null {
  if (plan.defender === null) return null;
  return { type: 'combatStart', defender: plan.defender, homeOf: plan.homeOf, controller: plan.controller, citadels: plan.citadels };
}

/** "In Caldari's home system, controlled by Gallente with 1 citadel" (for a plan, or a combat in progress). */
export function whereText(plan: Pick<StartPlan, 'homeOf' | 'controller' | 'citadels'>): string {
  const citadels = plan.citadels > 0 ? ` with ${plan.citadels} ${plan.citadels === 1 ? 'citadel' : 'citadels'}` : '';
  const by = plan.controller === null ? '' : `controlled by ${factionName(plan.controller)}${citadels}`;
  if (plan.homeOf !== null) return `In ${factionName(plan.homeOf)}'s home system${by === '' ? '' : `, ${by}`}`;
  return by === '' ? 'In a system nobody controls' : `In a system ${by}`;
}

const isFaction = (x: unknown): x is FactionId => FACTIONS.includes(x as FactionId);

export function sanitizeStart(raw: unknown): StartDraft | null {
  if (!isRecord(raw)) return null;
  const c = raw.citadels;
  return {
    defender: isFaction(raw.defender) ? raw.defender : null,
    homeOf: isFaction(raw.homeOf) ? raw.homeOf : null,
    controller: raw.controller === null ? null : isFaction(raw.controller) ? raw.controller : 'home',
    citadels: typeof c === 'number' && Number.isInteger(c) && c >= 0 && c <= 99 ? c : null,
  };
}

/* ------------------------------------------------------------------ start-of-combat choices */

export interface ChoicesDraft {
  citadelOrbit: Orbit | null;
  vanguardOrbit: Orbit | null;
  /** Uids of my explorers going evasive. */
  evasive: string[];
  curse: { ship: ShipId; slot: AbilitySlot } | null;
  /** The "strategy card chosen face down" reminder is ticked (local only). */
  cardChosen: boolean;
}

export const EMPTY_CHOICES: ChoicesDraft = { citadelOrbit: null, vanguardOrbit: null, evasive: [], curse: null, cardChosen: false };

/** My present explorers whose evasive ability (D1) is active. */
export function evasiveCandidates(g: GameState, c: CombatState, side: Side): CombatShip[] {
  return activeEffects(g, c, side)
    .filter((e) => e.entry.effect.kind === 'evasive')
    .map((e) => e.ship);
}

/** What going evasive does to this ship: "DIF 3→5 · ATK 2→0 · SUP 1→0" (any orbit; evasive DIF doesn't depend on it). */
export function evasiveText(g: GameState, c: CombatState, s: CombatShip): string {
  const view = c;
  const off = { ...s, evasive: false };
  const on = { ...s, evasive: true };
  const swap = (x: CombatShip): CombatState => ({ ...view, ships: view.ships.map((y) => (y.uid === s.uid ? x : y)) });
  const a = { dif: effDif(g, swap(off), off, s.orbit), ...effStats(g, swap(off), off) };
  const b = { dif: effDif(g, swap(on), on, s.orbit), ...effStats(g, swap(on), on) };
  return `DIF ${a.dif}→${b.dif} · ATK ${a.atk}→${b.atk} · SUP ${a.sup}→${b.sup}`;
}

export interface CurseOption {
  ship: ShipId;
  name: string;
  /** The orbits where it sits within reach of my Curse. */
  orbits: Orbit[];
  abilities: ShipAbility[];
}

/** Enemy ships (one entry per name) in the orbit of one of my active Curses, with the abilities a Curse may pick. */
export function curseOptions(g: GameState, c: CombatState, side: Side): CurseOption[] {
  const reach = new Set(
    activeEffects(g, c, side)
      .filter((e) => e.entry.effect.kind === 'curse')
      .map((e) => e.ship.orbit),
  );
  const out = new Map<ShipId, CurseOption>();
  for (const s of shipsOf(c, opponent(side))) {
    if (!reach.has(s.orbit)) continue;
    const data = shipData(s.ship);
    if (data.abilities.length === 0) continue;
    const o = out.get(s.ship) ?? { ship: s.ship, name: data.name, orbits: [], abilities: data.abilities };
    if (!o.orbits.includes(s.orbit)) o.orbits.push(s.orbit);
    out.set(s.ship, o);
  }
  return [...out.values()];
}

/**
 * The citadel choice for my side: 'choose' (I control the system and it has citadels: one orbit gets +1 SUP),
 * 'upgraded' (Upgraded Citadel: every orbit gets them, no choice), or null (not mine to make).
 */
export function citadelMode(g: GameState, c: CombatState, side: Side): 'choose' | 'upgraded' | null {
  const f = c.sides[side].faction;
  const p = g.players[f];
  if (f !== c.controller || c.citadels <= 0 || p === undefined) return null;
  return hasDev(p, DEV.upgradedCitadel) ? 'upgraded' : 'choose';
}

export interface CitadelOption {
  orbit: Orbit;
  /** Dice my attack from this orbit rolls without / with the citadel there. */
  before: number;
  after: number;
  /** I have a leader there (an orbit without one doesn't attack, so the citadel would do nothing). */
  leader: boolean;
}

export function citadelOptions(g: GameState, c: CombatState, side: Side): CitadelOption[] {
  const at = (orbit: Orbit | null): CombatState => ({ ...c, sides: { ...c.sides, [side]: { ...c.sides[side], citadelOrbit: orbit } } });
  return ORBITS.map((orbit) => ({
    orbit,
    before: dicePool(g, at(null), side, orbit).total,
    after: dicePool(g, at(orbit), side, orbit).total,
    leader: shipsOf(c, side, orbit).some((s) => s.role === 'leader'),
  }));
}

/** Vanguard Ship completed: I choose an orbit whose supports the enemy can't target. */
export function canVanguard(g: GameState, c: CombatState, side: Side): boolean {
  const p = g.players[c.sides[side].faction];
  return p !== undefined && hasDev(p, DEV.vanguardShip);
}

export function vanguardOptions(c: CombatState, side: Side): { orbit: Orbit; supports: number }[] {
  return ORBITS.map((orbit) => ({ orbit, supports: shipsOf(c, side, orbit).filter((s) => s.role === 'support').length }));
}

/** `combatStartChoices` from the draft, keeping only the choices that apply to my side now. */
export function choicesCommand(g: GameState, c: CombatState, side: Side, d: ChoicesDraft): Command {
  const evaders = new Set(evasiveCandidates(g, c, side).map((s) => s.uid));
  const curse =
    d.curse !== null && curseOptions(g, c, side).some((o) => o.ship === d.curse?.ship && o.abilities.some((a) => a.slot === d.curse?.slot)) ? { ...d.curse } : null;
  return {
    type: 'combatStartChoices',
    citadelOrbit: citadelMode(g, c, side) === 'choose' ? d.citadelOrbit : null,
    vanguardOrbit: canVanguard(g, c, side) ? d.vanguardOrbit : null,
    evasive: d.evasive.filter((uid, i) => evaders.has(uid) && d.evasive.indexOf(uid) === i),
    curse,
  };
}

export const SLOT_LABEL: Record<AbilitySlot, string> = {
  basic: 'basic ability',
  first: '1st researched ability',
  second: '2nd researched ability',
};

/** "Citadel: small orbit · Evasive: Anathema · Curse: Crow's 2nd researched ability". */
export function choicesSummary(c: CombatState, cmd: Command): string {
  if (cmd.type !== 'combatStartChoices') return '';
  const said: string[] = [];
  if (cmd.citadelOrbit !== null) said.push(`Citadel: ${cmd.citadelOrbit} orbit`);
  if (cmd.vanguardOrbit !== null) said.push(`Vanguard Ship: ${cmd.vanguardOrbit} orbit`);
  const evaders = c.ships.filter((s) => cmd.evasive.includes(s.uid)).map((s) => s.ship);
  if (evaders.length > 0) said.push(`Evasive: ${nameList(evaders)}`);
  if (cmd.curse !== null) said.push(`Curse: ${shipData(cmd.curse.ship).name}'s ${SLOT_LABEL[cmd.curse.slot]}`);
  return said.length === 0 ? 'No start-of-combat choices' : said.join(' · ');
}

/** "Citadel: small orbit · Evasive: Anathema · Curse: Crow's 2nd researched ability" for a side that is ready. */
export function sideChoicesSummary(c: CombatState, side: Side): string {
  const s = c.sides[side];
  const said: string[] = [];
  if (s.citadelOrbit !== null) said.push(`Citadel: ${s.citadelOrbit} orbit`);
  if (s.vanguardOrbit !== null) said.push(`Vanguard Ship: ${s.vanguardOrbit} orbit`);
  const evaders = c.ships.filter((x) => x.side === side && x.evasive).map((x) => x.ship);
  if (evaders.length > 0) said.push(`Evasive: ${nameList(evaders)}`);
  if (s.curse !== null) said.push(`Curse: ${shipData(s.curse.ship).name}'s ${SLOT_LABEL[s.curse.slot]}`);
  return said.length === 0 ? 'No start-of-combat choices' : said.join(' · ');
}

const SLOTS: AbilitySlot[] = ['basic', 'first', 'second'];

export function sanitizeChoices(raw: unknown): ChoicesDraft | null {
  if (!isRecord(raw)) return null;
  const orbit = (x: unknown): Orbit | null => (isOrbit(x) ? x : null);
  const evasive = Array.isArray(raw.evasive) ? [...new Set(raw.evasive.filter((x): x is string => typeof x === 'string'))] : [];
  const c = raw.curse;
  const curse = isRecord(c) && knownShip(c.ship) !== null && SLOTS.includes(c.slot as AbilitySlot) ? { ship: c.ship as ShipId, slot: c.slot as AbilitySlot } : null;
  return { citadelOrbit: orbit(raw.citadelOrbit), vanguardOrbit: orbit(raw.vanguardOrbit), evasive, curse, cardChosen: raw.cardChosen === true };
}
