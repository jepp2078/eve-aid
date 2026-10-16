/**
 * Before a game: Home (resume card, Host, Join, the rules reference; the LAN address in the footer and, on a laptop, a QR to the site)
 * and Host (name + faction tiles + game mode → a new lobby).
 */
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { FACTIONS, type FactionId } from '../../data/types';
import { MAX_NAME } from '../../engine/lobby';
import type { GameMode, GameState } from '../../engine/types';
import type { Session } from '../../sync/session';
import { loadPref, savePref } from '../../sync/session';
import { FactionBadge } from '../components/FactionBadge';
import { FactionTiles } from '../components/FactionTiles';
import { radioKeys, tabStop } from '../components/radio';
import { useFeedback } from '../components/Toast';
import { FOOTER_INSET, navigate, useBottomInset, useConnection, useGameSnapshot, useMediaQuery, useSession, useShareInfo, useStore, WIDE } from '../hooks';
import { Icon } from '../icons';
import { formatCode } from '../lib/code';
import { factionName } from '../lib/labels';
import { OfflineBanner, useAppTopHeight } from './GameHeader';
import { SiteBeacon } from './Invite';
import { HOST_HERE, HOSTED } from '../../sync/hosting';

function phaseLine(game: GameState): string {
  switch (game.phase) {
    case 'lobby':
      return `Lobby · ${game.seats.length} ${game.seats.length === 1 ? 'player' : 'players'}`;
    case 'setup':
      return 'Setting up factions';
    case 'actions':
      return `Round ${game.round} · Actions`;
    case 'upkeep':
      return `Round ${game.round} · Upkeep`;
    case 'ended':
      return 'Game over';
  }
}

function ResumeCard({ session, onForget }: { session: Session; onForget: () => void }) {
  const game = useGameSnapshot(session.code);
  const code = formatCode(session.code);
  if (game === null) {
    return (
      <div className="card resume-card is-gone">
        <p className="row">
          <Icon name="warn" size="1.25rem" className="text-warn" />
          <span>
            Game <span className="mono">{code}</span> is no longer {HOST_HERE}.
          </span>
        </p>
        <button type="button" className="btn btn-secondary" onClick={onForget}>
          Forget it
        </button>
      </div>
    );
  }
  return (
    <div className="resume-card-wrap">
      <button type="button" className="card resume-card" data-faction={session.faction ?? undefined} onClick={() => navigate({ name: 'game' })}>
        <span className="resume-text">
          <span className="caps faint">Resume</span>
          <span className="resume-title">
            <span className="mono">{code}</span>
            {session.faction !== null && (
              <>
                <span className="muted"> as </span>
                <FactionBadge faction={session.faction} />
              </>
            )}
          </span>
          <span className="small muted">{game === undefined ? 'Checking…' : phaseLine(game)}</span>
        </span>
        <Icon name="chevronRight" />
      </button>
      <button type="button" className="btn-link resume-forget" onClick={onForget}>
        Forget this game on this device
      </button>
    </div>
  );
}

function ShareFooter() {
  const info = useShareInfo();
  return (
    <footer className="home-footer">
      <span className="small muted">Players on this Wi-Fi open</span>
      <span className="mono home-url">{info?.best ?? '…'}</span>
    </footer>
  );
}

export function Home() {
  const { session, setSession } = useSession();
  const wide = useMediaQuery(WIDE);
  return (
    <div className="screen home">
      <main className="screen-body stack">
        <div className="home-hero">
          <span className="home-mark" aria-hidden="true">
            {FACTIONS.map((f) => (
              <span key={f} className={`home-mark-${f}`} data-faction={f} />
            ))}
          </span>
          <h1>EVE Table Companion</h1>
          <p className="muted">Resources, turns, combat maths and rules for EVE: War for New Eden. Every player uses their own phone; {HOSTED ? 'the server' : 'this laptop'} keeps the game.</p>
        </div>
        {session !== null && <ResumeCard session={session} onForget={() => setSession(null)} />}
        <div className="stack-sm">
          <button type="button" className="btn btn-primary btn-lg btn-block" onClick={() => navigate({ name: 'host' })}>
            <Icon name="play" />
            Host a new game
          </button>
          <button type="button" className="btn btn-secondary btn-lg btn-block" onClick={() => navigate({ name: 'join', code: '' })}>
            <Icon name="user" />
            Join with code
          </button>
          <button type="button" className="btn btn-ghost btn-lg btn-block" onClick={() => navigate({ name: 'rules' })}>
            <Icon name="reference" />
            Rules reference
          </button>
        </div>
        {wide && <SiteBeacon />}
      </main>
      {!wide && <ShareFooter />}
    </div>
  );
}

