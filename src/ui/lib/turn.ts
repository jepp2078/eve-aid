/**
 * What the turn strip says: whose turn it is and what the game is waiting on. A light game takes no actions (the play
 * is on the board), so its turn reads "End turn or pass" on your device and just names the player on everyone else's.
 */
import type { FactionId } from '../../data/types';
import type { GameState } from '../../engine/types';
import { ACTION_LABEL, andList, factionName } from './labels';

export interface TurnStatus {
  /** `mine`: this device's turn; `other`: someone else's; `upkeep`/`ended`: no active player; `idle`: before round 1. */
  kind: 'mine' | 'other' | 'upkeep' | 'ended' | 'idle';
  /** The active player, when there is one. */
  faction: FactionId | null;
  title: string;
  detail: string;
  round: number;
}

export function turnStatus(game: GameState, me: FactionId | null): TurnStatus {
  const round = game.round;
  if (game.phase === 'ended') {
    const winners = (game.result?.winners ?? []).map(factionName);
    const detail = winners.length === 0 ? 'Final scores on Table' : winners.length === 1 ? `${winners[0]} wins` : `${andList(winners)} share the win`;
    return { kind: 'ended', faction: null, title: 'Game over', detail, round };
  }
  if (game.phase === 'upkeep') {
    const confirmed = game.upkeep?.confirmed.length ?? 0;
    return { kind: 'upkeep', faction: null, title: 'Upkeep', detail: `${confirmed} of ${game.seats.length} confirmed`, round };
  }
  const turn = game.turn;
  if (game.phase !== 'actions' || turn === null) return { kind: 'idle', faction: null, title: '', detail: '', round };
  const light = game.mode === 'light';
  const action = turn.actionTaken === null ? null : ACTION_LABEL[turn.actionTaken];
  if (turn.faction === me) {
    const detail = light ? 'End turn or pass' : action === null ? 'Choose an action' : `${action} done`;
    return { kind: 'mine', faction: turn.faction, title: 'Your turn', detail, round };
  }
  const name = game.players[turn.faction]?.name ?? factionName(turn.faction);
  const detail = light ? name : `${name} · ${action ?? 'choosing action'}`;
  return { kind: 'other', faction: turn.faction, title: factionName(turn.faction), detail, round };
}
