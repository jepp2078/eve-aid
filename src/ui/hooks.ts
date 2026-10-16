/**
 * React glue between the UI and the GameStore: providers for the store, the saved session and the open game, hooks
 * for live state, commands (with toast errors and an undo snackbar), connection status, routing, keep-awake and a
 * few layout helpers. Screens never talk to the store directly; they use these.
 */
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from 'react';
import type { FactionId } from '../data/types';
import type { Command, GameState, PlayerPrivate, PlayerPublic } from '../engine/types';
import { actorFor } from '../sync/commit';
import { getStore } from '../sync/getStore';
import { loadPref, loadSession, savePref, saveSession, type Session } from '../sync/session';
import type { GameStore, LogEntry } from '../sync/store';
import type { Todo } from '../sync/todos';
import { useFeedback } from './components/Toast';
import { commandLabel } from './lib/labels';
import { parseRoute, routeHash, type Route } from './lib/route';
import { bestShareUrl, otherShareUrls } from './lib/share';
import { newlyUndone, snackbarUndoSeq } from './lib/undo';

export { prefersReducedMotion } from './lib/motion';

/* ---------------------------------------------------------------- store */

interface StoreValue {
  store: GameStore;
  /** This device's public uid (what seats are held by). */
  uid: string;
}

const StoreContext = createContext<StoreValue | null>(null);

interface ConnectionValue {
  /** The live stream to the host is up. */
  online: boolean;
  /** Offline for at least PAUSE_AFTER_MS: show the banner and disable command buttons. */
  paused: boolean;
}

const ConnectionContext = createContext<ConnectionValue>({ online: true, paused: false });

/** Offline blips shorter than this don't show the banner (no flicker). */
export const PAUSE_AFTER_MS = 2000;
const RETRY_MS = 3000;

export type StoreStatus = { state: 'connecting' } | { state: 'failed'; retry: () => void };

/**
 * Connects to the host (retrying every 3 s while it can't be reached) and provides the store. Until then it renders
 * `fallback`.
 */
export function StoreProvider({ children, fallback }: { children: ReactNode; fallback: (s: StoreStatus) => ReactNode }) {
  const [value, setValue] = useState<StoreValue | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    getStore()
      .then(async (store) => {
        const uid = await store.init();
        if (live) setValue({ store, uid });
      })
      .catch(() => {
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [attempt]);

  useEffect(() => {
    if (!failed || value !== null) return;
    const t = setTimeout(() => setAttempt((a) => a + 1), RETRY_MS);
    return () => clearTimeout(t);
  }, [failed, value, attempt]);

  const retry = useCallback(() => setAttempt((a) => a + 1), []);

  if (value === null) return fallback(failed ? { state: 'failed', retry } : { state: 'connecting' });
  return createElement(StoreContext.Provider, { value }, createElement(ConnectionProvider, { store: value.store, children }));
}

function ConnectionProvider({ store, children }: { store: GameStore; children: ReactNode }) {
  const [online, setOnline] = useState(true);
  const [paused, setPaused] = useState(false);
  useEffect(() => store.subscribeConnection(setOnline), [store]);
  useEffect(() => {
    if (online) {
      setPaused(false);
      return;
    }
    const t = setTimeout(() => setPaused(true), PAUSE_AFTER_MS);
    return () => clearTimeout(t);
  }, [online]);
  const value = useMemo(() => ({ online, paused }), [online, paused]);
  return createElement(ConnectionContext.Provider, { value }, children);
}

function useStoreValue(): StoreValue {
  const v = useContext(StoreContext);
  if (v === null) throw new Error('useStore needs a <StoreProvider>');
  return v;
}

export function useStore(): GameStore {
  return useStoreValue().store;
}

/** This device's public uid. */
export function useUid(): string {
  return useStoreValue().uid;
}

/** Live connection state; `paused` turns on after 2 s offline. */
export function useConnection(): ConnectionValue {
  return useContext(ConnectionContext);
}

/* -------------------------------------------------------------- session */

interface SessionValue {
  /** The game this device last joined (code and seat), saved per `?as=` profile. */
  session: Session | null;
  setSession: (s: Session | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, set] = useState<Session | null>(() => loadSession());
  const setSession = useCallback((s: Session | null) => {
    saveSession(s);
    set((cur) => (cur?.code === s?.code && cur?.faction === s?.faction ? cur : s));
  }, []);
  const value = useMemo(() => ({ session, setSession }), [session, setSession]);
  return createElement(SessionContext.Provider, { value }, children);
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (v === null) throw new Error('useSession needs a <SessionProvider>');
  return v;
}

/* ---------------------------------------------------------------- routing */

const routeListeners = new Set<() => void>();

function subscribeRoute(cb: () => void): () => void {
  window.addEventListener('hashchange', cb);
  routeListeners.add(cb);
  return () => {
    window.removeEventListener('hashchange', cb);
    routeListeners.delete(cb);
  };
}

/** Goes to `route` by changing only the hash, so `?as=<profile>` in the query string is kept. */
export function navigate(route: Route, opts: { replace?: boolean } = {}): void {
  const hash = routeHash(route);
  if (opts.replace) {
    history.replaceState(history.state, '', hash);
    for (const cb of [...routeListeners]) cb();
  } else if (window.location.hash !== hash) {
    window.location.hash = hash;
  }
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribeRoute, () => window.location.hash, () => '');
  return useMemo(() => parseRoute(hash), [hash]);
}

