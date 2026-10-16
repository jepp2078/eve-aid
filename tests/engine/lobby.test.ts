import { describe, expect, it } from 'vitest';
import { DEV, dev } from '../../src/data/developments';
import type { DevId, FactionId } from '../../src/data/types';
import { apply } from '../../src/engine/apply';
import { createGame, emptyPrivate, newPlayer } from '../../src/engine/create';
import { isError, type ApplyResult, type Command, type RuleError } from '../../src/engine/types';
import { DEFAULT_SETUP, NOW, newGame, startedGame, uidOf, type Table } from './helpers';

function ok(r: ApplyResult | RuleError): ApplyResult {
  if (isError(r)) throw new Error(`${r.code}: ${r.message}`);
  return r;
}

function codeOf(r: ApplyResult | RuleError): string | null {
  return isError(r) ? r.code : null;
}

function inSetup(factions: FactionId[] = ['amarr', 'caldari'], firstPlayer: FactionId = 'caldari'): Table {
  const t = newGame(factions);
  t.dispatch(factions[0]!, { type: 'startGame', firstPlayer });
  return t;
}

const AMARR_DEVS: DevId[] = [DEV.lobbyist, DEV.mediumHull, DEV.starMap, DEV.invader];

describe('createGame', () => {
  it('opens a lobby with the creator seated', () => {
    const g = createGame('ABC234', 'u1', 'Ana', 'amarr', NOW);
    expect(g).toStrictEqual({
      v: 3, mode: 'full', code: 'ABC234', createdAt: NOW, uids: ['u1'],
      phase: 'lobby', round: 0, seats: ['amarr'], firstPlayer: 'amarr', turn: null, retreatsThisRound: [],
      players: { amarr: newPlayer('amarr', 'Ana', 'u1') },
      upkeep: null, verge: null, combat: null, result: null,
      logSeq: 0, history: [],
    });
  });

  it('opens a light lobby whose creator starts with nothing on the board', () => {
    const g = createGame('ABC234', 'u1', 'Ana', 'amarr', NOW, 'light');
    expect(g).toStrictEqual({ ...createGame('ABC234', 'u1', 'Ana', 'amarr', NOW), mode: 'light', players: { amarr: newPlayer('amarr', 'Ana', 'u1', 'light') } });
    expect(g.players.amarr!.res.isk).toBe(0);
    expect(g.players.amarr!.ships).toStrictEqual({});
  });
});

describe('newPlayer', () => {
  it('starts with 4 ISK, its two starting frigates and two locked home belts', () => {
    const p = newPlayer('caldari', 'Cal', 'u2');
    expect(p).toStrictEqual({
      faction: 'caldari', name: 'Cal', uid: 'u2', setupDone: false,
      res: { isk: 4, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0, component: 0 },
      vp: 0, cubesUsed: 0,
      slots: { move: 0, claim: 0, extract: 0, manufacture: 0, trade: 0, build: 0, research: 0 },
      passed: false,
      ships: { buzzard: 1, crow: 1 },
      systems: 0, central: false,
      structures: { engineering: 0, citadel: 0, customs: 0, refinery: 0 }, homeCitadels: 0,
      belts: { pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0 }, lockedHomeBelts: 2,
      completed: [], tapped: [], devAreaCount: 0,
    });
  });

  it.each([
    ['amarr', { anathema: 1, malediction: 1 }],
    ['gallente', { helios: 1, ares: 1 }],
    ['minmatar', { cheetah: 1, stiletto: 1 }],
  ] as const)('gives %s its starting frigates', (f, ships) => {
    expect(newPlayer(f, 'x', 'u').ships).toEqual(ships);
  });

  it('in a light game starts with every resource at 0 and no ships, the rest as in a full game', () => {
    const light = newPlayer('caldari', 'Cal', 'u2', 'light');
    const full = newPlayer('caldari', 'Cal', 'u2');
    expect(newPlayer('caldari', 'Cal', 'u2', 'full')).toStrictEqual(full);
    expect(light).toStrictEqual({
      ...full,
      res: { isk: 0, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0, component: 0 },
      ships: {},
    });
  });

  it('emptyPrivate has an empty area and nothing pending', () => {
    expect(emptyPrivate()).toStrictEqual({ area: [], pendingResearch: 0, pendingCards: 0, history: [] });
  });
});

