import { describe, expect, it } from 'vitest';
import { allowsSelection, curtain, CURTAIN_MS, HIDDEN, isRevealed, secondsLeft, type Curtain } from '../../src/ui/lib/curtain';

const T = 1_000_000;

describe('privacy curtain', () => {
  it('starts hidden and reveals for 20 s from the eye', () => {
    expect(isRevealed(HIDDEN)).toBe(false);
    const s = curtain(HIDDEN, { type: 'reveal', now: T });
    expect(s).toStrictEqual({ mode: 'shown', until: T + CURTAIN_MS });
    expect(CURTAIN_MS).toBe(20_000);
    expect(isRevealed(s)).toBe(true);
  });

  it('hides itself once the time is up, not before', () => {
    const s = curtain(HIDDEN, { type: 'reveal', now: T });
    expect(curtain(s, { type: 'tick', now: T + CURTAIN_MS - 1 })).toBe(s);
    expect(curtain(s, { type: 'tick', now: T + CURTAIN_MS })).toStrictEqual(HIDDEN);
  });

  it('counts the seconds left, rounding up', () => {
    const s = curtain(HIDDEN, { type: 'reveal', now: T });
    expect(secondsLeft(s, T)).toBe(20);
    expect(secondsLeft(s, T + 500)).toBe(20);
    expect(secondsLeft(s, T + 19_001)).toBe(1);
    expect(secondsLeft(s, T + 25_000)).toBe(0);
    expect(secondsLeft(HIDDEN, T)).toBeNull();
    expect(secondsLeft({ mode: 'peek' }, T)).toBeNull();
  });

  it('a second reveal restarts the 20 s', () => {
    const s = curtain(HIDDEN, { type: 'reveal', now: T });
    expect(curtain(s, { type: 'reveal', now: T + 5_000 })).toStrictEqual({ mode: 'shown', until: T + 5_000 + CURTAIN_MS });
  });

  it('the eye hides at once', () => {
    const s = curtain(HIDDEN, { type: 'reveal', now: T });
    expect(curtain(s, { type: 'hide' })).toStrictEqual(HIDDEN);
  });

  it('press-and-hold peeks only while held', () => {
    const peek = curtain(HIDDEN, { type: 'holdStart' });
    expect(peek).toStrictEqual({ mode: 'peek' });
    expect(isRevealed(peek)).toBe(true);
    expect(curtain(peek, { type: 'tick', now: T + 60_000 })).toBe(peek); // no timeout while the finger is down
    expect(curtain(peek, { type: 'holdEnd' })).toStrictEqual(HIDDEN);
  });

  it('holding while already shown keeps the timed reveal', () => {
    const s = curtain(HIDDEN, { type: 'reveal', now: T });
    expect(curtain(s, { type: 'holdStart' })).toBe(s);
    expect(curtain(s, { type: 'holdEnd' })).toBe(s);
  });

  it('a page that goes to the background hides everything', () => {
    const states: Curtain[] = [HIDDEN, { mode: 'peek' }, curtain(HIDDEN, { type: 'reveal', now: T })];
    for (const s of states) expect(curtain(s, { type: 'pageHidden' })).toStrictEqual(HIDDEN);
  });

  it('keeps the long-press guard while peeking; only a timed reveal allows selecting text', () => {
    // On a phone the OS long-press (selection, callout, context menu) fires after the peek starts and would cancel the
    // hold, hiding the names again.
    expect(allowsSelection(HIDDEN)).toBe(false);
    expect(allowsSelection({ mode: 'peek' })).toBe(false);
    expect(allowsSelection(curtain(HIDDEN, { type: 'reveal', now: T }))).toBe(true);
  });

  it('honours a custom duration', () => {
    expect(curtain(HIDDEN, { type: 'reveal', now: T }, 5_000)).toStrictEqual({ mode: 'shown', until: T + 5_000 });
  });
});
