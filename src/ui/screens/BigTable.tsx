/**
 * Route `#/table?big[&code=CODE]`: the table for the laptop or a TV everyone can see. Read-only and needs no seat:
 * the game is the one in the link, else this device's saved session; without either it asks for the code.
 *   - Turn/phase banner ("Round 3 · Actions", ▶ whose turn) and the verge banner.
 *   - Seat cards in clockwise order (2×2 for 4 players, three columns for 3, two wide stacked cards for 2), the
 *     numbers centred in each card: huge VP, ISK, cubes, systems, the central system, NOW / First player / Passed /
 *     upkeep / Winner tags; the active card has a thick faction border and ▶ NOW. A light game's board keeps the ISK
 *     and cubes, so its cards show VP, systems and the central system only. Under the numbers, the completed
 *     developments by name; one used this round is dimmed. Hovering, focusing or tapping a card or ship name (here or
 *     in the log) shows its card as the reference page draws it.
 *   - The last 5 log lines, and the join QR, URL and code in a corner (with a "Scorekeeper game" tag in a light game).
 * No controls except a small "Exit" link. Keeps the screen awake while open (when the browser allows it).
 */
import { useState } from 'react';
import type { FactionId } from '../../data/types';
import type { GameState, PlayerPublic } from '../../engine/types';
import { CodeInput } from '../components/CodeInput';
import { DevName, NamedText } from '../components/CardName';
import { navigate, useGameSnapshot, useLog, useSession, useWakeLock } from '../hooks';
import { FactionGlyph, Icon, ResourceIcon } from '../icons';
import { formatCode, isCompleteCode } from '../lib/code';
import { centralWords, factionName, RESOURCE_LABEL } from '../lib/labels';
import { completedRows } from '../lib/devs';
import { recentLines } from '../lib/log';
import { routeHash } from '../lib/route';
import { combatText, phaseText, rowStatus, seatDetail, seatedFactions } from '../lib/table';
import { turnStatus } from '../lib/turn';
import { JoinCode } from './Invite';
import { VergeBanner } from './panel/FinalRanking';
import { CubeTrack } from './panel/PanelTop';
import { SeatTags } from './Table';
import { HOST_HERE } from '../../sync/hosting';

const LINES = 5;

