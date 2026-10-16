import { describe, expect, it } from 'vitest';
import type { FactionId } from '../../src/data/types';
import { apply } from '../../src/engine/apply';
import { createGame, emptyPrivate } from '../../src/engine/create';
import { isError, type Command, type GameState, type PlayerPrivate, type RuleError } from '../../src/engine/types';
import { actorFor, newCode, newGameFor, runCommand, runUndo } from '../../src/sync/commit';
import { NOW, startedGame, uidOf } from '../engine/helpers';

type Run = Exclude<ReturnType<typeof runCommand>, RuleError>;

function ok<T>(r: T | RuleError): T {
  if (isError(r)) throw new Error(`${r.code}: ${r.message}`);
  return r;
}

function codeOf(r: unknown): string | null {
  return isError(r) ? r.code : null;
}

const MOVE: Command = { type: 'action', action: 'move' };
const RESEARCH_FIND: Command = { type: 'discover', rewards: [{ kind: 'research', amount: 1 }] };
const CONTROL_FIND: Command = { type: 'discover', rewards: [{ kind: 'control' }] };

/** Runs `cmd` as faction `f` against a started 2-player game, the way a store would. */
function runAs(game: GameState, privs: Record<FactionId, PlayerPrivate>, f: FactionId, cmd: Command, now = NOW): Run {
  return ok(runCommand(game, privs[f], cmd, uidOf(f), now));
}

