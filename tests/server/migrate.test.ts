import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FactionId } from '../../src/data/types';
import { GAME_VERSION, isError, type Command, type GameState } from '../../src/engine/types';
import { factionName } from '../../src/engine/util';
import { todosFor } from '../../src/sync/todos';
import { GameHost, type Persistence, type StoredGame } from '../../server/games';
import { migrate } from '../../server/migrate';
import { fileStore, memoryStore } from '../../server/persist';
import { DEFAULT_SETUP, NOW } from '../engine/helpers';

const A = 'device-a';
const B = 'device-b';
const CONFIRM: Command = { type: 'confirmUpkeep', refinery: { planetary: 0, moon: 0, convert: 0 }, discard: {}, raids: [], researchLab: false };

function ok(r: unknown): void {
  if (r !== null) throw new Error(JSON.stringify(r));
}

/** A two-player game played into round 3 (two upkeeps, one undone and redone), on a host storing it as it does today. */
function playing(): { store: Persistence; host: GameHost; code: string } {
  const store = memoryStore();
  const host = new GameHost(store, () => NOW, Math.random);
  const code = host.create(A, 'Ana', 'amarr');
  if (isError(code)) throw new Error(code.code);
  ok(host.dispatch(code, B, { type: 'join', name: 'Cal', faction: 'caldari' }));
  ok(host.dispatch(code, A, { type: 'startGame', firstPlayer: 'amarr' }));
  for (const [d, f] of [[A, 'amarr'], [B, 'caldari']] as [string, FactionId][]) ok(host.dispatch(code, d, { type: 'setupFaction', ...DEFAULT_SETUP[f] }));
  const round = (first: string, second: string) => {
    ok(host.dispatch(code, first, { type: 'pass' }));
    ok(host.dispatch(code, second, { type: 'pass' }));
    ok(host.dispatch(code, A, CONFIRM));
    ok(host.dispatch(code, B, CONFIRM));
  };
  round(A, B);
  ok(host.undo(code, B)); // the confirm that began round 2, undone…
  ok(host.dispatch(code, B, CONFIRM)); // …and made again
  ok(host.dispatch(code, B, { type: 'eventPlayed' }));
  round(B, A);
  return { store, host, code };
}

/** The stored `playing()` game. */
function played(): StoredGame {
  const [s] = playing().store.loadAll();
  if (s === undefined || s.game.round !== 3) throw new Error('setup went wrong');
  return s;
}

/**
 * A round 3 attack still open in the upkeep, after Amarr confirmed, as games were saved before a turn guarded its
 * combat (everyone could pass with it open). The confirm's undo record holds the upkeep with the combat open too.
 */
function combatLeftOpen(): StoredGame {
  const { store, host, code } = playing();
  const attacker = store.loadAll()[0]!.game.turn!.faction;
  const [device, defender] = attacker === 'amarr' ? [A, 'caldari' as const] : [B, 'amarr' as const];
  ok(host.dispatch(code, device, { type: 'combatStart', defender, homeOf: null, controller: null, citadels: 0 }));
  const s = store.loadAll()[0]!;
  s.game = { ...s.game, phase: 'upkeep', turn: null, upkeep: { emergency: false, confirmed: [], raids: [], largeShips: [] } };
  store.save(s);
  const later = new GameHost(store, () => NOW, Math.random);
  ok(later.dispatch(code, A, CONFIRM));
  const [left] = store.loadAll();
  if (left?.game.combat === null || left?.game.phase !== 'upkeep') throw new Error('setup went wrong');
  return left;
}

/** `g` as version 2 saved it: no mode, and an open upkeep without large ships. */
function toVersion2(g: Record<string, any>): void {
  g.v = 2;
  delete g.mode;
  if (g.upkeep !== null) delete g.upkeep.largeShips;
}

/** `s` as version 2 saved it (also in the states undo can bring back). */
function asVersion2(s: StoredGame): unknown {
  const v2 = structuredClone(s) as unknown as Record<string, any>;
  toVersion2(v2.game);
  for (const u of v2.undo) toVersion2(u.before);
  return v2;
}

/** `s` as version 1 saved it: no retreats, entries without round, notices without kind or key, no to-do list. */
function asVersion1(s: StoredGame): unknown {
  const v1 = structuredClone(s) as unknown as Record<string, any>;
  const game = (g: Record<string, any>) => {
    toVersion2(g);
    g.v = 1;
    delete g.retreatsThisRound;
  };
  game(v1.game);
  for (const u of v1.undo) game(u.before);
  for (const e of v1.log) {
    delete e.round;
    for (const n of e.notices) {
      delete n.key;
      delete n.kind; // as logged before kinds existed
    }
  }
  delete v1.todos;
  return v1;
}

