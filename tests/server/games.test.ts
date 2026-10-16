import { describe, expect, it } from 'vitest';
import type { FactionId } from '../../src/data/types';
import { isError, type Command, type GameMode, type RuleError } from '../../src/engine/types';
import { HISTORY_CAP } from '../../src/sync/commit';
import { GameHost, KEEP, type Persistence, type Snapshot, type StoredGame } from '../../server/games';
import { memoryStore } from '../../server/persist';
import { DEFAULT_SETUP, NOW } from '../engine/helpers';

const A = 'device-a';
const B = 'device-b';
const C = 'device-c';

/** A memoryStore that counts saves. */
function countingStore(inner: Persistence = memoryStore()): Persistence & { saves: number } {
  const s = {
    saves: 0,
    loadAll: () => inner.loadAll(),
    has: (code: string) => inner.has(code),
    save(g: StoredGame) {
      s.saves++;
      inner.save(g);
    },
  };
  return s;
}

/** Deterministic random source for room codes. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length]!;
}

function ok(r: RuleError | null): void {
  if (r !== null) throw new Error(`${r.code}: ${r.message}`);
}

function codeOf(r: unknown): string | null {
  return isError(r) ? r.code : null;
}

function snap(host: GameHost, code: string, device: string): Snapshot {
  const s = host.snapshot(code, device, 100);
  if (s === null) throw new Error(`no game ${code}`);
  return s;
}

const RESEARCH_FIND: Command = { type: 'discover', rewards: [{ kind: 'research', amount: 1 }] };

/** A (amarr) creates, B (caldari) joins, both set up: phase 'actions', amarr to act. A light game takes no belt. */
function startedHost(store: Persistence = memoryStore(), mode: GameMode = 'full'): { host: GameHost; code: string } {
  const host = new GameHost(store, () => NOW, Math.random);
  const code = host.create(A, 'Ana', 'amarr', mode);
  if (isError(code)) throw new Error(code.code);
  ok(host.dispatch(code, B, { type: 'join', name: 'Cal', faction: 'caldari' }));
  ok(host.dispatch(code, A, { type: 'startGame', firstPlayer: 'amarr' }));
  for (const [device, f] of [[A, 'amarr'], [B, 'caldari']] as [string, FactionId][]) {
    const setup = mode === 'light' ? { ...DEFAULT_SETUP[f], revealedBelt: null } : DEFAULT_SETUP[f];
    ok(host.dispatch(code, device, { type: 'setupFaction', ...setup }));
  }
  return { host, code };
}

