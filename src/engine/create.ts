import { FACTION_INFO } from '../data/factions';
import type { FactionId, Resources } from '../data/types';
import { GAME_VERSION, type GameMode, type GameState, type PlayerPrivate, type PlayerPublic } from './types';

export const STARTING_ISK = 4;
/** Home asteroid belts still locked after setup reveals one of the three. */
export const LOCKED_HOME_BELTS = 2;

export function createGame(code: string, uid: string, name: string, faction: FactionId, now: number, mode: GameMode = 'full'): GameState {
  return {
    v: GAME_VERSION, mode, code, createdAt: now, uids: [uid],
    phase: 'lobby', round: 0, seats: [faction], firstPlayer: faction, turn: null, retreatsThisRound: [],
    players: { [faction]: newPlayer(faction, name, uid, mode) },
    upkeep: null, verge: null, combat: null, result: null,
    logSeq: 0, history: [],
  };
}

/** A light game's player starts with every resource at 0 and no ships: the board keeps those. */
export function newPlayer(f: FactionId, name: string, uid: string, mode: GameMode = 'full'): PlayerPublic {
  const [explorer, interceptor] = FACTION_INFO[f].startingShips;
  const light = mode === 'light';
  const res: Resources = { isk: light ? 0 : STARTING_ISK, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0, component: 0 };
  return {
    faction: f, name, uid, setupDone: false,
    res,
    vp: 0, cubesUsed: 0,
    slots: { move: 0, claim: 0, extract: 0, manufacture: 0, trade: 0, build: 0, research: 0 },
    passed: false,
    ships: light ? {} : { [explorer]: 1, [interceptor]: 1 },
    systems: 0, central: false,
    structures: { engineering: 0, citadel: 0, customs: 0, refinery: 0 }, homeCitadels: 0,
    belts: { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 }, lockedHomeBelts: LOCKED_HOME_BELTS,
    completed: [], tapped: [], devAreaCount: 0,
  };
}

export function emptyPrivate(): PlayerPrivate {
  return { area: [], pendingResearch: 0, pendingCards: 0, history: [] };
}
