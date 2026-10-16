/**
 * Joining: the 6-box code (skipped when the QR link carried it) → name → faction tiles. A free seat joins (lobby
 * only); a taken seat can be taken over after a confirmation (the seat, its resources and cards move to this
 * device). A device that already holds a seat goes straight into the game.
 */
import { useEffect, useState } from 'react';
import { FACTIONS, type FactionId } from '../../data/types';
import type { GameState } from '../../engine/types';
import { actorFor } from '../../sync/commit';
import { loadPref, savePref } from '../../sync/session';
import { CodeInput } from '../components/CodeInput';
import { ConfirmSheet } from '../components/ConfirmSheet';
import { FactionTiles, type FactionTile } from '../components/FactionTiles';
import { FOOTER_INSET, navigate, useBottomInset, useCommand, useGameSnapshot, useSession, useUid } from '../hooks';
import { Icon } from '../icons';
import { formatCode, isCompleteCode } from '../lib/code';
import { factionName } from '../lib/labels';
import { OfflineBanner } from './GameHeader';
import { FlowHeader, NameField } from './Lobby';
import { HOST_HERE } from '../../sync/hosting';

/** Route `#/join[/CODE]`. */
export function JoinScreen({ code }: { code: string }) {
  return isCompleteCode(code) ? <JoinSeat code={code} /> : <CodeStep initial={code} />;
}

function CodeStep({ initial }: { initial: string }) {
  const [code, setCode] = useState(initial);
  const go = (c: string) => navigate({ name: 'join', code: c });
  return (
    <form
      className="screen"
      onSubmit={(e) => {
        e.preventDefault();
        if (isCompleteCode(code)) go(code);
      }}
    >
      <FlowHeader title="Join a game" onBack={() => navigate({ name: 'home' })} />
      <main className="screen-body stack">
        <CodeInput value={code} onChange={setCode} onComplete={go} autoFocus />
        <p className="small faint">The code is on the host's screen, like ABC·234. Scanning the host's QR code skips this step.</p>
        <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={!isCompleteCode(code)}>
          Find game
        </button>
      </main>
    </form>
  );
}

function tilesFor(game: GameState, uid: string): FactionTile[] {
  return FACTIONS.map((f) => {
    const p = game.players[f];
    if (p !== undefined) return { faction: f, status: p.uid === uid ? 'mine' : 'taken', player: p.name };
    return { faction: f, status: game.phase === 'lobby' ? 'free' : 'closed' };
  });
}

/**
 * Seat choice for a known code. `seatLost`: shown inside the game when this device no longer holds a seat (someone
 * took it over, or the join was undone).
 */
export function JoinSeat({ code, seatLost = false }: { code: string; seatLost?: boolean }) {
  const game = useGameSnapshot(code);
  const uid = useUid();
  const { setSession } = useSession();
  const { run, disabled } = useCommand({ code });
  const [name, setName] = useState(() => loadPref('name') ?? '');
  const [faction, setFaction] = useState<FactionId | null>(null);
  const [tried, setTried] = useState(false);
  const [confirming, setConfirming] = useState(false);
  useBottomInset(FOOTER_INSET);

  const mine = game ? actorFor(game, uid) : null;
  useEffect(() => {
    if (mine === null) return;
    setSession({ code, faction: mine });
    if (!seatLost) navigate({ name: 'game' }, { replace: true });
  }, [mine, code, seatLost, setSession]);

  const back = () => {
    if (seatLost) setSession(null);
    navigate({ name: 'home' });
  };
  const title = seatLost ? 'Choose your seat' : `Join ${formatCode(code)}`;

  if (game === undefined || game === null) {
    return (
      <div className="screen">
        <FlowHeader title={title} onBack={back} />
        <OfflineBanner />
        <main className="screen-body stack">
          {game === undefined ? (
            <p className="muted row">
              <Icon name="hourglass" size="1.25rem" />
              Looking for game <span className="mono">{formatCode(code)}</span>…
            </p>
          ) : (
            <>
              <div className="notice notice-warn" role="alert">
                <Icon name="warn" size="1.25rem" />
                <p>
                  No game <span className="mono">{formatCode(code)}</span> {HOST_HERE}. Check the code or ask the host to show the QR.
                </p>
              </div>
              <button type="button" className="btn btn-secondary btn-block" onClick={() => navigate({ name: 'join', code: '' })}>
                Enter another code
              </button>
            </>
          )}
        </main>
      </div>
    );
  }

  const tiles = tilesFor(game, uid);
  const picked = faction === null ? null : (tiles.find((t) => t.faction === faction) ?? null);
  const canJoin = game.phase === 'lobby';
  const trimmed = name.trim();
  const nameError = tried && trimmed.length === 0 ? 'Enter your name' : null;
  const seated = picked?.status === 'taken' ? game.players[picked.faction] : undefined;

  const done = (f: FactionId) => {
    setSession({ code, faction: f });
    navigate({ name: 'game' }, { replace: true });
  };

  const submit = async () => {
    if (picked === null) return;
    if (picked.status === 'taken') {
      setConfirming(true);
      return;
    }
    setTried(true);
    if (trimmed.length === 0) return;
    if (await run({ type: 'join', name: trimmed, faction: picked.faction }, { undo: false })) {
      savePref('name', trimmed);
      done(picked.faction);
    }
  };

  const takeOver = async () => {
    if (picked === null) return;
    if (await run({ type: 'takeOver', faction: picked.faction }, { undo: false })) {
      setConfirming(false);
      done(picked.faction);
    }
  };

  return (
    <form
      className="screen"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <FlowHeader title={title} onBack={back} />
      <OfflineBanner />
      <main className="screen-body stack">
        {seatLost ? (
          <div className="notice notice-warn" role="status">
            <Icon name="warn" size="1.25rem" />
            <p>
              This device no longer holds a seat in <span className="mono">{formatCode(code)}</span>. Someone may have taken it over on another phone.
            </p>
          </div>
        ) : (
          <p className="row muted">
            Game <span className="mono">{formatCode(code)}</span>
            <button type="button" className="btn-link" onClick={() => navigate({ name: 'join', code: '' })}>
              Change code
            </button>
          </p>
        )}
        {canJoin && <NameField value={name} onChange={setName} error={nameError} />}
        <div className="stack-sm">
          <h2 className="field-label">{canJoin ? 'Pick a free faction, or take over a seat' : 'The game has started: take over a seat'}</h2>
          <FactionTiles tiles={tiles} value={faction} onChange={setFaction} label="Faction" />
        </div>
      </main>
      <div className="screen-footer">
        <div className="screen-footer-inner">
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={picked === null || disabled}>
            {picked === null ? 'Pick a faction' : picked.status === 'taken' ? `Take over ${factionName(picked.faction)}…` : `Join as ${factionName(picked.faction)}`}
          </button>
        </div>
      </div>
      <ConfirmSheet
        open={confirming && seated !== undefined}
        title={`Take over ${seated?.name ?? ''}'s seat?`}
        confirmLabel="Take over seat"
        cancelLabel="Keep looking"
        onConfirm={() => void takeOver()}
        onCancel={() => setConfirming(false)}
        busy={disabled}
      >
        <p>
          You will play {factionName(picked?.faction ?? 'amarr')} from this device. Its resources, cards and turn stay as they are; {seated?.name ?? 'the other player'}'s device loses
          the seat. Everyone sees this in the log.
        </p>
      </ConfirmSheet>
    </form>
  );
}