/** A simple top bar for the pre-game flows: back to Home and a title. */
export function FlowHeader({ title, onBack }: { title: ReactNode; onBack: () => void }) {
  const topRef = useRef<HTMLDivElement>(null);
  useAppTopHeight(topRef);
  return (
    <div ref={topRef} className="app-top">
      <header className="app-header">
        <button type="button" className="icon-btn" onClick={onBack} aria-label="Back">
          <Icon name="chevronLeft" />
        </button>
        <div className="app-header-text">
          <span className="app-header-title">{title}</span>
        </div>
      </header>
    </div>
  );
}

/** The player's name, remembered per profile. */
export function NameField({ value, onChange, error }: { value: string; onChange: (v: string) => void; error: string | null }) {
  return (
    <div className="field">
      <label htmlFor="player-name" className="field-label">
        Your name
      </label>
      <input
        id="player-name"
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={MAX_NAME}
        autoComplete="nickname"
        enterKeyHint="next"
        aria-invalid={error !== null}
        aria-describedby={error !== null ? 'player-name-error' : undefined}
      />
      {error !== null && (
        <p id="player-name-error" className="field-error">
          <Icon name="danger" size="1rem" />
          {error}
        </p>
      )}
    </div>
  );
}

const MODES: readonly GameMode[] = ['full', 'light'];
const MODE_LABEL: Record<GameMode, string> = { full: 'Full', light: 'Scorekeeper' };
const MODE_NOTE: Record<GameMode, string> = {
  full: 'The app tracks everything: ISK, minerals, ships and every action.',
  light: 'Track VP, systems and development cards, with turns, combat and upkeep help. ISK, minerals and ships stay on the board.',
};

/** Full or Scorekeeper, for the whole table and the game's life; one line says what the chosen mode tracks. */
function ModeField({ value, onChange }: { value: GameMode; onChange: (m: GameMode) => void }) {
  return (
    <div className="stack-sm">
      <h2 id="mode-title" className="field-label">
        Game mode
      </h2>
      <div className="chip-row" role="radiogroup" aria-labelledby="mode-title" aria-describedby="mode-note" onKeyDown={radioKeys(MODES, value, onChange)}>
        {MODES.map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={value === m}
            tabIndex={tabStop(MODES, value, m)}
            data-value={m}
            className={value === m ? 'chip is-selected' : 'chip'}
            onClick={() => onChange(m)}
          >
            {MODE_LABEL[m]}
          </button>
        ))}
      </div>
      <p id="mode-note" className="small muted">
        {MODE_NOTE[value]}
      </p>
    </div>
  );
}

export function HostGame() {
  const store = useStore();
  const { setSession } = useSession();
  const { toast } = useFeedback();
  const [name, setName] = useState(() => loadPref('name') ?? '');
  const [faction, setFaction] = useState<FactionId | null>(null);
  const [mode, setMode] = useState<GameMode>('full');
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const { paused } = useConnection();
  useBottomInset(FOOTER_INSET);

  const trimmed = name.trim();
  const nameError = tried && trimmed.length === 0 ? 'Enter your name' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (trimmed.length === 0 || faction === null || busy || paused) return;
    setBusy(true);
    const r = await store.createGame(trimmed, faction, mode);
    setBusy(false);
    if (typeof r !== 'string') {
      toast(r.message, 'danger');
      return;
    }
    savePref('name', trimmed);
    setSession({ code: r, faction });
    navigate({ name: 'game' }, { replace: true }); // Back from the lobby goes home, not to this form
  };

  return (
    <form className="screen" onSubmit={submit}>
      <FlowHeader title="Host a new game" onBack={() => navigate({ name: 'home' })} />
      <OfflineBanner />
      <main className="screen-body stack">
        <NameField value={name} onChange={setName} error={nameError} />
        <div className="stack-sm">
          <h2 className="field-label">Your faction</h2>
          <FactionTiles tiles={FACTIONS.map((f) => ({ faction: f, status: 'free' }))} value={faction} onChange={setFaction} label="Your faction" />
        </div>
        <ModeField value={mode} onChange={setMode} />
        <p className="small faint">Others join from their phones with the code or QR shown in the lobby.</p>
      </main>
      <div className="screen-footer">
        <div className="screen-footer-inner">
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || paused || faction === null}>
            {faction === null ? 'Pick a faction' : `Host as ${factionName(faction)}`}
          </button>
        </div>
      </div>
    </form>
  );
}
