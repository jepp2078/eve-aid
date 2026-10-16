import { describe, expect, it } from 'vitest';
import { dicePool, effDif, effStats } from '../../src/engine/combat/abilities';
import type { DicePool } from '../../src/engine/combat/abilities';
import { difOrbit, fleetLine, lineText, modified, poolBreakdown, poolDice, stepRail, tokenStats } from '../../src/ui/lib/combatBoard';
import { battle, lead, miss, noRetreat, sup } from '../engine/combat/fixtures';

const states = (b: ReturnType<typeof battle>) => stepRail(b.c()).steps.map((s) => `${s.short}:${s.state}${s.idle ? ':idle' : ''}`);

describe('stepRail', () => {
  it('shows the six attacks as upcoming while the fleets are set up', () => {
    const b = battle([], [], { stopAt: 'assign' });
    const rail = stepRail(b.c());
    expect(rail.round).toBeNull();
    expect(rail.title).toBe('Setup');
    expect(rail.detail).toBe('Assigning fleets');
    expect(rail.steps.map((s) => s.short)).toStrictEqual(['S·Att', 'S·Def', 'M·Att', 'M·Def', 'L·Att', 'L·Def']);
    expect(rail.steps[0]!.label).toBe('Small orbit: Amarr (attacker)');
    expect(rail.steps[5]!.label).toBe('Large orbit: Caldari (defender)');
    expect(states(b)).toStrictEqual(['S·Att:upcoming', 'S·Def:upcoming', 'M·Att:upcoming', 'M·Def:upcoming', 'L·Att:upcoming', 'L·Def:upcoming']);
  });

  it('marks the attacks of an assigned side without a leader there as idle', () => {
    const b = battle([lead('heretic')], [lead('crow'), lead('cerberus')], { stopAt: 'start' });
    expect(stepRail(b.c()).detail).toBe('Start of combat');
    expect(states(b)).toStrictEqual(['S·Att:upcoming', 'S·Def:upcoming', 'M·Att:upcoming:idle', 'M·Def:upcoming', 'L·Att:upcoming:idle', 'L·Def:upcoming:idle']);
  });

  it('names the round, then marks done, current and upcoming attacks', () => {
    const b = battle([lead('heretic'), lead('zealot')], [lead('crow'), lead('cerberus')]);
    const rail = stepRail(b.c());
    expect([rail.round, rail.title, rail.detail]).toStrictEqual([1, 'Round 1 of 3', 'Retreat decisions']);
    noRetreat(b);
    expect(states(b)).toStrictEqual(['S·Att:current', 'S·Def:upcoming', 'M·Att:upcoming', 'M·Def:upcoming', 'L·Att:upcoming:idle', 'L·Def:upcoming:idle']);
    miss(b, 'attacker');
    expect(stepRail(b.c()).detail).toBe('Attacks');
    expect(states(b)).toStrictEqual(['S·Att:done', 'S·Def:current', 'M·Att:upcoming', 'M·Def:upcoming', 'L·Att:upcoming:idle', 'L·Def:upcoming:idle']);
  });

  it('treats a retreating side as not attacking; a re-align after the round and the end as done', () => {
    const b = battle([lead('heretic')], [lead('crow')]);
    const c = b.c();
    c.retreatedSide = 'attacker';
    expect(states(b)[0]).toBe('S·Att:upcoming:idle');
    c.retreatedSide = null;
    c.stage = 'realign';
    c.retreatAsked = ['attacker', 'defender'];
    expect(stepRail(c).steps.every((s) => s.state === 'done')).toBe(true);
    c.retreatAsked = [];
    expect(stepRail(c).steps.every((s) => s.state === 'upcoming')).toBe(true);
    c.stage = 'end';
    expect(stepRail(c).detail).toBe('Results');
    expect(stepRail(c).steps.every((s) => s.state === 'done')).toBe(true);
  });
});