describe('join', () => {
  const join = (faction: FactionId, name = 'Cal'): Command => ({ type: 'join', name, faction });

  it('adds the player, seat and uid and returns an empty private doc owned by the joined faction', () => {
    const g = createGame('ABC234', 'u1', 'Ana', 'amarr', NOW);
    const r = ok(apply(g, join('caldari'), { actor: null, uid: 'u2', priv: null, now: NOW }));
    expect(r.game.seats).toEqual(['amarr', 'caldari']);
    expect(r.game.uids).toEqual(['u1', 'u2']);
    expect(r.game.players.caldari).toEqual(newPlayer('caldari', 'Cal', 'u2'));
    expect(r.privOwner).toBe('caldari');
    expect(r.priv).toEqual(emptyPrivate());
    expect(r.lines.join('\n')).toContain('Cal');
  });

  it('gives a player joining a light game the light start, and a full game the full one', () => {
    const light = createGame('ABC234', 'u1', 'Ana', 'amarr', NOW, 'light');
    const r = ok(apply(light, join('caldari'), { actor: null, uid: 'u2', priv: null, now: NOW }));
    expect(r.game.mode).toBe('light');
    expect(r.game.players.caldari).toEqual(newPlayer('caldari', 'Cal', 'u2', 'light'));
    const full = ok(apply(createGame('ABC234', 'u1', 'Ana', 'amarr', NOW), join('caldari'), { actor: null, uid: 'u2', priv: null, now: NOW }));
    expect(full.game.players.caldari).toEqual(newPlayer('caldari', 'Cal', 'u2', 'full'));
  });

  it('trims the name and rejects an empty one', () => {
    const t = newGame(['amarr']);
    expect(codeOf(t.tryAsUid('u2', join('caldari', '   ')))).toBe('bad_name');
    t.asUid('u2', join('caldari', '  Cal  '));
    expect(t.p('caldari').name).toBe('Cal');
  });

  it('rejects a faction that is already taken', () => {
    const t = newGame(['amarr', 'caldari']);
    expect(codeOf(t.tryAsUid('u3', join('caldari', 'Other')))).toBe('faction_taken');
  });

  it('rejects an unknown faction', () => {
    const t = newGame(['amarr']);
    expect(codeOf(t.tryAsUid('u3', join('jove' as FactionId)))).toBe('bad_faction');
  });

  it('rejects a device that already holds a seat', () => {
    const t = newGame(['amarr']);
    expect(codeOf(t.tryAsUid(uidOf('amarr'), join('caldari')))).toBe('already_seated');
  });

  it('rejects joining after the lobby closed', () => {
    const t = inSetup();
    expect(codeOf(t.tryAsUid('u3', join('gallente', 'Gil')))).toBe('not_lobby');
    const s = startedGame(['amarr', 'caldari']);
    expect(codeOf(s.tryAsUid('u3', join('gallente', 'Gil')))).toBe('not_lobby');
  });
});

