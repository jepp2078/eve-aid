import { describe, expect, it } from 'vitest';
import { DEV } from '../../src/data/developments';
import { isError, type Command } from '../../src/engine/types';
import { EMPTY_LIGHT_ADJUST, lightAdjustCommand, sanitizeLightAdjust, type LightAdjustDraft } from '../../src/ui/lib/adjust';
import {
  BOARD_STEPS,
  briefReason,
  canLightClaim,
  defaultLightUpkeep,
  gainVpCommand,
  lightClaimCommand,
  lightUpkeepCan,
  lightUpkeepCommand,
  NEW_GAIN_VP,
  NEW_LIGHT_CLAIM,
  NEW_RESEARCH_TOKENS,
  researchTokensCommand,
  sanitizeGainVp,
  sanitizeLightClaim,
  sanitizeLightUpkeep,
  sanitizeResearchTokens,
  type LightUpkeepDraft,
} from '../../src/ui/lib/light';
import { startedGame } from '../engine/helpers';

const NO_DELTA = { res: {}, vp: 0, systems: 0, homeCitadels: 0, lockedHomeBelts: 0, structures: {}, belts: {}, ships: {}, central: null };

/** A light game, Amarr to act. */
const light = () => startedGame(['amarr', 'caldari'], { mode: 'light' });

/** The light engine accepts the command from Amarr (the builders' output is never refused for its shape). */
function accepted(cmd: Command): void {
  const r = light().tryDispatch('amarr', cmd);
  expect(isError(r) ? r.code : 'ok').toBe('ok');
}

describe('gainVpCommand', () => {
  it('is an adjust of VP only that pays Lobbyist, with the reason in words', () => {
    expect(gainVpCommand({ vp: 2, reason: 'card' })).toStrictEqual({ type: 'adjust', delta: { ...NO_DELTA, vp: 2 }, correction: false, reason: 'Card effect' });
    expect(gainVpCommand({ vp: 1, reason: 'discovery' })).toStrictEqual({ type: 'adjust', delta: { ...NO_DELTA, vp: 1 }, correction: false, reason: 'Discovery' });
    expect(gainVpCommand({ vp: 9, reason: 'other' })).toStrictEqual({ type: 'adjust', delta: { ...NO_DELTA, vp: 9 }, correction: false, reason: 'Other' });
    accepted(gainVpCommand({ vp: 2, reason: 'card' }));
  });

  it('starts at 1 VP for a card', () => {
    expect(NEW_GAIN_VP).toStrictEqual({ vp: 1, reason: 'card' });
  });

  it('restores a stored draft only when it is well-formed', () => {
    expect(sanitizeGainVp({ vp: 3, reason: 'discovery' })).toStrictEqual({ vp: 3, reason: 'discovery' });
    expect(sanitizeGainVp(JSON.parse(JSON.stringify(NEW_GAIN_VP)))).toStrictEqual(NEW_GAIN_VP);
    for (const junk of [null, 'x', [], { vp: 0, reason: 'card' }, { vp: 10, reason: 'card' }, { vp: 1.5, reason: 'card' }, { vp: '2', reason: 'card' }, { vp: 2, reason: 'bribe' }, { vp: 2 }]) {
      expect(sanitizeGainVp(junk), JSON.stringify(junk)).toBeNull();
    }
  });
});