describe('runCommand', () => {
  it('numbers the entry logSeq + 1, keeps the input as undo.before and records a history item', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.game.logSeq = 7;
    const input = structuredClone(t.game);
    const r = runAs(t.game, t.privs, 'amarr', MOVE, NOW + 5);

    expect(t.game).toStrictEqual(input); // input untouched
    expect(r.game.logSeq).toBe(8);
    expect(r.game.history).toStrictEqual([{ seq: 8, actor: 'amarr', touchedPrivate: false }]);
    expect(r.undo).toStrictEqual({ seq: 8, before: input });
    expect(r.entry).toStrictEqual({
      seq: 8, at: NOW + 5, actor: 'amarr', type: 'action', round: 1,
      lines: r.entry.lines, notices: r.entry.notices, touchedPrivate: false, undone: false,
    });
    expect(r.entry.lines.length).toBeGreaterThan(0);
    // Apart from the bookkeeping, the game is exactly what the engine produced.
    const engine = ok(apply(input, MOVE, { actor: 'amarr', uid: uidOf('amarr'), priv: t.privs.amarr, now: NOW + 5 }));
    expect({ ...r.game, logSeq: 0, history: [] }).toStrictEqual({ ...engine.game, logSeq: 0, history: [] });
    expect(r.entry.lines).toStrictEqual(engine.lines);
  });

  it('passes a RuleError through unchanged', () => {
    const t = startedGame(['amarr', 'caldari']);
    const r = runCommand(t.game, t.privs.caldari, MOVE, uidOf('caldari'), NOW); // not caldari's turn
    expect(isError(r)).toBe(true);
    expect(r).toStrictEqual(apply(t.game, MOVE, { actor: 'caldari', uid: uidOf('caldari'), priv: t.privs.caldari, now: NOW }));
  });

  it('resolves the actor from the uid, not from anything the caller claims', () => {
    const t = startedGame(['amarr', 'caldari']);
    const r = runCommand(t.game, null, MOVE, 'stranger', NOW);
    expect(codeOf(r)).toBe('not_seated');
  });

  it('marks touchedPrivate false when the private doc was supplied but did not change', () => {
    const t = startedGame(['amarr', 'caldari']);
    const r = runAs(t.game, t.privs, 'caldari', CONTROL_FIND);
    expect(r.privOwner).toBe('caldari');
    expect(r.entry.touchedPrivate).toBe(false);
    expect(r.game.history.at(-1)).toStrictEqual({ seq: 1, actor: 'caldari', touchedPrivate: false });
    expect(r.priv).toStrictEqual(t.privs.caldari); // no snapshot pushed
  });

  it('marks touchedPrivate and snapshots the private state from before the command', () => {
    const t = startedGame(['amarr', 'caldari']);
    const before = t.privs.caldari;
    const r = runAs(t.game, t.privs, 'caldari', RESEARCH_FIND);
    expect(r.entry.touchedPrivate).toBe(true);
    expect(r.privOwner).toBe('caldari');
    expect(r.priv).toStrictEqual({
      ...before,
      pendingResearch: before.pendingResearch + 1,
      history: [{ seq: 1, area: before.area, pendingResearch: before.pendingResearch, pendingCards: before.pendingCards }],
    });
    expect(t.privs.caldari).toStrictEqual(before); // input untouched
  });

  it('treats a join as creating the seat, not touching an existing private doc', () => {
    const g = createGame('ABC234', 'host', 'Ana', 'amarr', NOW);
    const r = ok(runCommand(g, null, { type: 'join', name: 'Cal', faction: 'caldari' }, 'guest', NOW));
    expect(r.privOwner).toBe('caldari');
    expect(r.priv).toStrictEqual(emptyPrivate());
    expect(r.entry).toMatchObject({ seq: 1, actor: null, type: 'join', touchedPrivate: false });
  });

  it('logs the round the command was taken in (0 before the game starts)', () => {
    const g = createGame('ABC234', 'host', 'Ana', 'amarr', NOW);
    expect(ok(runCommand(g, null, { type: 'join', name: 'Cal', faction: 'caldari' }, 'guest', NOW)).entry.round).toBe(0);

    // The pass that ends round 1 starts the upkeep; the upkeep confirm that starts round 2 still belongs to round 1.
    const t = startedGame(['amarr', 'caldari']);
    let game = runAs(t.game, t.privs, 'amarr', { type: 'pass' }).game;
    const pass = runAs(game, t.privs, 'caldari', { type: 'pass' });
    expect(pass.entry.round).toBe(1);
    game = pass.game;
    const upkeep: Command = { type: 'confirmUpkeep', refinery: { planetary: 0, moon: 0, convert: 0 }, discard: {}, raids: [], researchLab: false };
    const first = runAs(game, t.privs, 'amarr', upkeep);
    const last = runAs(first.game, t.privs, 'caldari', upkeep);
    expect(last.game.round).toBe(2);
    expect(last.entry.round).toBe(1);
  });

  it('keeps the last 50 history items and the last 20 private snapshots', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.game.logSeq = 100;
    t.game.history = Array.from({ length: 50 }, (_, i) => ({ seq: 51 + i, actor: 'amarr' as const, touchedPrivate: false }));
    const priv = {
      ...t.privs.caldari,
      history: Array.from({ length: 20 }, (_, i) => ({ seq: 81 + i, area: [], pendingResearch: 0, pendingCards: 0 })),
    };
    const r = ok(runCommand(t.game, priv, RESEARCH_FIND, uidOf('caldari'), NOW));
    expect(r.game.history).toHaveLength(50);
    expect(r.game.history[0]!.seq).toBe(52);
    expect(r.game.history.at(-1)!.seq).toBe(101);
    expect(r.priv!.history).toHaveLength(20);
    expect(r.priv!.history[0]!.seq).toBe(82);
    expect(r.priv!.history.at(-1)!.seq).toBe(101);
  });

  it('keeps the state JSON-safe', () => {
    const t = startedGame(['amarr', 'caldari']);
    const r = runAs(t.game, t.privs, 'caldari', RESEARCH_FIND);
    for (const x of [r.game, r.priv, r.entry, r.undo]) expect(JSON.parse(JSON.stringify(x))).toStrictEqual(x);
  });
});

