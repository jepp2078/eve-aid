import { describe, expect, it } from 'vitest';
import { STRUCTURE_SUPPLY } from '../../src/data/costs';
import { DEV } from '../../src/data/developments';
import { apply } from '../../src/engine/apply';
import { isError, type Command } from '../../src/engine/types';
import {
  assignDraftName,
  canVanguard,
  choicesCommand,
  choicesDraftName,
  choicesSummary,
  citadelMode,
  combatKey,
  citadelOptions,
  combatBanner,
  combatTask,
  curseOptions,
  EMPTY_CHOICES,
  EMPTY_START,
  evasiveCandidates,
  evasiveText,
  pickController,
  pickHome,
  sanitizeChoices,
  sideChoicesSummary,
  sanitizeStart,
  startCommand,
  shiplessText,
  staleCombatDrafts,
  startPlan,
  vanguardOptions,
  whereText,
  type StartDraft,
} from '../../src/ui/lib/combat';
import { battle, dice, lead, NO_ADJUST, noRetreat, sup } from '../engine/combat/fixtures';
import { startedGame } from '../engine/helpers';

describe('combatTask and combatBanner', () => {
  it('walks both sides through assignment and the start choices', () => {
    const b = battle([lead('heretic')], [lead('crow')], { stopAt: 'assign' });
    const c = () => b.c();
    expect(combatTask(c(), 'amarr')).toBe('assign');
    expect(combatTask(c(), 'caldari')).toBe('waitAttacker');
    expect(combatTask(c(), null)).toBe('spectate');
    expect(combatBanner(b.t.game, 'amarr')).toStrictEqual({ side: 'attacker', enemy: 'caldari', title: 'You attack Caldari', detail: 'Assign your fleet', urgent: true });
    expect(combatBanner(b.t.game, 'caldari')).toStrictEqual({
      side: 'defender',
      enemy: 'amarr',
      title: 'Amarr attacks you',
      detail: 'Amarr is placing their fleet · choose a strategy card face down',
      urgent: false,
    });

    b.t.dispatch('amarr', { type: 'combatAssign', ships: [lead('heretic')] });
    expect(combatTask(c(), 'amarr')).toBe('waitAssign');
    expect(combatBanner(b.t.game, 'amarr')?.detail).toBe('Waiting for Caldari to place their fleet');
    expect(combatBanner(b.t.game, 'caldari')).toMatchObject({ detail: 'Assign your fleet', urgent: true });

    b.t.dispatch('caldari', { type: 'combatAssign', ships: [lead('crow')] });
    // the attacker chooses first; the defender waits (manual p.28)
    expect(combatTask(c(), 'amarr')).toBe('choices');
    expect(combatTask(c(), 'caldari')).toBe('waitAttackerChoices');
    expect(combatBanner(b.t.game, 'caldari')).toMatchObject({ detail: 'Amarr makes their start choices first', urgent: false });
    b.t.dispatch('amarr', { type: 'combatStartChoices', citadelOrbit: null, vanguardOrbit: null, evasive: [], curse: null });
    expect(combatTask(c(), 'amarr')).toBe('waitChoices');
    expect(combatBanner(b.t.game, 'amarr')).toMatchObject({ detail: "Waiting for Caldari's start choices", urgent: false });
    expect(combatTask(c(), 'caldari')).toBe('choices');
    expect(combatBanner(b.t.game, 'caldari')).toMatchObject({ detail: 'Reveal strategy cards · make your start choices', urgent: true });

    b.t.dispatch('caldari', { type: 'combatStartChoices', citadelOrbit: null, vanguardOrbit: null, evasive: [], curse: null });
    expect(combatTask(c(), 'amarr')).toBe('retreat');
    expect(combatBanner(b.t.game, 'amarr')).toMatchObject({ detail: 'Round 1 · Decide whether to retreat', urgent: true });
  });

  it('says whose move it is in the rounds and at the end', () => {
    const b = battle([lead('heretic'), sup('anathema', 'small'), lead('zealot')], [lead('crow'), sup('buzzard', 'small'), lead('cerberus')]);
    const c = () => b.c();
    expect(combatTask(c(), 'caldari')).toBe('waitRetreat');
    expect(combatBanner(b.t.game, 'caldari')).toMatchObject({ detail: 'Round 1 · Waiting for Amarr to decide on retreat', urgent: false });
    b.t.dispatch('amarr', { type: 'combatRetreat', retreat: false });
    expect(combatTask(c(), 'caldari')).toBe('retreat');
    expect(combatTask(c(), 'amarr')).toBe('waitRetreat');
    b.t.dispatch('caldari', { type: 'combatRetreat', retreat: false });

    expect(combatTask(c(), 'amarr')).toBe('attack');
    expect(combatBanner(b.t.game, 'amarr')).toMatchObject({ detail: 'Round 1 · Your small-orbit attack', urgent: true });
    expect(combatTask(c(), 'caldari')).toBe('waitAttack');
    expect(combatBanner(b.t.game, 'caldari')).toMatchObject({ detail: "Round 1 · Amarr's small-orbit attack", urgent: false });
    // A kill whose remaining damage can reach the Buzzard: Amarr picks where it goes.
    b.t.dispatch('amarr', { type: 'combatTarget', target: b.uid('defender', 'crow') });
    b.t.dispatch('amarr', { type: 'combatRoll', dice: dice({ aim2: 3, damage: 2 }), adjust: NO_ADJUST });
    expect(c().attack?.overflow).not.toBeNull();
    expect(combatTask(c(), 'amarr')).toBe('overflow');
    expect(combatBanner(b.t.game, 'amarr')).toMatchObject({ detail: 'Round 1 · Choose where the remaining damage goes', urgent: true });

    // Between rounds Amarr's small leader is destroyed: Amarr re-aligns first, Caldari waits.
    b.t.dispatch('amarr', { type: 'combatOverflow', target: b.uid('defender', 'buzzard') });
    b.t.dispatch('caldari', { type: 'combatContinue' });
    b.t.dispatch('amarr', { type: 'combatContinue' });
    b.t.dispatch('caldari', { type: 'combatContinue' });
    expect([c().round, c().stage]).toStrictEqual([2, 'retreat']);
    b.t.dispatch('caldari', { type: 'combatDestroy', ship: b.uid('attacker', 'heretic') });
    expect(c().stage).toBe('realign');
    expect(combatTask(c(), 'amarr')).toBe('realign');
    expect(combatBanner(b.t.game, 'amarr')).toMatchObject({ detail: 'Round 2 · Re-align your orbits', urgent: true });
    expect(combatTask(c(), 'caldari')).toBe('waitRealign');
    expect(combatBanner(b.t.game, 'caldari')).toMatchObject({ detail: 'Round 2 · Waiting for Amarr to re-align', urgent: false });

    c().stage = 'end';
    expect(combatTask(c(), 'caldari')).toBe('finish');
    expect(combatBanner(b.t.game, 'amarr')).toMatchObject({ detail: 'Combat over · see the result and finish', urgent: true });
  });

  it('is null without a combat or for a player outside it', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    expect(combatBanner(t.game, 'amarr')).toBeNull();
    const b = battle([lead('heretic')], [lead('crow')], { table: t, stopAt: 'assign' });
    expect(combatBanner(b.t.game, 'gallente')).toBeNull();
    expect(combatBanner(b.t.game, null)).toBeNull();
  });
});

