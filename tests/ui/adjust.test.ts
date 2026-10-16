import { describe, expect, it } from 'vitest';
import { adjustCommand, countsCommand, countsEdits, EMPTY_ADJUST, emptyCounts, sanitizeAdjust, sanitizeCounts } from '../../src/ui/lib/adjust';

describe('adjustCommand', () => {
  it('needs a change and a reason', () => {
    expect(adjustCommand(EMPTY_ADJUST)).toBeNull();
    expect(adjustCommand({ ...EMPTY_ADJUST, vp: 1 })).toBeNull();
  });

  it('builds an adjust command; only Correction skips Lobbyist', () => {
    const cmd = adjustCommand({ ...EMPTY_ADJUST, res: { ...EMPTY_ADJUST.res, isk: 3, pyrite: -1 }, vp: 1, reason: 'event' });
    expect(cmd).toStrictEqual({
      type: 'adjust',
      correction: false,
      reason: 'Event',
      delta: {
        res: { isk: 3, pyrite: -1 },
        vp: 1,
        systems: 0,
        homeCitadels: 0,
        lockedHomeBelts: 0,
        structures: {},
        belts: {},
        ships: {},
        central: null,
      },
    });
    expect(adjustCommand({ ...EMPTY_ADJUST, vp: -1, reason: 'correction' })).toMatchObject({ correction: true, reason: 'Correction' });
  });

  it('restores a stored draft', () => {
    expect(sanitizeAdjust({ ...EMPTY_ADJUST, vp: 2, reason: 'mission' })).toStrictEqual({ ...EMPTY_ADJUST, vp: 2, reason: 'mission' });
    expect(sanitizeAdjust({ res: { isk: 1.5 }, vp: 'x', reason: 'bribe' })).toStrictEqual(EMPTY_ADJUST);
  });
});

describe('countsCommand', () => {
  it('sends board count edits as one correction', () => {
    const d = emptyCounts();
    expect(countsCommand(d)).toBeNull();
    expect(countsEdits(d)).toBe(0);
    d.systems = 1;
    d.structures.citadel = 1;
    d.belts.mexallon = -1;
    d.ships.heretic = 2;
    d.central = true;
    expect(countsEdits(d)).toBe(5);
    expect(countsCommand(d)).toStrictEqual({
      type: 'adjust',
      correction: true,
      reason: 'Board counts',
      delta: {
        res: {},
        vp: 0,
        systems: 1,
        homeCitadels: 0,
        lockedHomeBelts: 0,
        structures: { citadel: 1 },
        belts: { mexallon: -1 },
        ships: { heretic: 2 },
        central: true,
      },
    });
  });

  it('restores stored count edits, ignoring unknown ships', () => {
    const d = emptyCounts();
    d.ships.heretic = 1;
    expect(sanitizeCounts({ ...d, ships: { heretic: 1, nope: 3 } })).toStrictEqual(d);
    expect(sanitizeCounts('x')).toBeNull();
  });
});