/* ----------------------------------------------------- live subscriptions */

/** The latest value a subscription delivered for `key` (undefined until the first one, or while key is null). */
function useSubscribed<T>(key: string | null, subscribe: (cb: (v: T) => void) => () => void): T | undefined {
  const [state, setState] = useState<{ key: string | null; value: T | undefined }>({ key, value: undefined });
  const subscribeRef = useRef(subscribe);
  subscribeRef.current = subscribe;
  useEffect(() => {
    if (key === null) return;
    return subscribeRef.current((value) => setState({ key, value }));
  }, [key]);
  return state.key === key ? state.value : undefined;
}

/** Public game state: undefined while loading, null when no game has that code. */
export function useGameSnapshot(code: string | null): GameState | null | undefined {
  const store = useStore();
  const g = useSubscribed<GameState | null>(code, (cb) => store.subscribeGame(code!, cb));
  return code === null ? null : g;
}

/** Public game state, or null (loading or no such game). */
export function useGame(code: string | null): GameState | null {
  return useGameSnapshot(code) ?? null;
}

/** This device's private doc for `faction` (null unless this device holds that seat). */
export function usePrivate(code: string | null, faction: FactionId | null): PlayerPrivate | null {
  const store = useStore();
  const key = code !== null && faction !== null ? `${code}:${faction}` : null;
  return useSubscribed<PlayerPrivate | null>(key, (cb) => store.subscribePrivate(code!, faction!, cb)) ?? null;
}

const NO_LOG: LogEntry[] = [];

/** The latest `limit` log entries, oldest first (at most 50 arrive from the host). */
export function useLog(code: string | null, limit: number): LogEntry[] {
  const store = useStore();
  const key = code === null ? null : `${code}:${limit}`;
  return useSubscribed<LogEntry[]>(key, (cb) => store.subscribeLog(code!, limit, cb)) ?? NO_LOG;
}

const NO_TODOS: Todo[] = [];

/** This device's to-do list for game `code`: its seat's and everyone's, oldest first (the host keeps them). */
export function useTodos(code: string | null): Todo[] {
  const store = useStore();
  return useSubscribed<Todo[]>(code, (cb) => store.subscribeTodos(code!, cb)) ?? NO_TODOS;
}

/* ------------------------------------------------------------- open game */

interface GameValue {
  code: string;
  game: GameState;
  faction: FactionId | null;
  me: PlayerPublic | null;
  priv: PlayerPrivate | null;
  /** The newest game state, readable from callbacks created on an older render. */
  latest: RefObject<GameState>;
  /** Log seqs this device undid itself (so their flip to `undone` doesn't toast). */
  ownUndos: RefObject<Set<number>>;
}

const GameContext = createContext<GameValue | null>(null);

