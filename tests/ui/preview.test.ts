import { describe, expect, it } from 'vitest';
import type { Command, GameState } from '../../src/engine/types';
import { changeText, consequence, diffPlayer, iskLost, previewCommand, type Change, type PreviewOk } from '../../src/ui/lib/preview';
import { NOW, startedGame, uidOf, type Table } from '../engine/helpers';

function deepFreeze<T>(x: T): T {
  if (typeof x === 'object' && x !== null) {
    Object.freeze(x);
    for (const v of Object.values(x)) deepFreeze(v);
  }
  return x;
}

function preview(t: Table, cmd: Command, iskNet: number | null = null) {
  return previewCommand({ game: t.game, priv: t.privs.amarr, faction: 'amarr', uid: uidOf('amarr'), now: NOW }, cmd, iskNet);
}

function ok(p: ReturnType<typeof preview>): PreviewOk {
  if (!p.ok) throw new Error(`expected a preview, got ${p.error.code}`);
  return p;
}

describe('previewCommand', () => {
  it('shows the rule error instead of changes', () => {
    const t = startedGame(['amarr', 'caldari']);
    const p = preview(t, { type: 'action', action: 'trade', ops: [{ dir: 'buy', item: 'component', mineral: null }] });
    expect(p).toMatchObject({ ok: false, error: { code: 'insufficient', message: 'Not enough ISK (need 7, have 4)' } });
  });

  it('diffs my player before and after, never touching the live game', () => {
    const t = startedGame(['amarr', 'caldari']);
    t.p('amarr').res.tritanium = 2;
    const game = deepFreeze(structuredClone(t.game)) as GameState;
    const p = ok(
      previewCommand(
        { game, priv: t.privs.amarr, faction: 'amarr', uid: uidOf('amarr'), now: NOW },
        { type: 'action', action: 'build', items: [{ kind: 'ship', ship: 'heretic' }] },
      ),
    );
    expect(p.changes.map(changeText)).toStrictEqual(['ISK 4→0', 'Tritanium 2→1', 'Minerals 3→2/12', 'Heretic 0→1', 'Cubes 0→1/5']);
    expect(game.players.amarr!.res.isk).toBe(4);
  });

  it('reports ISK lost to the cap when the net gain is known', () => {
    const t = startedGame(['amarr', 'caldari']);
    Object.assign(t.p('amarr').res, { isk: 46, component: 1 });
    const p = ok(preview(t, { type: 'action', action: 'trade', ops: [{ dir: 'sell', item: 'component', mineral: null }] }, 6));
    expect(p.iskLost).toBe(3);
    expect(p.changes.map(changeText)[0]).toBe('+6 ISK → 49 (3 lost)');
  });

  it('notes ISK lost even when the balance stays at the cap', () => {
    const t = startedGame(['amarr', 'caldari']);
    Object.assign(t.p('amarr').res, { isk: 49, component: 1 });
    const p = ok(preview(t, { type: 'action', action: 'trade', ops: [{ dir: 'sell', item: 'component', mineral: null }] }, 6));
    expect(p.changes.map(changeText)).toContain('+6 ISK → 49 (6 lost)');
  });

  it('counts minerals over the cap and research to place', () => {
    const t = startedGame(['amarr', 'caldari']);
    Object.assign(t.p('amarr').res, { pyrite: 6, mexallon: 6 });
    t.dispatch('amarr', { type: 'action', action: 'move' });
    const p = ok(preview(t, { type: 'discover', rewards: [{ kind: 'minerals', minerals: ['tritanium', 'tritanium'] }, { kind: 'research', amount: 2 }] }));
    expect(p.mineralsOver).toBe(2);
    expect(p.changes.map(changeText)).toStrictEqual(['Tritanium 0→2', 'Minerals 12→14/12', 'Research to place 0→2']);
  });
});

describe('diffPlayer', () => {
  it('lists systems, central, structures, belts and ships', () => {
    const t = startedGame(['amarr', 'caldari']);
    const before = t.p('amarr');
    const after = structuredClone(before);
    after.systems = 2;
    after.central = true;
    after.structures.citadel = 1;
    after.homeCitadels = 1;
    after.belts.pyrite = 2;
    after.lockedHomeBelts = 1;
    after.ships.heretic = 2;
    expect(diffPlayer(before, after, null, null).map(changeText)).toStrictEqual([
      'Systems 0→2',
      'Central system: yours',
      'Citadel 0→1',
      'Home citadels 0→1',
      'Pyrite belts 1→2',
      'Locked home belts 2→1',
      'Heretic 0→2',
    ]);
  });

  it('names the central flag by seat count: the most tier 3 systems with 2 players', () => {
    const t = startedGame(['amarr', 'caldari']);
    const before = t.p('amarr');
    const after = { ...structuredClone(before), central: true };
    expect(diffPlayer(before, after, null, null, 2).map(changeText)).toStrictEqual(['Most tier 3 systems: yours']);
    expect(diffPlayer(before, after, null, null, 3).map(changeText)).toStrictEqual(['Central system: yours']);
  });
});

describe('consequence labels', () => {
  const changes: Change[] = [
    { kind: 'res', key: 'isk', before: 12, after: 8 },
    { kind: 'res', key: 'tritanium', before: 3, after: 2 },
    { kind: 'minerals', before: 4, after: 3, cap: 12 },
    { kind: 'count', id: 'cubes', label: 'Cubes', before: 1, after: 2, max: 5 },
  ];

  it('appends the main resource deltas to the action', () => {
    expect(consequence('Build Heretic', changes)).toBe('Build Heretic · −4\u00a0ISK · −1\u00a0Trit'); // no-break space: "−4 ISK" never splits
    expect(consequence('Move', [changes[3]!])).toBe('Move');
    expect(consequence('Claim', [{ kind: 'count', id: 'systems', label: 'Systems', before: 1, after: 2, max: null }])).toBe('Claim · +1\u00a0system');
  });

  it('names up to 3 changes, then how many more (K5)', () => {
    const res = (key: 'isk' | 'pyrite' | 'mexallon' | 'tritanium' | 'morphite', d: number): Change => ({ kind: 'res', key, before: 5, after: 5 + d });
    expect(consequence('Trade', [res('isk', 6), res('pyrite', -1), res('mexallon', -1)])).toBe('Trade · +6\u00a0ISK · −1\u00a0Pyr · −1\u00a0Mex');
    expect(consequence('Trade', [res('isk', 6), res('pyrite', -1), res('mexallon', -1), res('tritanium', -1), res('morphite', -1)])).toBe(
      'Trade · +6\u00a0ISK · −1\u00a0Pyr · −1\u00a0Mex · +2\u00a0more',
    );
  });

  it('computes ISK lost to the cap from the uncapped net change', () => {
    expect(iskLost(46, 49, 6)).toBe(3);
    expect(iskLost(10, 16, 6)).toBe(0);
    expect(iskLost(46, 49, null)).toBe(0);
  });
});
