import { describe, expect, it } from 'vitest';
import { dicePool, type DicePool } from '../../src/engine/combat/abilities';
import { resolveRoll } from '../../src/engine/combat/attack';
import {
  addExtra,
  clearPad,
  EMPTY_PAD,
  entered,
  faceMax,
  PAD_FACES,
  padColours,
  padDice,
  padIssue,
  padLimits,
  padMeter,
  padSummary,
  resolveLabel,
  rollWords,
  rollDraftName,
  sanitizePad,
  setFace,
  STRIP_MAX,
  tapFace,
  undoTap,
  type PadDraft,
} from '../../src/ui/lib/dicePad';
import { combatKey } from '../../src/ui/lib/combat';
import { battle, lead, losePanther, NO_ADJUST, noRetreat, sup } from '../engine/combat/fixtures';

const pool = (p: Partial<DicePool>): DicePool => ({ total: 0, white: 0, black: 0, choice: 0, parts: [], ...p });
const SMALL5 = pool({ total: 5, white: 5 });
const MEDIUM5 = pool({ total: 5, white: 2, black: 2, choice: 1 });
const LARGE3 = pool({ total: 3, black: 3 });
const NONE = { white: 0, black: 0 };

/** Taps faces in order; ignores taps the limits refuse (like the pad). */
function tapAll(d: PadDraft, p: DicePool, taps: [('white' | 'black'), string][]): PadDraft {
  return taps.reduce((acc, [die, face]) => tapFace(acc, padLimits(p, acc.extra), die, face as never), d);
}

describe('the faces on the pad', () => {
  it('shows only the faces of the orbit’s dice, in the printed order', () => {
    expect(PAD_FACES.white).toStrictEqual(['aim', 'aim2', 'damage', 'crit']);
    expect(PAD_FACES.black).toStrictEqual(['aim', 'aimDamage', 'damage', 'damage2', 'crit']);
    expect(padColours('small')).toStrictEqual(['white']);
    expect(padColours('medium')).toStrictEqual(['white', 'black']);
    expect(padColours('large')).toStrictEqual(['black']);
  });
});

describe('per-colour limits', () => {
  it('counts the pool’s dice of each colour, the choice die for either, and the extra dice', () => {
    expect(padLimits(SMALL5, NONE)).toStrictEqual({ white: 5, black: 0, total: 5 });
    expect(padLimits(MEDIUM5, NONE)).toStrictEqual({ white: 3, black: 3, total: 5 });
    expect(padLimits(LARGE3, { white: 0, black: 2 })).toStrictEqual({ white: 0, black: 5, total: 5 });
    expect(padLimits(MEDIUM5, { white: 1, black: 0 })).toStrictEqual({ white: 4, black: 3, total: 6 });
  });

  it('a tap adds one die until that colour or the whole pool is full', () => {
    let d = tapAll(EMPTY_PAD, SMALL5, [['white', 'aim'], ['white', 'aim'], ['white', 'aim2']]);
    expect(d.counts.white).toStrictEqual({ aim: 2, aim2: 1 });
    expect(entered(d.counts)).toStrictEqual({ white: 3, black: 0, total: 3 });
    d = tapAll(d, SMALL5, [['white', 'crit'], ['white', 'damage'], ['white', 'damage'], ['black', 'aim']]);
    // The 6th white die and any black die are refused: the pool has 5 white dice.
    expect(entered(d.counts)).toStrictEqual({ white: 5, black: 0, total: 5 });
    expect(d.counts.white).toStrictEqual({ aim: 2, aim2: 1, crit: 1, damage: 1 });
  });

  it('the medium orbit’s choice die goes to whichever colour takes it first', () => {
    const d = tapAll(EMPTY_PAD, MEDIUM5, [
      ['white', 'aim'], ['white', 'aim'], ['white', 'aim'], // 2 white + the choice die
      ['white', 'aim'], // refused: no 4th white die
      ['black', 'damage'], ['black', 'damage'],
      ['black', 'damage'], // refused: the choice die is taken
    ]);
    expect(entered(d.counts)).toStrictEqual({ white: 3, black: 2, total: 5 });
  });

  it('faceMax is the largest count a face may be set to (the 0–10 strip)', () => {
    const d = tapAll(EMPTY_PAD, MEDIUM5, [['white', 'aim'], ['black', 'damage']]);
    const lim = padLimits(MEDIUM5, NONE);
    // white: 3 max, 1 white entered, total 5 with 2 entered → aim can go to 1 + min(2, 3) = 3
    expect(faceMax(d.counts, lim, 'white', 'aim')).toBe(3);
    expect(faceMax(d.counts, lim, 'white', 'crit')).toBe(2);
    expect(faceMax(d.counts, lim, 'black', 'damage')).toBe(3);
    expect(faceMax(EMPTY_PAD.counts, padLimits(pool({ total: 10, white: 10 }), { white: 3, black: 0 }), 'white', 'aim')).toBe(STRIP_MAX);
  });

  it('setFace sets a count within its limit; 0 removes the face', () => {
    const lim = padLimits(SMALL5, NONE);
    let d = setFace(EMPTY_PAD, lim, 'white', 'aim', 4);
    expect(d.counts.white).toStrictEqual({ aim: 4 });
    d = setFace(d, lim, 'white', 'crit', 9);
    expect(d.counts.white).toStrictEqual({ aim: 4, crit: 1 });
    d = setFace(d, lim, 'white', 'aim', 0);
    expect(d.counts.white).toStrictEqual({ crit: 1 });
    expect(setFace(d, lim, 'white', 'crit', 1)).toBe(d);
  });
});

