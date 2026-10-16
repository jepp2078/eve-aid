/**
 * Action availability for the Panel's action grid: what the next cube costs, the cube track, slots left, and a
 * plain-language reason when an action can't be taken right now (not your turn, slot used, no cubes, …). For a light
 * game, the record grid's status line.
 */
import { CUBE_COST, MAX_CUBES, SLOT_LIMIT } from '../../data/costs';
import type { ActionType, FactionId } from '../../data/types';
import type { GameState, PlayerPublic } from '../../engine/types';
import { ACTION_LABEL, factionName, signed } from './labels';

/** The seven actions in grid order. */
export const ACTIONS: ActionType[] = ['move', 'claim', 'extract', 'trade', 'manufacture', 'build', 'research'];

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th'];

/** ISK the next cube costs when `cubesUsed` cubes are already used (0 when none are left). */
export function cubeCost(cubesUsed: number): number {
  return CUBE_COST[cubesUsed] ?? 0;
}

/** "Cube 1 · free", "Cube 4 · −5 ISK", "No cubes left". */
export function cubeCostLabel(cubesUsed: number): string {
  if (cubesUsed >= MAX_CUBES) return 'No cubes left';
  const cost = cubeCost(cubesUsed);
  return `Cube ${cubesUsed + 1} · ${cost === 0 ? 'free' : `${signed(-cost)} ISK`}`;
}

export interface CubeSquare {
  /** 1..5 */
  n: number;
  used: boolean;
  /** ISK this cube costs (0 for the free ones). */
  cost: number;
  /** The cube the next action takes. */
  next: boolean;
}

export function cubeTrack(cubesUsed: number): CubeSquare[] {
  return Array.from({ length: MAX_CUBES }, (_, i) => ({ n: i + 1, used: i < cubesUsed, cost: CUBE_COST[i] ?? 0, next: i === cubesUsed }));
}

/** Whether it is `faction`'s turn in the action phase (the Panel's turn controls show). */
export function turnControlsVisible(game: GameState | null, faction: FactionId | null): boolean {
  return game !== null && faction !== null && game.phase === 'actions' && game.turn?.faction === faction;
}

export function slotsLeft(p: PlayerPublic, a: ActionType): number {
  return Math.max(0, SLOT_LIMIT[a] - p.slots[a]);
}

export type Availability = { ok: true; cost: number } | { ok: false; reason: string };

const no = (reason: string): Availability => ({ ok: false, reason });

/** Whether `faction` may take action `a` now, mirroring the engine's checks, with a reason when not. */
export function actionAvailability(game: GameState, faction: FactionId | null, a: ActionType): Availability {
  if (game.phase === 'upkeep') return no('Upkeep now; actions resume next round');
  if (game.phase === 'ended') return no('The game is over');
  if (game.phase !== 'actions') return no('Actions start in round 1');
  const p = faction === null ? undefined : game.players[faction];
  if (p === undefined) return no('You are not seated in this game');
  if (p.passed) return no('You passed this round');
  const turn = game.turn;
  if (turn === null) return no('No turn in progress');
  if (turn.faction !== faction) return no(`Not your turn: ${factionName(turn.faction)} is playing`);
  if (turn.actionTaken !== null) return no(`You already took an action this turn (${ACTION_LABEL[turn.actionTaken]}); end your turn`);
  if (p.cubesUsed >= MAX_CUBES) return no(`All ${MAX_CUBES} action cubes are used`);
  const limit = SLOT_LIMIT[a];
  const label = ACTION_LABEL[a];
  if (p.slots[a] >= limit) {
    return no(limit === 1 ? `The ${label} slot is used this round` : limit === 2 ? `Both ${label} slots are used this round` : `All ${limit} ${label} slots are used this round`);
  }
  const cost = cubeCost(p.cubesUsed);
  if (cost > p.res.isk) return no(`Your ${ORDINAL[p.cubesUsed]} cube costs ${cost} ISK; you have ${p.res.isk}`);
  return { ok: true, cost };
}

/**
 * The light record grid's status line: what the game expects of me. The board takes the action; the app records what
 * it gave and ends the turn.
 */
export function lightStatus(game: GameState, faction: FactionId | null): string {
  if (game.phase === 'upkeep') return 'Upkeep: confirm on your phone';
  if (game.phase === 'ended') return 'The game is over';
  const turn = game.turn;
  if (game.phase !== 'actions' || turn === null) return 'Waiting for the next turn';
  if (faction !== null && game.players[faction]?.passed === true) return 'You passed: waiting for the others';
  return turn.faction === faction ? 'Your turn: play your action on the board, then End turn' : `${factionName(turn.faction)}'s turn`;
}
