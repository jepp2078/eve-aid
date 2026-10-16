/**
 * The Table tab and the big-screen table: everyone's public state at a glance. The phase line ("Round 3 ·
 * Actions", "Round 3 · Upkeep · 2/4 confirmed"), each seat's status tags (NOW, First player, Passed, upkeep
 * progress, Winner), a seat's public detail (completed developments only: cards being researched are secret and
 * never in the public state; a light game shows only those), the "Force next turn" consequence (from the engine
 * itself) and the combat line.
 */
import { dev } from '../../data/developments';
import { SHIPS } from '../../data/ships';
import { MINERALS, type DevId, type FactionId, type Mineral, type ResourceKey, type ShipId, type StructureType } from '../../data/types';
import { apply } from '../../engine/apply';
import { isError, type CombatState, type GameMode, type GameState, type PlayerPublic } from '../../engine/types';
import { isLight, withArticle } from '../../engine/util';
import { HOSTED } from '../../sync/hosting';
import { STRUCTURES } from './build';
import { ACTION_LABEL, andList, factionName, STRUCTURE_LABEL } from './labels';

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Seated factions in clockwise seat order. */
export function seatedFactions(game: GameState): FactionId[] {
  return game.seats.filter((f) => game.players[f] !== undefined);
}

/** The phase banner: "Round 3 · Actions", "Round 3 · Upkeep · 2/4 confirmed", "Setup · 1/3 ready", "Game over · Amarr wins". */
export function phaseText(game: GameState): string {
  const seated = seatedFactions(game);
  switch (game.phase) {
    case 'lobby':
      return `Lobby · ${plural(seated.length, 'player')}`;
    case 'setup': {
      const ready = seated.filter((f) => game.players[f]!.setupDone).length;
      return `Setup · ${ready}/${seated.length} ready`;
    }
    case 'actions':
      return `Round ${game.round} · Actions`;
    case 'upkeep': {
      const confirmed = game.upkeep?.confirmed.length ?? 0;
      const name = game.upkeep?.emergency ? 'Emergency upkeep' : 'Upkeep';
      return `Round ${game.round} · ${name} · ${confirmed}/${seated.length} confirmed`;
    }
    case 'ended': {
      const winners = (game.result?.winners ?? []).map(factionName);
      if (winners.length === 0) return 'Game over';
      return `Game over · ${andList(winners)} ${winners.length === 1 ? 'wins' : 'share the victory'}`;
    }
  }
}

export type SeatTagKind = 'now' | 'first' | 'passed' | 'upkeepDone' | 'upkeepWaiting' | 'winner';

export interface SeatTag {
  kind: SeatTagKind;
  label: string;
}

export interface RowStatus {
  /** It is this seat's turn (actions phase): thick faction border, ▶ and NOW. */
  active: boolean;
  /** Passed this round (actions phase only): the row dims and says "Passed". */
  dimmed: boolean;
  tags: SeatTag[];
}

const TAG_LABEL: Record<SeatTagKind, string> = {
  now: 'NOW',
  first: 'First player',
  passed: 'Passed',
  upkeepDone: 'Upkeep done',
  upkeepWaiting: 'Waiting',
  winner: 'Winner',
};

/** A seat's status on the Table: whose turn, first player, passed, upkeep progress, winner (icons are the UI's). */
export function rowStatus(game: GameState, f: FactionId): RowStatus {
  const p = game.players[f];
  const kinds: SeatTagKind[] = [];
  const actions = game.phase === 'actions';
  const active = actions && game.turn?.faction === f;
  const passed = actions && p?.passed === true && !active;
  if (active) kinds.push('now');
  if ((game.phase === 'setup' || actions || game.phase === 'upkeep') && game.firstPlayer === f) kinds.push('first');
  if (passed) kinds.push('passed');
  if (game.phase === 'upkeep' && game.upkeep !== null) kinds.push(game.upkeep.confirmed.includes(f) ? 'upkeepDone' : 'upkeepWaiting');
  if (game.phase === 'ended' && game.result?.winners.includes(f)) kinds.push('winner');
  return { active, dimmed: passed, tags: kinds.map((kind) => ({ kind, label: TAG_LABEL[kind] })) };
}

