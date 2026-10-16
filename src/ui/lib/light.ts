/**
 * The light game's record sheets: VP gained from a card, a discovery or anything else (an `adjust` of VP only that
 * pays Lobbyist), a system claimed on the board (`lightClaim`, no action) and research tokens gained (`gainResearch`,
 * placed right after by the existing overlay). Their drafts, the sanitisers that restore them, and when a claim can be
 * recorded. Also the light upkeep: the board steps to tick, and the draft behind `lightUpkeep`.
 */
import { DEV } from '../../data/developments';
import { ISK_CAP, MINERAL_CAP } from '../../data/costs';
import { FACTION_INFO } from '../../data/factions';
import { FACTIONS, type FactionId } from '../../data/types';
import { MAX_GAINED_RESEARCH } from '../../engine/light';
import type { Command, GameState, PlayerPublic } from '../../engine/types';
import { baseDelta } from './adjust';
import type { Allowed } from './devs';
import { isRecord } from './drafts';
import { factionName } from './labels';

export { MAX_GAINED_RESEARCH };

const isFaction = (x: unknown): x is FactionId => typeof x === 'string' && (FACTIONS as string[]).includes(x);
const between = (x: unknown, min: number, max: number): x is number => typeof x === 'number' && Number.isInteger(x) && x >= min && x <= max;

/* ------------------------------------------------------------------ Gained VP */

export type VpReason = 'card' | 'discovery' | 'other';

/** The reason chips, and the reason the log shows ("Amarr adjusted: VP +2 (Card effect)"). */
export const VP_REASONS: { id: VpReason; label: string; reason: string }[] = [
  { id: 'card', label: 'Card', reason: 'Card effect' },
  { id: 'discovery', label: 'Discovery', reason: 'Discovery' },
  { id: 'other', label: 'Other', reason: 'Other' },
];

/** The most VP one record takes (the stepper's limit). */
export const MAX_GAINED_VP = 9;

export interface GainVpDraft {
  vp: number;
  reason: VpReason;
}

export const NEW_GAIN_VP: GainVpDraft = { vp: 1, reason: 'card' };

/** VP only, not a correction: Lobbyist and the Verge of Ascendancy apply as for any VP gained. */
export function gainVpCommand(d: GainVpDraft): Command {
  const delta = baseDelta();
  delta.vp = d.vp;
  return { type: 'adjust', delta, correction: false, reason: VP_REASONS.find((r) => r.id === d.reason)!.reason };
}

export function sanitizeGainVp(raw: unknown): GainVpDraft | null {
  if (!isRecord(raw) || !between(raw.vp, 1, MAX_GAINED_VP)) return null;
  const reason = VP_REASONS.find((r) => r.id === raw.reason)?.id;
  return reason === undefined ? null : { vp: raw.vp, reason };
}

/* ------------------------------------------------------------------ Claimed a system */

export interface LightClaimDraft {
  /** The rival the system was taken from; null for an unclaimed system. */
  from: FactionId | null;
  central: boolean;
}

export const NEW_LIGHT_CLAIM: LightClaimDraft = { from: null, central: false };

export function lightClaimCommand(d: LightClaimDraft): Command {
  return { type: 'lightClaim', from: d.from, central: d.central };
}

export function sanitizeLightClaim(raw: unknown): LightClaimDraft | null {
  if (!isRecord(raw) || (raw.from !== null && !isFaction(raw.from)) || typeof raw.central !== 'boolean') return null;
  return { from: raw.from, central: raw.central };
}

/**
 * A claim is recorded on my turn in the action phase (engine `wrong_phase` / `not_your_turn`). Once I have passed, my turn
 * won't come back this round, so a system I forgot to record goes in through Adjust.
 */
export function canLightClaim(game: GameState, faction: FactionId): Allowed {
  if (game.phase === 'ended') return { ok: false, reason: 'The game is over' };
  if (game.phase !== 'actions' || game.turn === null) return { ok: false, reason: 'Claim systems on your turn in the action phase' };
  if (game.players[faction]?.passed === true) return { ok: false, reason: 'You passed this round: fix your systems with Adjust' };
  if (game.turn.faction !== faction) return { ok: false, reason: `Not your turn: claim it on your turn (${factionName(game.turn.faction)} is playing)` };
  return { ok: true };
}

