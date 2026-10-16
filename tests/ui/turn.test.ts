import { describe, expect, it } from 'vitest';
import { turnStatus } from '../../src/ui/lib/turn';
import { newGame, startedGame } from '../engine/helpers';

describe('turnStatus', () => {
  it('says nothing before the first round', () => {
    const t = newGame(['amarr', 'caldari']);
    expect(turnStatus(t.game, 'amarr').kind).toBe('idle');
  });

  it("shows the active player and that they are choosing an action", () => {
    const t = startedGame(['amarr', 'caldari']);
    expect(turnStatus(t.game, 'caldari')).toStrictEqual({
      kind: 'other',
      faction: 'amarr',
      title: 'Amarr',
      detail: 'Ana · choosing action',
      round: 1,
    });
  });

  it('turns into "Your turn" on the active player\'s device, naming the action once taken', () => {
    const t = startedGame(['amarr', 'caldari']);
    expect(turnStatus(t.game, 'amarr')).toMatchObject({ kind: 'mine', faction: 'amarr', title: 'Your turn', detail: 'Choose an action' });
    t.dispatch('amarr', { type: 'action', action: 'move' });
    expect(turnStatus(t.game, 'amarr')).toMatchObject({ kind: 'mine', detail: 'Move done' });
    expect(turnStatus(t.game, 'caldari')).toMatchObject({ kind: 'other', detail: 'Ana · Move' });
  });

  it('in a light game, says "End turn or pass" on my turn and just names the player on anyone else\'s', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    expect(turnStatus(t.game, 'amarr')).toStrictEqual({ kind: 'mine', faction: 'amarr', title: 'Your turn', detail: 'End turn or pass', round: 1 });
    expect(turnStatus(t.game, 'caldari')).toStrictEqual({ kind: 'other', faction: 'amarr', title: 'Amarr', detail: 'Ana', round: 1 });
    expect(turnStatus(t.game, null)).toMatchObject({ kind: 'other', detail: 'Ana' }); // the big screen
    t.dispatch('amarr', { type: 'lightClaim', from: null, central: false }); // light plays take no action
    expect(turnStatus(t.game, 'amarr').detail).toBe('End turn or pass');
    expect(turnStatus(t.game, 'caldari').detail).toBe('Ana');
  });

  it('counts upkeep confirmations', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.dispatch('amarr', { type: 'pass' });
    t.dispatch('caldari', { type: 'pass' });
    expect(t.game.phase).toBe('upkeep');
    expect(turnStatus(t.game, 'amarr')).toMatchObject({ kind: 'upkeep', faction: null, title: 'Upkeep', detail: '0 of 2 confirmed' });
  });

  it('names the winner when the game is over', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.game.phase = 'ended';
    t.game.turn = null;
    t.game.result = { ranking: ['caldari', 'amarr'], winners: ['caldari'] };
    expect(turnStatus(t.game, 'amarr')).toMatchObject({ kind: 'ended', title: 'Game over', detail: 'Caldari wins' });
    t.game.result = { ranking: ['caldari', 'amarr'], winners: ['caldari', 'amarr'] };
    expect(turnStatus(t.game, 'amarr').detail).toBe('Caldari and Amarr share the win');
  });
});
