import type {
  ActionType,
  BasicMineral,
  Resources,
  Size,
  StructureType,
} from './types';

/** Actions of each type that may be taken per round. */
export const SLOT_LIMIT: Record<ActionType, number> = {
  move: 2,
  claim: 2,
  extract: 2,
  manufacture: 1,
  trade: 1,
  build: 1,
  research: 1,
};

/** ISK to pay for taking an action; index = cubesUsed before taking it. */
export const CUBE_COST: number[] = [0, 0, 0, 5, 10];
export const MAX_CUBES = 5;

/** ISK is capped; excess is lost. */
export const ISK_CAP = 49;
/** Total minerals (including morphite) a player may hold. */
export const MINERAL_CAP = 12;
/** Structure models available per type. */
export const STRUCTURE_SUPPLY = 13;
/** Base build points per Build action. */
export const BASE_BP = 6;

export interface TradePrice {
  /** ISK received when selling. */
  sell: number;
  /** ISK paid when buying. */
  buy: number;
}

export type TradeKey =
  | 'component'
  | 'planetary'
  | 'moon'
  | 'morphite'
  | BasicMineral
  | 'triple';

/**
 * Trade prices. `pyrite`/`mexallon`/`tritanium` are a single basic mineral;
 * `triple` is three identical basic minerals traded together.
 */
export const TRADE: Record<TradeKey, TradePrice> = {
  component: { sell: 6, buy: 7 },
  planetary: { sell: 4, buy: 6 },
  moon: { sell: 4, buy: 6 },
  morphite: { sell: 4, buy: 5 },
  pyrite: { sell: 1, buy: 3 },
  mexallon: { sell: 1, buy: 3 },
  tritanium: { sell: 1, buy: 3 },
  triple: { sell: 5, buy: 8 },
};

export type ManufactureOutput =
  | 'component'
  | 'moon'
  | 'planetary'
  | 'research'
  | 'vp'
  | 'card';
export type ManufacturePay = 'basic' | 'morphite';

/** What one manufacture operation yields: research makes 2 tokens, everything else 1. */
export const MANUFACTURE_YIELD: Record<ManufactureOutput, number> = {
  component: 1,
  moon: 1,
  planetary: 1,
  research: 2,
  vp: 1,
  card: 1,
};

/**
 * Manufacture recipes: output -> payment option -> resources spent.
 * `basic` is the listed minerals (one of each for research/card/vp);
 * `morphite` is the single-morphite alternative where one exists.
 * Output quantities are in MANUFACTURE_YIELD.
 */
export const MANUFACTURE: Record<
  ManufactureOutput,
  Partial<Record<ManufacturePay, Partial<Resources>>>
> = {
  component: { basic: { mexallon: 2 } },
  moon: { basic: { tritanium: 2 } },
  planetary: { basic: { pyrite: 2 } },
  research: {
    basic: { pyrite: 1, mexallon: 1, tritanium: 1 },
    morphite: { morphite: 1 },
  },
  vp: { basic: { pyrite: 1, mexallon: 1, tritanium: 1, morphite: 2 } },
  card: {
    basic: { pyrite: 1, mexallon: 1, tritanium: 1 },
    morphite: { morphite: 1 },
  },
};

export interface ShipCost {
  bp: number;
  isk: number;
  pay: Partial<Resources>;
}

export const SHIP_COST: Record<Size, ShipCost> = {
  small: { bp: 1, isk: 4, pay: { tritanium: 1 } },
  medium: { bp: 3, isk: 6, pay: { planetary: 1, moon: 1, mexallon: 1 } },
  large: { bp: 5, isk: 8, pay: { component: 1, morphite: 1 } },
};

export interface StructureCost {
  bp: 5;
  isk: number;
  pay: { pyrite: 1 };
}

export const STRUCTURE_COST: Record<StructureType, StructureCost> = {
  engineering: { bp: 5, isk: 6, pay: { pyrite: 1 } },
  citadel: { bp: 5, isk: 5, pay: { pyrite: 1 } },
  customs: { bp: 5, isk: 4, pay: { pyrite: 1 } },
  refinery: { bp: 5, isk: 4, pay: { pyrite: 1 } },
};

export const UNLOCK_BELT_COST = { bp: 4, isk: 5 };

/** Mass Production: ISK off each further ship of the same name in one Build action. */
export const MASS_PRODUCTION_ISK = 2;
/** Assembly Line: extra build points per Build action. */
export const ASSEMBLY_LINE_BP = 2;
/** Materials Efficiency: ISK off each structure. */
export const MATERIALS_EFFICIENCY_ISK = 1;
