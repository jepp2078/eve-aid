/**
 * Engine test fixtures, shared by every engine test file.
 *
 *   const t = startedGame(['amarr', 'caldari']);     // round 1, phase 'actions', amarr to act
 *   t.dispatch('amarr', { type: 'endTurn' });         // runs through apply; throws on RuleError
 *   const e = t.tryDispatch('caldari', cmd);          // returns the RuleError instead (negative tests)
 *   t.p('amarr').res.isk; t.privs.amarr.area;         // current public / private state
 *   t.last?.lines;                                    // lines + notices of the last successful command
 *
 * Commands run with ctx { actor: the faction seated with that uid, priv: that faction's private doc, now: NOW },
 * like the sync layer does. On success `t.game` and the owner's `t.privs` entry are replaced; on error nothing
 * changes. `tryAsUid`/`asUid` act as a device by uid (it may be unseated: join, takeOver).
 * Arrange scenarios by editing `t.game` / `t.privs` directly (e.g. `t.p('amarr').completed.push(DEV.lobbyist)`).
 * Setup is deterministic: DEFAULT_SETUP per faction unless overridden via `startedGame(factions, { setup })`.
 * `{ mode: 'light' }` (on `newGame` and `startedGame`) makes a light game, whose default setup takes no belt.
 */
import { DEV } from '../../src/data/developments';
import type { DevId, FactionId, Mineral } from '../../src/data/types';
import { apply } from '../../src/engine/apply';
import { createGame, emptyPrivate } from '../../src/engine/create';
import {
  isError,
  type ApplyResult,
  type Command,
  type Ctx,
  type GameMode,
  type GameState,
  type PlayerPrivate,
  type PlayerPublic,
  type RuleError,
} from '../../src/engine/types';

export const NOW = 1_760_000_000_000;
export const CODE = 'TEST42';
export const NAMES: Record<FactionId, string> = { amarr: 'Ana', caldari: 'Cal', gallente: 'Gil', minmatar: 'Mia' };
export const uidOf = (f: FactionId): string => `uid-${f}`;

export interface SetupChoice {
  /** A full game's revealed home belt; null in a light game (which tracks no belts). */
  revealedBelt: Mineral | null;
  devs: DevId[];
}

/** Distinct starting areas (no prerequisites, nothing completed) so no passive effect is active. */
export const DEFAULT_SETUP: Record<FactionId, SetupChoice> = {
  amarr: { revealedBelt: 'pyrite', devs: [DEV.mediumHull, DEV.technologicalBreakthrough, DEV.galacticTrustFund, DEV.assemblyLine] },
  caldari: { revealedBelt: 'mexallon', devs: [DEV.offensiveSystemsT1, DEV.underdog, DEV.tradeContracts, DEV.materialsEfficiency] },
  gallente: { revealedBelt: 'tritanium', devs: [DEV.defensiveSystemsT1, DEV.pacifist, DEV.manufacturingHub, DEV.upgradedCustomsOffice] },
  minmatar: { revealedBelt: 'pyrite', devs: [DEV.utilitySystemsT1, DEV.starMap, DEV.asteroidMining, DEV.upgradedRefinery] },
};

export interface Table {
  game: GameState;
  /** Private docs of seated factions only (typed as a full record for convenience). */
  privs: Record<FactionId, PlayerPrivate>;
  uids: Record<FactionId, string>;
  /** Result of the last successful command. */
  last: ApplyResult | null;
  /** Seated player's public state (throws if absent). */
  p(f: FactionId): PlayerPublic;
  /** The ctx a device with this uid would send. */
  ctxFor(uid: string): Ctx;
  dispatch(f: FactionId, cmd: Command): ApplyResult;
  tryDispatch(f: FactionId, cmd: Command): ApplyResult | RuleError;
  asUid(uid: string, cmd: Command): ApplyResult;
  tryAsUid(uid: string, cmd: Command): ApplyResult | RuleError;
}

function makeTable(game: GameState, privs: Partial<Record<FactionId, PlayerPrivate>>, uids: Partial<Record<FactionId, string>>): Table {
  const t: Table = {
    game,
    privs: privs as Record<FactionId, PlayerPrivate>,
    uids: uids as Record<FactionId, string>,
    last: null,
    p(f) {
      const p = t.game.players[f];
      if (!p) throw new Error(`${f} is not seated`);
      return p;
    },
    ctxFor(uid) {
      const actor = t.game.seats.find((f) => t.game.players[f]?.uid === uid) ?? null;
      return { actor, uid, priv: actor === null ? null : (t.privs[actor] ?? null), now: NOW };
    },
    tryAsUid(uid, cmd) {
      const r = apply(t.game, cmd, t.ctxFor(uid));
      if (isError(r)) return r;
      t.game = r.game;
      if (r.privOwner !== null && r.priv !== null) t.privs[r.privOwner] = r.priv;
      if (cmd.type === 'join' || cmd.type === 'takeOver') t.uids[cmd.faction] = uid;
      t.last = r;
      return r;
    },
    asUid(uid, cmd) {
      const r = t.tryAsUid(uid, cmd);
      if (isError(r)) throw new Error(`${cmd.type} by ${uid} failed: ${r.code} (${r.message})`);
      return r;
    },
    tryDispatch(f, cmd) {
      const uid = t.uids[f];
      if (uid === undefined) throw new Error(`${f} has no uid in this table`);
      return t.tryAsUid(uid, cmd);
    },
    dispatch(f, cmd) {
      const r = t.tryDispatch(f, cmd);
      if (isError(r)) throw new Error(`${cmd.type} by ${f} failed: ${r.code} (${r.message})`);
      return r;
    },
  };
  return t;
}

/** Lobby with `factions` seated in that order; factions[0] created the game. */
export function newGame(factions: FactionId[], opts: { mode?: GameMode } = {}): Table {
  const [host, ...rest] = factions;
  if (host === undefined) throw new Error('newGame needs at least one faction');
  const t = makeTable(
    createGame(CODE, uidOf(host), NAMES[host], host, NOW, opts.mode ?? 'full'),
    { [host]: emptyPrivate() },
    { [host]: uidOf(host) },
  );
  for (const f of rest) t.asUid(uidOf(f), { type: 'join', name: NAMES[f], faction: f });
  return t;
}

/** Game through lobby and setup: phase 'actions', round 1, `firstPlayer` (default factions[0]) to act. */
export function startedGame(
  factions: FactionId[],
  opts: { firstPlayer?: FactionId; setup?: Partial<Record<FactionId, SetupChoice>>; mode?: GameMode } = {},
): Table {
  const t = newGame(factions, { mode: opts.mode });
  t.dispatch(factions[0]!, { type: 'startGame', firstPlayer: opts.firstPlayer ?? factions[0]! });
  for (const f of factions) {
    const setup = opts.setup?.[f] ?? (opts.mode === 'light' ? { revealedBelt: null, devs: DEFAULT_SETUP[f].devs } : DEFAULT_SETUP[f]);
    t.dispatch(f, { type: 'setupFaction', ...setup });
  }
  return t;
}