describe('GameHost', () => {
  it('creates a game with a code from the random source and the creator seated', () => {
    const store = countingStore();
    const host = new GameHost(store, () => NOW, seq(0));
    expect(host.create(A, ' Ana ', 'amarr')).toBe('AAAAAA');
    const s = snap(host, 'AAAAAA', A);
    expect(s.game.players.amarr).toMatchObject({ name: 'Ana', uid: A });
    expect(s.game.createdAt).toBe(NOW);
    expect(s.priv).toStrictEqual({ area: [], pendingResearch: 0, pendingCards: 0, history: [] });
    expect(s.log).toStrictEqual([]);
    expect(store.saves).toBe(1);
  });

  it('creates a full game unless asked for a light one', () => {
    const host = new GameHost(memoryStore(), () => NOW, seq(0, 0, 0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5));
    expect(host.create(A, 'Ana', 'amarr')).toBe('AAAAAA');
    expect(host.create(B, 'Cal', 'caldari', 'light')).toBe('999999');
    const third = host.create(C, 'Gus', 'gallente', 'full') as string;
    expect(snap(host, 'AAAAAA', A).game.mode).toBe('full');
    expect(snap(host, '999999', B).game.mode).toBe('light');
    expect(snap(host, third, C).game.mode).toBe('full');
  });

  it('rejects an unknown mode without saving', () => {
    const store = countingStore();
    const host = new GameHost(store, () => NOW, Math.random);
    for (const mode of ['heavy', null, 3, 'Light']) expect(codeOf(host.create(A, 'Ana', 'amarr', mode))).toBe('bad_mode');
    expect(store.saves).toBe(0);
  });

  it('picks another code when the first one is taken', () => {
    const host = new GameHost(memoryStore(), () => NOW, seq(0, 0, 0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99));
    expect(host.create(A, 'Ana', 'amarr')).toBe('AAAAAA');
    expect(host.create(B, 'Cal', 'caldari')).toBe('999999');
  });

  it('never gives out a code that has a saved file, even one that could not be loaded (M8)', () => {
    const inner = memoryStore();
    const store: Persistence = { loadAll: () => inner.loadAll(), save: (g) => inner.save(g), has: (code) => code === 'AAAAAA' || inner.has(code) };
    const host = new GameHost(store, () => NOW, seq(0, 0, 0, 0, 0, 0, 0.99, 0.99, 0.99, 0.99, 0.99, 0.99));
    expect(host.create(A, 'Ana', 'amarr')).toBe('999999');
  });

  it('rejects a bad name or faction without saving', () => {
    const store = countingStore();
    const host = new GameHost(store, () => NOW, Math.random);
    expect(codeOf(host.create(A, '  ', 'amarr'))).toBe('bad_name');
    expect(codeOf(host.create(A, 'Ana', 'jove' as FactionId))).toBe('bad_faction');
    expect(store.saves).toBe(0);
  });

  it('runs create, join from a second device and setup to round 1', () => {
    const { host, code } = startedHost();
    const s = snap(host, code, A);
    expect(s.game.phase).toBe('actions');
    expect(s.game.round).toBe(1);
    expect(s.game.uids).toStrictEqual([A, B]);
    expect(s.game.logSeq).toBe(4);
    expect(s.log.map((e) => [e.seq, e.type, e.actor])).toStrictEqual([
      [1, 'join', null],
      [2, 'startGame', 'amarr'],
      [3, 'setupFaction', 'amarr'],
      [4, 'setupFaction', 'caldari'],
    ]);
  });

  it("gives each device only its own seat's private doc", () => {
    const { host, code } = startedHost();
    const a = snap(host, code, A);
    const b = snap(host, code, B);
    const c = snap(host, code, C);
    expect(a.priv?.area.map((x) => x.dev)).toStrictEqual(DEFAULT_SETUP.amarr.devs);
    expect(b.priv?.area.map((x) => x.dev)).toStrictEqual(DEFAULT_SETUP.caldari.devs);
    expect(c.priv).toBeNull();
    const aJson = JSON.stringify(a);
    for (const dev of DEFAULT_SETUP.caldari.devs) expect(aJson).not.toContain(`"${dev}"`);
    expect(a.game).toStrictEqual(b.game);
  });

  it('limits the log to the requested number of latest entries', () => {
    const { host, code } = startedHost();
    expect(host.snapshot(code, A, 2)!.log.map((e) => e.seq)).toStrictEqual([3, 4]);
    expect(host.snapshot(code, A, 0)!.log).toStrictEqual([]);
  });

  it('notifies every subscriber after a change, each with its own private doc', () => {
    const { host, code } = startedHost();
    const got: Record<string, Snapshot[]> = { [A]: [], [B]: [], [C]: [] };
    const offs = [A, B, C].map((d) => host.subscribe(code, d, (s) => got[d]!.push(s)));
    ok(host.dispatch(code, B, RESEARCH_FIND));
    expect(got[A]).toHaveLength(1);
    expect(got[B]).toHaveLength(1);
    expect(got[C]).toHaveLength(1);
    expect(got[A]![0]!.priv).toStrictEqual(snap(host, code, A).priv);
    expect(got[B]![0]!.priv!.pendingResearch).toBe(1);
    expect(got[C]![0]!.priv).toBeNull();
    expect(got[A]![0]!.game.logSeq).toBe(5);
    expect(got[A]![0]!.log.at(-1)).toMatchObject({ seq: 5, type: 'discover', actor: 'caldari', touchedPrivate: true });

    offs[0]!();
    ok(host.dispatch(code, A, { type: 'action', action: 'move' }));
    expect(got[A]).toHaveLength(1);
    expect(got[B]).toHaveLength(2);
    offs.forEach((off) => off());
  });

  it('neither saves nor notifies on a RuleError', () => {
    const store = countingStore();
    const { host, code } = startedHost(store);
    const saves = store.saves;
    const before = snap(host, code, A);
    let calls = 0;
    host.subscribe(code, A, () => calls++);
    expect(codeOf(host.dispatch(code, B, { type: 'action', action: 'move' }))).toBe('not_your_turn');
    expect(codeOf(host.dispatch(code, C, { type: 'endTurn' }))).toBe('not_seated');
    expect(store.saves).toBe(saves);
    expect(calls).toBe(0);
    expect(snap(host, code, A)).toStrictEqual(before);
  });

  it('rejects a malformed command', () => {
    const { host, code } = startedHost();
    for (const bad of [null, 5, 'endTurn', {}, { type: 3 }, []]) {
      expect(codeOf(host.dispatch(code, A, bad as unknown as Command))).toBe('bad_command');
    }
  });

  it('undoes the latest change for anyone when it was public', () => {
    const { host, code } = startedHost();
    const before = snap(host, code, A);
    ok(host.dispatch(code, A, { type: 'action', action: 'move' }));
    let seen: Snapshot | null = null;
    host.subscribe(code, B, (s) => (seen = s));
    ok(host.undo(code, B));
    const after = snap(host, code, A);
    expect(after.game).toStrictEqual({ ...before.game, logSeq: 5 });
    expect(after.priv).toStrictEqual(before.priv);
    expect(after.log.at(-1)).toMatchObject({ seq: 5, undone: true });
    expect(seen).not.toBeNull();
    // Next in line is caldari's setup, which changed caldari's private doc: only B may undo it.
    expect(after.game.history.at(-1)).toStrictEqual({ seq: 4, actor: 'caldari', touchedPrivate: true });
    expect(codeOf(host.undo(code, A))).toBe('not_your_undo');
  });

  it('undoes only the entry the device saw as the latest when it names one', () => {
    const store = countingStore();
    const { host, code } = startedHost(store);
    ok(host.dispatch(code, A, { type: 'action', action: 'move' })); // seq 5
    const before = snap(host, code, A);
    const saves = store.saves;
    // The device still shows seq 4 as the newest entry: something newer happened, so nothing is undone.
    const stale = host.undo(code, B, 4);
    expect(codeOf(stale)).toBe('not_latest');
    expect(isError(stale) && stale.message).toMatch(/newer/);
    expect(store.saves).toBe(saves);
    expect(snap(host, code, A)).toStrictEqual(before);
    ok(host.undo(code, B, 5));
    expect(snap(host, code, A).log.at(-1)).toMatchObject({ seq: 5, undone: true });
  });

  it('refuses the undo of a private-touching change to another device', () => {
    const store = countingStore();
    const { host, code } = startedHost(store);
    const before = snap(host, code, B);
    ok(host.dispatch(code, B, RESEARCH_FIND));
    const saves = store.saves;
    expect(codeOf(host.undo(code, A))).toBe('not_your_undo');
    expect(store.saves).toBe(saves);
    ok(host.undo(code, B));
    const after = snap(host, code, B);
    expect(after.priv).toStrictEqual(before.priv);
    expect(after.game).toStrictEqual({ ...before.game, logSeq: 5 });
  });

  it('drops the private doc of a seat whose join was undone', () => {
    const store = memoryStore();
    const host = new GameHost(store, () => NOW, Math.random);
    const code = host.create(A, 'Ana', 'amarr') as string;
    ok(host.dispatch(code, B, { type: 'join', name: 'Cal', faction: 'caldari' }));
    ok(host.undo(code, A));
    const [stored] = store.loadAll();
    expect(Object.keys(stored!.privs)).toStrictEqual(['amarr']);
    expect(snap(host, code, B).priv).toBeNull();
    ok(host.dispatch(code, C, { type: 'join', name: 'Cy', faction: 'caldari' }));
    expect(snap(host, code, C).priv).toStrictEqual({ area: [], pendingResearch: 0, pendingCards: 0, history: [] });
  });

  it('undoes a light claim from a rival and the light upkeep that began the next round', () => {
    const { host, code } = startedHost(memoryStore(), 'light');
    /** What an undo has to bring back exactly. */
    const state = (device: string) => {
      const { players, phase, round, upkeep } = snap(host, code, device).game;
      return { players, phase, round, upkeep };
    };
    const claim = (from: FactionId | null): Command => ({ type: 'lightClaim', from, central: false });
    const upkeep = (research: number, raids: FactionId[]): Command => ({ type: 'lightUpkeep', research, researchLab: false, raids, largeShip: false });

    // Caldari needs a system for Amarr to take.
    ok(host.dispatch(code, A, claim(null)));
    ok(host.dispatch(code, A, { type: 'endTurn' }));
    ok(host.dispatch(code, B, claim(null)));
    ok(host.dispatch(code, B, { type: 'endTurn' }));

    const beforeClaim = state(A);
    ok(host.dispatch(code, A, claim('caldari')));
    expect(state(A).players.amarr!.systems).toBe(2);
    expect(state(A).players.caldari!.systems).toBe(0);
    ok(host.undo(code, B)); // a change nobody's private doc felt: any device may undo it
    expect(state(A)).toStrictEqual(beforeClaim);
    expect(state(B)).toStrictEqual(beforeClaim);

    // Both pass; Amarr confirms the upkeep; Caldari's confirm finishes it and begins round 2.
    ok(host.dispatch(code, A, { type: 'pass' }));
    ok(host.dispatch(code, B, { type: 'pass' }));
    ok(host.dispatch(code, A, upkeep(3, [])));
    const beforeFinish = state(B);
    const privBefore = snap(host, code, B).priv;
    expect(beforeFinish.phase).toBe('upkeep');
    expect(beforeFinish.upkeep).toMatchObject({ confirmed: ['amarr'] });

    ok(host.dispatch(code, B, upkeep(2, ['amarr'])));
    const after = state(B);
    expect(after).toMatchObject({ phase: 'actions', round: 2, upkeep: null });
    expect(snap(host, code, B).priv?.pendingResearch).toBe(2);
    expect(codeOf(host.undo(code, A))).toBe('not_your_undo'); // Caldari's research was placed in Caldari's private doc
    ok(host.undo(code, B));
    expect(state(A)).toStrictEqual(beforeFinish);
    expect(state(B)).toStrictEqual(beforeFinish);
    expect(snap(host, code, B).priv).toStrictEqual(privBefore);
    expect(snap(host, code, A).priv?.pendingResearch).toBe(3);

    // The upkeep can be confirmed again after the undo.
    ok(host.dispatch(code, B, upkeep(0, [])));
    expect(state(A)).toMatchObject({ phase: 'actions', round: 2 });
  });

  it('says nothing_to_undo for a fresh game', () => {
    const host = new GameHost(memoryStore(), () => NOW, Math.random);
    const code = host.create(A, 'Ana', 'amarr') as string;
    expect(codeOf(host.undo(code, A))).toBe('nothing_to_undo');
  });

  it('restores every game from the same store in a new GameHost', () => {
    const store = memoryStore();
    const { host, code } = startedHost(store);
    ok(host.dispatch(code, B, RESEARCH_FIND));
    const again = new GameHost(store, () => NOW + 1000, Math.random);
    for (const d of [A, B, C]) expect(snap(again, code, d)).toStrictEqual(snap(host, code, d));
    ok(again.undo(code, B)); // undo records survive too
    expect(snap(again, code, B).priv!.pendingResearch).toBe(0);
  });

  it('answers no_game for an unknown code', () => {
    const host = new GameHost(memoryStore(), () => NOW, Math.random);
    expect(codeOf(host.dispatch('NOPE42', A, { type: 'endTurn' }))).toBe('no_game');
    expect(codeOf(host.undo('NOPE42', A))).toBe('no_game');
    expect(host.snapshot('NOPE42', A, 50)).toBeNull();
  });

  it("keeps each seat's to-dos past the log window: a device gets its own and everyone's (I1)", () => {
    const store = memoryStore();
    const { host, code } = startedHost(store);
    const setup = 'Draw 1 Event card, then draw 3 Mission cards and keep 1';
    expect(snap(host, code, A).todos).toStrictEqual([{ id: 'setup:0', seq: 3, to: 'amarr', text: setup, key: null }]);
    expect(snap(host, code, B).todos).toStrictEqual([{ id: 'setup:0', seq: 4, to: 'caldari', text: setup, key: null }]);
    expect(snap(host, code, C).todos).toStrictEqual([]); // no seat: everyone's only
    for (let i = 0; i < 150; i++) ok(host.dispatch(code, A, { type: 'eventPlayed' }));
    expect(snap(host, code, A).log.some((e) => e.type === 'setupFaction')).toBe(false);
    expect(snap(host, code, A).todos.map((t) => t.text)).toStrictEqual([setup]);
    expect(new GameHost(store, () => NOW, Math.random).snapshot(code, A, 50)!.todos.map((t) => t.text)).toStrictEqual([setup]);
  });

  it('drops the to-dos of an undone entry, and gives a seat its to-dos on the device that takes it over', () => {
    const { host, code } = startedHost();
    ok(host.dispatch(code, A, { type: 'action', action: 'move' }));
    ok(host.dispatch(code, A, { type: 'discover', rewards: [{ kind: 'card' }] }));
    expect(snap(host, code, A).todos.map((t) => t.text)).toContain('Draw an Event or Mission card');
    ok(host.undo(code, A));
    expect(snap(host, code, A).todos.map((t) => t.text)).not.toContain('Draw an Event or Mission card');
    ok(host.dispatch(code, C, { type: 'takeOver', faction: 'amarr' }));
    expect(snap(host, code, C).todos.map((t) => t.id)).toStrictEqual(['setup:0']);
    expect(snap(host, code, A).todos).toStrictEqual([]);
  });

  it('answers a repeated command id with the first answer instead of applying the command again (M1)', () => {
    const { host, code } = startedHost();
    const before = snap(host, code, A).game.logSeq;
    ok(host.dispatch(code, A, { type: 'missionComplete', vp: 2 }, 'cmd-1'));
    ok(host.dispatch(code, A, { type: 'missionComplete', vp: 2 }, 'cmd-1')); // the phone retried: lost answer
    expect(snap(host, code, A).game.logSeq).toBe(before + 1);
    expect(snap(host, code, A).game.players.amarr!.vp).toBe(2);
    // An error answer is remembered too; the same id from another device is another command.
    expect(codeOf(host.dispatch(code, B, { type: 'endTurn' }, 'cmd-2'))).toBe('not_your_turn');
    expect(codeOf(host.dispatch(code, B, { type: 'endTurn' }, 'cmd-2'))).toBe('not_your_turn');
    ok(host.dispatch(code, B, { type: 'missionComplete', vp: 1 }, 'cmd-1'));
    expect(snap(host, code, A).game.players.caldari!.vp).toBe(1);
    // Without an id nothing is remembered.
    ok(host.dispatch(code, B, { type: 'eventPlayed' }));
    ok(host.dispatch(code, B, { type: 'eventPlayed' }));
    expect(snap(host, code, A).game.logSeq).toBe(before + 4);
  });

  it('undoes once for a repeated command id, and remembers the last 20 ids of each device', () => {
    const { host, code } = startedHost();
    ok(host.dispatch(code, A, { type: 'eventPlayed' }));
    ok(host.dispatch(code, A, { type: 'eventPlayed' }));
    const seq = snap(host, code, A).game.logSeq;
    ok(host.undo(code, A, seq, 'undo-1'));
    ok(host.undo(code, A, seq, 'undo-1'));
    expect(snap(host, code, A).log.filter((e) => e.undone).map((e) => e.seq)).toStrictEqual([seq]);

    for (let i = 0; i < 20; i++) ok(host.dispatch(code, A, { type: 'eventPlayed' }, `id-${i}`));
    const logSeq = snap(host, code, A).game.logSeq;
    ok(host.dispatch(code, A, { type: 'eventPlayed' }, 'id-0')); // still remembered
    expect(snap(host, code, A).game.logSeq).toBe(logSeq);
    ok(host.dispatch(code, A, { type: 'eventPlayed' }, 'id-20')); // the 21st pushes id-0 out
    ok(host.dispatch(code, A, { type: 'eventPlayed' }, 'id-0'));
    expect(snap(host, code, A).game.logSeq).toBe(logSeq + 2);
  });

  it('keeps the last 100 log entries, but undo records only for the entries that can still be undone', () => {
    const store = memoryStore();
    const { host, code } = startedHost(store);
    for (let i = 0; i < 110; i++) ok(host.dispatch(code, A, { type: 'eventPlayed' }));
    ok(host.undo(code, A));
    ok(host.undo(code, B));
    ok(host.dispatch(code, A, { type: 'eventPlayed' }));
    const [stored] = store.loadAll();
    expect(KEEP).toBe(100);
    expect(HISTORY_CAP).toBe(50);
    expect(stored!.log).toHaveLength(KEEP);
    expect(stored!.log.at(-1)!.seq).toBe(stored!.game.logSeq);
    expect(stored!.game.history).toHaveLength(HISTORY_CAP - 1);
    expect(stored!.undo.map((u) => u.seq)).toStrictEqual(stored!.game.history.map((h) => h.seq));
  });
});