/** Provides the open game to everything under it and toasts undos made on other devices. */
export function GameProvider({ code, game, children }: { code: string; game: GameState; children: ReactNode }) {
  const uid = useUid();
  const faction = actorFor(game, uid);
  const priv = usePrivate(code, faction);
  const latest = useRef(game);
  const ownUndos = useRef(new Set<number>());
  useEffect(() => {
    latest.current = game;
  }, [game]);
  useUndoToasts(code, ownUndos);
  const me = faction === null ? null : (game.players[faction] ?? null);
  const value = useMemo<GameValue>(() => ({ code, game, faction, me, priv, latest, ownUndos }), [code, game, faction, me, priv]);
  return createElement(GameContext.Provider, { value }, children);
}

export interface Me {
  code: string | null;
  /** The seat this device holds in the open game. */
  faction: FactionId | null;
  uid: string;
  game: GameState | null;
  me: PlayerPublic | null;
  priv: PlayerPrivate | null;
}

/** Who this device is in the open game (all null outside a game). */
export function useMe(): Me {
  const ctx = useContext(GameContext);
  const uid = useUid();
  const { session } = useSession();
  if (ctx !== null) return { code: ctx.code, faction: ctx.faction, uid, game: ctx.game, me: ctx.me, priv: ctx.priv };
  return { code: session?.code ?? null, faction: null, uid, game: null, me: null, priv: null };
}

/** The open game and this device's seat, or null outside a game. Needs no store (works in the gallery too). */
export function useOpenGame(): { game: GameState; faction: FactionId | null } | null {
  const ctx = useContext(GameContext);
  return ctx === null ? null : { game: ctx.game, faction: ctx.faction };
}

function useUndoToasts(code: string, ownUndos: RefObject<Set<number>>): void {
  const log = useLog(code, 50);
  const prev = useRef<LogEntry[] | null>(null);
  const { toast } = useFeedback();
  useEffect(() => {
    const before = prev.current;
    prev.current = log;
    if (before === null) return;
    for (const e of newlyUndone(before, log)) {
      if (ownUndos.current.delete(e.seq)) continue;
      toast(`Undone on another device: ${e.lines[0] ?? 'a change'}`, 'info');
    }
  }, [log, ownUndos, toast]);
}

/* -------------------------------------------------------------- commands */

export interface DispatchOptions {
  /** Snackbar text; defaults to the command's short label. */
  label?: string;
  /** Offer Undo in the snackbar (default true). */
  undo?: boolean;
}

export type Dispatch = (cmd: Command, opts?: DispatchOptions) => Promise<boolean>;

/** A short haptic tick where the Vibration API exists (Android); never the only signal. */
export function buzz(ms = 15): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not allowed without a gesture; ignore
  }
}

/** A ref that always holds the latest committed `value`, for stable callbacks that must read fresh data. */
function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** The open game's code: `target.code`, else the provided game, else the saved session. */
function useTargetCode(target: { code?: string }): RefObject<string | null> {
  const ctx = useContext(GameContext);
  const { session } = useSession();
  return useLatest(target.code ?? ctx?.code ?? session?.code ?? null);
}

/** Which entry an Undo means. */
type UndoTarget =
  /** A log entry the player sees as the newest undoable one (the Table's log). */
  | { seq: number }
  /** A snackbar's Undo: the entry its command created; `before` is the game's logSeq just before the command. */
  | { before: number; me: FactionId | null }
  /** The newest entry this device knows of. */
  | null;

/**
 * Undo one log entry as this device. Every undo names the entry it means (`seq`), and the host refuses with
 * `not_latest` when something newer happened meanwhile, so an Undo never reverts a change its player hasn't seen.
 * A snackbar's Undo is refused here already when someone else's change is known to be newer. Stable across game
 * updates.
 */