describe('startPlan, startCommand and whereText', () => {
  it('picks the only rival, and no home, controller or citadels by default', () => {
    const t = startedGame(['amarr', 'caldari']);
    const plan = startPlan(t.game, 'amarr', EMPTY_START);
    expect(plan).toStrictEqual({ rivals: ['caldari'], shipless: [], defender: 'caldari', homeOf: null, controller: null, citadels: 0, citadelsAuto: true, citadelMax: 0 });
    expect(whereText(plan)).toBe('In a system nobody controls');
    expect(startCommand(plan)).toStrictEqual({ type: 'combatStart', defender: 'caldari', homeOf: null, controller: null, citadels: 0 });
  });

  it('waits for a choice with several rivals', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    const plan = startPlan(t.game, 'amarr', EMPTY_START);
    expect([plan.rivals, plan.defender]).toStrictEqual([['caldari', 'gallente'], null]);
    expect(startCommand(plan)).toBeNull();
    expect(startPlan(t.game, 'amarr', { ...EMPTY_START, defender: 'amarr' }).defender).toBeNull();
    expect(startPlan(t.game, 'amarr', { ...EMPTY_START, defender: 'minmatar' }).defender).toBeNull();
  });

  it('leaves out rivals with no ships on the board, and says who they are (the engine refuses them)', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('gallente').ships = {};
    const plan = startPlan(t.game, 'amarr', { ...EMPTY_START, defender: 'gallente' });
    expect([plan.rivals, plan.shipless, plan.defender]).toStrictEqual([['caldari'], ['gallente'], 'caldari']);
    expect(shiplessText(plan.shipless)).toBe('Gallente has no ships on the board to fight with.');
    t.p('caldari').ships = { crow: 0 };
    const none = startPlan(t.game, 'amarr', EMPTY_START);
    expect([none.rivals, none.shipless, none.defender]).toStrictEqual([[], ['caldari', 'gallente'], null]);
    expect(shiplessText(none.shipless)).toBe('Caldari and Gallente have no ships on the board to fight with.');
    expect(shiplessText([])).toBe(null);
  });

  it('offers every seated rival in a light game, where nobody has ships on record (the engine asks for none)', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente'], { mode: 'light' });
    expect(Object.values(t.game.players).map((p) => p.ships)).toStrictEqual([{}, {}, {}]);
    const plan = startPlan(t.game, 'amarr', { ...EMPTY_START, defender: 'gallente' });
    expect([plan.rivals, plan.shipless, plan.defender]).toStrictEqual([['caldari', 'gallente'], [], 'gallente']);
    expect(shiplessText(plan.shipless)).toBeNull();
    expect(isError(apply(t.game, startCommand(plan)!, t.ctxFor(t.uids.amarr)))).toBe(false);
    const two = startedGame(['amarr', 'caldari'], { mode: 'light' });
    expect(startPlan(two.game, 'amarr', EMPTY_START)).toMatchObject({ rivals: ['caldari'], shipless: [], defender: 'caldari' });
  });

  it('lets a light game enter the citadels on the board (the app keeps no structures), up to all there are', () => {
    const t = startedGame(['amarr', 'caldari'], { mode: 'light' });
    const auto = startPlan(t.game, 'amarr', { defender: 'caldari', homeOf: 'caldari', controller: 'home', citadels: null });
    expect(auto).toMatchObject({ controller: 'caldari', citadels: 0, citadelsAuto: true, citadelMax: STRUCTURE_SUPPLY });
    const two = startPlan(t.game, 'amarr', { defender: 'caldari', homeOf: null, controller: 'caldari', citadels: 2 });
    expect(two).toMatchObject({ controller: 'caldari', citadels: 2, citadelsAuto: false, citadelMax: STRUCTURE_SUPPLY });
    expect(isError(apply(t.game, startCommand(two)!, t.ctxFor(t.uids.amarr)))).toBe(false);
    const nobody = startPlan(t.game, 'amarr', { defender: 'caldari', homeOf: null, controller: null, citadels: 2 });
    expect([nobody.citadels, nobody.citadelMax]).toStrictEqual([0, 0]);
  });

  it('lets the controller follow the home owner, whose home citadels fill in the count', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').homeCitadels = 2;
    t.p('caldari').structures.citadel = 3;
    const plan = startPlan(t.game, 'amarr', { ...EMPTY_START, defender: 'caldari', homeOf: 'caldari' });
    expect(plan).toMatchObject({ homeOf: 'caldari', controller: 'caldari', citadels: 2, citadelsAuto: true, citadelMax: 3 });
    expect(whereText(plan)).toBe("In Caldari's home system, controlled by Caldari with 2 citadels");
    const cmd = startCommand(plan) as Command;
    expect(cmd).toStrictEqual({ type: 'combatStart', defender: 'caldari', homeOf: 'caldari', controller: 'caldari', citadels: 2 });
    expect(isError(apply(t.game, cmd, t.ctxFor(t.uids.amarr)))).toBe(false);
  });

  it('takes an explicit controller and count; without a controller there are no citadels', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    const other = startPlan(t.game, 'amarr', { defender: 'caldari', homeOf: 'caldari', controller: 'gallente', citadels: 1 });
    expect(other).toMatchObject({ controller: 'gallente', citadels: 1, citadelsAuto: false, citadelMax: 1 });
    expect(whereText(other)).toBe("In Caldari's home system, controlled by Gallente with 1 citadel");
    const open = startPlan(t.game, 'amarr', { defender: 'caldari', homeOf: null, controller: 'gallente', citadels: null });
    expect(whereText(open)).toBe('In a system controlled by Gallente');
    const none = startPlan(t.game, 'amarr', { defender: 'caldari', homeOf: null, controller: 'home', citadels: 3 });
    expect([none.controller, none.citadels]).toStrictEqual([null, 0]);
  });

  it('reads "no controller" in a home system as the home owner, like the engine', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').homeCitadels = 2;
    t.p('caldari').structures.citadel = 2;
    const plan = startPlan(t.game, 'amarr', { defender: 'caldari', homeOf: 'caldari', controller: null, citadels: null });
    expect(plan).toMatchObject({ controller: 'caldari', citadels: 2, citadelsAuto: true });
    expect(startCommand(plan)).toMatchObject({ controller: 'caldari', citadels: 2 });
  });

  it('a new home pick makes the controller follow the home owner again (tap Nobody, then a home)', () => {
    const t = startedGame(['amarr', 'caldari', 'gallente']);
    t.p('caldari').homeCitadels = 1;
    t.p('caldari').structures.citadel = 1;
    let d: StartDraft = { ...EMPTY_START, defender: 'caldari' };
    d = pickController(d, null); // "Nobody" tapped while it is already selected
    expect(d.controller).toBeNull();
    d = pickHome(d, 'caldari');
    expect(d).toStrictEqual({ defender: 'caldari', homeOf: 'caldari', controller: 'home', citadels: null });
    expect(startPlan(t.game, 'amarr', d)).toMatchObject({ controller: 'caldari', citadels: 1 });
    d = pickController({ ...d, citadels: 3 }, 'gallente');
    expect(d).toMatchObject({ controller: 'gallente', citadels: null });
    d = pickController(d, 'caldari'); // the home owner again: back to following it
    expect(d.controller).toBe('home');
    d = pickHome(d, null);
    expect(startPlan(t.game, 'amarr', d)).toMatchObject({ homeOf: null, controller: null, citadels: 0 });
  });

  it('sanitizes a stored draft', () => {
    expect(sanitizeStart(7)).toBeNull();
    expect(sanitizeStart({ defender: 'caldari', homeOf: 'nope', controller: 'gallente', citadels: 2 })).toStrictEqual({
      defender: 'caldari',
      homeOf: null,
      controller: 'gallente',
      citadels: 2,
    });
    expect(sanitizeStart({ controller: null, citadels: -1 })).toStrictEqual({ defender: null, homeOf: null, controller: null, citadels: null });
    expect(sanitizeStart({})).toStrictEqual(EMPTY_START);
  });
});