describe('undo last tap and clear', () => {
  it('undoes the pad changes one by one, including Clear', () => {
    const lim = padLimits(SMALL5, NONE);
    let d = tapFace(EMPTY_PAD, lim, 'white', 'aim');
    d = tapFace(d, lim, 'white', 'aim');
    d = setFace(d, lim, 'white', 'crit', 2);
    d = clearPad(d);
    expect(entered(d.counts).total).toBe(0);
    d = undoTap(d);
    expect(d.counts.white).toStrictEqual({ aim: 2, crit: 2 });
    d = undoTap(d);
    expect(d.counts.white).toStrictEqual({ aim: 2 });
    d = undoTap(undoTap(d));
    expect(d.counts.white).toStrictEqual({});
    expect(undoTap(d)).toBe(d);
    expect(clearPad(d)).toBe(d);
  });

  it('a refused tap leaves no history', () => {
    const d = tapFace(EMPTY_PAD, padLimits(SMALL5, NONE), 'black', 'aim');
    expect(d).toBe(EMPTY_PAD);
  });
});

describe('extra dice', () => {
  it('“+1 die” grows that colour’s limit; removing it may leave too many dice entered', () => {
    let d = addExtra(EMPTY_PAD, 'white', 1);
    expect(d.extra).toStrictEqual({ white: 1, black: 0 });
    d = tapAll(d, SMALL5, Array.from({ length: 6 }, () => ['white', 'aim'] as ['white', string]));
    expect(entered(d.counts).white).toBe(6);
    expect(padMeter(d.counts, padLimits(SMALL5, d.extra)).text).toBe('6 of 6 dice entered · 0 blank');
    d = addExtra(d, 'white', -1);
    expect(d.extra.white).toBe(0);
    expect(padIssue(d.counts, padLimits(SMALL5, d.extra))).toBe('6 dice entered, but the pool has 5: remove 1');
    expect(addExtra(d, 'white', -1)).toBe(d);
  });
});

describe('meter, label and issues', () => {
  it('counts the blanks the player did not have to tap', () => {
    const d = tapAll(EMPTY_PAD, pool({ total: 8, white: 8 }), [['white', 'aim'], ['white', 'aim'], ['white', 'aim2'], ['white', 'crit'], ['white', 'damage'], ['white', 'damage']]);
    const m = padMeter(d.counts, padLimits(pool({ total: 8, white: 8 }), NONE));
    expect(m).toStrictEqual({ entered: 6, total: 8, blank: 2, text: '6 of 8 dice entered · 2 blank' });
    expect(resolveLabel(m.blank)).toBe('Resolve (2 blank)');
    expect(resolveLabel(1)).toBe('Resolve (1 blank)');
    expect(resolveLabel(0)).toBe('Resolve (no blanks)');
  });

  it('flags a colour over its limit after a live change', () => {
    const counts = { white: { aim: 4 }, black: {} };
    expect(padIssue(counts, padLimits(MEDIUM5, NONE))).toBe('4 white dice entered, but the pool has 3: remove 1');
    expect(padIssue({ white: { aim: 3 }, black: { damage: 3 } }, padLimits(MEDIUM5, NONE))).toBe('6 dice entered, but the pool has 5: remove 1');
    expect(padIssue({ white: { aim: 3 }, black: { damage: 2 } }, padLimits(MEDIUM5, NONE))).toBeNull();
  });

  it('sums the pad up in one line for the single live region: the meter and the verdict, or the problem', () => {
    const m = padMeter({ white: { aim: 2 }, black: {} }, padLimits(SMALL5, NONE));
    expect(padSummary(m, null, null)).toBe('2 of 5 dice entered · 3 blank');
    expect(padSummary(m, null, 'LOCKED · 1 DAMAGE')).toBe('2 of 5 dice entered · 3 blank. LOCKED · 1 DAMAGE');
    expect(padSummary(m, '6 dice entered, but the pool has 5: remove 1', 'LOCKED')).toBe('Too many dice: 6 dice entered, but the pool has 5: remove 1');
  });
});

