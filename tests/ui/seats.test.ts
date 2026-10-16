import { describe, expect, it } from 'vitest';
import type { FactionId } from '../../src/data/types';
import { hostFaction, pickOne, ringSlots, rotateToFirst, shuffled, swapSeats } from '../../src/ui/lib/seats';
import { newGame } from '../engine/helpers';

const SEATS: FactionId[] = ['amarr', 'caldari', 'gallente', 'minmatar'];

/** A fixed sequence of "random" numbers in [0, 1). */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

describe('swapSeats', () => {
  it('swaps two seated factions without touching the input', () => {
    const input = [...SEATS];
    expect(swapSeats(input, 'amarr', 'gallente')).toStrictEqual(['gallente', 'caldari', 'amarr', 'minmatar']);
    expect(input).toStrictEqual(SEATS);
  });

  it('returns an unchanged copy for the same seat or an unseated faction', () => {
    const three: FactionId[] = ['amarr', 'caldari', 'gallente'];
    expect(swapSeats(three, 'amarr', 'amarr')).toStrictEqual(three);
    expect(swapSeats(three, 'amarr', 'minmatar')).toStrictEqual(three);
    expect(swapSeats(three, 'amarr', 'amarr')).not.toBe(three);
  });
});

describe('rotateToFirst', () => {
  it('starts the clockwise order at the first player', () => {
    expect(rotateToFirst(SEATS, 'gallente')).toStrictEqual(['gallente', 'minmatar', 'amarr', 'caldari']);
    expect(rotateToFirst(SEATS, 'amarr')).toStrictEqual(SEATS);
  });

  it('leaves the order alone when that faction is not seated', () => {
    expect(rotateToFirst(['amarr', 'caldari'], 'minmatar')).toStrictEqual(['amarr', 'caldari']);
  });
});

describe('shuffled', () => {
  it('returns a permutation and leaves the input alone', () => {
    const input = [...SEATS];
    const out = shuffled(input, seq(0.9, 0.1, 0.5));
    expect([...out].sort()).toStrictEqual([...SEATS].sort());
    expect(input).toStrictEqual(SEATS);
  });

  it('is a Fisher-Yates shuffle driven by the random source', () => {
    // i=3: j=floor(0*4)=0 → swap 3,0; i=2: j=0 → swap 2,0; i=1: j=0 → swap 1,0
    expect(shuffled([1, 2, 3, 4], seq(0))).toStrictEqual([2, 3, 4, 1]);
    // j = i every time → nothing moves
    expect(shuffled([1, 2, 3, 4], seq(0.999))).toStrictEqual([1, 2, 3, 4]);
  });
});

describe('pickOne', () => {
  it('picks by the random source and clamps a source that returns 1', () => {
    expect(pickOne(SEATS, () => 0)).toBe('amarr');
    expect(pickOne(SEATS, () => 0.5)).toBe('gallente');
    expect(pickOne(SEATS, () => 1)).toBe('minmatar');
  });
});

describe('ringSlots', () => {
  it('places seats clockwise around a 3×3 table, starting at the top', () => {
    expect(ringSlots(1)).toStrictEqual([{ row: 1, col: 2 }]);
    expect(ringSlots(2)).toStrictEqual([
      { row: 1, col: 2 },
      { row: 3, col: 2 },
    ]);
    expect(ringSlots(3)).toStrictEqual([
      { row: 1, col: 2 },
      { row: 3, col: 3 },
      { row: 3, col: 1 },
    ]);
    expect(ringSlots(4)).toStrictEqual([
      { row: 1, col: 2 },
      { row: 2, col: 3 },
      { row: 3, col: 2 },
      { row: 2, col: 1 },
    ]);
  });
});

describe('hostFaction', () => {
  it('is the seat held by the device that created the game', () => {
    const t = newGame(['caldari', 'amarr']);
    expect(hostFaction(t.game)).toBe('caldari');
  });

  it('follows the creator when their seat moves to another device', () => {
    const t = newGame(['caldari', 'amarr']);
    t.asUid('uid-new', { type: 'takeOver', faction: 'caldari' });
    // The creator's device no longer holds a seat, so the oldest device still in the game is the host.
    expect(hostFaction(t.game)).toBe('amarr');
  });
});
