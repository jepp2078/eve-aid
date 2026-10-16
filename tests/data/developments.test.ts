import { describe, expect, it } from 'vitest';
import { DEV, DEVELOPMENTS, dev, type DevCategory } from '../../src/data/developments';

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

describe('development data', () => {
  it('has 44 developments with unique ids that are slugs of the card name', () => {
    expect(DEVELOPMENTS).toHaveLength(44);
    expect(new Set(DEVELOPMENTS.map((d) => d.id)).size).toBe(44);
    for (const d of DEVELOPMENTS) expect(d.id).toBe(slug(d.name));
  });

  it('has the expected number of cards per category', () => {
    const count = (c: DevCategory) => DEVELOPMENTS.filter((d) => d.category === c).length;
    expect(count('combat')).toBe(7);
    expect(count('conquest')).toBe(8);
    expect(count('diplomacy')).toBe(5);
    expect(count('economy')).toBe(7);
    expect(count('spaceships')).toBe(9);
    expect(count('structures')).toBe(8);
  });

  it('converts prerequisite card names to ids', () => {
    expect(dev(DEV.largeHull).prerequisite).toBe(DEV.mediumHull);
    expect(dev(DEV.defensiveSystemsT2).prerequisite).toBe(DEV.defensiveSystemsT1);
    expect(dev(DEV.offensiveSystemsT2).prerequisite).toBe(DEV.offensiveSystemsT1);
    expect(dev(DEV.utilitySystemsT2).prerequisite).toBe(DEV.utilitySystemsT1);
    const withPrereq = DEVELOPMENTS.filter((d) => d.prerequisite !== null);
    expect(withPrereq).toHaveLength(4);
    const ids = new Set(DEVELOPMENTS.map((d) => d.id));
    for (const d of withPrereq) expect(ids.has(d.prerequisite as string)).toBe(true);
  });

  it('sets tier on exactly the six Systems cards', () => {
    expect(dev(DEV.offensiveSystemsT1).tier).toBe('O1');
    expect(dev(DEV.offensiveSystemsT2).tier).toBe('O2');
    expect(dev(DEV.defensiveSystemsT1).tier).toBe('D1');
    expect(dev(DEV.defensiveSystemsT2).tier).toBe('D2');
    expect(dev(DEV.utilitySystemsT1).tier).toBe('U1');
    expect(dev(DEV.utilitySystemsT2).tier).toBe('U2');
    expect(DEVELOPMENTS.filter((d) => d.tier !== null)).toHaveLength(6);
  });

  it('marks every spaceship card as adding a development card, and only those', () => {
    const spaceships = DEVELOPMENTS.filter((d) => d.category === 'spaceships');
    expect(spaceships.every((d) => d.addsCard)).toBe(true);
    expect(DEVELOPMENTS.filter((d) => d.addsCard)).toHaveLength(spaceships.length);
  });

  it('reads costs and keywords from the card transcription', () => {
    expect(dev(DEV.vanguardShip).cost).toBe(6);
    expect(dev(DEV.warpDriveEfficiency).cost).toBe(7);
    expect(dev(DEV.defensiveTactic).keyword).toBe('use_in_combat');
    expect(dev(DEV.starMap).keyword).toBe('use');
    expect(dev(DEV.vanguardShip).keyword).toBeNull();
    for (const d of DEVELOPMENTS) {
      expect(Number.isInteger(d.cost) && d.cost >= 0).toBe(true);
    }
  });

  it('keeps card text verbatim, with inline tokens and paragraph breaks', () => {
    expect(dev(DEV.defensiveTactic).text).toContain('[DAMAGE]');
    expect(dev(DEV.defensiveTactic).text).toContain('\n');
    for (const d of DEVELOPMENTS) expect(d.text.length).toBeGreaterThan(0);
  });

  it('never contains undefined values', () => {
    for (const d of DEVELOPMENTS) {
      for (const v of Object.values(d)) expect(v).not.toBeUndefined();
      expect(Object.keys(d).sort()).toEqual(
        ['addsCard', 'category', 'cost', 'id', 'keyword', 'name', 'prerequisite', 'text', 'tier'],
      );
    }
  });

  it('resolves every DEV constant to a distinct development', () => {
    const entries = Object.entries(DEV);
    expect(entries).toHaveLength(44);
    expect(new Set(entries.map(([, id]) => id)).size).toBe(44);
    for (const [, id] of entries) expect(dev(id).id).toBe(id);
    expect(DEV.defensiveTactic).toBe('defensive-tactic');
    expect(DEV.researchLab).toBe('upgraded-eng-complex-research-lab');
    expect(DEV.shipyard).toBe('upgraded-eng-complex-shipyard');
  });

  it('throws on an unknown development id', () => {
    expect(() => dev('no-such-card')).toThrow(/no-such-card/);
  });
});