function useUndoRunner() {
  const { store } = useStoreValue();
  const ctxRef = useLatest(useContext(GameContext));
  const { toast } = useFeedback();
  return useCallback(
    async (code: string, label: string | null, target: UndoTarget): Promise<boolean> => {
      const ctx = ctxRef.current?.code === code ? ctxRef.current : null;
      const history = ctx === null ? null : ctx.latest.current.history;
      let seq: number | undefined;
      if (target !== null && 'seq' in target) seq = target.seq;
      else if (target !== null) {
        const mine = history === null ? { seq: target.before + 1 } : snackbarUndoSeq(history, target.before, target.me);
        if (mine === null) {
          toast("Can't undo: someone else changed the game after you", 'warn');
          return false;
        }
        seq = mine.seq;
      } else seq = history?.[history.length - 1]?.seq;
      // This device's own undo: its flip to `undone` must not toast "undone on another device". The host undoes
      // exactly `seq` or nothing, so on success the mark is right, and on failure it is taken back.
      if (seq !== undefined && ctx !== null) ctx.ownUndos.current.add(seq);
      const e = await store.undo(code, seq);
      if (e !== null) {
        if (seq !== undefined && ctx !== null) ctx.ownUndos.current.delete(seq);
        toast(e.message, e.code === 'not_latest' ? 'warn' : 'danger');
        buzz();
        return false;
      }
      toast(label === null ? 'Undone' : `Undone: ${label}`, 'info');
      return true;
    },
    [store, ctxRef, toast],
  );
}

/**
 * Sends a command to the open game (or to `target.code`). A RuleError shows as a toast; success shows a snackbar
 * "<label> · Undo". Resolves to whether the command was applied. The function's identity is stable across game
 * updates (it reads the latest game through refs), so it is safe in effect and memo dependencies.
 */
export function useDispatch(target: { code?: string } = {}): Dispatch {
  const { store } = useStoreValue();
  const ctxRef = useLatest(useContext(GameContext));
  const codeRef = useTargetCode(target);
  const { toast, snackbar } = useFeedback();
  const runUndo = useUndoRunner();
  return useCallback(
    async (cmd: Command, opts: DispatchOptions = {}) => {
      const code = codeRef.current;
      if (code === null) {
        toast('No game is open', 'danger');
        return false;
      }
      const ctx = ctxRef.current?.code === code ? ctxRef.current : null;
      const before = ctx === null ? null : ctx.latest.current.logSeq;
      const me = ctx === null ? null : ctx.faction;
      const e = await store.dispatch(code, cmd);
      if (e !== null) {
        toast(e.message, 'danger');
        buzz();
        return false;
      }
      if (opts.undo !== false) {
        const label = opts.label ?? commandLabel(cmd);
        snackbar(label, {
          label: 'Undo',
          onAction: () => void runUndo(code, label, before === null ? null : { before, me }),
        });
      }
      return true;
    },
    [codeRef, ctxRef, store, toast, snackbar, runUndo],
  );
}

/**
 * Undo a change (the log's Undo button): `seq` is the entry the player sees as the newest undoable one (default: the
 * newest this device knows of); the host refuses when something newer happened. Errors show as a toast. Stable
 * identity.
 */
export function useUndo(target: { code?: string } = {}): (label?: string, seq?: number) => Promise<boolean> {
  const codeRef = useTargetCode(target);
  const runUndo = useUndoRunner();
  return useCallback(
    async (label?: string, seq?: number) => {
      const code = codeRef.current;
      return code === null ? false : runUndo(code, label ?? null, seq === undefined ? null : { seq });
    },
    [codeRef, runUndo],
  );
}

/**
 * `useDispatch` plus a busy flag: `disabled` is true while a command is in flight or changes are paused (host
 * unreachable for 2 s), so buttons can't double-send or send into the void.
 */