describe('takeOver', () => {
  it('moves the seat to the new device, keeps the player data and tells everyone', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').res.isk = 17;
    const before = structuredClone(t.p('caldari'));
    const r = t.asUid('phone-2', { type: 'takeOver', faction: 'caldari' });
    expect(t.p('caldari')).toEqual({ ...before, uid: 'phone-2' });
    expect(t.game.uids).toEqual([uidOf('amarr'), 'phone-2']);
    expect(r.notices).toEqual([{ to: 'all', text: expect.stringContaining('Cal'), kind: 'info' }]);
    expect(t.game.phase).toBe('actions');
  });

  it('refuses a device that already holds another seat: one device, one seat (M9)', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    const before = structuredClone(t.game);
    const r = t.tryAsUid(uidOf('amarr'), { type: 'takeOver', faction: 'caldari' });
    expect(codeOf(r)).toBe('already_seated');
    expect(isError(r) && r.message).toBe('This device already holds a seat (Amarr); a seat moves to a device that holds none');
    expect(t.game).toStrictEqual(before);
  });

  it('keeps the old uid while it still holds another seat (a game saved before one device meant one seat)', () => {
    const t = newGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').uid = uidOf('amarr');
    t.game.uids = [uidOf('amarr'), uidOf('gallente')];
    t.asUid('phone-9', { type: 'takeOver', faction: 'caldari' });
    expect(t.game.uids).toEqual([uidOf('amarr'), uidOf('gallente'), 'phone-9']);
    expect(t.p('amarr').uid).toBe(uidOf('amarr'));
  });

  it('rejects a faction nobody holds and a seat the device already holds', () => {
    const t = newGame(['amarr']);
    expect(codeOf(t.tryAsUid('u2', { type: 'takeOver', faction: 'minmatar' }))).toBe('no_player');
    expect(codeOf(t.tryAsUid(uidOf('amarr'), { type: 'takeOver', faction: 'amarr' }))).toBe('already_yours');
  });

  it('treats inherited object keys as unseated factions', () => {
    const t = newGame(['amarr']);
    for (const faction of ['__proto__', 'constructor', 'toString']) {
      expect(codeOf(t.tryAsUid('u2', { type: 'takeOver', faction } as unknown as Command))).toBe('no_player');
    }
    expect(({} as Record<string, unknown>).uid).toBeUndefined();
  });
});

describe('setSeats', () => {
  it('sets the clockwise seat order', () => {
    const t = newGame(['amarr', 'caldari', 'gallente']);
    t.dispatch('caldari', { type: 'setSeats', seats: ['gallente', 'amarr', 'caldari'] });
    expect(t.game.seats).toEqual(['gallente', 'amarr', 'caldari']);
  });

  it.each([
    ['a missing seat', ['amarr', 'caldari']],
    ['a duplicate', ['amarr', 'caldari', 'caldari']],
    ['an unseated faction', ['amarr', 'caldari', 'minmatar']],
    ['an extra seat', ['amarr', 'caldari', 'gallente', 'minmatar']],
  ] as [string, FactionId[]][])('rejects %s', (_, seats) => {
    const t = newGame(['amarr', 'caldari', 'gallente']);
    expect(codeOf(t.tryDispatch('amarr', { type: 'setSeats', seats }))).toBe('bad_seats');
  });

  it('needs a seated device and the lobby', () => {
    const t = newGame(['amarr', 'caldari']);
    expect(codeOf(t.tryAsUid('stranger', { type: 'setSeats', seats: ['caldari', 'amarr'] }))).toBe('not_seated');
    t.dispatch('amarr', { type: 'startGame', firstPlayer: 'amarr' });
    expect(codeOf(t.tryDispatch('amarr', { type: 'setSeats', seats: ['caldari', 'amarr'] }))).toBe('not_lobby');
  });
});

describe('startGame', () => {
  it('needs at least two players', () => {
    const t = newGame(['amarr']);
    expect(codeOf(t.tryDispatch('amarr', { type: 'startGame', firstPlayer: 'amarr' }))).toBe('not_enough_players');
  });

  it('moves to setup with the chosen first player', () => {
    const t = newGame(['amarr', 'caldari']);
    t.dispatch('caldari', { type: 'startGame', firstPlayer: 'caldari' });
    expect(t.game).toMatchObject({ phase: 'setup', round: 0, firstPlayer: 'caldari', turn: null });
  });

  it('rejects a first player who is not seated', () => {
    const t = newGame(['amarr', 'caldari']);
    expect(codeOf(t.tryDispatch('amarr', { type: 'startGame', firstPlayer: 'gallente' }))).toBe('bad_first_player');
  });

  it('must come from a seated device while in the lobby', () => {
    const t = newGame(['amarr', 'caldari']);
    expect(codeOf(t.tryAsUid('stranger', { type: 'startGame', firstPlayer: 'amarr' }))).toBe('not_seated');
    t.dispatch('amarr', { type: 'startGame', firstPlayer: 'amarr' });
    expect(codeOf(t.tryDispatch('amarr', { type: 'startGame', firstPlayer: 'amarr' }))).toBe('not_lobby');
  });
});

