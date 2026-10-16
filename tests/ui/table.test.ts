import { describe, expect, it } from 'vitest';
import { DEV } from '../../src/data/developments';
import { shipsOf } from '../../src/data/ships';
import { createGame } from '../../src/engine/create';
import type { Command } from '../../src/engine/types';
import { combatText, forceCopy, forceOutcome, phaseText, rowStatus, seatDetail, seatedFactions, TAKE_OVER_HINT } from '../../src/ui/lib/table';
import { NOW, startedGame, uidOf, type Table } from '../engine/helpers';

function inUpkeep(): Table {
  const t = startedGame(['amarr', 'caldari', 'gallente']);
  while (t.game.phase === 'actions') t.dispatch(t.game.turn!.faction, { type: 'pass' });
  return t;
}

const UPKEEP: Command = { type: 'confirmUpkeep', refinery: { planetary: 0, moon: 0, convert: 0 }, discard: {}, raids: [], researchLab: false };

describe('seatedFactions', () => {
  it('lists seated factions in clockwise seat order', () => {
    const t = startedGame(['caldari', 'amarr', 'gallente']);
    expect(seatedFactions(t.game)).toStrictEqual(t.game.seats);
    delete t.game.players.amarr;
    expect(seatedFactions(t.game)).toStrictEqual(t.game.seats.filter((f) => f !== 'amarr'));
  });
});

describe('phaseText', () => {
  it('names the round and the phase', () => {
    const t = startedGame(['amarr', 'caldari']);
    expect(phaseText(t.game)).toBe('Round 1 · Actions');
  });

  it('counts confirmed upkeeps, and says when the upkeep is the emergency one', () => {
    const t = inUpkeep();
    expect(phaseText(t.game)).toBe('Round 1 · Upkeep · 0/3 confirmed');
    t.dispatch('amarr', UPKEEP);
    expect(phaseText(t.game)).toBe('Round 1 · Upkeep · 1/3 confirmed');
    t.game.upkeep!.emergency = true;
    expect(phaseText(t.game)).toBe('Round 1 · Emergency upkeep · 1/3 confirmed');
  });

  it('names the winners once the game is over', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.game.phase = 'ended';
    t.game.result = { ranking: ['caldari', 'amarr'], winners: ['caldari'] };
    expect(phaseText(t.game)).toBe('Game over · Caldari wins');
    t.game.result = { ranking: ['caldari', 'amarr'], winners: ['caldari', 'amarr'] };
    expect(phaseText(t.game)).toBe('Game over · Caldari and Amarr share the victory');
  });

  it('counts players in the lobby and finished setups', () => {
    const g = createGame('ABC234', 'host', 'Ana', 'amarr', NOW);
    expect(phaseText(g)).toBe('Lobby · 1 player');
    const t = startedGame(['amarr', 'caldari']);
    t.game.phase = 'setup';
    t.p('caldari').setupDone = false;
    expect(phaseText(t.game)).toBe('Setup · 1/2 ready');
  });
});

describe('rowStatus', () => {
  it('marks the turn holder NOW (active) and the first player', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    expect(rowStatus(t.game, 'amarr')).toStrictEqual({
      active: true,
      dimmed: false,
      tags: [
        { kind: 'now', label: 'NOW' },
        { kind: 'first', label: 'First player' },
      ],
    });
    expect(rowStatus(t.game, 'caldari')).toStrictEqual({ active: false, dimmed: false, tags: [] });
  });

  it('dims a passed player and says so', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.dispatch('amarr', { type: 'pass' });
    expect(rowStatus(t.game, 'amarr')).toStrictEqual({
      active: false,
      dimmed: true,
      tags: [
        { kind: 'first', label: 'First player' },
        { kind: 'passed', label: 'Passed' },
      ],
    });
    expect(rowStatus(t.game, 'caldari').active).toBe(true);
  });

  it('shows upkeep progress instead of passes during the upkeep, and nobody is dimmed', () => {
    const t = inUpkeep();
    t.dispatch('caldari', UPKEEP);
    expect(rowStatus(t.game, 'caldari')).toStrictEqual({ active: false, dimmed: false, tags: [{ kind: 'upkeepDone', label: 'Upkeep done' }] });
    expect(rowStatus(t.game, 'amarr')).toStrictEqual({
      active: false,
      dimmed: false,
      tags: [
        { kind: 'first', label: 'First player' },
        { kind: 'upkeepWaiting', label: 'Waiting' },
      ],
    });
  });

  it('crowns the winners at the end, with no turn or first player', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.game.phase = 'ended';
    t.game.turn = null;
    t.game.result = { ranking: ['caldari', 'amarr'], winners: ['caldari'] };
    expect(rowStatus(t.game, 'caldari')).toStrictEqual({ active: false, dimmed: false, tags: [{ kind: 'winner', label: 'Winner' }] });
    expect(rowStatus(t.game, 'amarr')).toStrictEqual({ active: false, dimmed: false, tags: [] });
  });

  it('has no status in the lobby (the first player is not chosen yet)', () => {
    const g = createGame('ABC234', 'host', 'Ana', 'amarr', NOW);
    expect(rowStatus(g, 'amarr')).toStrictEqual({ active: false, dimmed: false, tags: [] });
  });
});