/** A reason's words before its colon ("Not your turn", "You passed this round"): a dimmed button's subline, whose tap toasts the whole reason. */
export function briefReason(reason: string): string {
  const i = reason.indexOf(':');
  return i < 0 ? reason : reason.slice(0, i);
}

/* ------------------------------------------------------------------ Gained research */

export interface ResearchTokensDraft {
  research: number;
}

export const NEW_RESEARCH_TOKENS: ResearchTokensDraft = { research: 1 };

export function researchTokensCommand(d: ResearchTokensDraft): Command {
  return { type: 'gainResearch', research: d.research };
}

export function sanitizeResearchTokens(raw: unknown): ResearchTokensDraft | null {
  return isRecord(raw) && between(raw.research, 1, MAX_GAINED_RESEARCH) ? { research: raw.research } : null;
}

/* ------------------------------------------------------------------ Light upkeep */

/** What everyone does on the board during a light upkeep, ticked on the phone as they go (spec 5). */
export const BOARD_STEPS: readonly string[] = [
  'Return your action cubes to the pool and remove Fleet Exhausted tokens',
  `Mine 1 mineral per asteroid belt in systems you control (a double belt gives 2); keep at most ${MINERAL_CAP} (morphite counts)`,
  'Each refinery gives 1 material shown in its system, your choice (Upgraded Refinery: all of them, or a component from a moon and a planetary)',
  `Collect your ISK income (${ISK_CAP} at most)`,
];

/** The research every faction gains in upkeep before its engineering complexes (the board counts those). */
export const BASE_RESEARCH = Math.min(...FACTIONS.map((f) => FACTION_INFO[f].research));

export interface LightUpkeepDraft {
  /** The round it was made for: a new upkeep starts over. */
  round: number;
  research: number;
  researchLab: boolean;
  /** The rivals whose raids succeeded at the table. */
  raids: FactionId[];
  largeShip: boolean;
  /** The ticked `BOARD_STEPS` (indexes); they stay on this phone and are never sent. */
  ticks: number[];
}

/** The base research, no Research Lab card, no raid, no large ship, nothing ticked. */
export function defaultLightUpkeep(round: number): LightUpkeepDraft {
  return { round, research: BASE_RESEARCH, researchLab: false, raids: [], largeShip: false, ticks: [] };
}

/** Which upkeep cards I hold: completed Research Lab (its engineering complex is my word) and Fleet Supremacy. */
export function lightUpkeepCan(p: PlayerPublic): { lab: boolean; supremacy: boolean } {
  return { lab: p.completed.includes(DEV.researchLab), supremacy: p.completed.includes(DEV.fleetSupremacy) };
}

/** The `lightUpkeep` command; a Research Lab card or a large ship without its card is left out, and the ticks stay here. */
export function lightUpkeepCommand(d: LightUpkeepDraft, can: { lab: boolean; supremacy: boolean }): Command {
  return { type: 'lightUpkeep', research: d.research, researchLab: can.lab && d.researchLab, raids: [...d.raids], largeShip: can.supremacy && d.largeShip };
}

const distinct = (xs: unknown[]): boolean => new Set(xs).size === xs.length;

/** A stored draft of `round`'s upkeep when well-formed; null otherwise, and for another round's draft. */
export function sanitizeLightUpkeep(raw: unknown, round: number): LightUpkeepDraft | null {
  if (!isRecord(raw) || raw.round !== round || !between(raw.research, 0, MAX_GAINED_RESEARCH)) return null;
  if (typeof raw.researchLab !== 'boolean' || typeof raw.largeShip !== 'boolean') return null;
  const { raids, ticks } = raw;
  if (!Array.isArray(raids) || !raids.every(isFaction) || !distinct(raids)) return null;
  if (!Array.isArray(ticks) || !ticks.every((i) => between(i, 0, BOARD_STEPS.length - 1)) || !distinct(ticks)) return null;
  return { round, research: raw.research, researchLab: raw.researchLab, raids: [...raids], largeShip: raw.largeShip, ticks: [...ticks] };
}