describe('start-of-combat choices', () => {
  it('evasive: my explorers with D1, minus any the attacker already cursed', () => {
    const b = battle([lead('heretic'), sup('anathema', 'small')], [lead('crow')], { stopAt: 'start', attacker: { tiers: ['D1'] } });
    const g = b.t.game;
    const anathema = b.uid('attacker', 'anathema');
    expect(evasiveCandidates(g, b.c(), 'attacker').map((s) => s.uid)).toStrictEqual([anathema]);
    expect(evasiveCandidates(g, b.c(), 'defender')).toStrictEqual([]);
    expect(evasiveText(g, b.c(), b.ship(anathema))).toBe('DIF 3→5 · ATK 2→0 · SUP 1→0');
    b.c().sides.defender.curse = { ship: 'anathema', slot: 'first' };
    expect(evasiveCandidates(g, b.c(), 'attacker')).toStrictEqual([]);
  });

  it('sideChoicesSummary tells the defender what the attacker chose', () => {
    const b = battle([lead('anathema'), lead('curse')], [lead('rook'), sup('crow', 'medium')], {
      stopAt: 'start', controller: 'amarr', citadels: 1, attacker: { tiers: ['D1', 'U1'], devs: [DEV.vanguardShip] },
    });
    expect(sideChoicesSummary(b.c(), 'attacker')).toBe('No start-of-combat choices');
    b.t.dispatch('amarr', { type: 'combatStartChoices', citadelOrbit: 'small', vanguardOrbit: 'small', evasive: [b.uid('attacker', 'anathema')], curse: { ship: 'crow', slot: 'second' } });
    expect(sideChoicesSummary(b.c(), 'attacker')).toBe("Citadel: small orbit · Vanguard Ship: small orbit · Evasive: Anathema · Curse: Crow's 2nd researched ability");
  });

  it('curse: enemy ships in my Curse’s orbit, with their abilities', () => {
    const b = battle([lead('curse')], [lead('cerberus'), sup('crow', 'medium'), lead('flycatcher')], { stopAt: 'start', attacker: { tiers: ['U1'] } });
    const opts = curseOptions(b.t.game, b.c(), 'attacker');
    expect(opts.map((o) => o.ship)).toStrictEqual(['cerberus', 'crow']);
    // An interceptor has no basic ability.
    expect(opts[1]!.abilities.map((a) => [a.slot, a.requires])).toStrictEqual([
      ['first', ['U1']],
      ['second', ['U2']],
    ]);
    expect(curseOptions(b.t.game, b.c(), 'defender')).toStrictEqual([]);
    const plain = battle([lead('curse')], [lead('cerberus')], { stopAt: 'start' });
    expect(curseOptions(plain.t.game, plain.c(), 'attacker')).toStrictEqual([]);
  });

  it('citadel: the controller chooses an orbit, unless Upgraded Citadel covers every orbit', () => {
    const b = battle([lead('heretic'), sup('anathema', 'small'), lead('zealot')], [lead('crow')], { stopAt: 'start', controller: 'amarr', citadels: 1 });
    const g = b.t.game;
    expect(citadelMode(g, b.c(), 'attacker')).toBe('choose');
    expect(citadelMode(g, b.c(), 'defender')).toBeNull();
    expect(citadelOptions(g, b.c(), 'attacker')).toStrictEqual([
      { orbit: 'small', before: 5, after: 6, leader: true },
      { orbit: 'medium', before: 5, after: 6, leader: true },
      { orbit: 'large', before: 0, after: 0, leader: false },
    ]);
    b.t.p('amarr').completed.push(DEV.upgradedCitadel);
    expect(citadelMode(g, b.c(), 'attacker')).toBe('upgraded');
    const none = battle([lead('heretic')], [lead('crow')], { stopAt: 'start', controller: 'amarr', citadels: 0 });
    expect(citadelMode(none.t.game, none.c(), 'attacker')).toBeNull();
  });

  it('vanguard: needs Vanguard Ship; options count my supports per orbit', () => {
    const b = battle([lead('heretic'), sup('anathema', 'small'), sup('malediction', 'small'), lead('zealot')], [lead('crow')], { stopAt: 'start', attacker: { devs: [DEV.vanguardShip] } });
    expect(canVanguard(b.t.game, b.c(), 'attacker')).toBe(true);
    expect(canVanguard(b.t.game, b.c(), 'defender')).toBe(false);
    expect(vanguardOptions(b.c(), 'attacker')).toStrictEqual([
      { orbit: 'small', supports: 2 },
      { orbit: 'medium', supports: 0 },
      { orbit: 'large', supports: 0 },
    ]);
  });

  it('choicesCommand keeps only what applies, and the engine accepts it', () => {
    const b = battle([lead('heretic'), sup('anathema', 'small')], [lead('crow')], { stopAt: 'start', attacker: { tiers: ['D1'] } });
    const anathema = b.uid('attacker', 'anathema');
    const draft = { citadelOrbit: 'small' as const, vanguardOrbit: 'medium' as const, evasive: [anathema, 's99'], curse: { ship: 'crow', slot: 'second' as const }, cardChosen: true };
    const cmd = choicesCommand(b.t.game, b.c(), 'attacker', draft);
    expect(cmd).toStrictEqual({ type: 'combatStartChoices', citadelOrbit: null, vanguardOrbit: null, evasive: [anathema], curse: null });
    expect(isError(apply(b.t.game, cmd, b.t.ctxFor(b.t.uids.amarr)))).toBe(false);
    expect(choicesSummary(b.c(), cmd)).toBe('Evasive: Anathema');
    expect(choicesSummary(b.c(), choicesCommand(b.t.game, b.c(), 'attacker', EMPTY_CHOICES))).toBe('No start-of-combat choices');
  });

  it('choicesCommand keeps a citadel, vanguard and curse when allowed', () => {
    const b = battle([lead('curse')], [lead('cerberus'), sup('crow', 'medium')], {
      stopAt: 'start',
      controller: 'amarr',
      citadels: 1,
      attacker: { tiers: ['U1'], devs: [DEV.vanguardShip] },
    });
    const draft = { citadelOrbit: 'medium' as const, vanguardOrbit: 'medium' as const, evasive: [], curse: { ship: 'crow', slot: 'second' as const }, cardChosen: false };
    const cmd = choicesCommand(b.t.game, b.c(), 'attacker', draft);
    expect(cmd).toStrictEqual({ type: 'combatStartChoices', citadelOrbit: 'medium', vanguardOrbit: 'medium', evasive: [], curse: { ship: 'crow', slot: 'second' } });
    expect(isError(apply(b.t.game, cmd, b.t.ctxFor(b.t.uids.amarr)))).toBe(false);
    expect(choicesSummary(b.c(), cmd)).toBe("Citadel: medium orbit · Vanguard Ship: medium orbit · Curse: Crow's 2nd researched ability");
    const badSlot = choicesCommand(b.t.game, b.c(), 'attacker', { ...draft, curse: { ship: 'crow', slot: 'basic' } });
    expect(badSlot.type === 'combatStartChoices' && badSlot.curse).toBeNull();
    const gone = choicesCommand(b.t.game, b.c(), 'attacker', { ...draft, curse: { ship: 'golem', slot: 'first' } });
    expect(gone.type === 'combatStartChoices' && gone.curse).toBeNull();
  });

  it('sanitizes a stored draft', () => {
    expect(sanitizeChoices('x')).toBeNull();
    expect(sanitizeChoices({})).toStrictEqual(EMPTY_CHOICES);
    expect(sanitizeChoices({ citadelOrbit: 'small', vanguardOrbit: 'x', evasive: ['s1', 3, 's1'], curse: { ship: 'crow', slot: 'third' }, cardChosen: true })).toStrictEqual({
      citadelOrbit: 'small',
      vanguardOrbit: null,
      evasive: ['s1'],
      curse: null,
      cardChosen: true,
    });
  });
});