describe('setupFaction', () => {
  it.each([
    ['three developments', AMARR_DEVS.slice(0, 3)],
    ['five developments', [...AMARR_DEVS, DEV.pacifist]],
    ['a duplicate', [DEV.lobbyist, DEV.lobbyist, DEV.starMap, DEV.invader]],
    ['an unknown id', [DEV.lobbyist, DEV.mediumHull, DEV.starMap, 'no-such-card']],
  ] as [string, DevId[]][])('rejects %s with bad_devs', (_, devs) => {
    const t = inSetup();
    expect(codeOf(t.tryDispatch('amarr', { type: 'setupFaction', revealedBelt: 'pyrite', devs }))).toBe('bad_devs');
    expect(t.p('amarr').setupDone).toBe(false);
  });

  it('reveals the chosen belt and deals the development area privately', () => {
    const t = inSetup();
    const r = t.dispatch('amarr', { type: 'setupFaction', revealedBelt: 'mexallon', devs: AMARR_DEVS });
    const p = t.p('amarr');
    expect(p.belts).toEqual({ pyrite: 0, mexallon: 1, tritanium: 0, morphite: 0 });
    expect(p.res).toMatchObject({ isk: 4, pyrite: 0, mexallon: 1, tritanium: 0, morphite: 0 });
    expect(p).toMatchObject({ setupDone: true, devAreaCount: 4, lockedHomeBelts: 2, completed: [] });
    expect(r.privOwner).toBe('amarr');
    expect(r.priv).toEqual({ ...emptyPrivate(), area: AMARR_DEVS.map((d) => ({ dev: d, tokens: 0 })) });
    expect(t.privs.amarr.area).toHaveLength(4);
    expect(r.notices).toEqual([{ to: 'amarr', text: expect.stringMatching(/Event/), kind: 'todo' }]);
  });

  it('keeps the chosen developments out of the public game and log', () => {
    const t = inSetup();
    const r = t.dispatch('amarr', { type: 'setupFaction', revealedBelt: 'pyrite', devs: AMARR_DEVS });
    const visible = JSON.stringify([r.game, r.lines, r.notices]);
    for (const id of AMARR_DEVS) {
      expect(visible).not.toContain(id);
      expect(visible).not.toContain(dev(id).name);
    }
  });

  it('accepts morphite as the revealed belt', () => {
    const t = inSetup();
    t.dispatch('amarr', { type: 'setupFaction', revealedBelt: 'morphite', devs: AMARR_DEVS });
    expect(t.p('amarr').belts.morphite).toBe(1);
    expect(t.p('amarr').res.morphite).toBe(1);
  });

  it('rejects an unknown belt colour', () => {
    const t = inSetup();
    const cmd = { type: 'setupFaction', revealedBelt: 'planetary', devs: AMARR_DEVS } as unknown as Command;
    expect(codeOf(t.tryDispatch('amarr', cmd))).toBe('bad_belt');
  });

  it('requires the private doc', () => {
    const t = inSetup();
    const ctx = { actor: 'amarr' as const, uid: uidOf('amarr'), priv: null, now: NOW };
    const r = apply(t.game, { type: 'setupFaction', revealedBelt: 'pyrite', devs: AMARR_DEVS }, ctx);
    expect(codeOf(r)).toBe('no_private');
  });

  it('can only be done once, and only during setup', () => {
    const lobby = newGame(['amarr', 'caldari']);
    expect(codeOf(lobby.tryDispatch('amarr', { type: 'setupFaction', revealedBelt: 'pyrite', devs: AMARR_DEVS }))).toBe('not_setup');
    const t = inSetup();
    t.dispatch('amarr', { type: 'setupFaction', revealedBelt: 'pyrite', devs: AMARR_DEVS });
    expect(codeOf(t.tryDispatch('amarr', { type: 'setupFaction', revealedBelt: 'mexallon', devs: AMARR_DEVS }))).toBe('already_setup');
  });

  it('starts round 1 with the first player once everyone has finished', () => {
    const t = inSetup(['amarr', 'caldari'], 'caldari');
    t.dispatch('amarr', { type: 'setupFaction', revealedBelt: 'pyrite', devs: AMARR_DEVS });
    expect(t.game).toMatchObject({ phase: 'setup', round: 0, turn: null });
    t.dispatch('caldari', { type: 'setupFaction', ...DEFAULT_SETUP.caldari });
    expect(t.game).toMatchObject({ phase: 'actions', round: 1 });
    expect(t.game.turn).toEqual({ faction: 'caldari', actionTaken: null, deployable: false });
  });
});

