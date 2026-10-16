/**
 * The app: feedback (toasts), the store connection, the saved session and the hash router.
 *   #/ home · #/host · #/join[/CODE] · #/game (lobby room, setup or tabs by phase) · #/table?big[&code=CODE]
 *   #/rules: the rules reference, which needs no game or connection, so it renders even while the host is unreachable.
 *   #/gallery: the UI-kit page, dev server only (production builds leave it out and show Home).
 */
import { lazy, Suspense, useEffect, useState } from 'react';
import { FeedbackProvider } from './components/Toast';
import { SessionProvider, StoreProvider, useRoute, type StoreStatus } from './hooks';
import { Icon } from './icons';
import { BigTable } from './screens/BigTable';
import { GameScreen } from './screens/GameScreen';
import { JoinScreen } from './screens/Join';
import { Home, HostGame } from './screens/Lobby';
import { RulesScreen } from './screens/Reference';
import { HOST, HOSTED } from '../sync/hosting';

/** Shown until the host answers; quiet for the first moment so a fast connection doesn't flash it. */
function Connecting({ status }: { status: StoreStatus }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 400);
    return () => clearTimeout(t);
  }, []);
  if (status.state === 'connecting') {
    return <div className="screen center-screen">{visible && <p className="muted">Connecting to {HOST}…</p>}</div>;
  }
  return (
    <div className="screen center-screen">
      <div className="stack connect-failed" role="alert">
        <Icon name="offline" size="3rem" />
        <h1>Can't reach {HOST}</h1>
        <p className="muted">
          {HOSTED
            ? "Check this device's internet connection. Retrying every few seconds."
            : 'Make sure this device is on the same Wi-Fi as the laptop running the game, and that the laptop is awake. Retrying every few seconds.'}
        </p>
        <button type="button" className="btn btn-secondary" onClick={status.retry}>
          <Icon name="refresh" />
          Try again now
        </button>
      </div>
    </div>
  );
}

/** Dev-only; `import.meta.env.DEV` is false in a build, so the chunk (and its engine imports) is never emitted. */
const Gallery = import.meta.env.DEV ? lazy(() => import('./screens/Gallery').then((m) => ({ default: m.Gallery }))) : null;

function Routes() {
  const route = useRoute();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [route.name]);
  switch (route.name) {
    case 'home':
      return <Home />;
    case 'host':
      return <HostGame />;
    case 'join':
      return <JoinScreen code={route.code} />;
    case 'game':
      return <GameScreen />;
    case 'table':
      return <BigTable code={route.code} />;
    case 'rules':
      return <RulesScreen />;
    case 'gallery':
      return <Home />; // production: the gallery isn't shipped
  }
}

function Root() {
  const route = useRoute();
  if (route.name === 'rules') return <RulesScreen />;
  if (route.name === 'gallery' && Gallery !== null) {
    return (
      <Suspense fallback={null}>
        <Gallery />
      </Suspense>
    );
  }
  return (
    <StoreProvider fallback={(status) => <Connecting status={status} />}>
      <SessionProvider>
        <Routes />
      </SessionProvider>
    </StoreProvider>
  );
}

export function App() {
  return (
    <FeedbackProvider>
      <Root />
    </FeedbackProvider>
  );
}
