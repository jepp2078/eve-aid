/**
 * The in-game top block (sticky): a 56 px header with this seat's faction stripe, glyph and name, the connection
 * dot and the overflow menu (Keep screen on, Invite, Open big-screen table, Leave); the "changes paused" banner after
 * 2 s offline; then whatever the screen adds below (the turn strip, step progress). Its height is published as
 * `--app-top-h`.
 */
import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { FactionId } from '../../data/types';
import { ConnectionDot } from '../components/ConnectionDot';
import { Menu, type MenuItem } from '../components/Menu';
import { navigate, useConnection, useKeepAwake, useSession } from '../hooks';
import { FactionGlyph, Icon } from '../icons';
import { InviteSheet } from './Invite';
import { HOST } from '../../sync/hosting';

export interface GameHeaderProps {
  code: string;
  faction: FactionId | null;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Rendered under the header and banner, inside the sticky block. */
  children?: ReactNode;
}

/** The banner itself (also shown in the gallery). */
export function PausedBanner() {
  return (
    <div className="offline-banner" role="status">
      <Icon name="offline" size="1.25rem" />
      <span>Can't reach {HOST} — changes paused</span>
    </div>
  );
}

/** Shown after 2 s without a live connection; command buttons are disabled meanwhile (`useCommand().disabled`). */
export function OfflineBanner() {
  const { paused } = useConnection();
  return paused ? <PausedBanner /> : null;
}

/** Publishes the sticky top block's height as --app-top-h, so sticky bars further down the page sit right under it. */
export function useAppTopHeight(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--app-top-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty('--app-top-h');
    };
  }, [ref]);
}

export function GameHeader({ code, faction, title, subtitle, children }: GameHeaderProps) {
  const { online } = useConnection();
  const keep = useKeepAwake();
  const { setSession } = useSession();
  const [invite, setInvite] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  useAppTopHeight(topRef);

  const items: MenuItem[] = [
    keep.supported
      ? { id: 'awake', label: 'Keep screen on', icon: 'sun', checked: keep.enabled, onSelect: () => keep.setEnabled(!keep.enabled) }
      : { id: 'awake', label: 'Keep screen on', icon: 'sun', disabled: true, note: "Not available here. Your phone may sleep; it rejoins automatically.", onSelect: () => {} },
    { id: 'invite', label: 'Invite players (QR)', icon: 'qr', onSelect: () => setInvite(true) },
    {
      id: 'big',
      label: 'Open big-screen table',
      icon: 'table',
      note: 'For a laptop or TV everyone can see',
      onSelect: () => navigate({ name: 'table', big: true, code }),
    },
    {
      id: 'leave',
      label: 'Leave game',
      icon: 'leave',
      note: 'Your seat stays; rejoin with the code',
      onSelect: () => {
        setSession(null);
        navigate({ name: 'home' });
      },
    },
  ];

  return (
    <div className="app-top" ref={topRef}>
      <header className="app-header" data-faction={faction ?? undefined}>
        {faction !== null && <FactionGlyph faction={faction} size="1.5rem" />}
        <div className="app-header-text">
          <span className="app-header-title truncate">{title}</span>
          {subtitle !== undefined && <span className="app-header-sub truncate">{subtitle}</span>}
        </div>
        <ConnectionDot online={online} />
        <Menu items={items} label="Game menu" />
      </header>
      <OfflineBanner />
      {children}
      <InviteSheet open={invite} onClose={() => setInvite(false)} code={code} />
    </div>
  );
}
