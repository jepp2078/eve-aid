/** Player-facing names for game terms, shared by every screen. */
import { DEVELOPMENTS, type DevCategory, type DevKeyword } from '../../data/developments';
import { FACTION_INFO } from '../../data/factions';
import type { ActionType, DevTier, FactionId, ResourceKey, Size, StructureType } from '../../data/types';
import type { Command } from '../../engine/types';

export function factionName(f: FactionId): string {
  return FACTION_INFO[f].name;
}

export const ACTION_LABEL: Record<ActionType, string> = {
  move: 'Move',
  claim: 'Claim',
  extract: 'Extract',
  manufacture: 'Manufacture',
  trade: 'Trade',
  build: 'Build',
  research: 'Research',
};

export const RESOURCE_LABEL: Record<ResourceKey, string> = {
  isk: 'ISK',
  pyrite: 'Pyrite',
  mexallon: 'Mexallon',
  tritanium: 'Tritanium',
  morphite: 'Morphite',
  planetary: 'Planetary',
  moon: 'Moon',
  component: 'Component',
};

export const STRUCTURE_LABEL: Record<StructureType, string> = {
  engineering: 'Engineering Complex',
  citadel: 'Citadel',
  customs: 'Customs Office',
  refinery: 'Refinery',
};

/** "+4", "−5" (a real minus sign), "0". */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `\u2212${-n}` : '0';
}

export const CATEGORY_LABEL: Record<DevCategory, string> = {
  combat: 'Combat',
  conquest: 'Conquest',
  diplomacy: 'Diplomacy',
  economy: 'Economy',
  spaceships: 'Spaceships',
  structures: 'Structures',
};

export const SIZE_LABEL: Record<Size, string> = {
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
};

/** The Systems development that unlocks a ship ability tier ("Offensive Systems T1"), from the card data. */
export const TIER_LABEL = Object.fromEntries(DEVELOPMENTS.flatMap((d) => (d.tier === null ? [] : [[d.tier, d.name]]))) as Record<DevTier, string>;

export const KEYWORD_LABEL: Record<NonNullable<DevKeyword>, string> = {
  use: 'Use',
  use_in_combat: 'Use in combat',
  use_at_any_time: 'Use any time',
};

const COMMAND_LABEL: Record<Exclude<Command['type'], 'action' | 'join' | 'takeOver'>, string> = {
  setSeats: 'Seats changed',
  startGame: 'Game started',
  setupFaction: 'Setup confirmed',
  lightClaim: 'Claimed a system',
  gainResearch: 'Research gained',
  endTurn: 'Turn ended',
  pass: 'Passed',
  forceAdvance: 'Turn advanced',
  discover: 'Discovery recorded',
  autoClaim: 'System claimed',
  payJump: 'Jump paid',
  deployableInfrastructure: 'Structure deployed',
  adjust: 'Adjusted',
  missionComplete: 'Mission completed',
  eventPlayed: 'Event played',
  discardMinerals: 'Minerals discarded',
  distributeResearch: 'Research placed',
  addCard: 'Card added',
  completeDev: 'Development completed',
  useDev: 'Development used',
  confirmUpkeep: 'Upkeep confirmed',
  lightUpkeep: 'Upkeep confirmed',
  combatStart: 'Combat started',
  combatAssign: 'Fleet assigned',
  combatStartChoices: 'Combat choices set',
  combatRetreat: 'Retreat decided',
  combatTarget: 'Target chosen',
  combatRoll: 'Attack resolved',
  combatOverflow: 'Overflow resolved',
  combatRealign: 'Orbits realigned',
  combatDamage: 'Damage adjusted',
  combatDestroy: 'Ship destroyed',
  combatAddShips: 'Ships added',
  combatContinue: 'Combat continued',
  combatFinish: 'Combat finished',
  combatCancel: 'Combat cancelled',
};

/** A short label for the undo snackbar ("Trade · Undo"). */
export function commandLabel(cmd: Command): string {
  switch (cmd.type) {
    case 'action':
      return ACTION_LABEL[cmd.action];
    case 'join':
      return `Joined as ${factionName(cmd.faction)}`;
    case 'takeOver':
      return `Took over ${factionName(cmd.faction)}`;
    default:
      return COMMAND_LABEL[cmd.type];
  }
}

/** "Ann", "Ann and Bob", "Ann, Bob and Cid". */
export function andList(parts: readonly string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** The words for the `central` flag's domination VP, wherever a screen names, tags or toggles it. */
export interface CentralWords {
  /** A toggle, detail-row or preview label: "Central system". */
  name: string;
  /** A seat's tag: "Central". */
  tag: string;
  /** A seat's count word, lower case beside "done" and "hidden": "central". */
  count: string;
  /** The claim toggle: "It's the central system". */
  claim: string;
  /** The light claim toggle: "Took the central system". */
  took: string;
  /** What it scores: "Worth 1 VP in each upkeep". */
  note: string;
  /** The toggle's note while the player has it, and while they don't. */
  held: string;
  notHeld: string;
}

const CENTRAL_WORDS: CentralWords = {
  name: 'Central system',
  tag: 'Central',
  count: 'central',
  claim: "It's the central system",
  took: 'Took the central system',
  note: 'Worth 1 VP in each upkeep',
  held: 'You control it',
  notHeld: 'Not yours',
};

/** The 2-player layout has no central system: the official errata gives its VP to the sole player with the most tier 3 systems. */
const MOST_T3_WORDS: CentralWords = {
  name: 'Most tier 3 systems',
  tag: 'Most T3',
  count: 'most T3',
  claim: 'Now the most tier 3 systems',
  took: 'Now the most tier 3 systems',
  note: 'Worth 1 VP in each upkeep; nobody on a tie',
  held: 'You have the most',
  notHeld: 'Not you',
};

/** The `central` flag's words for a game of `seats` players: the central system, or (2 players) the most tier 3 systems. */
export function centralWords(seats: number): CentralWords {
  return seats === 2 ? MOST_T3_WORDS : CENTRAL_WORDS;
}
