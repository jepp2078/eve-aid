/**
 * Lifetime of the combat stage drafts (fleet assignment, start choices, dice pads, re-aligns, dismissed loss prompts):
 * they stay through Confirm / Ready / Resolve, so an Undo of any of them brings the player's placements, choices or
 * dice taps back. Dice pads go while the next combat is being set up, and every stage draft once no combat is running
 * (finished or cancelled; also on a later visit, after a reload): `staleCombatDrafts`. The Start combat draft is not
 * touched: its sheet resets it.
 */
import { useEffect } from 'react';
import { useMe } from '../../hooks';
import { staleCombatDrafts } from '../../lib/combat';
import { draftKey, forgetDrafts } from '../../lib/drafts';

/** Mounted once by TabShell. */
export function useCombatDraftCleanup(): void {
  const { code, faction, game } = useMe();
  const stale = game === null ? '' : staleCombatDrafts(game).join(' ');
  useEffect(() => {
    if (stale === '' || code === null || faction === null) return;
    for (const prefix of stale.split(' ')) forgetDrafts(draftKey(code, faction, prefix));
  }, [stale, code, faction]);
}