describe('tokenStats', () => {
  it('a ship without modifiers shows its printed values', () => {
    const b = battle([lead('heretic')], [lead('crow')]);
    const s = b.ship(b.uid('attacker', 'heretic'));
    s.damage = 1;
    const t = tokenStats(b.t.game, b.c(), s, null);
    expect(t.dif).toStrictEqual({ label: 'DIF', value: 3, base: 3, parts: [], floored: false });
    expect([t.atk.value, t.sup.value, t.red.value, t.hp, t.damage, t.notes]).toStrictEqual([4, 0, 0, 2, 1, []]);
    expect(modified(t.atk)).toBe(false);
    expect(lineText(t.atk)).toBe('ATK 4 as printed');
  });

  it('an evasive explorer: +2 DIF, −2 ATK, −1 SUP, matching the engine', () => {
    const b = battle([lead('heretic'), sup('anathema', 'small')], [lead('crow')], { attacker: { tiers: ['D1'], evasive: [1] } });
    const g = b.t.game;
    const s = b.ship(b.uid('attacker', 'anathema'));
    const t = tokenStats(g, b.c(), s, null);
    expect(t.dif.parts).toStrictEqual([{ amount: 2, label: 'evasive (D1)' }]);
    expect([t.dif.value, t.atk.value, t.sup.value]).toStrictEqual([5, 0, 0]);
    expect(t.dif.value).toBe(effDif(g, b.c(), s, 'small'));
    expect({ atk: t.atk.value, sup: t.sup.value, red: t.red.value }).toStrictEqual(effStats(g, b.c(), s));
    expect(lineText(t.dif)).toBe('DIF 5 = 3 base + 2 evasive (D1)');
    expect(lineText(t.atk)).toBe('ATK 0 = 2 base − 2 evasive (D1)');
    expect(modified(t.sup)).toBe(true);
  });

  it('enemy auras in the ship’s orbit, one per ship name, with their source', () => {
    const b = battle([lead('stiletto'), sup('stiletto', 'small'), sup('huginn', 'small')], [lead('crow')], { attacker: { tiers: ['U1', 'U2'] } });
    const s = b.ship(b.uid('defender', 'crow'));
    const t = tokenStats(b.t.game, b.c(), s, null);
    expect(t.dif.parts).toStrictEqual([
      { amount: -1, label: 'Stiletto aura (Minmatar, U2)' },
      { amount: -1, label: 'Huginn aura (Minmatar, U1)' },
    ]);
    expect(t.dif.value).toBe(1);
    expect(t.dif.value).toBe(effDif(b.t.game, b.c(), s, 'large'));
  });

  it('never goes below 0, and says so', () => {
    const b = battle([lead('vargur'), sup('stiletto', 'large'), sup('huginn', 'large')], [lead('golem')], { attacker: { tiers: ['U1', 'U2'] } });
    const s = b.ship(b.uid('defender', 'golem'));
    const t = tokenStats(b.t.game, b.c(), s, null);
    expect([t.dif.value, t.dif.floored]).toStrictEqual([0, true]);
    expect(lineText(t.dif)).toBe('DIF 0 = 1 base − 1 Stiletto aura (Minmatar, U2) − 1 Huginn aura (Minmatar, U1), never below 0');
    expect(t.dif.value).toBe(effDif(b.t.game, b.c(), s, 'large'));
  });

  it('a retreating side: +1, and the enemy Lachesis lowers it', () => {
    const b = battle([lead('ares'), sup('lachesis', 'small')], [lead('crow')], { attacker: { tiers: ['U1'] } });
    b.c().retreatedSide = 'defender';
    const s = b.ship(b.uid('defender', 'crow'));
    const t = tokenStats(b.t.game, b.c(), s, null);
    // Ares's aura needs U2, which Gallente lacks here.
    expect(t.dif.parts).toStrictEqual([
      { amount: 1, label: 'retreating' },
      { amount: -2, label: 'Lachesis vs retreating ships (Gallente, U1)' },
    ]);
    expect(t.dif.value).toBe(2);
    expect(t.dif.value).toBe(effDif(b.t.game, b.c(), s, 'small'));
  });

  it('DIF that depends on the attacking orbit: a note without an orbit, a part with one', () => {
    const b = battle([lead('zealot')], [lead('nighthawk')], { defender: { tiers: ['D2'] } });
    const s = b.ship(b.uid('defender', 'nighthawk'));
    const g = b.t.game;
    const free = tokenStats(g, b.c(), s, null);
    expect([free.dif.value, free.dif.parts, free.notes]).toStrictEqual([2, [], ['+1 DIF against attacks from the small or medium orbit (D2)']]);
    const fromSmall = tokenStats(g, b.c(), s, 'small');
    expect([fromSmall.dif.value, fromSmall.dif.parts, fromSmall.notes]).toStrictEqual([3, [{ amount: 1, label: 'vs small-orbit attacks (D2)' }], []]);
    expect(fromSmall.dif.value).toBe(effDif(g, b.c(), s, 'small'));
    const fromLarge = tokenStats(g, b.c(), s, 'large');
    expect([fromLarge.dif.value, fromLarge.notes]).toStrictEqual([2, []]);
    expect(fromLarge.dif.value).toBe(effDif(g, b.c(), s, 'large'));
  });

  it('stat abilities (Marauder O2+D2, Absolution D2 RED)', () => {
    const b = battle([lead('paladin'), lead('absolution')], [lead('crow')], { attacker: { tiers: ['O2', 'D2'] } });
    const g = b.t.game;
    const paladin = b.ship(b.uid('attacker', 'paladin'));
    const p = tokenStats(g, b.c(), paladin, null);
    expect([p.atk.value, p.sup.value, p.red.value]).toStrictEqual([7, 2, 4]);
    expect(p.atk.parts).toStrictEqual([{ amount: 1, label: 'O2+D2 ability' }]);
    expect({ atk: p.atk.value, sup: p.sup.value, red: p.red.value }).toStrictEqual(effStats(g, b.c(), paladin));
    const absolution = tokenStats(g, b.c(), b.ship(b.uid('attacker', 'absolution')), null);
    expect(lineText(absolution.red)).toBe('RED 3 = 2 base + 1 D2 ability');
  });
});