/** Resources shown to the whole table (manual p. 9): minerals, then planetary, moon and component. ISK is shown apart. */
const STOCK_KEYS: readonly ResourceKey[] = [...MINERALS, 'planetary', 'moon', 'component'];

export interface SeatDetail {
  /** Minerals and materials they hold, in that order (only kinds they have). A light game's board keeps them: none. */
  stock: { kind: ResourceKey; count: number }[];
  /** Completed (public) developments; `tapped` = used this round. */
  devs: { id: DevId; name: string; tapped: boolean }[];
  /** Structures on the board by type (only types they have). The citadel count includes home citadels. */
  structures: { type: StructureType; label: string; count: number }[];
  homeCitadels: number;
  /** Ships on the board by name (only ships they have). */
  ships: { id: ShipId; name: string; count: number }[];
  /** Unlocked asteroid belts by mineral (only minerals they have). */
  belts: { mineral: Mineral; count: number }[];
  lockedHomeBelts: number;
  /** Structures and ships on the board in total (the collapsed row's counts). */
  structureCount: number;
  shipCount: number;
  /**
   * "2 developments · 3 structures · 6 ships", the collapsed row's counts in words; in a light game "2 developments
   * done · 3 hidden" (completed, and still in the development area).
   */
  summary: string;
}

/**
 * A seat's public detail for the expanded Table row. A light game's board keeps the structures, ships and belts, so its
 * detail has the completed developments only.
 */
export function seatDetail(p: PlayerPublic, mode: GameMode = 'full'): SeatDetail {
  const devs = p.completed.map((id) => ({ id, name: dev(id).name, tapped: p.tapped.includes(id) }));
  if (mode === 'light') {
    return {
      stock: [],
      devs,
      structures: [],
      homeCitadels: 0,
      ships: [],
      belts: [],
      lockedHomeBelts: 0,
      structureCount: 0,
      shipCount: 0,
      summary: `${plural(devs.length, 'development')} done · ${p.devAreaCount} hidden`,
    };
  }
  const structures = STRUCTURES.filter((s) => p.structures[s] > 0).map((s) => ({ type: s, label: STRUCTURE_LABEL[s], count: p.structures[s] }));
  const ships = SHIPS.filter((s) => (p.ships[s.id] ?? 0) > 0).map((s) => ({ id: s.id, name: s.name, count: p.ships[s.id]! }));
  const belts = MINERALS.filter((m) => p.belts[m] > 0).map((m) => ({ mineral: m, count: p.belts[m] }));
  const nStructures = structures.reduce((n, s) => n + s.count, 0);
  const nShips = ships.reduce((n, s) => n + s.count, 0);
  return {
    stock: STOCK_KEYS.filter((k) => p.res[k] > 0).map((kind) => ({ kind, count: p.res[kind] })),
    devs,
    structures,
    homeCitadels: p.homeCitadels,
    ships,
    belts,
    lockedHomeBelts: p.lockedHomeBelts,
    structureCount: nStructures,
    shipCount: nShips,
    summary: `${plural(devs.length, 'development')} · ${plural(nStructures, 'structure')} · ${plural(nShips, 'ship')}`,
  };
}

/** What "Force next turn" would do, worked out by the engine on a copy of the game. */
export type ForceOutcome =
  | { kind: 'next'; faction: FactionId }
  /** Everyone else has passed: the holder gets the turn again. */
  | { kind: 'again' }
  | { kind: 'upkeep'; emergency: boolean }
  /** A combat is open: it belongs to the turn, so it must be cancelled or finished first. */
  | { kind: 'combat' }
  | { kind: 'error'; message: string };

/**
 * How a seat moves to another device when its phone died or its player left. The laptop's own browser may hold a seat
 * itself (Join would send it back to its game), so there it takes `?as=spare`, a separate device (README, "A phone
 * died or someone left"). Shown where the game waits on one seat: the upkeep's "Waiting for:", the combat waits, and
 * Force next turn when the stuck holder would just get the turn again. A word joiner (U+2060) keeps `?as=spare` on one
 * line: a phone would break it after the "?".
 */
export const TAKE_OVER_HINT = HOSTED
  ? "Phone died or player gone? On any device that isn't in the game (or one that is, with ?\u2060as=spare added to the address): Join → code → their faction → Take over."
  : "Phone died or player gone? On any device that isn't in the game (on the laptop, add ?\u2060as=spare to the address): Join → code → their faction → Take over.";

