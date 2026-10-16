/**
 * Getting other phones in: the join QR (`<best LAN url>/#/join/<CODE>`), the same URL in large monospace and the
 * code. The laptop shows it as a big panel in the lobby; phones open it full-screen from the header menu. No
 * copy/share buttons: phones on the plain-http LAN have no clipboard or share API.
 */
import type { ReactNode } from 'react';
import { BottomSheet } from '../components/BottomSheet';
import { QrCode } from '../components/QrCode';
import { HOSTED } from '../../sync/hosting';
import { useShareInfo } from '../hooks';
import { formatCode } from '../lib/code';
import { joinUrl } from '../lib/share';

function OtherAddresses({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null;
  return (
    <details className="other-urls">
      <summary>Other addresses of this laptop</summary>
      <ul>
        {urls.map((u) => (
          <li key={u} className="mono">
            {u}
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * QR + URL + code. `layout="beacon"` is the laptop's large lobby panel; `corner` the big-screen table's compact,
 * read-only corner: the QR with the code beside it and the URL underneath (no "other addresses" disclosure, since
 * that screen has no controls). `tag` (the "Scorekeeper game" tag) sits next to the code: on the "Game code" line, where it
 * adds no height to the laptop panel, which is sized to fit between the header and the footer; in the corner, under it.
 */
export function JoinCode({ code, layout, tag }: { code: string; layout: 'beacon' | 'sheet' | 'corner'; tag?: ReactNode }) {
  const info = useShareInfo();
  if (info === null) return <p className="muted">{HOSTED ? 'Finding the address…' : "Finding this laptop's address…"}</p>;
  const url = joinUrl(info.best, code);
  if (layout === 'corner') {
    return (
      <div className="join-code join-code-corner">
        <QrCode value={url} label={`QR code to join game ${formatCode(code)}`} className="join-qr" />
        <div className="join-code-text">
          <p className="join-label">Join with the phone camera, or the code</p>
          <p className="join-code-value mono">{formatCode(code)}</p>
          {tag}
        </div>
        <p className="join-url mono">
          {info.best}
          <wbr />
          /#/join/{code}
        </p>
      </div>
    );
  }
  return (
    <div className={`join-code join-code-${layout}`}>
      <QrCode value={url} label={`QR code to join game ${formatCode(code)}`} className="join-qr" />
      <div className="join-code-text">
        <p className="join-label">Scan with the phone camera, or open</p>
        <p className="join-url mono">
          {info.best}
          <wbr />
          /#/join/{code}
        </p>
        <p className={tag ? 'join-label row' : 'join-label'}>
          Game code
          {tag}
        </p>
        <p className="join-code-value mono">{formatCode(code)}</p>
        <OtherAddresses urls={info.others} />
      </div>
    </div>
  );
}

export function InviteSheet({ open, onClose, code }: { open: boolean; onClose: () => void; code: string }) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Invite players" size="full">
      <JoinCode code={code} layout="sheet" />
    </BottomSheet>
  );
}

/** Home on the laptop: where phones open the site (no game yet, so no code). */
export function SiteBeacon() {
  const info = useShareInfo();
  if (info === null) return null;
  return (
    <div className="site-beacon card">
      <QrCode value={`${info.best}/`} label="QR code to open this site on a phone" className="site-qr" />
      <div className="stack-sm">
        <p className="join-label">{HOSTED ? 'Players scan or open' : 'Players on this Wi-Fi scan or open'}</p>
        <p className="join-url mono">{info.best}</p>
        <OtherAddresses urls={info.others} />
      </div>
    </div>
  );
}
