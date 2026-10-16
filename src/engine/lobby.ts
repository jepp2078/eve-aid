import { FACTIONS, MINERALS, type FactionId } from '../data/types';
import { emptyPrivate, newPlayer } from './create';
import type { Command, Ctx, GameState, PlayerPrivate } from './types';
import { addRes, factionName, fail, isDevId, isLight, needActor, needPriv, player, type Out } from './util';

type Cmd<T extends Command['type']> = Extract<Command, { type: T }>;

/** The physical-world step after setup (shown on the Setup screen and on the Panel as one checklist card). */
export const SETUP_NOTICE = 'Draw 1 Event card, then draw 3 Mission cards and keep 1';
export const MAX_NAME = 24;
const STARTING_DEVS = 4;

function needPhase(g: GameState, phase: GameState['phase'], code: string, message: string): void {
  if (g.phase !== phase) fail(code, message);
}

export function join(g: GameState, cmd: Cmd<'join'>, ctx: Ctx, out: Out): PlayerPrivate {
  needPhase(g, 'lobby', 'not_lobby', 'The game has started; take over an existing seat instead');
  const name = typeof cmd.name === 'string' ? cmd.name.trim() : '';
  if (name.length === 0 || name.length > MAX_NAME) fail('bad_name', `Enter a name of 1 to ${MAX_NAME} characters`);
  if (!FACTIONS.includes(cmd.faction)) fail('bad_faction', 'Unknown faction');
  if (g.players[cmd.faction]) fail('faction_taken', `${factionName(cmd.faction)} is already taken`);
  if (g.seats.some((f) => g.players[f]?.uid === ctx.uid)) fail('already_seated', 'This device already holds a seat');
  g.players[cmd.faction] = newPlayer(cmd.faction, name, ctx.uid, g.mode);
  g.seats.push(cmd.faction);
  if (!g.uids.includes(ctx.uid)) g.uids.push(ctx.uid);
  out.lines.push(`${name} joined as ${factionName(cmd.faction)}`);
  return emptyPrivate();
}

/**
 * A new device takes an existing seat (any phase); the player's data stays. A device holding another seat is refused
 * (`already_seated`): a device plays one seat, so its commands never switch to another faction.
 */
export function takeOver(g: GameState, cmd: Cmd<'takeOver'>, ctx: Ctx, out: Out): void {
  const p = player(g, cmd.faction);
  if (p.uid === ctx.uid) fail('already_yours', 'This device already holds that seat');
  const held = g.seats.find((f) => g.players[f]?.uid === ctx.uid);
  if (held !== undefined) fail('already_seated', `This device already holds a seat (${factionName(held)}); a seat moves to a device that holds none`);
  const oldUid = p.uid;
  p.uid = ctx.uid;
  if (!g.uids.includes(ctx.uid)) g.uids.push(ctx.uid);
  if (!g.seats.some((f) => g.players[f]?.uid === oldUid)) g.uids = g.uids.filter((u) => u !== oldUid);
  const who = `${p.name} (${factionName(cmd.faction)})`;
  out.lines.push(`${who} moved to another device`);
  out.notices.push({ to: 'all', text: `${who} is now played from another device`, kind: 'info' });
}

export function setSeats(g: GameState, cmd: Cmd<'setSeats'>, ctx: Ctx, out: Out): void {
  needActor(g, ctx);
  needPhase(g, 'lobby', 'not_lobby', 'Seats can only be changed in the lobby');
  const seats = cmd.seats;
  const isPermutation =
    Array.isArray(seats) &&
    seats.length === g.seats.length &&
    new Set(seats).size === seats.length &&
    seats.every((f) => g.seats.includes(f));
  if (!isPermutation) fail('bad_seats', 'Seat order must list every seated faction exactly once');
  g.seats = [...seats];
  out.lines.push(`Seat order: ${g.seats.map(factionName).join(' → ')}`);
}

export function startGame(g: GameState, cmd: Cmd<'startGame'>, ctx: Ctx, out: Out): void {
  needActor(g, ctx);
  needPhase(g, 'lobby', 'not_lobby', 'The game has already started');
  if (g.seats.length < 2) fail('not_enough_players', 'At least 2 players are needed to start');
  if (!g.seats.includes(cmd.firstPlayer)) fail('bad_first_player', 'The first player must be seated');
  g.firstPlayer = cmd.firstPlayer;
  g.phase = 'setup';
  g.turn = null;
  out.lines.push(`Game started; ${factionName(cmd.firstPlayer)} will go first. Everyone sets up their faction.`);
}

/**
 * Reveal one home belt (gain 1 of that mineral) and pick the 4 starting developments (private). A light game tracks
 * no belts: `revealedBelt` is null there, and nothing is revealed or gained.
 */
export function setupFaction(g: GameState, cmd: Cmd<'setupFaction'>, ctx: Ctx, out: Out, priv: PlayerPrivate | null): void {
  const f = needActor(g, ctx);
  const pv = needPriv(priv);
  needPhase(g, 'setup', 'not_setup', 'Faction setup happens after the game starts');
  const p = player(g, f);
  if (p.setupDone) fail('already_setup', 'You have already finished setup');
  const belt = cmd.revealedBelt;
  if (isLight(g)) {
    if (belt !== null) fail('bad_belt', "Scorekeeper games don't track belts");
  } else if (belt === null || !MINERALS.includes(belt)) {
    fail('bad_belt', 'Choose the mineral of the revealed asteroid belt');
  }
  const devs = cmd.devs;
  const validDevs =
    Array.isArray(devs) && devs.length === STARTING_DEVS && new Set(devs).size === STARTING_DEVS && devs.every(isDevId);
  if (!validDevs) fail('bad_devs', `Choose ${STARTING_DEVS} different development cards`);

  if (belt !== null) {
    p.belts[belt] = 1;
    addRes(p, belt, 1, out);
  }
  pv.area = devs.map((dev) => ({ dev, tokens: 0 }));
  p.devAreaCount = pv.area.length;
  p.setupDone = true;
  out.lines.push(belt === null ? `${p.name} finished setup` : `${p.name} finished setup (revealed a ${belt} belt)`);
  out.notices.push({ to: f, text: SETUP_NOTICE, kind: 'todo' });

  if (g.seats.every((s) => g.players[s]?.setupDone)) beginFirstRound(g, out);
}

function beginFirstRound(g: GameState, out: Out): void {
  g.phase = 'actions';
  g.round = 1;
  g.turn = { faction: g.firstPlayer, actionTaken: null, deployable: false };
  out.lines.push(`Round 1 begins: ${player(g, g.firstPlayer).name} (${factionName(g.firstPlayer)}) takes the first turn`);
}