describe('seatDetail', () => {
  it('lists the public detail: completed developments (no secrets), structures, ships and belts', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    p.completed = [DEV.mediumHull, DEV.galacticTrustFund];
    p.tapped = [DEV.galacticTrustFund];
    p.structures.customs = 2;
    p.structures.citadel = 1;
    p.homeCitadels = 1;
    p.res = { ...p.res, pyrite: 2, mexallon: 0, tritanium: 1, morphite: 0, planetary: 1, moon: 0, component: 3 };
    const d = seatDetail(p);
    expect(d.stock).toStrictEqual([
      { kind: 'pyrite', count: 2 },
      { kind: 'tritanium', count: 1 },
      { kind: 'planetary', count: 1 },
      { kind: 'component', count: 3 },
    ]);
    expect(d.devs).toStrictEqual([
      { id: DEV.mediumHull, name: 'Medium Hull', tapped: false },
      { id: DEV.galacticTrustFund, name: 'Galactic Trust Fund', tapped: true },
    ]);
    expect(d.structures).toStrictEqual([
      { type: 'citadel', label: 'Citadel', count: 1 },
      { type: 'customs', label: 'Customs Office', count: 2 },
    ]);
    expect(d.homeCitadels).toBe(1);
    const owned = shipsOf('amarr').filter((s) => (p.ships[s.id] ?? 0) > 0);
    expect(d.ships).toStrictEqual(owned.map((s) => ({ id: s.id, name: s.name, count: p.ships[s.id] })));
    expect(d.belts).toStrictEqual([{ mineral: 'pyrite', count: 1 }]);
    expect(d.lockedHomeBelts).toBe(2);
    const shipCount = owned.reduce((n, s) => n + p.ships[s.id]!, 0);
    expect(d.summary).toBe(`2 developments · 3 structures · ${shipCount} ships`);
    expect([d.structureCount, d.shipCount]).toStrictEqual([3, shipCount]);
  });

  it('never lists in-progress developments, which are not in the public state at all', () => {
    const t = startedGame(['amarr', 'caldari']);
    const d = seatDetail(t.p('amarr'));
    expect(d.devs).toStrictEqual([]);
    expect(d.structures).toStrictEqual([]);
    expect(d.summary).toMatch(/^0 developments · 0 structures · \d+ ships$/);
  });

  it('uses the singular for one of a kind', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = t.p('amarr');
    p.completed = [DEV.mediumHull];
    p.structures.refinery = 1;
    p.ships = { [shipsOf('amarr')[0]!.id]: 1 };
    expect(seatDetail(p).summary).toBe('1 development · 1 structure · 1 ship');
  });

  it('in a light game, lists completed developments only: no structures, ships or belts (the board keeps those)', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    const p = t.p('amarr');
    p.completed = [DEV.mediumHull, DEV.galacticTrustFund];
    p.tapped = [DEV.galacticTrustFund];
    // Never set in a light game; here they prove the mode alone keeps them out.
    p.structures.customs = 2;
    p.homeCitadels = 1;
    p.ships = { [shipsOf('amarr')[0]!.id]: 2 };
    p.belts.pyrite = 1;
    expect(p.lockedHomeBelts).toBe(2);
    expect(p.devAreaCount).toBe(4);
    expect(seatDetail(p, 'light')).toStrictEqual({
      stock: [],
      devs: [
        { id: DEV.mediumHull, name: 'Medium Hull', tapped: false },
        { id: DEV.galacticTrustFund, name: 'Galactic Trust Fund', tapped: true },
      ],
      structures: [],
      homeCitadels: 0,
      ships: [],
      belts: [],
      lockedHomeBelts: 0,
      structureCount: 0,
      shipCount: 0,
      summary: '2 developments done · 4 hidden',
    });
    p.completed = [DEV.mediumHull];
    p.devAreaCount = 1;
    expect(seatDetail(p, 'light').summary).toBe('1 development done · 1 hidden');
    // The default stays the full detail.
    expect(seatDetail(p)).toStrictEqual(seatDetail(p, 'full'));
    expect(seatDetail(p).summary).toBe('1 development · 2 structures · 2 ships');
  });
});

