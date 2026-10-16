/**
 * Saved games move up to the current shape when the host loads them (`persist.ts`), one version step at a time,
 * keyed on `game.v`. A game is saved in the new shape with its next change. A file from a newer version of the app is
 * refused rather than guessed at.
 *
 * v1 → v2:
 *   - `game.retreatsThisRound` (Pacifist's condition) starts empty, also in the states undo can bring back;
 *   - log entries get their `round` where it is missing (worked out from the "Round N begins:" lines, walking back from
 *     the game's round) and their notices a `kind` where it is missing (`info` for the app's own prompts and news, as
 *     the engine logs them now, so they don't come back as stale checklist lines; otherwise `todo`, how they were shown
 *     then) and, for "pass the first player token", its replace key;
 *   - the to-do list is derived once from the kept log (`todosFromLog`);
 *   - a combat left open past the action phase (everyone could pass with one open before a turn guarded its combat) is
 *     cancelled with no rewards, also in the states undo can bring back, so it never comes back to score in the next
 *     round; the game's log says so, in an entry by the app that nobody can undo.
 *
 * v2 → v3:
 *   - `game.mode` is `'full'` (every game saved so far is one);
 *   - an open `upkeep` gains `largeShips: []`, also in the states undo can bring back.
 */
import type { FactionId } from '../src/data/types';
import { FIRST_PLAYER_KEY } from '../src/engine/upkeep';
import { GAME_VERSION, type GameState, type Notice } from '../src/engine/types';
import { factionName } from '../src/engine/util';
import type { LogEntry, UndoRecord } from '../src/sync/store';
import { todosFromLog } from '../src/sync/todos';
import type { StoredGame } from './games';

/** A saved game as it may come off disk: any version so far. */
interface Saved {
  game: { v?: unknown; round?: unknown } & Record<string, unknown>;
  privs: StoredGame['privs'];
  log: (Omit<LogEntry, 'round' | 'notices'> & { round?: unknown; notices: (Omit<Notice, 'kind'> & { kind?: unknown })[] })[];
  undo: { seq: number; before: Record<string, unknown> }[];
  todos?: unknown;
}

const GAME_ROUND_BEGINS = /^Round (\d+) begins: /;
const FIRST_PLAYER_TOKEN = /^Round \d+: pass the first player token to /;
/** The texts of every notice the engine logs as `info`: a prompt the app walks the player through, or news. */
const INFO_NOTICES = [
  / is attacking you: choose a strategy card face down, then assign your ships once .+ has placed theirs$/,
  / has placed their ships: assign yours$/,
  / has made their start-of-combat choices: make yours$/,
  /^Reveal your strategy card$/,
  /^(?:Upkeep|Emergency upkeep \(Verge of Ascendancy, no domination\)): confirm your upkeep on your device$/,
  /^Choose a new development card for your development area$/,
  /^Final round: the game ends after this round's upkeep$/,
  / is on the Verge of Ascendancy — one more round/,
  /^Game over: /,
  / is now played from another device$/,
];

/** The round an entry began ("Round 3 begins: …", never a combat's "Round 2 begins"), or null. */
function roundBegun(lines: readonly string[]): number | null {
  for (const line of lines) {
    const m = GAME_ROUND_BEGINS.exec(line);
    if (m) return Number(m[1]);
  }
  return null;
}

/**
 * Each entry's round, newest first from the game's current round: an entry that began round N was taken in N − 1,
 * and so was everything before it. An undone entry changed nothing, so it moves nothing. Recorded rounds are kept.
 */
function withRounds(log: Saved['log'], current: number): Saved['log'] {
  let round = current;
  const out = [...log];
  for (let i = out.length - 1; i >= 0; i--) {
    const e = out[i]!;
    const began = e.undone ? null : roundBegun(e.lines);
    const own = typeof e.round === 'number' ? e.round : began === null ? round : Math.max(0, began - 1);
    out[i] = { ...e, round: own };
    round = own;
  }
  return out;
}

/** A combat open outside the action phase, where it can never be fought; with the next round it would come back to life. */
function strandedCombat(game: Record<string, unknown>): { attacker: FactionId; defender: FactionId } | null {
  const c = game.combat as { attacker: FactionId; defender: FactionId } | null | undefined;
  return c !== null && c !== undefined && game.phase !== 'actions' ? c : null;
}

function v1GameToV2(game: Record<string, unknown>): GameState {
  return {
    ...game,
    v: 2,
    retreatsThisRound: Array.isArray(game.retreatsThisRound) ? game.retreatsThisRound : [],
    ...(strandedCombat(game) === null ? {} : { combat: null }),
  } as unknown as GameState;
}

function v1ToV2(s: Saved): Saved {
  const round = typeof s.game.round === 'number' ? s.game.round : 0;
  const log = withRounds(s.log, round).map((e) => ({
    ...e,
    notices: e.notices.map((n) => {
      const kind = n.kind === 'info' || (n.kind === undefined && INFO_NOTICES.some((re) => re.test(n.text))) ? 'info' : 'todo';
      return FIRST_PLAYER_TOKEN.test(n.text) && n.key === undefined ? { ...n, kind, key: FIRST_PLAYER_KEY } : { ...n, kind };
    }),
  }));
  const game = v1GameToV2(s.game);
  const stranded = strandedCombat(s.game);
  if (stranded !== null) {
    // Not in game.history: undoing it would only bring the combat back.
    game.logSeq += 1;
    log.push({
      seq: game.logSeq,
      at: log.at(-1)?.at ?? game.createdAt,
      actor: null,
      type: 'combatCancel',
      round,
      lines: [
        `The combat between ${factionName(stranded.attacker)} and ${factionName(stranded.defender)} was cancelled (no rewards): ` +
          'an older version of the app left it open after the action phase',
      ],
      notices: [],
      touchedPrivate: false,
      undone: false,
    });
  }
  return {
    game: game as unknown as Saved['game'],
    privs: s.privs,
    log,
    undo: s.undo.map((u) => ({ seq: u.seq, before: v1GameToV2(u.before) as unknown as Record<string, unknown> })),
    todos: todosFromLog(log as LogEntry[]),
  };
}

function v2GameToV3(game: Record<string, unknown>): Record<string, unknown> {
  const open = typeof game.upkeep === 'object' && game.upkeep !== null;
  return { ...game, v: 3, mode: 'full', ...(open ? { upkeep: { ...(game.upkeep as object), largeShips: [] } } : {}) };
}

function v2ToV3(s: Saved): Saved {
  return { ...s, game: v2GameToV3(s.game), undo: s.undo.map((u) => ({ ...u, before: v2GameToV3(u.before) })) };
}

/** Each step takes a game saved at version `v` to `v + 1`. */
const STEPS: Record<number, (s: Saved) => Saved> = { 1: v1ToV2, 2: v2ToV3 };

/** A saved game in the current shape; throws when it was saved by a newer version or its version is unknown. */
export function migrate(stored: StoredGame | Saved): StoredGame {
  let s = stored as Saved;
  let v = s.game.v;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new Error(`unknown save version ${JSON.stringify(v)}`);
  if (v > GAME_VERSION) throw new Error(`saved by a newer version of the app (version ${v}; this one reads up to ${GAME_VERSION})`);
  while (v < GAME_VERSION) {
    const step = STEPS[v];
    if (step === undefined) throw new Error(`no way to update a version ${v} save`);
    s = step(s);
    v += 1;
  }
  return { game: s.game as unknown as GameState, privs: s.privs, log: s.log as LogEntry[], undo: s.undo as unknown as UndoRecord[], todos: Array.isArray(s.todos) ? s.todos : [] };
}