describe('difOrbit', () => {
  it('is the enemy’s attacking orbit while it attacks, otherwise null', () => {
    const b = battle([lead('heretic')], [lead('crow')]);
    const crow = b.ship(b.uid('defender', 'crow'));
    const heretic = b.ship(b.uid('attacker', 'heretic'));
    expect(difOrbit(b.c(), crow)).toBeNull();
    noRetreat(b);
    expect(difOrbit(b.c(), crow)).toBe('small');
    expect(difOrbit(b.c(), heretic)).toBeNull();
  });
});

describe('poolDice and poolBreakdown', () => {
  const pool = (p: Partial<DicePool>): DicePool => ({ total: 0, white: 0, black: 0, choice: 0, parts: [], ...p });

  it('says the dice in words', () => {
    expect(poolDice(pool({ total: 4, white: 4 }))).toBe('4 white');
    expect(poolDice(pool({ total: 6, black: 6 }))).toBe('6 black');
    expect(poolDice(pool({ total: 6, white: 3, black: 3 }))).toBe('3 white, 3 black');
    expect(poolDice(pool({ total: 7, white: 3, black: 3, choice: 1 }))).toBe('3 white, 3 black, 1 of either colour');
    expect(poolDice(pool({}))).toBe('no dice');
  });

  it('adds up the engine’s parts', () => {
    const b = battle([lead('zealot'), sup('anathema', 'medium'), sup('anathema', 'medium')], [lead('crow')]);
    expect(poolBreakdown(dicePool(b.t.game, b.c(), 'attacker', 'medium'))).toBe('Pool 7 = Zealot ATK 5 + 2× Anathema SUP 1');
    expect(poolBreakdown(pool({ total: 10, parts: ['Vargur ATK 6', '5× Stiletto SUP 1', 'Capped at 10'] }))).toBe('Pool 10 = Vargur ATK 6 + 5× Stiletto SUP 1 · capped at 10');
    expect(poolBreakdown(pool({}))).toBe('No leader: no attack');
  });
});

describe('fleetLine', () => {
  it('summarises one side of one orbit', () => {
    const b = battle([lead('zealot'), sup('anathema', 'medium'), sup('anathema', 'medium'), lead('heretic')], [lead('crow')], { stopAt: 'start' });
    const c = b.c();
    expect(fleetLine(c, 'attacker', 'medium')).toBe('Zealot (leader) + 2× Anathema');
    expect(fleetLine(c, 'attacker', 'small')).toBe('Heretic (leader)');
    expect(fleetLine(c, 'attacker', 'large')).toBeNull();
    b.ship(b.uid('attacker', 'zealot')).removed = true;
    expect(fleetLine(c, 'attacker', 'medium')).toBe('2× Anathema (no leader)');
  });
});