export function BigTable({ code: linked }: { code: string }) {
  const { session } = useSession();
  const code = linked !== '' ? linked : (session?.code ?? null);
  const game = useGameSnapshot(code);
  const log = useLog(code, 20);
  useWakeLock();
  // Exit goes back to this device's game when it is the one shown, else to the start.
  const exit = routeHash(session !== null && session.code === code ? { name: 'game' } : { name: 'home' });

  if (code === null) return <PickGame exit={exit} />;
  if (game === undefined) {
    return (
      <div className="screen center-screen">
        <p className="row muted">
          <Icon name="hourglass" size="1.25rem" />
          Connecting to game <span className="mono">{formatCode(code)}</span>…
        </p>
      </div>
    );
  }
  if (game === null) return <PickGame exit={exit} missing={code} />;

  const seats = seatedFactions(game);
  const status = turnStatus(game, null);
  const turn = game.phase === 'actions' ? game.turn : null;
  const combat = game.phase === 'ended' ? null : combatText(game);
  const lines = recentLines(log, LINES);

  return (
    <div className="big" data-seats={seats.length}>
      <header className="big-top">
        <div className="big-banner">
          <h1 className="big-phase">{phaseText(game)}</h1>
          {turn !== null && (
            <p className="big-turn" data-faction={turn.faction}>
              <span className="big-turn-who">
                <Icon name="play" className="big-turn-mark" />
                <FactionGlyph faction={turn.faction} />
                <strong className="big-turn-name">{factionName(turn.faction)}</strong>
              </span>
              <span className="big-turn-detail">{status.detail}</span>
            </p>
          )}
        </div>
        <a className="big-exit" href={exit}>
          <Icon name="close" size="1.1rem" />
          Exit
        </a>
      </header>
      {(game.verge !== null || combat !== null) && (
        <div className="big-alerts">
          <VergeBanner game={game} />
          {combat !== null && (
            <p className="big-combat">
              <Icon name="combat" />
              <span>
                <strong>Combat in progress:</strong> {combat}
              </span>
            </p>
          )}
        </div>
      )}
      <main className="big-main">
        <ul className="big-seats" aria-label="Players, clockwise">
          {seats.map((f) => (
            <SeatCard key={f} game={game} f={f} p={game.players[f]!} />
          ))}
        </ul>
        <aside className="big-side">
          <section className="big-log" aria-labelledby="big-log-title">
            <h2 id="big-log-title" className="caps faint">
              Latest
            </h2>
            {lines.length === 0 ? (
              <p className="muted">Nothing has happened yet.</p>
            ) : (
              <ol className="big-lines">
                {lines.map((l) => (
                  <li key={l.key} className="big-line" data-faction={l.actor ?? undefined}>
                    {l.actor === null ? <Icon name="info" size="1.1em" /> : <FactionGlyph faction={l.actor} size="1.1em" />}
                    <span>
                      <NamedText text={l.text} />
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className="big-join" aria-label="Join this game">
            <JoinCode code={code} layout="corner" tag={game.mode === 'light' ? <span className="tag">Scorekeeper game</span> : null} />
          </section>
        </aside>
      </main>
    </div>
  );
}

function SeatCard({ game, f, p }: { game: GameState; f: FactionId; p: PlayerPublic }) {
  const s = rowStatus(game, f);
  const light = game.mode === 'light';
  const winner = s.tags.some((t) => t.kind === 'winner');
  const cls = ['big-seat', s.active && 'is-active', s.dimmed && 'is-passed', winner && 'is-winner'].filter(Boolean).join(' ');
  return (
    <li className={cls} data-faction={f}>
      <div className="big-seat-head">
        {s.active && <Icon name="play" className="big-now-mark" />}
        <FactionGlyph faction={f} size="1.5em" />
        <span className="big-faction">{factionName(f)}</span>
        <span className="big-player truncate">{p.name}</span>
      </div>
      <SeatTags tags={s.tags} />
      <div className="big-body">
        <div className="big-nums">
          <p className="big-vp">
            <span className="big-vp-num num">{p.vp}</span>
            <span className="big-unit">VP</span>
          </p>
          {!light && (
            <p className="big-isk">
              <ResourceIcon kind="isk" size="0.6em" title={null} />
              <span className="big-isk-num num">{p.res.isk}</span>
              <span className="big-unit">ISK</span>
            </p>
          )}
        </div>
        <div className="big-stats">
          {!light && <CubeTrack used={p.cubesUsed} compact />}
          <span className="big-stat">
            <Icon name="claim" size="1.1em" />
            <span className="num">{p.systems}</span> {p.systems === 1 ? 'system' : 'systems'}
          </span>
          {p.central && (
            <span className="big-stat big-central">
              <Icon name="central" size="1.1em" />
              {centralWords(game.seats.length).tag}
            </span>
          )}
        </div>
      </div>
      {!light && <Stock p={p} />}
      <CompletedDevs p={p} />
    </li>
  );
}

/** The seat's minerals and materials as icon and count (public by the rules, manual p. 9); nothing while it holds none. */
function Stock({ p }: { p: PlayerPublic }) {
  const { stock } = seatDetail(p);
  if (stock.length === 0) return null;
  return (
    <ul className="big-stock" aria-label="Resources">
      {stock.map((r) => (
        <li key={r.kind} className="big-stock-item" aria-label={`${RESOURCE_LABEL[r.kind]} ${r.count}`}>
          <ResourceIcon kind={r.kind} size="1em" title={null} />
          <span className="num">{r.count}</span>
        </li>
      ))}
    </ul>
  );
}

/** The seat's completed developments as name chips; a card used this round is dimmed. Nothing while none are done. */
function CompletedDevs({ p }: { p: PlayerPublic }) {
  const rows = completedRows(p);
  if (rows.length === 0) return null;
  return (
    <ul className="big-devs" aria-label="Completed developments">
      {rows.map((r) => (
        <li key={r.dev.id}>
          <DevName dev={r.dev} className={r.tapped ? 'big-dev is-tapped' : 'big-dev'}>
            <Icon name="research" size="0.9em" />
            {r.dev.name}
            {r.tapped && <span className="sr-only"> (used this round)</span>}
          </DevName>
        </li>
      ))}
    </ul>
  );
}

/** No game to show yet: ask for its code (a TV that only opened the site), or say the linked game is gone. */
function PickGame({ exit, missing }: { exit: string; missing?: string }) {
  const [value, setValue] = useState('');
  const show = (c: string) => navigate({ name: 'table', big: true, code: c });
  return (
    <div className="screen center-screen">
      <div className="stack big-pick">
        <Icon name="table" size="3rem" />
        <h1>Big-screen table</h1>
        {missing !== undefined ? (
          <p className="notice notice-warn">
            <Icon name="warn" size="1.25rem" />
            <span>
              No game <span className="mono">{formatCode(missing)}</span> {HOST_HERE}. Check the code.
            </span>
          </p>
        ) : (
          <p className="muted">Enter the game code to show everyone's VP, ISK and turn on this screen.</p>
        )}
        <CodeInput value={value} onChange={setValue} onComplete={show} autoFocus label="Game code" />
        <button type="button" className="btn btn-primary btn-lg btn-block" disabled={!isCompleteCode(value)} onClick={() => show(value)}>
          Show the table
        </button>
        <a className="btn-link big-pick-exit" href={exit}>
          Back
        </a>
      </div>
    </div>
  );
}
