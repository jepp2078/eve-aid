import { describe, expect, it } from 'vitest';
import { DEVELOPMENTS, dev } from '../../src/data/developments';
import { CATEGORY_ORDER, devsByCategory, RECOMMENDED_DEVS, setupStep, setupSteps, STARTING_DEVS, tableSteps, toggleDev } from '../../src/ui/lib/setup';

describe('toggleDev', () => {
  it('adds and removes a card', () => {
    expect(toggleDev([], 'a')).toStrictEqual(['a']);
    expect(toggleDev(['a', 'b'], 'a')).toStrictEqual(['b']);
  });

  it('refuses a fifth card', () => {
    expect(STARTING_DEVS).toBe(4);
    const four = ['a', 'b', 'c', 'd'];
    expect(toggleDev(four, 'e')).toBe(four);
    expect(toggleDev(four, 'd')).toStrictEqual(['a', 'b', 'c']);
  });
});

describe('RECOMMENDED_DEVS', () => {
  it('names distinct cheap starting cards, cheapest first, each with a reason', () => {
    const ids = RECOMMENDED_DEVS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(STARTING_DEVS);
    const costs = ids.map((id) => dev(id).cost);
    expect(costs).toStrictEqual([...costs].sort((a, b) => a - b));
    for (const r of RECOMMENDED_DEVS) {
      expect(dev(r.id).cost).toBeLessThanOrEqual(4);
      expect(dev(r.id).prerequisite).toBeNull();
      expect(r.why).not.toBe('');
    }
  });
});

describe('devsByCategory', () => {
  it('groups every development by category in a fixed order, cheapest first', () => {
    const groups = devsByCategory(DEVELOPMENTS);
    expect(groups.map((g) => g.category)).toStrictEqual(CATEGORY_ORDER);
    expect(groups.reduce((n, g) => n + g.devs.length, 0)).toBe(DEVELOPMENTS.length);
    for (const g of groups) {
      const costs = g.devs.map((d) => d.cost);
      expect(costs).toStrictEqual([...costs].sort((a, b) => a - b));
    }
  });
});

describe('setupSteps', () => {
  it('a full game walks home belt, developments, confirm', () => {
    expect(setupSteps('full')).toStrictEqual([1, 2, 3]);
  });

  it('a light game skips the home belt step', () => {
    expect(setupSteps('light')).toStrictEqual([2, 3]);
  });
});

describe('setupStep', () => {
  it('keeps a saved step the game has', () => {
    expect(setupStep(1, 'full')).toBe(1);
    expect(setupStep(3, 'full')).toBe(3);
    expect(setupStep(2, 'light')).toBe(2);
    expect(setupStep(3, 'light')).toBe(3);
  });

  it("falls back to the game's first step, so a light player never lands on the belt step", () => {
    expect(setupStep(1, 'light')).toBe(2);
    expect(setupStep(undefined, 'light')).toBe(2);
    expect(setupStep('3', 'light')).toBe(2);
    expect(setupStep(undefined, 'full')).toBe(1);
    expect(setupStep(4, 'full')).toBe(1);
  });
});

describe('tableSteps', () => {
  it('a full game has the belt step, so only the starting frigates go under "At the table"', () => {
    expect(tableSteps('full')).toStrictEqual(['Place your 2 starting frigates in any of your home systems']);
  });

  it('a light game skips the belt step, so the table covers the belt, the frigates and the tracks', () => {
    const steps = tableSteps('light');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toContain('2 unlock tokens');
    expect(steps[1]).toContain('2 starting frigates');
    expect(steps[2]).toContain('ISK track');
  });
});
