import { describe, expect, it } from 'vitest';
import { BLACK_FACES, FACE_VALUE, WHITE_FACES } from '../../src/data/dice';
import { FACTION_INFO } from '../../src/data/factions';
import {
  BASE_BP,
  CUBE_COST,
  ISK_CAP,
  MANUFACTURE,
  MAX_CUBES,
  MINERAL_CAP,
  SHIP_COST,
  SLOT_LIMIT,
  STRUCTURE_COST,
  STRUCTURE_SUPPLY,
  TRADE,
  UNLOCK_BELT_COST,
} from '../../src/data/costs';
import { FACTIONS } from '../../src/data/types';

describe('action limits', () => {
  it('has the per-round slot limits', () => {
    expect(SLOT_LIMIT).toEqual({
      move: 2,
      claim: 2,
      extract: 2,
      manufacture: 1,
      trade: 1,
      build: 1,
      research: 1,
    });
  });

  it('charges 5 and 10 ISK for the 4th and 5th cube', () => {
    expect(CUBE_COST).toEqual([0, 0, 0, 5, 10]);
  });
});

describe('trade table', () => {
  it('prices components, materials and minerals', () => {
    expect(TRADE.component).toEqual({ sell: 6, buy: 7 });
    expect(TRADE.planetary).toEqual({ sell: 4, buy: 6 });
    expect(TRADE.moon).toEqual({ sell: 4, buy: 6 });
    expect(TRADE.morphite).toEqual({ sell: 4, buy: 5 });
  });

  it('prices a single basic mineral and three identical basic minerals', () => {
    expect(TRADE.pyrite).toEqual({ sell: 1, buy: 3 });
    expect(TRADE.mexallon).toEqual({ sell: 1, buy: 3 });
    expect(TRADE.tritanium).toEqual({ sell: 1, buy: 3 });
    expect(TRADE.triple).toEqual({ sell: 5, buy: 8 });
  });
});

describe('caps and supply', () => {
  it('has the numeric limits', () => {
    expect({ MAX_CUBES, ISK_CAP, MINERAL_CAP, STRUCTURE_SUPPLY, BASE_BP }).toEqual({
      MAX_CUBES: 5,
      ISK_CAP: 49,
      MINERAL_CAP: 12,
      STRUCTURE_SUPPLY: 13,
      BASE_BP: 6,
    });
  });
});

describe('manufacture recipes', () => {
  it('makes components and materials from two of one mineral', () => {
    expect(MANUFACTURE.component).toEqual({ basic: { mexallon: 2 } });
    expect(MANUFACTURE.moon).toEqual({ basic: { tritanium: 2 } });
    expect(MANUFACTURE.planetary).toEqual({ basic: { pyrite: 2 } });
  });

  it('makes research and cards from one of each basic mineral or one morphite', () => {
    const trio = { pyrite: 1, mexallon: 1, tritanium: 1 };
    expect(MANUFACTURE.research).toEqual({ basic: trio, morphite: { morphite: 1 } });
    expect(MANUFACTURE.card).toEqual({ basic: trio, morphite: { morphite: 1 } });
  });

  it('makes a VP from one of each basic mineral plus two morphite', () => {
    expect(MANUFACTURE.vp).toEqual({
      basic: { pyrite: 1, mexallon: 1, tritanium: 1, morphite: 2 },
    });
  });
});

describe('build costs', () => {
  it('prices a medium ship', () => {
    expect(SHIP_COST.medium).toEqual({
      bp: 3,
      isk: 6,
      pay: { planetary: 1, moon: 1, mexallon: 1 },
    });
  });

  it('prices small and large ships', () => {
    expect(SHIP_COST.small).toEqual({ bp: 1, isk: 4, pay: { tritanium: 1 } });
    expect(SHIP_COST.large).toEqual({ bp: 5, isk: 8, pay: { component: 1, morphite: 1 } });
  });

  it('prices unlocking a home asteroid belt', () => {
    expect(UNLOCK_BELT_COST).toEqual({ bp: 4, isk: 5 });
  });

  it('prices structures', () => {
    expect(STRUCTURE_COST.engineering.isk).toBe(6);
    expect(STRUCTURE_COST.citadel.isk).toBe(5);
    expect(STRUCTURE_COST.customs.isk).toBe(4);
    expect(STRUCTURE_COST.refinery.isk).toBe(4);
    for (const cost of Object.values(STRUCTURE_COST)) {
      expect(cost.bp).toBe(5);
      expect(cost.pay).toEqual({ pyrite: 1 });
    }
  });
});

describe('dice', () => {
  it('values crit as 1 damage plus 1 crit', () => {
    expect(FACE_VALUE.crit).toEqual({ aim: 0, damage: 1, crit: 1 });
  });

  it('values aim+damage as 1 aim and 1 damage', () => {
    expect(FACE_VALUE.aimDamage).toEqual({ aim: 1, damage: 1, crit: 0 });
  });

  it('has two aim faces on the white die', () => {
    expect(WHITE_FACES).toHaveLength(6);
    expect(WHITE_FACES.filter((f) => f === 'aim')).toHaveLength(2);
  });

  it('has six faces on the black die', () => {
    expect(BLACK_FACES).toHaveLength(6);
  });
});

describe('factions', () => {
  it('has base income, build and research for every faction', () => {
    for (const f of FACTIONS) {
      const { income, build, research } = FACTION_INFO[f];
      expect({ income, build, research }).toEqual({ income: 4, build: 6, research: 3 });
    }
  });

  it('has faction colours', () => {
    expect(FACTIONS.map((f) => FACTION_INFO[f].color)).toEqual([
      '#d4a017',
      '#3b82c4',
      '#2f9e74',
      '#c0392b',
    ]);
  });

  it('starts each faction with an explorer and an interceptor', () => {
    expect(FACTIONS.map((f) => FACTION_INFO[f].startingShips)).toEqual([
      ['anathema', 'malediction'],
      ['buzzard', 'crow'],
      ['helios', 'ares'],
      ['cheetah', 'stiletto'],
    ]);
  });
});