describe('lightClaimCommand', () => {
  it('claims an unclaimed system or one of a rival, with or without the central system', () => {
    expect(lightClaimCommand({ from: null, central: false })).toStrictEqual({ type: 'lightClaim', from: null, central: false });
    expect(lightClaimCommand({ from: 'caldari', central: true })).toStrictEqual({ type: 'lightClaim', from: 'caldari', central: true });
    expect(NEW_LIGHT_CLAIM).toStrictEqual({ from: null, central: false });
    accepted(lightClaimCommand({ from: null, central: true }));
  });

  it('restores a stored draft only when it is well-formed', () => {
    expect(sanitizeLightClaim({ from: 'caldari', central: true })).toStrictEqual({ from: 'caldari', central: true });
    expect(sanitizeLightClaim({ from: null, central: false })).toStrictEqual({ from: null, central: false });
    for (const junk of [null, 'x', [], { from: 'jove', central: false }, { from: null, central: 'yes' }, { central: false }, { from: null }]) {
      expect(sanitizeLightClaim(junk), JSON.stringify(junk)).toBeNull();
    }
  });

  it('is allowed on my turn in the action phase only, and says when to do it instead', () => {
    const t = light();
    expect(canLightClaim(t.game, 'amarr')).toStrictEqual({ ok: true });
    expect(canLightClaim(t.game, 'caldari')).toStrictEqual({ ok: false, reason: 'Not your turn: claim it on your turn (Amarr is playing)' });
    t.game.phase = 'upkeep';
    t.game.turn = null;
    expect(canLightClaim(t.game, 'amarr')).toStrictEqual({ ok: false, reason: 'Claim systems on your turn in the action phase' });
    t.game.phase = 'ended';
    expect(canLightClaim(t.game, 'amarr')).toStrictEqual({ ok: false, reason: 'The game is over' });
  });

  it('tells a player who has passed to fix their systems with Adjust (their turn will not come back this round)', () => {
    const t = light();
    t.dispatch('amarr', { type: 'pass' });
    expect(t.game.turn?.faction).toBe('caldari');
    expect(canLightClaim(t.game, 'amarr')).toStrictEqual({ ok: false, reason: 'You passed this round: fix your systems with Adjust' });
    expect(canLightClaim(t.game, 'caldari')).toStrictEqual({ ok: true });
  });

  it('shortens a reason to the words before its colon, for a dimmed button that agrees with its toast', () => {
    const t = light();
    const reason = (f: 'amarr' | 'caldari'): string => {
      const r = canLightClaim(t.game, f);
      if (r.ok) throw new Error(`${f} may claim`);
      return r.reason;
    };
    expect(briefReason(reason('caldari'))).toBe('Not your turn');
    t.dispatch('amarr', { type: 'pass' });
    expect(briefReason(reason('amarr'))).toBe('You passed this round');
    expect(briefReason('The game is over')).toBe('The game is over');
  });
});

describe('researchTokensCommand', () => {
  it('gains research tokens to place', () => {
    expect(researchTokensCommand({ research: 3 })).toStrictEqual({ type: 'gainResearch', research: 3 });
    expect(NEW_RESEARCH_TOKENS).toStrictEqual({ research: 1 });
    accepted(researchTokensCommand({ research: 20 }));
  });

  it('restores a stored draft only when it is well-formed', () => {
    expect(sanitizeResearchTokens({ research: 1 })).toStrictEqual({ research: 1 });
    expect(sanitizeResearchTokens({ research: 20 })).toStrictEqual({ research: 20 });
    for (const junk of [null, 'x', [], { research: 0 }, { research: 21 }, { research: 2.5 }, { research: '3' }, {}]) {
      expect(sanitizeResearchTokens(junk), JSON.stringify(junk)).toBeNull();
    }
  });
});

describe('lightAdjustCommand', () => {
  it('needs a change and a reason', () => {
    expect(lightAdjustCommand(EMPTY_LIGHT_ADJUST)).toBeNull();
    expect(lightAdjustCommand({ ...EMPTY_LIGHT_ADJUST, vp: 1 })).toBeNull();
    expect(lightAdjustCommand({ ...EMPTY_LIGHT_ADJUST, reason: 'event' })).toBeNull();
  });

  it('carries only VP, systems and the central system; only Correction skips Lobbyist', () => {
    expect(lightAdjustCommand({ vp: 1, systems: -1, central: true, reason: 'event' })).toStrictEqual({
      type: 'adjust',
      correction: false,
      reason: 'Event',
      delta: { ...NO_DELTA, vp: 1, systems: -1, central: true },
    });
    expect(lightAdjustCommand({ ...EMPTY_LIGHT_ADJUST, systems: 2, reason: 'mission' })).toMatchObject({ correction: false, reason: 'Mission' });
    expect(lightAdjustCommand({ ...EMPTY_LIGHT_ADJUST, central: false, reason: 'correction' })).toMatchObject({ correction: true, reason: 'Correction' });
    accepted(lightAdjustCommand({ vp: 1, systems: 1, central: true, reason: 'event' })!);
  });

  it('never sends resources, structures, belts or ships, even from a draft that holds them', () => {
    const full = { ...EMPTY_LIGHT_ADJUST, vp: 1, reason: 'event', res: { isk: 3 }, structures: { citadel: 1 }, belts: { pyrite: 1 }, ships: { heretic: 2 }, homeCitadels: 1 } as LightAdjustDraft;
    const cmd = lightAdjustCommand(full);
    expect(cmd).toStrictEqual({ type: 'adjust', correction: false, reason: 'Event', delta: { ...NO_DELTA, vp: 1 } });
    accepted(cmd!);
  });

  it('restores a stored draft, dropping anything a light game does not adjust', () => {
    const d: LightAdjustDraft = { vp: -2, systems: 1, central: false, reason: 'correction' };
    expect(sanitizeLightAdjust(JSON.parse(JSON.stringify(d)))).toStrictEqual(d);
    expect(sanitizeLightAdjust({ ...d, res: { isk: 3 }, ships: { heretic: 1 } })).toStrictEqual(d);
    expect(sanitizeLightAdjust({ vp: 1.5, systems: 'x', central: 'yes', reason: 'bribe' })).toStrictEqual(EMPTY_LIGHT_ADJUST);
    expect(sanitizeLightAdjust('x')).toBeNull();
  });
});

