import { describe, expect, it } from 'vitest';
import { DEV } from '../../src/data/developments';
import {
  buildHead,
  buildItems,
  bpUsed,
  costLines,
  EMPTY_BUILD,
  sanitizeBuild,
  shipOptions,
  structureCost,
  structuresLeft,
  type BuildDraft,
} from '../../src/ui/lib/build';
import { startedGame } from '../engine/helpers';

describe('shipOptions', () => {
  it('lists my faction ships affordable first, then short ones, then locked or sold out', () => {
    const t = startedGame(['amarr', 'caldari']);
    const me = t.p('amarr');
    Object.assign(me.res, { isk: 6, tritanium: 1, planetary: 1, moon: 1, mexallon: 1 });
    me.ships.heretic = 5; // all models on the board
    const opts = shipOptions(me, 6, 0);
    expect(opts.map((o) => o.ship.id)).toStrictEqual([
      'anathema', 'malediction', // affordable smalls
      'heretic', // sold out
      'absolution', 'curse', 'zealot', // medium: hull locked
      'paladin', 'redeemer', // large: hull locked
    ]);
    expect(opts[0]).toMatchObject({ affordable: true, owned: 1, left: 4, locked: null, short: [] });
    expect(opts[2]).toMatchObject({ affordable: false, left: 0, locked: 'All 5 on the board' });
    expect(opts[3]).toMatchObject({ affordable: false, locked: 'Needs Medium Hull' });
  });

  it('names the shortfall, counting the cube price', () => {
    const t = startedGame(['amarr', 'caldari']);
    const me = t.p('amarr');
    me.completed.push(DEV.mediumHull);
    Object.assign(me.res, { isk: 6, tritanium: 0, planetary: 1, moon: 0, mexallon: 1 });
    const opts = shipOptions(me, 6, 5);
    const zealot = opts.find((o) => o.ship.id === 'zealot')!;
    expect(zealot).toMatchObject({ affordable: false, locked: null, short: ['+5 ISK', '+1 Moon'] });
    const anathema = opts.find((o) => o.ship.id === 'anathema')!;
    expect(anathema.short).toStrictEqual(['+3 ISK', '+1 Tritanium']);
    // unaffordable but buildable ships come before locked ones; small before medium
    expect(opts.map((o) => o.ship.id).slice(0, 6)).toStrictEqual(['anathema', 'heretic', 'malediction', 'absolution', 'curse', 'zealot']);
  });
});

describe('structureCost', () => {
  it('shows how slot discounts and Materials Efficiency change the price', () => {
    expect(structureCost({ structure: 'engineering', home: false, discount: { bp: 0, isk: 0, pyrite: false } }, { materialsEfficiency: false })).toStrictEqual({
      bp: 5,
      isk: 6,
      pyrite: 1,
      lines: ['BP 5', 'ISK 6', 'Pyrite 1'],
    });
    expect(structureCost({ structure: 'citadel', home: true, discount: { bp: 2, isk: 1, pyrite: true } }, { materialsEfficiency: true })).toStrictEqual({
      bp: 3,
      isk: 3,
      pyrite: 0,
      lines: ['BP 5 − 2 slot = 3', 'ISK 5 − 1 slot − 1 Materials Efficiency = 3', 'Pyrite waived by the slot'],
    });
    expect(structureCost({ structure: 'refinery', home: false, discount: { bp: 0, isk: 9, pyrite: false } }, { materialsEfficiency: false, ignoreBp: true })).toStrictEqual({
      bp: 0,
      isk: 0,
      pyrite: 1,
      lines: ['No BP (Deployable Infrastructure)', 'ISK 4 − 9 slot = 0', 'Pyrite 1'],
    });
  });

  it('counts the models left of a structure type across all players', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').structures.citadel = 4;
    t.p('caldari').structures.citadel = 3;
    expect(structuresLeft(t.game, 'citadel')).toBe(6);
    expect(structuresLeft(t.game, 'refinery')).toBe(13);
  });
});

describe('build drafts', () => {
  const draft: BuildDraft = {
    ships: { heretic: 3, zealot: 0 },
    structures: [{ structure: 'citadel', home: true, discount: { bp: 0, isk: 0, pyrite: false } }],
    belts: ['pyrite'],
  };

  it('expands into build items and adds up build points', () => {
    expect(buildItems(draft)).toStrictEqual([
      { kind: 'ship', ship: 'heretic' },
      { kind: 'ship', ship: 'heretic' },
      { kind: 'ship', ship: 'heretic' },
      { kind: 'structure', structure: 'citadel', home: true, discount: { bp: 0, isk: 0, pyrite: false } },
      { kind: 'unlockBelt', mineral: 'pyrite' },
    ]);
    expect(bpUsed(draft)).toBe(3 + 5 + 4);
    expect(buildItems(EMPTY_BUILD)).toStrictEqual([]);
  });

  it('names the build for the Confirm button', () => {
    expect(buildHead(EMPTY_BUILD)).toBe('Build');
    expect(buildHead({ ...EMPTY_BUILD, ships: { heretic: 1 } })).toBe('Build Heretic');
    expect(buildHead({ ...EMPTY_BUILD, ships: { heretic: 2, anathema: 1 } })).toBe('Build 3 ships');
    expect(buildHead(draft)).toBe('Build 3 ships + Citadel + belt');
    expect(buildHead({ ...EMPTY_BUILD, belts: ['mexallon'] })).toBe('Unlock mexallon belt');
  });

  it('breaks the cost down line by line, with Mass Production', () => {
    const t = startedGame(['amarr', 'caldari']);
    const me = t.p('amarr');
    me.completed.push(DEV.massProduction, DEV.materialsEfficiency);
    expect(costLines(me, draft, 3)).toStrictEqual([
      'Heretic ×3: BP 3 · ISK 4 + 2 + 2 = 8 (Mass Production) · Tritanium 3',
      'Citadel at home: BP 5 · ISK 5 − 1 Materials Efficiency = 4 · Pyrite 1',
      'Unlock pyrite belt: BP 4 · ISK 5',
      'Cube 4: ISK 5',
      'Total: BP 12/6 · ISK 22',
    ]);
  });

  it('restores stored drafts and drops anything malformed', () => {
    expect(sanitizeBuild(draft)).toStrictEqual({ ...draft, ships: { heretic: 3 } }); // zero counts are dropped
    expect(sanitizeBuild({ ships: { heretic: -1, nope: 2 }, structures: [{ structure: 'castle' }], belts: ['gold'] })).toStrictEqual(EMPTY_BUILD);
    expect(sanitizeBuild(42)).toBeNull();
  });

  it('keeps any number of structures in a draft (only BP and supply limit a build)', () => {
    const five = Array.from({ length: 5 }, () => ({ structure: 'customs', home: false, discount: { bp: 0, isk: 0, pyrite: false } }));
    expect(sanitizeBuild({ ships: {}, structures: five, belts: [] })?.structures).toHaveLength(5);
  });
});