describe('staleCombatDrafts (when the combat drafts go, M7)', () => {
  it('keeps every draft while the fight is on, so an Undo of a roll brings its pad back', () => {
    const b = battle([lead('heretic')], [lead('crow')]);
    expect(staleCombatDrafts(b.t.game)).toStrictEqual([]);
    noRetreat(b);
    expect(b.c().stage).toBe('attack');
    expect(staleCombatDrafts(b.t.game)).toStrictEqual([]);
  });

  it('drops dice pads while a combat is being set up (they belong to an earlier one), and everything once none runs', () => {
    const b = battle([lead('heretic')], [lead('crow')], { stopAt: 'assign' });
    expect(staleCombatDrafts(b.t.game)).toStrictEqual(['combat-roll:']);
    b.t.game.combat = null;
    expect(staleCombatDrafts(b.t.game)).toStrictEqual(['combat-assign:', 'combat-choices:', 'combat-roll:', 'combat-realign:', 'combat-loss:']);
  });
});

describe('combatKey (keys the combat drafts)', () => {
  it('stays the same through a stage, and differs for another combat or other fleets', () => {
    const b = battle([lead('heretic'), sup('anathema', 'small')], [lead('crow')], { stopAt: 'start', attacker: { tiers: ['D1'] } });
    const key = combatKey(b.c());
    expect(key).toMatch(/^amarr-caldari-[0-9a-z]+$/);
    b.ship(b.uid('attacker', 'anathema')).evasive = true; // the enemy's Ready flags evasive ships: same draft
    expect(combatKey(b.c())).toBe(key);
    const other = battle([lead('heretic'), sup('malediction', 'small')], [lead('crow')], { stopAt: 'start' });
    expect(combatKey(other.c())).not.toBe(key);
    const before = battle([], [], { stopAt: 'assign' });
    expect(combatKey(before.c())).toBe('amarr-caldari-0');
  });

  it('names the drafts: the assignment by the enemy fleet only (stable through my own Confirm and its Undo)', () => {
    const b = battle([lead('heretic')], [lead('crow')], { stopAt: 'assign' });
    const name = assignDraftName(b.c(), 'attacker');
    expect(name).toBe('combat-assign:amarr-caldari-0');
    b.t.dispatch('amarr', { type: 'combatAssign', ships: [lead('heretic')] });
    expect(assignDraftName(b.c(), 'attacker')).toBe(name);
    const defender = assignDraftName(b.c(), 'defender');
    expect(defender).not.toBe(name);
    b.t.dispatch('caldari', { type: 'combatAssign', ships: [lead('crow')] });
    expect(assignDraftName(b.c(), 'defender')).toBe(defender);
    expect(choicesDraftName(b.c())).toBe(`combat-choices:${combatKey(b.c())}`);
  });
});