/** A light game in its round-1 upkeep, Amarr holding Research Lab and Fleet Supremacy. */
function lightUpkeepGame() {
  const t = light();
  for (const f of t.game.seats) t.dispatch(f, { type: 'pass' });
  expect(t.game.phase).toBe('upkeep');
  t.p('amarr').completed.push(DEV.researchLab, DEV.fleetSupremacy);
  return t;
}

describe('light upkeep', () => {
  const typical: LightUpkeepDraft = { round: 1, research: 4, researchLab: true, raids: ['caldari'], largeShip: true, ticks: [0, 2] };

  it('starts each round with the base research, nothing claimed and nothing ticked', () => {
    expect(defaultLightUpkeep(3)).toStrictEqual({ round: 3, research: 3, researchLab: false, raids: [], largeShip: false, ticks: [] });
  });

  it('lists the four steps done on the board', () => {
    expect(BOARD_STEPS).toStrictEqual([
      'Return your action cubes to the pool and remove Fleet Exhausted tokens',
      'Mine 1 mineral per asteroid belt in systems you control (a double belt gives 2); keep at most 12 (morphite counts)',
      'Each refinery gives 1 material shown in its system, your choice (Upgraded Refinery: all of them, or a component from a moon and a planetary)',
      'Collect your ISK income (49 at most)',
    ]);
  });

  it('sends the research, the Research Lab, the raids that succeeded and the large ship; never the ticks', () => {
    const cmd = lightUpkeepCommand(typical, { lab: true, supremacy: true });
    expect(cmd).toStrictEqual({ type: 'lightUpkeep', research: 4, researchLab: true, raids: ['caldari'], largeShip: true });
    const r = lightUpkeepGame().tryDispatch('amarr', cmd);
    expect(isError(r) ? r.code : 'ok').toBe('ok');
  });

  it('drops the Research Lab and the large ship a player without the card cannot claim', () => {
    expect(lightUpkeepCommand(typical, { lab: false, supremacy: true })).toStrictEqual({ type: 'lightUpkeep', research: 4, researchLab: false, raids: ['caldari'], largeShip: true });
    expect(lightUpkeepCommand(typical, { lab: true, supremacy: false })).toStrictEqual({ type: 'lightUpkeep', research: 4, researchLab: true, raids: ['caldari'], largeShip: false });
    const r = lightUpkeepGame().tryDispatch('caldari', lightUpkeepCommand({ ...typical, raids: ['amarr'] }, { lab: false, supremacy: false }));
    expect(isError(r) ? r.code : 'ok').toBe('ok');
  });

  it('knows who holds the cards from the completed ones (the engineering complex is the player’s word)', () => {
    const t = lightUpkeepGame();
    expect(lightUpkeepCan(t.p('amarr'))).toStrictEqual({ lab: true, supremacy: true });
    expect(lightUpkeepCan(t.p('caldari'))).toStrictEqual({ lab: false, supremacy: false });
  });

  it('restores a draft of this round only when it is well-formed', () => {
    expect(sanitizeLightUpkeep(JSON.parse(JSON.stringify(typical)), 1)).toStrictEqual(typical);
    expect(sanitizeLightUpkeep(defaultLightUpkeep(2), 2)).toStrictEqual(defaultLightUpkeep(2));
    for (const junk of [
      null,
      'x',
      [],
      { ...typical, research: 21 },
      { ...typical, research: -1 },
      { ...typical, research: 1.5 },
      { ...typical, researchLab: 'yes' },
      { ...typical, largeShip: 1 },
      { ...typical, raids: 'caldari' },
      { ...typical, raids: ['jove'] },
      { ...typical, raids: ['caldari', 'caldari'] },
      { ...typical, ticks: [4] },
      { ...typical, ticks: [0, 0] },
      { ...typical, ticks: [0.5] },
      { ...typical, ticks: null },
    ]) {
      expect(sanitizeLightUpkeep(junk, 1), JSON.stringify(junk)).toBeNull();
    }
  });

  it('discards a draft from another round', () => {
    expect(sanitizeLightUpkeep(typical, 2)).toBeNull();
    expect(sanitizeLightUpkeep({ ...typical, round: '1' }, 1)).toBeNull();
  });
});
