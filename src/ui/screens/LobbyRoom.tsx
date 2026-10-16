/**
 * The lobby room: who is in, and the clockwise seat order the physical table must match. Anyone seated can swap
 * two seats (tap, tap) or shuffle them; the host (the device that created the game) picks the first player (or a
 * random one) and starts. On a laptop-width screen the join QR, URL and code fill the left half. A light game shows a
 * "Scorekeeper game" tag next to the code.
 */
import { useEffect, useRef, useState } from 'react';
import type { FactionId } from '../../data/types';
import { radioKeys, tabStop } from '../components/radio';
import { FOOTER_INSET, prefersReducedMotion, useBottomInset, useCommand, useMe, useMediaQuery, WIDE } from '../hooks';
import { FactionGlyph, Icon } from '../icons';
import { formatCode } from '../lib/code';
import { factionName } from '../lib/labels';
import { routeHash } from '../lib/route';
import { hostFaction, pickOne, ringSlots, rotateToFirst, shuffled, swapSeats } from '../lib/seats';
import { GameHeader } from './GameHeader';
import { InviteSheet, JoinCode } from './Invite';

const PICK_MS = 600;
const PICK_STEP_MS = 100;

export function LobbyRoom() {
  const { code, game, faction } = useMe();
  const wide = useMediaQuery(WIDE);
  const { run, disabled } = useCommand();
  const [swapFrom, setSwapFrom] = useState<FactionId | null>(null);
  const [first, setFirst] = useState<FactionId | null>(null);
  const [picking, setPicking] = useState<FactionId | null>(null);
  const [invite, setInvite] = useState(false);
  const pickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useBottomInset(FOOTER_INSET);

  useEffect(
    () => () => {
      if (pickTimer.current !== null) clearInterval(pickTimer.current);
    },
    [],
  );

  if (code === null || game === null || faction === null) return null;
  const seats = game.seats;
  const host = hostFaction(game);
  const isHost = host === faction;
  const hostName = host === null ? 'the host' : (game.players[host]?.name ?? 'the host');
  const firstPlayer = first !== null && seats.includes(first) ? first : seats[0]!;
  const swapping = swapFrom !== null && seats.includes(swapFrom) ? swapFrom : null;
  const enough = seats.length >= 2;
  const modeTag = game.mode === 'light' ? <span className="tag">Scorekeeper game</span> : null;

  const tapSeat = (f: FactionId) => {
    if (swapping === null) setSwapFrom(f);
    else if (swapping === f) setSwapFrom(null);
    else {
      setSwapFrom(null);
      void run({ type: 'setSeats', seats: swapSeats(seats, swapping, f) }, { label: `Swapped ${factionName(swapping)} and ${factionName(f)}` });
    }
  };

  const randomFirst = () => {
    const pick = pickOne(seats);
    if (prefersReducedMotion()) {
      setFirst(pick);
      return;
    }
    if (pickTimer.current !== null) clearInterval(pickTimer.current);
    let i = Math.floor(Math.random() * seats.length);
    const started = Date.now();
    setPicking(seats[i]!);
    pickTimer.current = setInterval(() => {
      if (Date.now() - started >= PICK_MS) {
        clearInterval(pickTimer.current!);
        pickTimer.current = null;
        setPicking(null);
        setFirst(pick);
        return;
      }
      i = (i + 1) % seats.length;
      setPicking(seats[i]!);
    }, PICK_STEP_MS);
  };

  const start = async () => {
    const ordered = rotateToFirst(seats, firstPlayer);
    if (ordered.some((f, i) => f !== seats[i])) {
      if (!(await run({ type: 'setSeats', seats: ordered }, { undo: false }))) return;
    }
    await run({ type: 'startGame', firstPlayer });
  };

  const slots = ringSlots(seats.length);
  const ring = (
    <section className="lobby-seats stack-sm" aria-labelledby="seat-title">
      <h2 id="seat-title">Sit in this order around the table</h2>
      <p className="small muted">
        Clockwise, starting at the top. {swapping === null ? 'Tap two seats to swap them.' : `Now tap the seat to swap with ${factionName(swapping)}.`}
      </p>
      <div className={`seat-ring seats-${seats.length}`}>
        <div className="seat-table" aria-hidden="true">
          <Icon name="clockwise" size="1.75rem" />
          <span className="caps">Clockwise</span>
        </div>
        {seats.map((f, i) => {
          const p = game.players[f]!;
          const slot = slots[i]!;
          const marks: string[] = [];
          if (f === faction) marks.push('you');
          if (f === host) marks.push('host');
          if (isHost && f === firstPlayer) marks.push('first player');
          return (
            <button
              key={f}
              type="button"
              className={`seat${swapping === f ? ' is-swapping' : ''}${picking === f ? ' is-picking' : ''}`}
              data-faction={f}
              style={{ gridRow: slot.row, gridColumn: slot.col }}
              aria-pressed={swapping === f}
              aria-label={`Seat ${i + 1}: ${factionName(f)}, ${p.name}${marks.length > 0 ? `, ${marks.join(', ')}` : ''}. ${swapping === null ? 'Tap to swap.' : swapping === f ? 'Selected; tap again to cancel.' : `Swap with ${factionName(swapping)}.`}`}
              disabled={disabled}
              onClick={() => tapSeat(f)}
            >
              <span className="seat-faction">
                <FactionGlyph faction={f} size="1.1rem" />
                <span>{factionName(f)}</span>
              </span>
              <span className="seat-player">{p.name}</span>
              <span className="seat-marks">
                {isHost && f === firstPlayer && <span className="mark mark-first">1st</span>}
                {f === host && (
                  <span className="mark">
                    <Icon name="crown" size="0.9rem" />
                    Host
                  </span>
                )}
                {f === faction && <span className="mark mark-you">You</span>}
                {swapping === f && <span className="mark mark-swap">Swap with…</span>}
              </span>
            </button>
          );
        })}
      </div>
      {!enough && (
        <p className="notice notice-info">
          <Icon name="info" size="1.25rem" />
          <span>Waiting for players: 2 to 4 can play. Others join with the code {wide ? 'or the QR code' : 'or Invite'}.</span>
        </p>
      )}
      <button
        type="button"
        className="btn btn-secondary btn-block"
        disabled={disabled || seats.length < 2}
        onClick={() => void run({ type: 'setSeats', seats: shuffled(seats) }, { label: 'Seats shuffled' })}
      >
        <Icon name="shuffle" />
        Randomise seats
      </button>
    </section>
  );

  const firstPicker = isHost && (
    <section className="stack-sm" aria-labelledby="first-title">
      <h2 id="first-title">First player</h2>
      <div className="chip-row" role="radiogroup" aria-labelledby="first-title" onKeyDown={radioKeys(seats, firstPlayer, setFirst)}>
        {seats.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={f === firstPlayer}
            data-value={f}
            data-faction={f}
            tabIndex={tabStop(seats, firstPlayer, f)}
            className={`chip${f === firstPlayer ? ' is-selected' : ''}${picking === f ? ' is-picking' : ''}`}
            onClick={() => setFirst(f)}
          >
            <FactionGlyph faction={f} size="1rem" />
            {factionName(f)}
            {f === firstPlayer && <Icon name="check" size="1rem" />}
          </button>
        ))}
        <button type="button" className="chip chip-action" onClick={randomFirst} disabled={seats.length < 2 || picking !== null}>
          <Icon name="dice" size="1.1rem" />
          Random
        </button>
      </div>
    </section>
  );

  const footer = (
    <div className="screen-footer">
      <div className="screen-footer-inner">
        {isHost ? (
          <button type="button" className="btn btn-primary btn-lg btn-block" disabled={disabled || !enough || picking !== null} onClick={() => void start()}>
            {enough ? `Start · ${factionName(firstPlayer)} goes first` : 'Start needs 2 players'}
          </button>
        ) : (
          <p className="waiting row" role="status">
            <Icon name="hourglass" size="1.25rem" />
            Waiting for {hostName} to start
          </p>
        )}
      </div>
    </div>
  );

  return (
    <div className="screen">
      <GameHeader code={code} faction={faction} title="Lobby" subtitle={`Game ${formatCode(code)}`} />
      <main className={wide ? 'lobby-room is-wide' : 'lobby-room'}>
        {wide ? (
          <section className="lobby-beacon card" aria-label="Join this game">
            <div className="title-row">
              <h2>Join this game</h2>
              <a className="btn-link" href={routeHash({ name: 'table', big: true, code })}>
                <Icon name="table" size="1.25rem" />
                Open big-screen table
              </a>
            </div>
            <JoinCode code={code} layout="beacon" tag={modeTag} />
          </section>
        ) : (
          <section className="lobby-code card">
            <div>
              <p className="caps faint">Game code</p>
              <p className="lobby-code-value mono">{formatCode(code)}</p>
              {modeTag}
            </div>
            <button type="button" className="btn btn-secondary" onClick={() => setInvite(true)}>
              <Icon name="qr" />
              Invite
            </button>
          </section>
        )}
        <div className="lobby-main stack">
          {ring}
          {firstPicker}
        </div>
      </main>
      {footer}
      <InviteSheet open={invite} onClose={() => setInvite(false)} code={code} />
    </div>
  );
}
