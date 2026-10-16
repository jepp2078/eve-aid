/**
 * A whole light game, driven only by commands through `apply` (spec 7): three players from creation to the final
 * ranking, using what a light game keeps (research, cards, systems, combat, VP, upkeep) and none of what the board
 * keeps. Every number below follows from the rules, so each checkpoint says where the VP come from.
 */
import { describe, expect, it } from 'vitest';
import { DEV } from '../../src/data/developments';
import type { DevId, FactionId } from '../../src/data/types';
import { isError, type Command } from '../../src/engine/types';
import { battle, dice, hit, lead, miss, noRetreat } from './combat/fixtures';
import { startedGame, type Table } from './helpers';

const none = { kind: 'none' } as const;
const noBoard = { isk: 0, pyrite: 0, mexallon: 0, tritanium: 0, morphite: 0, planetary: 0, moon: 0, component: 0 };

describe('a light game, start to finish', () => {
  it('plays a three-player light game from creation to the final ranking', () => {
    const t: Table = startedGame(['amarr', 'caldari', 'gallente'], {
      mode: 'light',
      setup: { amarr: { revealedBelt: null, devs: [DEV.fleetSupremacy, DEV.technologicalBreakthrough, DEV.galacticTrustFund, DEV.assemblyLine] } },
    });
    const run = (f: FactionId, cmd: Command): void => void t.dispatch(f, cmd);
    const endTurn = (f: FactionId): void => run(f, { type: 'endTurn' });
    const pass = (f: FactionId): void => run(f, { type: 'pass' });
    const claim = (f: FactionId, from: FactionId | null = null, n = 1): void => {
      for (let i = 0; i < n; i++) run(f, { type: 'lightClaim', from, central: false });
    };
    const gain = (f: FactionId, research: number): void => run(f, { type: 'gainResearch', research });
    const place = (f: FactionId, alloc: Record<DevId, number>): void => run(f, { type: 'distributeResearch', alloc, fetch: [] });
    const mission = (f: FactionId, vp: number): void => run(f, { type: 'missionComplete', vp });
    const upkeep = (f: FactionId, o: { research?: number; raids?: FactionId[]; largeShip?: boolean } = {}): void =>
      run(f, { type: 'lightUpkeep', research: o.research ?? 0, researchLab: false, raids: o.raids ?? [], largeShip: o.largeShip ?? false });
    const vp = (): number[] => t.game.seats.map((f) => t.p(f).vp);
    const systems = (): number[] => t.game.seats.map((f) => t.p(f).systems);

    expect(t.game).toMatchObject({ mode: 'light', phase: 'actions', round: 1, firstPlayer: 'amarr' });
    expect(t.game.turn?.faction).toBe('amarr');

    // ---- Round 1, Amarr: research from the board, two cards completed, a system, a combat won -------------------------
    gain('amarr', 4); // a discovery
    gain('amarr', 6); // a mission
    expect(t.privs.amarr.pendingResearch).toBe(10);
    expect(t.tryDispatch('amarr', { type: 'endTurn' })).toMatchObject({ error: true, code: 'pending_research' });
    place('amarr', { [DEV.technologicalBreakthrough]: 4, [DEV.fleetSupremacy]: 6 });
    expect(t.privs.amarr.pendingResearch).toBe(0);
    run('amarr', { type: 'completeDev', dev: DEV.technologicalBreakthrough }); // +1 VP
    run('amarr', { type: 'completeDev', dev: DEV.fleetSupremacy });
    expect(t.p('amarr').completed).toStrictEqual([DEV.technologicalBreakthrough, DEV.fleetSupremacy]);
    expect(t.privs.amarr.area.map((c) => c.dev)).toStrictEqual([DEV.galacticTrustFund, DEV.assemblyLine]);
    claim('amarr');

    // Amarr's Zealot against Caldari's Crow, from the box: the Crow misses, the Zealot kills it (+1 VP).
    const b = battle([lead('zealot')], [lead('crow')], { table: t });
    noRetreat(b);
    miss(b, 'defender');
    hit(b, 'attacker', b.uid('defender', 'crow'), dice({ aim: 3, damage: 1 }));
    expect(b.c().stage).toBe('end');
    run('caldari', { type: 'combatFinish', noEscape: false });
    expect(t.game.combat).toBeNull();
    expect(t.p('caldari').ships).toStrictEqual({});
    expect(vp()).toStrictEqual([2, 0, 0]);
    expect(systems()).toStrictEqual([1, 0, 0]);
    endTurn('amarr');

    // ---- Round 1, Caldari: Underdog needs 2 research on the card; two systems --------------------------------------
    expect(t.game.turn?.faction).toBe('caldari');
    gain('caldari', 2);
    place('caldari', { [DEV.underdog]: 2 });
    run('caldari', { type: 'completeDev', dev: DEV.underdog });
    claim('caldari', null, 2);
    endTurn('caldari');

    // ---- Round 1, Gallente: takes a system from Caldari; a mission worth 2 VP ---------------------------------------
    run('gallente', { type: 'lightClaim', from: 'caldari', central: false });
    expect(t.last?.notices).toStrictEqual([{ to: 'caldari', text: 'Gallente took one of your systems', kind: 'todo' }]);
    expect(systems()).toStrictEqual([1, 1, 1]);
    mission('gallente', 2);
    endTurn('gallente');
    expect(vp()).toStrictEqual([2, 0, 2]);

    // ---- Round 1, second pass: Amarr passes, Caldari is the underdog, Gallente passes -------------------------------
    pass('amarr');
    expect(t.game.turn?.faction).toBe('caldari');
    run('caldari', { type: 'useDev', dev: DEV.underdog, params: none }); // 0 VP against 2 and 2: +1
    expect(t.p('caldari').vp).toBe(1);
    expect(t.p('caldari').tapped).toStrictEqual([DEV.underdog]);
    pass('caldari');
    pass('gallente');

    // ---- Round 1 upkeep: Amarr's raid on Caldari succeeded at the table, and Amarr has a large ship ---------------------
    expect(t.game.phase).toBe('upkeep');
    expect(t.game.upkeep).toStrictEqual({ emergency: false, confirmed: [], raids: [], largeShips: [] });
    upkeep('amarr', { research: 3, raids: ['caldari'], largeShip: true });
    expect(t.game.upkeep).toStrictEqual({
      emergency: false,
      confirmed: ['amarr'],
      raids: [{ raider: 'amarr', target: 'caldari', strength: 0 }],
      largeShips: ['amarr'],
    });
    upkeep('caldari', { research: 3 });
    expect(t.game.phase).toBe('upkeep');
    upkeep('gallente', { research: 3 });
    // The raid takes Caldari's VP (3, 0, 2) and Fleet Supremacy scores for Amarr (+1). Nobody has 5 systems yet.
    expect(vp()).toStrictEqual([4, 0, 2]);
    expect(t.last?.lines).toContain("Amarr's raid on Caldari succeeds");
    expect(t.last?.lines).toContain('Fleet Supremacy: Amarr has a large ship');
    expect(t.last?.lines.some((l) => l.startsWith('Domination'))).toBe(false);
    expect(t.p('caldari').tapped).toStrictEqual([]); // Underdog is ready again
    expect(t.game).toMatchObject({ phase: 'actions', round: 2, firstPlayer: 'caldari', upkeep: null, verge: null });
    for (const f of t.game.seats) expect(t.privs[f].pendingResearch).toBe(3);

    // ---- Round 2 (Caldari, Gallente, Amarr): everyone places the upkeep's research -----------------------------------
    expect(t.tryDispatch('caldari', { type: 'endTurn' })).toMatchObject({ error: true, code: 'pending_research' });
    place('caldari', { [DEV.offensiveSystemsT1]: 3 });
    mission('caldari', 2);
    endTurn('caldari');

    place('gallente', { [DEV.pacifist]: 3 });
    claim('gallente', null, 4); // Gallente now holds 5 systems
    mission('gallente', 3);
    endTurn('gallente');
    expect(vp()).toStrictEqual([4, 2, 5]);
    expect(systems()).toStrictEqual([1, 1, 5]);

    place('amarr', { [DEV.galacticTrustFund]: 3 });
    claim('amarr', null, 2);
    // A table fix of +6 VP puts Amarr on 10: the verge. The round ends when this turn does.
    run('amarr', {
      type: 'adjust',
      delta: { res: {}, vp: 6, systems: 0, homeCitadels: 0, lockedHomeBelts: 0, structures: {}, belts: {}, ships: {}, central: null },
      correction: false,
      reason: 'event cards',
    });
    expect(t.p('amarr').vp).toBe(10);
    expect(t.game.verge).toStrictEqual({ by: 'amarr', finalRound: 3, emergencyPending: true });
    endTurn('amarr');

    // ---- Emergency upkeep: Gallente raids Amarr; no domination for Gallente's 5 systems; Fleet Supremacy still scores ---
    expect(t.game.phase).toBe('upkeep');
    expect(t.game.upkeep).toStrictEqual({ emergency: true, confirmed: [], raids: [], largeShips: [] });
    upkeep('gallente', { research: 2, raids: ['amarr'] });
    upkeep('caldari', { research: 2 });
    upkeep('amarr', { research: 2, largeShip: true });
    expect(vp()).toStrictEqual([10, 2, 6]); // 10 - 1 (raid) + 1 (Fleet Supremacy); 5 + 1 (raid)
    expect(t.last?.lines.some((l) => l.startsWith('Domination'))).toBe(false);
    expect(t.game).toMatchObject({ phase: 'actions', round: 3, firstPlayer: 'gallente', upkeep: null });
    expect(t.game.verge).toStrictEqual({ by: 'amarr', finalRound: 3, emergencyPending: false });
    expect(t.last?.notices).toContainEqual({ to: 'all', text: "Final round: the game ends after this round's upkeep", kind: 'info' });

    // ---- Round 3, the final round (Gallente, Amarr, Caldari) --------------------------------------------------------
    place('gallente', { [DEV.pacifist]: 2 });
    mission('gallente', 3);
    endTurn('gallente');
    place('amarr', { [DEV.assemblyLine]: 2 });
    endTurn('amarr');
    place('caldari', { [DEV.materialsEfficiency]: 2 });
    endTurn('caldari');
    expect(vp()).toStrictEqual([10, 2, 9]);
    pass('gallente');
    pass('amarr');
    pass('caldari');

    // ---- The final upkeep: domination for Gallente (+2), Fleet Supremacy for Amarr (+1): a tie on 11, won on systems ----
    expect(t.game.phase).toBe('upkeep');
    expect(t.game.upkeep?.emergency).toBe(false);
    upkeep('amarr', { largeShip: true });
    upkeep('caldari');
    expect(t.game.phase).toBe('upkeep');
    upkeep('gallente');

    expect(t.game.phase).toBe('ended');
    expect(vp()).toStrictEqual([11, 2, 11]);
    expect(systems()).toStrictEqual([3, 1, 5]);
    expect(t.game.result).toStrictEqual({ ranking: ['gallente', 'amarr', 'caldari'], winners: ['gallente'] });
    expect(t.game).toMatchObject({ round: 3, turn: null, upkeep: null });
    expect(t.last?.lines).toContain('Domination: Gallente controls 5 systems');
    expect(t.last?.lines).toContain('Domination: Gallente controls the most systems');
    expect(t.last?.lines).toContain('Game over: Gallente wins');
    expect(t.last?.lines).toContain('Final ranking: 1. Gallente (11 VP, 5 systems), 2. Amarr (11 VP, 3 systems), 3. Caldari (2 VP, 1 system)');
    expect(t.last?.notices).toContainEqual({ to: 'all', text: 'Game over: Gallente wins', kind: 'info' });

    // The board kept everything else: the app never held ISK, minerals or ships.
    for (const f of t.game.seats) {
      expect(t.p(f).res).toStrictEqual(noBoard);
      expect(t.p(f).ships).toStrictEqual({});
    }
    // Nothing more happens once the game is over.
    expect(isError(t.tryDispatch('amarr', { type: 'pass' }))).toBe(true);
    expect(JSON.parse(JSON.stringify(t.game))).toStrictEqual(t.game);
    for (const f of t.game.seats) expect(JSON.parse(JSON.stringify(t.privs[f]))).toStrictEqual(t.privs[f]);
  });
});