describe('migrate', () => {
  it('reads the current version as it is', () => {
    const s = played();
    expect(s.game.v).toBe(GAME_VERSION);
    expect(migrate(structuredClone(s))).toStrictEqual(s);
  });

  it('takes a version 1 save to the current shape: the same game, rounds worked out, the to-do list derived', () => {
    const now = played();
    const old = asVersion1(now);
    const up = migrate(old as StoredGame);
    expect(up.game).toStrictEqual(now.game);
    expect(up.undo).toStrictEqual(now.undo);
    expect(up.privs).toStrictEqual(now.privs);
    // Every round comes back, including the undone confirm (taken in round 1) and the setup (round 0).
    expect(up.log.map((e) => e.round)).toStrictEqual(now.log.map((e) => e.round));
    expect(up.log.map((e) => e.notices)).toStrictEqual(now.log.map((e) => e.notices));
    expect(up.todos).toStrictEqual(now.todos);
    expect(todosFor(up.todos, 'amarr').map((t) => t.text)).toStrictEqual([
      'Draw 1 Event card, then draw 3 Mission cards and keep 1',
      'Round 3: pass the first player token to Amarr',
    ]);
  });

  it('takes a version 2 save to version 3: a full game, open upkeeps with no large ships', () => {
    const now = combatLeftOpen();
    expect(now.game.upkeep).not.toBeNull();
    expect(now.undo.some((u) => u.before.upkeep !== null)).toBe(true);
    const old = asVersion2(now) as { game: Record<string, any> };
    expect(old.game.v).toBe(2);
    expect(old.game).not.toHaveProperty('mode');
    expect(old.game.upkeep).not.toHaveProperty('largeShips');
    const up = migrate(old as StoredGame);
    expect(up.game.v).toBe(3);
    expect(up.game.mode).toBe('full');
    expect(up.game.upkeep).toStrictEqual({ emergency: false, confirmed: ['amarr'], raids: [], largeShips: [] });
    expect(up).toStrictEqual(now);
    const quiet = played(); // no open upkeep: only the version and the mode change
    expect(quiet.game.upkeep).toBeNull();
    expect(migrate(asVersion2(quiet) as StoredGame)).toStrictEqual(quiet);
  });

  it('gives a version 2 upkeep, in the game and in the states undo can bring back, no large ships', () => {
    const old = asVersion2(played()) as { game: Record<string, any>; undo: { before: Record<string, any> }[] };
    old.game.upkeep = { emergency: false, confirmed: [], raids: [] };
    old.undo.at(-1)!.before.upkeep = { emergency: true, confirmed: ['caldari'], raids: [] };
    const up = migrate(old as unknown as StoredGame);
    expect(up.game.v).toBe(3);
    expect(up.game.mode).toBe('full');
    expect(up.game.upkeep).toStrictEqual({ emergency: false, confirmed: [], raids: [], largeShips: [] });
    expect(up.undo.at(-1)!.before.upkeep).toStrictEqual({ emergency: true, confirmed: ['caldari'], raids: [], largeShips: [] });
    for (const u of up.undo) {
      expect(u.before.v).toBe(3);
      expect(u.before.mode).toBe('full');
    }
  });

  it('takes a version 1 save to version 3 in one migrate, upkeeps included', () => {
    const now = combatLeftOpen();
    const old = asVersion1(now) as { game: Record<string, any> };
    expect(old.game.v).toBe(1);
    const up = migrate(old as StoredGame);
    expect(up.game.v).toBe(3);
    expect(up.game.mode).toBe('full');
    expect(up.game.upkeep).toStrictEqual({ emergency: false, confirmed: ['amarr'], raids: [], largeShips: [] });
    for (const u of up.undo) {
      expect(u.before.v).toBe(3);
      expect(u.before.mode).toBe('full');
      if (u.before.upkeep !== null) expect(u.before.upkeep.largeShips).toStrictEqual([]);
    }
    expect(up.undo.some((u) => u.before.upkeep !== null)).toBe(true);
  });

  it('keeps rounds an entry already carried', () => {
    const v1 = asVersion1(played()) as { log: { round?: number }[] };
    v1.log[0]!.round = 0;
    expect(migrate(v1 as unknown as StoredGame).log[0]!.round).toBe(0);
  });

  it("reads a notice without a kind as a to-do, unless it is one of the app's own prompts or news; a kind is kept", () => {
    const info = [
      'Amarr is attacking you: choose a strategy card face down, then assign your ships once Amarr has placed theirs',
      'Amarr has placed their ships: assign yours',
      'Amarr has made their start-of-combat choices: make yours',
      'Reveal your strategy card',
      'Upkeep: confirm your upkeep on your device',
      'Emergency upkeep (Verge of Ascendancy, no domination): confirm your upkeep on your device',
      'Choose a new development card for your development area',
      "Final round: the game ends after this round's upkeep",
      'Caldari is on the Verge of Ascendancy — one more round (this round ends when the current turn ends)',
      'Caldari is on the Verge of Ascendancy — one more round',
      'Game over: Amarr wins',
      'Game over: Amarr and Caldari share the victory',
      'Bob (Gallente) is now played from another device',
    ];
    const todo = [
      'Draw 1 Event card, then draw 3 Mission cards and keep 1',
      'Round 2: pass the first player token to Caldari',
      'Caldari took one of your systems',
      'Caldari took the central system from you',
      'Gallente stole 1 VP from you',
      "Raid on Amarr: move your raiding fleet from Caldari's home system to an adjacent system",
      'Discard the strategy cards used',
      'Move your surviving fleet to an adjacent explored system you can enter',
      'Draw 3 Event cards (reparations)',
      'Draw an Event or Mission card',
      'Amarr retreated — you may Use Pacifist',
    ];
    const v1 = asVersion1(played()) as { log: { notices: { to: string; text: string; kind?: string }[] }[] };
    v1.log.at(-1)!.notices = [
      ...[...info, ...todo].map((text) => ({ to: 'all', text })),
      { to: 'all', text: 'Reveal your strategy card', kind: 'todo' },
      { to: 'all', text: 'Discard the strategy cards used', kind: 'info' },
    ];
    const kinds = migrate(v1 as unknown as StoredGame).log.at(-1)!.notices.map((n) => [n.text, n.kind]);
    expect(kinds).toStrictEqual([
      ...info.map((t) => [t, 'info']),
      ...todo.map((t) => [t, 'todo']),
      ['Reveal your strategy card', 'todo'],
      ['Discard the strategy cards used', 'info'],
    ]);
  });

  it('cancels a combat left open past the action phase, so it never comes back to score in the next round', () => {
    const now = combatLeftOpen();
    const { attacker, defender } = now.game.combat!;
    const up = migrate(asVersion1(now) as StoredGame);
    const stranded = (u: { before: GameState }) => u.before.combat !== null && u.before.phase !== 'actions';
    expect(now.undo.filter(stranded)).toHaveLength(1); // Amarr's confirm would bring it back
    expect(up.game.combat).toBeNull();
    expect(up.undo.filter(stranded)).toStrictEqual([]);
    // Logged by the app (not undoable: game.history is untouched), in the round it was left open in.
    expect(up.game.logSeq).toBe(now.game.logSeq + 1);
    expect(up.game.history).toStrictEqual(now.game.history);
    expect(up.log.at(-1)).toStrictEqual({
      seq: now.game.logSeq + 1, at: NOW, actor: null, type: 'combatCancel', round: 3,
      lines: [`The combat between ${factionName(attacker)} and ${factionName(defender)} was cancelled (no rewards): an older version of the app left it open after the action phase`],
      notices: [], touchedPrivate: false, undone: false,
    });
    expect(up.log.slice(0, -1)).toStrictEqual(now.log);

    // Round 4 begins without it, and undoing the upkeep's confirms doesn't bring it back.
    const store = memoryStore();
    store.save(up);
    const host = new GameHost(store, () => NOW, Math.random);
    ok(host.dispatch(now.game.code, B, CONFIRM));
    expect(host.snapshot(now.game.code, A, 0)!.game).toMatchObject({ round: 4, phase: 'actions', combat: null });
    const device = attacker === 'amarr' ? A : B;
    expect(host.dispatch(now.game.code, device, { type: 'combatFinish', noEscape: false })).toMatchObject({ code: 'no_combat' });
    ok(host.undo(now.game.code, B));
    ok(host.undo(now.game.code, A));
    expect(host.snapshot(now.game.code, A, 0)!.game).toMatchObject({ round: 3, phase: 'upkeep', combat: null });
  });

  it('keeps a combat open in the action phase', () => {
    const { store, host, code } = playing();
    const attacker = store.loadAll()[0]!.game.turn!.faction;
    const [device, defender] = attacker === 'amarr' ? [A, 'caldari' as const] : [B, 'amarr' as const];
    ok(host.dispatch(code, device, { type: 'combatStart', defender, homeOf: null, controller: null, citadels: 0 }));
    const now = store.loadAll()[0]!;
    expect(migrate(asVersion1(now) as StoredGame)).toStrictEqual(now);
  });

  it('refuses a save from a newer version, or one without a version', () => {
    const s = played();
    expect(() => migrate({ ...s, game: { ...s.game, v: (GAME_VERSION + 1) as typeof GAME_VERSION } })).toThrow('saved by a newer version');
    expect(() => migrate({ ...s, game: { ...s.game, v: undefined as never } })).toThrow('unknown save version');
  });
});

describe('loading saved games', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('migrates version 1 files as it loads them, and skips (with a warning) a file from a newer version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'eve-migrate-'));
    dirs.push(dir);
    const now = played();
    writeFileSync(join(dir, `${now.game.code}.json`), JSON.stringify(asVersion1(now)));
    const newer = { ...now, game: { ...now.game, code: 'NEWER2', v: GAME_VERSION + 1 } };
    writeFileSync(join(dir, 'NEWER2.json'), JSON.stringify(newer));
    const warnings: string[] = [];
    const loaded = fileStore(dir, { warn: (m) => warnings.push(m) }).loadAll();
    expect(loaded).toStrictEqual([now]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('NEWER2.json');
    expect(warnings[0]).toContain('newer version');
  });
});
