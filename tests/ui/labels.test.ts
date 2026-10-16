import { describe, expect, it } from 'vitest';
import { centralWords, commandLabel, KEYWORD_LABEL, RESOURCE_LABEL, TIER_LABEL } from '../../src/ui/lib/labels';

describe('commandLabel', () => {
  it('names lobby and setup commands for the undo snackbar', () => {
    expect(commandLabel({ type: 'setSeats', seats: ['amarr', 'caldari'] })).toBe('Seats changed');
    expect(commandLabel({ type: 'startGame', firstPlayer: 'amarr' })).toBe('Game started');
    expect(commandLabel({ type: 'setupFaction', revealedBelt: 'pyrite', devs: [] })).toBe('Setup confirmed');
    expect(commandLabel({ type: 'join', name: 'Ann', faction: 'amarr' })).toBe('Joined as Amarr');
    expect(commandLabel({ type: 'takeOver', faction: 'gallente' })).toBe('Took over Gallente');
  });

  it('names actions by their action', () => {
    expect(commandLabel({ type: 'action', action: 'move' })).toBe('Move');
    expect(commandLabel({ type: 'action', action: 'trade', ops: [] })).toBe('Trade');
    expect(commandLabel({ type: 'endTurn' })).toBe('Turn ended');
    expect(commandLabel({ type: 'pass' })).toBe('Passed');
  });

  it('names the light-only commands', () => {
    expect(commandLabel({ type: 'lightClaim', from: null, central: false })).toBe('Claimed a system');
    // Told apart from a claim by fleet strength in the log and the undo snackbar.
    expect(commandLabel({ type: 'autoClaim', central: false })).toBe('System claimed');
    expect(commandLabel({ type: 'gainResearch', research: 2 })).toBe('Research gained');
  });
});

describe('labels', () => {
  it('has a readable name for every resource and keyword', () => {
    expect(RESOURCE_LABEL.isk).toBe('ISK');
    expect(RESOURCE_LABEL.morphite).toBe('Morphite');
    expect(KEYWORD_LABEL.use_in_combat).toBe('Use in combat');
  });
});

describe('TIER_LABEL', () => {
  it('names the Systems card behind every ability tier', () => {
    expect(TIER_LABEL).toEqual({
      O1: 'Offensive Systems T1',
      O2: 'Offensive Systems T2',
      D1: 'Defensive Systems T1',
      D2: 'Defensive Systems T2',
      U1: 'Utility Systems T1',
      U2: 'Utility Systems T2',
    });
  });
});

describe('centralWords', () => {
  it('names the central system in 3- and 4-player games', () => {
    for (const seats of [3, 4]) {
      expect(centralWords(seats)).toMatchObject({ name: 'Central system', tag: 'Central', claim: "It's the central system", note: 'Worth 1 VP in each upkeep' });
    }
  });

  it('names the most tier 3 systems in a 2-player game, which has no central system (official errata)', () => {
    const w = centralWords(2);
    expect(w).toMatchObject({ name: 'Most tier 3 systems', tag: 'Most T3', count: 'most T3', claim: 'Now the most tier 3 systems', held: 'You have the most' });
    expect(w.note).toBe('Worth 1 VP in each upkeep; nobody on a tie');
    for (const text of Object.values(w)) expect(text.toLowerCase()).not.toContain('central');
  });
});
