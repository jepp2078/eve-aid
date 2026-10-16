import { describe, expect, it } from 'vitest';
import { actionAvailability, cubeCost, cubeCostLabel, cubeTrack, lightStatus, slotsLeft } from '../../src/ui/lib/actions';
import { startedGame } from '../engine/helpers';

describe('cube cost labels', () => {
  it('names the next cube and what it costs', () => {
    expect(cubeCostLabel(0)).toBe('Cube 1 · free');
    expect(cubeCostLabel(2)).toBe('Cube 3 · free');
    expect(cubeCostLabel(3)).toBe('Cube 4 · −5 ISK');
    expect(cubeCostLabel(4)).toBe('Cube 5 · −10 ISK');
    expect(cubeCostLabel(5)).toBe('No cubes left');
    expect(cubeCost(3)).toBe(5);
    expect(cubeCost(5)).toBe(0);
  });

  it('draws the track: used filled, the next one marked, paid cubes carry their price', () => {
    expect(cubeTrack(3)).toStrictEqual([
      { n: 1, used: true, cost: 0, next: false },
      { n: 2, used: true, cost: 0, next: false },
      { n: 3, used: true, cost: 0, next: false },
      { n: 4, used: false, cost: 5, next: true },
      { n: 5, used: false, cost: 10, next: false },
    ]);
    expect(cubeTrack(5).every((c) => c.used && !c.next)).toBe(true);
  });
});

describe('actionAvailability', () => {
  it('allows an action on my turn before acting, with the cube price', () => {
    const t = startedGame(['amarr', 'caldari']);
    expect(actionAvailability(t.game, 'amarr', 'move')).toStrictEqual({ ok: true, cost: 0 });
    expect(slotsLeft(t.p('amarr'), 'move')).toBe(2);
    expect(slotsLeft(t.p('amarr'), 'build')).toBe(1);
  });

  it('explains why an action is unavailable', () => {
    const t = startedGame(['amarr', 'caldari']);
    expect(actionAvailability(t.game, 'caldari', 'move')).toStrictEqual({ ok: false, reason: 'Not your turn: Amarr is playing' });
    t.dispatch('amarr', { type: 'action', action: 'move' });
    expect(actionAvailability(t.game, 'amarr', 'claim')).toStrictEqual({
      ok: false,
      reason: 'You already took an action this turn (Move); end your turn',
    });
  });

  it('reports used slots, used cubes and unaffordable cubes', () => {
    const t = startedGame(['amarr', 'caldari']);
    const me = t.p('amarr');
    me.slots.build = 1;
    expect(actionAvailability(t.game, 'amarr', 'build')).toStrictEqual({ ok: false, reason: 'The Build slot is used this round' });
    me.slots.move = 2;
    expect(actionAvailability(t.game, 'amarr', 'move')).toStrictEqual({ ok: false, reason: 'Both Move slots are used this round' });
    me.cubesUsed = 3;
    me.res.isk = 2;
    expect(actionAvailability(t.game, 'amarr', 'claim')).toStrictEqual({ ok: false, reason: 'Your 4th cube costs 5 ISK; you have 2' });
    me.cubesUsed = 5;
    expect(actionAvailability(t.game, 'amarr', 'claim')).toStrictEqual({ ok: false, reason: 'All 5 action cubes are used' });
  });

  it('says when I passed or when it is not the action phase', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', { type: 'pass' });
    expect(actionAvailability(t.game, 'amarr', 'move')).toStrictEqual({ ok: false, reason: 'You passed this round' });
    t.dispatch('caldari', { type: 'pass' });
    expect(t.game.phase).toBe('upkeep');
    expect(actionAvailability(t.game, 'caldari', 'move')).toStrictEqual({ ok: false, reason: 'Upkeep now; actions resume next round' });
  });
});

describe('lightStatus', () => {
  /** A light game, Amarr to act. */
  const light = () => startedGame(['amarr', 'caldari'], { mode: 'light' });

  it('tells me to play on the board, then End turn, on my turn', () => {
    const t = light();
    expect(lightStatus(t.game, 'amarr')).toBe('Your turn: play your action on the board, then End turn');
  });

  it('names whose turn it is otherwise', () => {
    const t = light();
    expect(lightStatus(t.game, 'caldari')).toBe("Amarr's turn");
    t.dispatch('amarr', { type: 'endTurn' });
    expect(lightStatus(t.game, 'amarr')).toBe("Caldari's turn");
    expect(lightStatus(t.game, null)).toBe("Caldari's turn");
  });

  it('says I passed until the round ends', () => {
    const t = light();
    t.dispatch('amarr', { type: 'pass' });
    expect(lightStatus(t.game, 'amarr')).toBe('You passed: waiting for the others');
    expect(lightStatus(t.game, 'caldari')).toBe('Your turn: play your action on the board, then End turn');
  });

  it('points to the upkeep once everyone passed, and says when the game is over', () => {
    const t = light();
    t.dispatch('amarr', { type: 'pass' });
    t.dispatch('caldari', { type: 'pass' });
    expect(t.game.phase).toBe('upkeep');
    expect(lightStatus(t.game, 'amarr')).toBe('Upkeep: confirm on your phone');
    expect(lightStatus(t.game, 'caldari')).toBe('Upkeep: confirm on your phone');
    t.game.phase = 'ended';
    expect(lightStatus(t.game, 'amarr')).toBe('The game is over');
  });
});