export function forceOutcome(game: GameState, actor: FactionId, uid: string): ForceOutcome {
  let r;
  try {
    if (game.turn === null) return { kind: 'error', message: 'There is no turn in progress' };
    r = apply(game, { type: 'forceAdvance', expected: game.turn.faction }, { actor, uid, priv: null, now: 0 });
  } catch {
    return { kind: 'error', message: "This can't be worked out right now" };
  }
  if (isError(r)) return r.code === 'combat_active' ? { kind: 'combat' } : { kind: 'error', message: r.message };
  if (r.game.phase === 'upkeep') return { kind: 'upkeep', emergency: r.game.upkeep?.emergency === true };
  const next = r.game.turn?.faction;
  if (next === undefined) return { kind: 'error', message: 'There is no turn in progress' };
  return next === game.turn?.faction ? { kind: 'again' } : { kind: 'next', faction: next };
}

export interface ForceCopy {
  title: string;
  /** Where the holder's turn stands. */
  where: string;
  /** What happens next (the consequence). */
  next: string;
  /** When to use it. */
  note: string;
  /** How to move the seat to another device, when skipping alone can't get the game going (the holder plays again). */
  hint: string | null;
  confirm: string;
  cancel: string;
  /** Snackbar text after it went through. */
  done: string;
}

/** The confirmation's words, naming the consequence ("Skip Caldari's turn" / "Keep waiting"). Null without a turn. */
export function forceCopy(game: GameState, outcome: ForceOutcome): ForceCopy | null {
  const turn = game.phase === 'actions' ? game.turn : null;
  if (turn === null) return null;
  const holder = factionName(turn.faction);
  // A light game records no actions (they are played on the board), so the app can't tell whether the holder played.
  const where = isLight(game)
    ? `The app can't see the board, so it doesn't know whether ${holder} has played. Skipping ends their turn without passing them.`
    : turn.actionTaken === null
      ? `${holder} hasn't taken an action yet. Skipping doesn't pass them: they play again when the turn comes round.`
      : `${holder} took ${withArticle(ACTION_LABEL[turn.actionTaken])} action but hasn't ended the turn. Skipping ends it.`;
  let next: string;
  switch (outcome.kind) {
    case 'next':
      next = `${factionName(outcome.faction)} takes the turn next.`;
      break;
    case 'again':
      next = `Everyone else has passed, so ${holder} gets the turn again.`;
      break;
    case 'upkeep':
      next = outcome.emergency ? 'The round then ends with the emergency upkeep (Verge of Ascendancy).' : 'Everyone has passed, so the upkeep begins.';
      break;
    case 'combat':
      next = `A combat is still open, and it belongs to this turn: cancel it first (Combat → More → Cancel combat), or let ${holder} finish it.`;
      break;
    case 'error':
      next = `It can't be done right now: ${outcome.message.replace(/\.$/, '')}.`;
      break;
  }
  return {
    title: `Skip ${holder}'s turn?`,
    where,
    next,
    note: "Use it only when their device is stuck or away. It's logged, and anyone can undo it.",
    hint: outcome.kind === 'again' ? TAKE_OVER_HINT : null,
    confirm: `Skip ${holder}'s turn`,
    cancel: 'Keep waiting',
    done: `Skipped ${holder}'s turn`,
  };
}

/** What a combat stage is called in status lines (Table, Combat). */
export const STAGE_LABEL: Record<CombatState['stage'], string> = {
  assign: 'Assigning fleets',
  start: 'Start of combat',
  retreat: 'Retreat decisions',
  attack: 'Attacks',
  realign: 'Realigning orbits',
  end: 'Results',
};

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** "Amarr attacks Caldari · Round 2 · Attacks · Medium orbit", or null when no combat is on. */
export function combatText(game: GameState): string | null {
  const c = game.combat;
  if (c === null) return null;
  const parts = [`${factionName(c.attacker)} attacks ${factionName(c.defender)}`];
  if (c.round > 0) parts.push(`Round ${c.round}`);
  parts.push(STAGE_LABEL[c.stage]);
  if (c.stage === 'attack' && c.step !== null) parts.push(`${capital(c.step.orbit)} orbit`);
  return parts.join(' · ');
}
