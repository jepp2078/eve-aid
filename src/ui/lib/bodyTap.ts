/**
 * Whether a tap that reached a card's body should toggle the card. React events bubble through portals to their
 * React ancestors, so a tap inside a portalled term popover still reaches the card's onClick although the popover is
 * not inside the card in the DOM. Only taps inside the card's own DOM count, and not on one of its own controls.
 */
const CONTROLS = 'button, a, input, select, textarea';

export interface TapHost {
  contains(node: unknown): boolean;
}

export function bodyTapToggles(host: TapHost, target: unknown): boolean {
  if (!host.contains(target)) return false;
  const el = target as { closest?: (selector: string) => unknown };
  return typeof el.closest !== 'function' || el.closest(CONTROLS) === null;
}