describe('rollWords', () => {
  it('says which dice to roll, the die of either colour and the extra dice', () => {
    expect(rollWords(SMALL5, NONE)).toBe('5 white');
    expect(rollWords(MEDIUM5, NONE)).toBe('2 white, 2 black (+1 of your choice)');
    expect(rollWords(LARGE3, { white: 0, black: 1 })).toBe('4 black (1 extra)');
    expect(rollWords(MEDIUM5, { white: 1, black: 1 })).toBe('3 white, 3 black (+1 of your choice, 2 extra)');
    expect(rollWords(pool({ total: 1, choice: 1 }), NONE)).toBe('1 of your choice');
    expect(rollWords(pool({ total: 1, choice: 1 }), { white: 1, black: 0 })).toBe('1 white (+1 of your choice, 1 extra)');
    expect(rollWords(pool({}), NONE)).toBe('no dice');
  });
});

describe('padDice', () => {
  it('builds the full DiceEntry the engine takes (blank faces left at 0)', () => {
    expect(padDice({ white: { aim: 2, crit: 1 }, black: { damage2: 1 } })).toStrictEqual({
      white: { blank: 0, aim: 2, aim2: 0, damage: 0, crit: 1 },
      black: { blank: 0, aim: 0, aimDamage: 0, damage: 0, damage2: 1, crit: 0 },
    });
  });

  it('is what resolveRoll needs for a live tally', () => {
    const b = battle([lead('zealot')], [lead('cerberus')], { attacker: { tiers: [] } });
    noRetreat(b);
    const c = b.c();
    const target = b.uid('defender', 'cerberus');
    const r = resolveRoll(b.t.game, c, 'attacker', 'medium', target, padDice({ white: { aim2: 1 }, black: { aimDamage: 1, damage2: 1 } }), NO_ADJUST);
    expect([r.aims, r.damage, r.locked, r.dealt]).toStrictEqual([3, 3, true, 1]);
    expect(dicePool(b.t.game, c, 'attacker', 'medium').total).toBe(5);
  });
});

describe('sanitizePad', () => {
  it('keeps valid faces and whole counts, drops the rest', () => {
    const raw = {
      counts: { white: { aim: 2, aimDamage: 1, crit: -1, damage: 1.5 }, black: { damage2: 1, aim2: 3 } },
      extra: { white: 1, black: 'x' },
      adjust: { aim: -1, damage: 2, crit: 0.5 },
      history: [{ white: { aim: 1 }, black: {} }, 'junk'],
    };
    expect(sanitizePad(raw)).toStrictEqual({
      counts: { white: { aim: 2 }, black: { damage2: 1 } },
      extra: { white: 1, black: 0 },
      adjust: { aim: -1, damage: 2, crit: 0 },
      history: [{ white: { aim: 1 }, black: {} }],
    });
    expect(sanitizePad(null)).toBeNull();
    expect(sanitizePad({})).toStrictEqual(EMPTY_PAD);
  });
});

describe('rollDraftName', () => {
  it('names the attack: attacker, defender, round, step and target; null without a target', () => {
    const b = battle([lead('heretic'), sup('anathema', 'small')], [lead('crow'), sup('buzzard', 'small')]);
    expect(rollDraftName(b.c())).toBeNull();
    noRetreat(b);
    expect(rollDraftName(b.c())).toBeNull();
    const crow = b.uid('defender', 'crow');
    b.t.dispatch('amarr', { type: 'combatTarget', target: crow });
    const name = rollDraftName(b.c());
    expect(name).toBe(`combat-roll:amarr-caldari:r1:small-attacker:${crow}`);
    b.t.dispatch('amarr', { type: 'combatTarget', target: b.uid('defender', 'buzzard') });
    expect(rollDraftName(b.c())).not.toBe(name);
  });

  it('keeps the name when ships join mid-attack (the attacker keeps their taps)', () => {
    const b = battle([lead('heretic'), sup('anathema', 'small')], [lead('crow'), sup('buzzard', 'small')]);
    noRetreat(b);
    b.t.dispatch('amarr', { type: 'combatTarget', target: b.uid('defender', 'crow') });
    const name = rollDraftName(b.c());
    const key = combatKey(b.c());
    losePanther(b, 'defender');
    losePanther(b, 'attacker');
    b.t.dispatch('caldari', { type: 'combatAddShips', ships: ['buzzard'], orbit: 'small' });
    b.t.dispatch('amarr', { type: 'combatAddShips', ships: ['anathema'], orbit: 'small' });
    expect(combatKey(b.c())).not.toBe(key); // the fleets did change
    expect(rollDraftName(b.c())).toBe(name);
  });
});
