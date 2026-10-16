import { describe, expect, it } from 'vitest';
import { bodyTapToggles } from '../../src/ui/lib/bodyTap';

/** A minimal stand-in for DOM nodes: `contains` by identity set, `closest` answering for one selector match. */
function node(insideControl: boolean) {
  return { closest: (sel: string) => (insideControl && sel.includes('button') ? {} : null) };
}
function host(children: unknown[]) {
  return { contains: (n: unknown) => children.includes(n) };
}

describe('bodyTapToggles', () => {
  it('toggles for a tap on the card text', () => {
    const text = node(false);
    expect(bodyTapToggles(host([text]), text)).toBe(true);
  });

  it('ignores taps on the card\'s own controls (prerequisite link, term chips)', () => {
    const chip = node(true);
    expect(bodyTapToggles(host([chip]), chip)).toBe(false);
  });

  it('ignores events from outside the card\'s DOM, e.g. a portalled term popover', () => {
    const popoverText = node(false);
    expect(bodyTapToggles(host([]), popoverText)).toBe(false);
  });

  it('treats a target without `closest` (a text node) inside the card as card text', () => {
    const textNode = {};
    expect(bodyTapToggles(host([textNode]), textNode)).toBe(true);
  });
});