export function useCommand(target: { code?: string } = {}) {
  const dispatch = useDispatch(target);
  const { paused } = useConnection();
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const run = useCallback(
    async (cmd: Command, opts?: DispatchOptions) => {
      if (busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      try {
        return await dispatch(cmd, opts);
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [dispatch],
  );
  return { run, busy, paused, disabled: busy || paused };
}

/* ------------------------------------------------------------ keep awake */

export interface KeepAwake {
  /** The Screen Wake Lock API exists here (laptop on localhost; not plain-http phones). */
  supported: boolean;
  /** The player wants the screen kept on (remembered; default on). */
  enabled: boolean;
  /** A wake lock is currently held. */
  active: boolean;
  setEnabled: (on: boolean) => void;
}

const KeepAwakeContext = createContext<KeepAwake>({ supported: false, enabled: false, active: false, setEnabled: () => {} });

/** Holds a screen wake lock while enabled and visible (re-acquired when the page becomes visible again). */
export function useWakeLock(): KeepAwake {
  const supported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  const [enabled, setEnabledState] = useState(() => loadPref('keepAwake') !== 'off');
  const [active, setActive] = useState(false);
  const setEnabled = useCallback((on: boolean) => {
    savePref('keepAwake', on ? 'on' : 'off');
    setEnabledState(on);
  }, []);

  useEffect(() => {
    if (!supported || !enabled) return;
    let sentinel: WakeLockSentinel | null = null;
    let disposed = false;
    /** One request at a time: a visibilitychange during a pending request must not open a second lock. */
    let requesting = false;
    const acquire = async () => {
      if (disposed || requesting || document.visibilityState !== 'visible' || (sentinel !== null && !sentinel.released)) return;
      requesting = true;
      try {
        const s = await navigator.wakeLock.request('screen');
        if (disposed) {
          void s.release(); // the effect was cleaned up while we waited: never keep a lock nobody owns
          return;
        }
        if (sentinel !== null && !sentinel.released) void sentinel.release();
        sentinel = s;
        setActive(true);
        s.addEventListener('release', () => {
          if (sentinel === s) setActive(false);
        });
      } catch {
        setActive(false);
      } finally {
        requesting = false;
      }
    };
    void acquire();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (sentinel !== null) void sentinel.release();
      setActive(false);
    };
  }, [supported, enabled]);

  return useMemo(() => ({ supported, enabled, active, setEnabled }), [supported, enabled, active, setEnabled]);
}

export function KeepAwakeProvider({ value, children }: { value: KeepAwake; children: ReactNode }) {
  return createElement(KeepAwakeContext.Provider, { value }, children);
}

export function useKeepAwake(): KeepAwake {
  return useContext(KeepAwakeContext);
}

/* ---------------------------------------------------------------- sharing */

let shareUrls: Promise<string[]> | null = null;

/** Where other players reach this host: the best URL for the QR and the other addresses. Null while loading. */
export function useShareInfo(): { best: string; others: string[] } | null {
  const store = useStore();
  const [urls, setUrls] = useState<string[] | null>(null);
  useEffect(() => {
    let live = true;
    const p = (shareUrls ??= store.shareUrls());
    void p.then((u) => {
      if (u.length === 0 && shareUrls === p) shareUrls = null; // ask again next time
      if (live) setUrls(u);
    });
    return () => {
      live = false;
    };
  }, [store]);
  return useMemo(() => {
    if (urls === null) return null;
    const best = bestShareUrl(urls, window.location.origin);
    return { best, others: otherShareUrls(urls, best) };
  }, [urls]);
}

/* ----------------------------------------------------------------- layout */

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', cb);
      return () => m.removeEventListener('change', cb);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches, () => false);
}

/** Laptop-width screens get the big join QR. */
export const WIDE = '(min-width: 900px)';

/** The height of a `.screen-footer` holding one large button, for `useBottomInset`. */
export const FOOTER_INSET = 'calc(5.25rem + var(--safe-bottom))';
/** No bottom bar: toasts sit just above the safe area. */
export const NO_INSET = 'var(--safe-bottom)';

/** Lifts toasts above a bottom bar (tab bar, sticky footer) while mounted. */
export function useBottomInset(value: string): void {
  useEffect(() => {
    const el = document.documentElement;
    el.style.setProperty('--bottom-inset', value);
    return () => {
      el.style.removeProperty('--bottom-inset');
    };
  }, [value]);
}

/** Marks `<body>` with this device's faction so the whole page can use its accent tokens. */
export function useBodyFaction(faction: FactionId | null): void {
  useEffect(() => {
    if (faction === null) return;
    document.body.dataset.faction = faction;
    return () => {
      delete document.body.dataset.faction;
    };
  }, [faction]);
}

/** A string preference remembered per profile. */
export function usePref(name: string, initial: string): [string, (v: string) => void] {
  const [value, setValue] = useState(() => loadPref(name) ?? initial);
  const set = useCallback(
    (v: string) => {
      savePref(name, v);
      setValue(v);
    },
    [name],
  );
  return [value, set];
}