describe('startedGame fixture', () => {
  it('reaches round 1 of the action phase with every faction set up', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente', 'minmatar']);
    expect(t.game).toMatchObject({ phase: 'actions', round: 1, firstPlayer: 'amarr' });
    expect(t.game.turn?.faction).toBe('amarr');
    for (const f of t.game.seats) {
      expect(t.p(f)).toMatchObject({ setupDone: true, devAreaCount: 4, uid: uidOf(f) });
      expect(t.privs[f].area.map((c) => c.dev)).toEqual(DEFAULT_SETUP[f].devs);
    }
  });

  it('honours a different first player and setup', () => {
    const t = startedGame(['amarr', 'caldari'], {
      firstPlayer: 'caldari',
      setup: { amarr: { revealedBelt: 'morphite', devs: AMARR_DEVS } },
    });
    expect(t.game.turn?.faction).toBe('caldari');
    expect(t.p('amarr').belts.morphite).toBe(1);
    expect(t.privs.amarr.area.map((c) => c.dev)).toEqual(AMARR_DEVS);
  });
});

describe('apply', () => {
  function deepFreeze<T>(x: T): T {
    if (typeof x === 'object' && x !== null) {
      for (const v of Object.values(x)) deepFreeze(v);
      Object.freeze(x);
    }
    return x;
  }

  it('never mutates its inputs', () => {
    const t = inSetup();
    const game = deepFreeze(structuredClone(t.game));
    const priv = deepFreeze(structuredClone(t.privs.amarr));
    const cmd = deepFreeze<Command>({ type: 'setupFaction', revealedBelt: 'pyrite', devs: [...AMARR_DEVS] });
    const r = ok(apply(game, cmd, deepFreeze({ actor: 'amarr', uid: uidOf('amarr'), priv, now: NOW })));
    expect(r.game).not.toBe(game);
    expect(r.priv).not.toBe(priv);
    expect(game).toEqual(t.game);
    expect(priv).toEqual(t.privs.amarr);
  });

  it('does not share arrays between the command and the new state', () => {
    const t = newGame(['amarr', 'caldari']);
    const seats: FactionId[] = ['caldari', 'amarr'];
    const r = t.dispatch('amarr', { type: 'setSeats', seats });
    seats.reverse();
    expect(r.game.seats).toEqual(['caldari', 'amarr']);
  });

  it('keeps every state JSON-safe (no undefined anywhere)', () => {
    const lobby = newGame(['amarr', 'caldari']);
    const setup = inSetup();
    const started = startedGame(['amarr', 'caldari', 'gallente']);
    for (const t of [lobby, setup, started]) {
      expect(JSON.parse(JSON.stringify(t.game))).toStrictEqual(t.game);
      for (const f of t.game.seats) expect(JSON.parse(JSON.stringify(t.privs[f]))).toStrictEqual(t.privs[f]);
    }
  });

  it('answers commands without a handler with not_implemented', () => {
    const t = startedGame(['amarr', 'caldari']);
    for (const type of ['noSuchCommand', 'constructor', 'toString', '__proto__']) {
      expect(codeOf(t.tryDispatch('amarr', { type } as unknown as Command))).toBe('not_implemented');
    }
    expect(codeOf(t.tryDispatch('amarr', { type: 'action', action: 'warp' } as unknown as Command))).toBe('not_implemented');
  });
});

describe('isError', () => {
  it('recognises RuleErrors only', () => {
    expect(isError({ error: true, code: 'x', message: 'y' })).toBe(true);
    expect(isError({ error: false })).toBe(false);
    expect(isError(null)).toBe(false);
    expect(isError('error')).toBe(false);
  });
});
