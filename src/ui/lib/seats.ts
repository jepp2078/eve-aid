/** Seat-order helpers for the lobby room. Randomness is passed in (the engine stays deterministic). */
import type { FactionId } from '../../data/types';
import type { GameState } from '../../engine/types';

export function swapSeats(seats: readonly FactionId[], a: FactionId, b: FactionId): FactionId[] {
  const out = [...seats];
  const i = out.indexOf(a);
  const j = out.indexOf(b);
  if (i === -1 || j === -1 || i === j) return out;
  out[i] = b;
  out[j] = a;
  return out;
}

/** The same clockwise order, starting at `first`. */
export function rotateToFirst(seats: readonly FactionId[], first: FactionId): FactionId[] {
  const i = seats.indexOf(first);
  return i === -1 ? [...seats] : [...seats.slice(i), ...seats.slice(0, i)];
}

function index(n: number, rand: () => number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(rand() * n)));
}

/** Fisher-Yates shuffle into a new array. */
export function shuffled<T>(items: readonly T[], rand: () => number = Math.random): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = index(i + 1, rand);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export function pickOne<T>(items: readonly T[], rand: () => number = Math.random): T {
  return items[index(items.length, rand)]!;
}

export interface Slot {
  row: number;
  col: number;
}

/** Grid cells (3×3, table in the middle) for `n` seats in clockwise order, starting at the top. */
export function ringSlots(n: number): Slot[] {
  const top = { row: 1, col: 2 };
  switch (n) {
    case 1:
      return [top];
    case 2:
      return [top, { row: 3, col: 2 }];
    case 3:
      return [top, { row: 3, col: 3 }, { row: 3, col: 1 }];
    default:
      return [top, { row: 2, col: 3 }, { row: 3, col: 2 }, { row: 2, col: 1 }];
  }
}

/** The seat held by the game's host: the oldest device still in the game (`uids[0]`, the creator unless they left). */
export function hostFaction(game: GameState): FactionId | null {
  const host = game.uids[0];
  return game.seats.find((f) => game.players[f]?.uid === host) ?? null;
}
