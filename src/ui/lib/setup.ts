/** Faction setup: its steps, and picking the four starting developments. */
import { DEV, type DevCategory, type Development } from '../../data/developments';
import type { DevId } from '../../data/types';
import type { GameMode } from '../../engine/types';

/** Setup's steps: 1 Home belt · 2 Developments · 3 Confirm. */
export type Step = 1 | 2 | 3;

const FULL_STEPS: readonly Step[] = [1, 2, 3];
const LIGHT_STEPS: readonly Step[] = [2, 3];

/** The steps a player walks, in order. A light game tracks no belts, so it skips the home belt step. */
export function setupSteps(mode: GameMode): readonly Step[] {
  return mode === 'light' ? LIGHT_STEPS : FULL_STEPS;
}

/** A saved step if this game has it, else the game's first step (a light player never lands on the belt step). */
export function setupStep(saved: unknown, mode: GameMode): Step {
  const steps = setupSteps(mode);
  return steps.find((s) => s === saved) ?? steps[0]!;
}

/** The home belt as a board step: a light game skips the belt step, so the player still reveals it at the table. */
const LIGHT_BELT_STEP =
  'On your leftmost home system, put 2 unlock tokens over 2 of its 3 asteroid belts and take 1 mineral of the uncovered belt\'s colour';
const FRIGATES_STEP = 'Place your 2 starting frigates in any of your home systems';
/** A light game keeps ISK and action cubes on the board. */
const LIGHT_TRACKS_STEP = 'Set your ISK track to your income (4), put 5 action cubes in the action pool and 2 currency cubes on 0';

/** "At the table" lines besides the card draw: the board setup the app doesn't track (a light game also skips the belt step). */
export function tableSteps(mode: GameMode): readonly string[] {
  return mode === 'light' ? [LIGHT_BELT_STEP, FRIGATES_STEP, LIGHT_TRACKS_STEP] : [FRIGATES_STEP];
}

export const STARTING_DEVS = 4;

/**
 * Starting picks for a first game, from the BoardGameGeek thread
 * https://boardgamegeek.com/thread/3589511/development-deck-recommendations-for-beginners: the cards at least two
 * posters named as good openers that cost at most 4 research and need no other card first, cheapest first. Each has a
 * one-line reason, drawn from what the posters said.
 */
export const RECOMMENDED_DEVS: readonly { id: DevId; why: string }[] = [
  { id: DEV.starMap, why: 'Draws or swaps a mission, so you can go for one you can finish quickly.' },
  { id: DEV.tradeContracts, why: 'A free trade operation: sell spare resources for ISK or buy what you are short of.' },
  { id: DEV.manufacturingHub, why: 'A free manufacturing operation, to turn spare minerals into research, VP or cards.' },
  { id: DEV.materialsEfficiency, why: 'Every structure costs 1 ISK less: worth it if you plan to build a lot.' },
  { id: DEV.underdog, why: 'A cheap VP whenever you are in last place.' },
  { id: DEV.offensiveTactic, why: 'Cheap, and a reroll can decide an early battle.' },
  { id: DEV.researchLab, why: 'Adds development cards during upkeep, which saves you research actions.' },
  { id: DEV.mediumHull, why: 'Lets you build cruisers early, and replaces itself when completed.' },
  { id: DEV.researchSpy, why: 'Copies a rival’s completed development. It pays off on any card costing 3 or more.' },
];

export const CATEGORY_ORDER: DevCategory[] = ['combat', 'conquest', 'diplomacy', 'economy', 'spaceships', 'structures'];

/** Adds or removes `id`; a card beyond the fourth is refused (the same array comes back). */
export function toggleDev(selected: readonly DevId[], id: DevId, max = STARTING_DEVS): readonly DevId[] {
  if (selected.includes(id)) return selected.filter((d) => d !== id);
  if (selected.length >= max) return selected;
  return [...selected, id];
}

export function devsByCategory(devs: readonly Development[]): { category: DevCategory; devs: Development[] }[] {
  return CATEGORY_ORDER.map((category) => ({
    category,
    devs: devs.filter((d) => d.category === category).sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name)),
  }));
}