describe('runUndo', () => {
  it('restores the state from before the entry but keeps logSeq and uids', () => {
    const t = startedGame(['amarr', 'caldari']);
    const first = runAs(t.game, t.privs, 'amarr', MOVE);
    const u = ok(runUndo(first.game, first.entry, first.undo, null, uidOf('caldari')));
    expect(u.game).toStrictEqual({ ...t.game, logSeq: 1, uids: first.game.uids, history: [] });
    expect(u.priv).toBeNull();
  });

  it('keeps the uids of the current game (a device that joined since stays a member)', () => {
    const t = startedGame(['amarr', 'caldari']);
    const r = runAs(t.game, t.privs, 'amarr', MOVE);
    const g = { ...r.game, uids: [...r.game.uids, 'newcomer'] };
    const u = ok(runUndo(g, r.entry, r.undo, null, uidOf('amarr')));
    expect(u.game.uids).toStrictEqual([...r.game.uids, 'newcomer']);
  });

  it('removes only the last history item', () => {
    const t = startedGame(['amarr', 'caldari']);
    const a = runAs(t.game, t.privs, 'amarr', MOVE);
    const b = runAs(a.game, t.privs, 'caldari', CONTROL_FIND);
    const u = ok(runUndo(b.game, b.entry, b.undo, null, uidOf('amarr')));
    expect(u.game).toStrictEqual({ ...a.game, logSeq: 2 });
    expect(u.game.history).toStrictEqual([{ seq: 1, actor: 'amarr', touchedPrivate: false }]);
  });

  it('refuses to undo an entry that is not the latest', () => {
    const t = startedGame(['amarr', 'caldari']);
    const a = runAs(t.game, t.privs, 'amarr', MOVE);
    const b = runAs(a.game, t.privs, 'caldari', CONTROL_FIND);
    expect(codeOf(runUndo(b.game, a.entry, a.undo, null, uidOf('amarr')))).toBe('not_latest');
  });

  it('refuses to undo an entry that is no longer in the history', () => {
    const t = startedGame(['amarr', 'caldari']);
    const a = runAs(t.game, t.privs, 'amarr', MOVE);
    const u = ok(runUndo(a.game, a.entry, a.undo, null, uidOf('amarr')));
    expect(codeOf(runUndo(u.game, a.entry, a.undo, null, uidOf('amarr')))).toBe('not_latest');
  });

  it('refuses another uid the undo of a private-touching entry', () => {
    const t = startedGame(['amarr', 'caldari']);
    const r = runAs(t.game, t.privs, 'caldari', RESEARCH_FIND);
    expect(codeOf(runUndo(r.game, r.entry, r.undo, r.priv, uidOf('amarr')))).toBe('not_your_undo');
    expect(codeOf(runUndo(r.game, r.entry, r.undo, r.priv, 'stranger'))).toBe('not_your_undo');
  });

  it('restores the private doc from its own history for the owner', () => {
    const t = startedGame(['amarr', 'caldari']);
    const r = runAs(t.game, t.privs, 'caldari', RESEARCH_FIND);
    const u = ok(runUndo(r.game, r.entry, r.undo, r.priv, uidOf('caldari')));
    expect(u.priv).toStrictEqual(t.privs.caldari);
    expect(u.game).toStrictEqual({ ...t.game, logSeq: 1 });
  });

  it('follows the seat after a takeover: the new device may undo the faction’s private change', () => {
    const t = startedGame(['amarr', 'caldari']);
    const r = runAs(t.game, t.privs, 'caldari', RESEARCH_FIND);
    // Simulate the seat now held by another device (the takeOver itself would be a later history item).
    const g = structuredClone(r.game);
    g.players.caldari!.uid = 'phone-2';
    expect(codeOf(runUndo(g, r.entry, r.undo, r.priv, uidOf('caldari')))).toBe('not_your_undo');
    expect(ok(runUndo(g, r.entry, r.undo, r.priv, 'phone-2')).priv).toStrictEqual(t.privs.caldari);
  });

  it('refuses when the private snapshot is missing', () => {
    const t = startedGame(['amarr', 'caldari']);
    const r = runAs(t.game, t.privs, 'caldari', RESEARCH_FIND);
    const stripped = { ...r.priv!, history: [] };
    expect(codeOf(runUndo(r.game, r.entry, r.undo, stripped, uidOf('caldari')))).toBe('no_undo');
    expect(codeOf(runUndo(r.game, r.entry, r.undo, null, uidOf('caldari')))).toBe('no_undo');
  });

  it('refuses a record that belongs to another entry', () => {
    const t = startedGame(['amarr', 'caldari']);
    const a = runAs(t.game, t.privs, 'amarr', MOVE);
    const b = runAs(a.game, t.privs, 'caldari', CONTROL_FIND);
    expect(codeOf(runUndo(b.game, b.entry, a.undo, null, uidOf('amarr')))).toBe('no_undo');
  });
});