describe('forceOutcome and forceCopy', () => {
  it('hands the turn to the next player who has not passed', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    expect(forceOutcome(t.game, 'gallente', uidOf('gallente'))).toStrictEqual({ kind: 'next', faction: 'caldari' });
    t.p('caldari').passed = true;
    expect(forceOutcome(t.game, 'gallente', uidOf('gallente'))).toStrictEqual({ kind: 'next', faction: 'gallente' });
  });

  it('gives the holder the turn again when everyone else has passed', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').passed = true;
    expect(forceOutcome(t.game, 'caldari', uidOf('caldari'))).toStrictEqual({ kind: 'again' });
  });

  it('ends the round when an emergency upkeep is pending', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.game.verge = { by: 'caldari', finalRound: 2, emergencyPending: true };
    expect(forceOutcome(t.game, 'caldari', uidOf('caldari'))).toStrictEqual({ kind: 'upkeep', emergency: true });
  });

  it('reports why it cannot be done', () => {
    const t = inUpkeep();
    const r = forceOutcome(t.game, 'caldari', uidOf('caldari'));
    expect(r.kind).toBe('error');
  });

  it('cannot skip a turn with a combat open: the combat must be cancelled or finished first', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', { type: 'combatStart', defender: 'caldari', homeOf: null, controller: null, citadels: 0 });
    const r = forceOutcome(t.game, 'caldari', uidOf('caldari'));
    expect(r).toStrictEqual({ kind: 'combat' });
    const copy = forceCopy(t.game, r)!;
    expect(copy.next).toBe('A combat is still open, and it belongs to this turn: cancel it first (Combat → More → Cancel combat), or let Amarr finish it.');
    expect(copy.hint).toBe(null);
  });

  it('words the confirmation with the consequence', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    const copy = forceCopy(t.game, forceOutcome(t.game, 'gallente', uidOf('gallente')))!;
    expect(copy.title).toBe("Skip Amarr's turn?");
    expect(copy.confirm).toBe("Skip Amarr's turn");
    expect(copy.cancel).toBe('Keep waiting');
    expect(copy.done).toBe("Skipped Amarr's turn");
    expect(copy.where).toContain("Amarr hasn't taken an action yet");
    expect(copy.next).toBe('Caldari takes the turn next.');
    expect(copy.note).toContain('anyone can undo it');

    t.dispatch('amarr', { type: 'action', action: 'move' });
    const after = forceCopy(t.game, forceOutcome(t.game, 'gallente', uidOf('gallente')))!;
    expect(after.where).toContain("Amarr took a Move action but hasn't ended the turn");

    t.game.turn!.actionTaken = 'extract';
    const extracted = forceCopy(t.game, forceOutcome(t.game, 'gallente', uidOf('gallente')))!;
    expect(extracted.where).toContain("Amarr took an Extract action but hasn't ended the turn");
  });

  it("in a light game, says the app can't see whether the holder played (no actions are recorded)", () => {
    const t = startedGame(['amarr', 'caldari', 'gallente'], { mode: 'light' });
    expect(t.game.turn!.actionTaken).toBeNull();
    const copy = forceCopy(t.game, forceOutcome(t.game, 'gallente', uidOf('gallente')))!;
    expect(copy.where).toBe("The app can't see the board, so it doesn't know whether Amarr has played. Skipping ends their turn without passing them.");
    expect(copy.next).toBe('Caldari takes the turn next.');
    expect(copy.title).toBe("Skip Amarr's turn?");

    // A full game with no action yet keeps its own words.
    const full = startedGame(['amarr', 'caldari', 'gallente']);
    expect(forceCopy(full.game, forceOutcome(full.game, 'gallente', uidOf('gallente')))!.where).toBe(
      "Amarr hasn't taken an action yet. Skipping doesn't pass them: they play again when the turn comes round.",
    );
  });

  it('words the other outcomes', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('caldari').passed = true;
    expect(forceCopy(t.game, { kind: 'again' })!.next).toBe('Everyone else has passed, so Amarr gets the turn again.');
    expect(forceCopy(t.game, { kind: 'again' })!.hint).toBe(TAKE_OVER_HINT);
    expect(forceCopy(t.game, { kind: 'next', faction: 'caldari' })!.hint).toBe(null);
    expect(forceCopy(t.game, { kind: 'upkeep', emergency: true })!.next).toContain('emergency upkeep');
    expect(forceCopy(t.game, { kind: 'error', message: 'Nope' })!.next).toBe("It can't be done right now: Nope.");
  });

  it('has nothing to say without a turn', () => {
    const t = inUpkeep();
    expect(forceCopy(t.game, { kind: 'again' })).toBeNull();
  });
});

describe('TAKE_OVER_HINT', () => {
  it('says how a seat moves to another device, in one line', () => {
    expect(TAKE_OVER_HINT.replaceAll('\u2060', '')).toBe(
      "Phone died or player gone? On any device that isn't in the game (on the laptop, add ?as=spare to the address): Join → code → their faction → Take over.",
    );
  });

  it('keeps ?as=spare on one line (a word joiner after the "?", where a phone would break it)', () => {
    expect(TAKE_OVER_HINT).toContain(' ?\u2060as=spare ');
  });
});

describe('combatText', () => {
  it('says who fights and where the combat stands', () => {
    const t = startedGame(['amarr', 'caldari']);
    expect(combatText(t.game)).toBeNull();
    t.dispatch('amarr', { type: 'combatStart', defender: 'caldari', homeOf: null, controller: null, citadels: 0 });
    expect(combatText(t.game)).toBe('Amarr attacks Caldari · Assigning fleets');
    const c = t.game.combat!;
    c.stage = 'attack';
    c.round = 2;
    c.step = { orbit: 'medium', side: 'defender' };
    expect(combatText(t.game)).toBe('Amarr attacks Caldari · Round 2 · Attacks · Medium orbit');
  });
});
