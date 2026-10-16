/**
 * Route `#/game`: the saved session's game. Holds the keep-awake lock while a game is open, marks <body> with this
 * device's faction, mounts the rules drawer once, and shows the lobby room, setup or the tab shell by phase. A game that no longer exists clears
 * the session; a device without a seat gets the seat picker.
 */
import { useEffect } from 'react';
import { actorFor } from '../../sync/commit';
import { loadPref, savePref } from '../../sync/session';
import { useFeedback } from '../components/Toast';
import { GameProvider, KeepAwakeProvider, navigate, useBodyFaction, useGameSnapshot, useMe, useSession, useUid, useWakeLock } from '../hooks';
import { Icon } from '../icons';
import { formatCode } from '../lib/code';
import { JoinSeat } from './Join';
import { LobbyRoom } from './LobbyRoom';
import { RulesProvider } from './RulesDrawer';
import { Setup } from './Setup';
import { TabShell } from './TabShell';
import { HOST_HERE } from '../../sync/hosting';

export function GameScreen() {
  const { session, setSession } = useSession();
  const uid = useUid();
  const { toast } = useFeedback();
  const keepAwake = useWakeLock();
  const code = session?.code ?? null;
  const game = useGameSnapshot(code);
  const faction = game ? actorFor(game, uid) : null;
  useBodyFaction(faction);

  useEffect(() => {
    if (code === null) navigate({ name: 'home' }, { replace: true });
  }, [code]);

  useEffect(() => {
    if (game !== null || code === null) return;
    setSession(null);
    toast(`Game ${formatCode(code)} is no longer ${HOST_HERE}.`, 'warn');
    navigate({ name: 'home' }, { replace: true });
  }, [game, code, setSession, toast]);

  // Keep the saved seat in step with the game (a takeover elsewhere, a seat taken here).
  useEffect(() => {
    if (code !== null && faction !== null && session?.faction !== faction) setSession({ code, faction });
  }, [code, faction, session?.faction, setSession]);

  // Phones on the plain-http LAN can't hold a wake lock: say so once, honestly.
  useEffect(() => {
    if (keepAwake.supported || loadPref('sleepNotice') !== null) return;
    savePref('sleepNotice', 'shown');
    toast('Your phone may sleep during the game; it will rejoin automatically.', 'info');
  }, [keepAwake.supported, toast]);

  if (code === null || game === null) return null;
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
  return (
    <KeepAwakeProvider value={keepAwake}>
      <GameProvider code={code} game={game}>
        <RulesProvider>{faction === null ? <JoinSeat code={code} seatLost /> : <PhaseView />}</RulesProvider>
      </GameProvider>
    </KeepAwakeProvider>
  );
}

function PhaseView() {
  const { game } = useMe();
  switch (game?.phase) {
    case 'lobby':
      return <LobbyRoom />;
    case 'setup':
      return <Setup />;
    default:
      return <TabShell />;
  }
}