describe('newGameFor', () => {
  it('creates the lobby with a trimmed name and an empty private doc', () => {
    const r = ok(newGameFor('ABC234', 'u1', '  Ana  ', 'amarr', NOW));
    expect(r).toStrictEqual({ game: createGame('ABC234', 'u1', 'Ana', 'amarr', NOW), priv: emptyPrivate() });
  });

  it('creates a full game, or a light one when asked', () => {
    expect(ok(newGameFor('ABC234', 'u1', 'Ana', 'amarr', NOW)).game.mode).toBe('full');
    expect(ok(newGameFor('ABC234', 'u1', 'Ana', 'amarr', NOW, 'full'))).toStrictEqual(ok(newGameFor('ABC234', 'u1', 'Ana', 'amarr', NOW)));
    const light = ok(newGameFor('ABC234', 'u1', 'Ana', 'amarr', NOW, 'light'));
    expect(light).toStrictEqual({ game: createGame('ABC234', 'u1', 'Ana', 'amarr', NOW, 'light'), priv: emptyPrivate() });
    expect(light.game.mode).toBe('light');
  });

  it('rejects anything but a full or a light game', () => {
    for (const mode of ['heavy', 'Light', '', null, 1, {}]) {
      expect(newGameFor('ABC234', 'u1', 'Ana', 'amarr', NOW, mode)).toStrictEqual({ error: true, code: 'bad_mode', message: 'Choose a full or a scorekeeper game' });
    }
  });

  it('rejects a blank or too long name', () => {
    expect(codeOf(newGameFor('ABC234', 'u1', '   ', 'amarr', NOW))).toBe('bad_name');
    expect(codeOf(newGameFor('ABC234', 'u1', 'x'.repeat(25), 'amarr', NOW))).toBe('bad_name');
    expect(codeOf(newGameFor('ABC234', 'u1', 42 as unknown as string, 'amarr', NOW))).toBe('bad_name');
    expect(isError(newGameFor('ABC234', 'u1', 'x'.repeat(24), 'amarr', NOW))).toBe(false);
  });

  it('rejects an unknown faction', () => {
    expect(codeOf(newGameFor('ABC234', 'u1', 'Ana', 'jove' as FactionId, NOW))).toBe('bad_faction');
    expect(codeOf(newGameFor('ABC234', 'u1', 'Ana', '__proto__' as FactionId, NOW))).toBe('bad_faction');
  });
});

describe('actorFor', () => {
  it('finds the first seat (in seat order) held by the uid', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    expect(actorFor(t.game, uidOf('caldari'))).toBe('caldari');
    expect(actorFor(t.game, 'stranger')).toBeNull();
    const g = structuredClone(t.game);
    g.players.amarr!.uid = uidOf('gallente');
    g.seats = ['caldari', 'gallente', 'amarr'];
    expect(actorFor(g, uidOf('gallente'))).toBe('gallente');
  });
});

describe('newCode', () => {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  it('builds 6 characters from the unambiguous alphabet', () => {
    let i = 0;
    const seq = [0, 0.999999, 0.5, 0.25, 0.75, 0.1];
    expect(newCode(() => seq[i++]!)).toBe(`A9${ALPHABET[16]}${ALPHABET[8]}${ALPHABET[24]}${ALPHABET[3]}`);
  });

  it('only ever uses allowed characters, even for a random source that returns 1', () => {
    expect(newCode(() => 1)).toBe('999999');
    for (let n = 0; n < 200; n++) expect(newCode(Math.random)).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
  });
});
