/**
 * The privacy curtain over my private development area (research #8). Phones lie face-up on the table, so card
 * names stay hidden by default: the eye reveals them for 20 s, press-and-hold peeks only while held, and the page
 * going to the background (screen lock, app switch) hides everything at once. Pure state machine; the component
 * feeds it the clock.
 */

/** How long a tap on the eye reveals the names. */
export const CURTAIN_MS = 20_000;

export type Curtain = { mode: 'hidden' } | { mode: 'shown'; until: number } | { mode: 'peek' };

export type CurtainEvent =
  /** The eye, or a second tap on it while shown: (re)start the timed reveal. */
  | { type: 'reveal'; now: number }
  /** The eye while shown: hide at once. */
  | { type: 'hide' }
  /** Press-and-hold on the card backs. */
  | { type: 'holdStart' }
  | { type: 'holdEnd' }
  | { type: 'tick'; now: number }
  /** `visibilitychange` to hidden. */
  | { type: 'pageHidden' };

export const HIDDEN: Curtain = { mode: 'hidden' };

export function curtain(s: Curtain, e: CurtainEvent, ms = CURTAIN_MS): Curtain {
  switch (e.type) {
    case 'reveal':
      return { mode: 'shown', until: e.now + ms };
    case 'hide':
    case 'pageHidden':
      return s.mode === 'hidden' ? s : HIDDEN;
    case 'holdStart':
      return s.mode === 'hidden' ? { mode: 'peek' } : s;
    case 'holdEnd':
      return s.mode === 'peek' ? HIDDEN : s;
    case 'tick':
      return s.mode === 'shown' && e.now >= s.until ? HIDDEN : s;
  }
}

export function isRevealed(s: Curtain): boolean {
  return s.mode !== 'hidden';
}

/**
 * Whether the revealed names may be selected and long-pressed: only during a timed reveal. While peeking the
 * finger is down, and the phone's own long-press (selection, callout, context menu) would cancel the hold and hide
 * the names again, so it stays suppressed.
 */
export function allowsSelection(s: Curtain): boolean {
  return s.mode === 'shown';
}

/** Whole seconds until a timed reveal hides (rounded up); null unless timed. */
export function secondsLeft(s: Curtain, now: number): number | null {
  return s.mode === 'shown' ? Math.max(0, Math.ceil((s.until - now) / 1000)) : null;
}
