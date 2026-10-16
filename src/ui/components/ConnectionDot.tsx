import { HOST } from '../../sync/hosting';

/** Header dot: solid when the live connection to the host is up, hollow while reconnecting (named either way). */
export function ConnectionDot({ online }: { online: boolean }) {
  const label = online ? `Live: connected to ${HOST}` : `Reconnecting to ${HOST}…`;
  return <span className={online ? 'conn-dot is-online' : 'conn-dot is-offline'} role="img" aria-label={label} title={label} />;
}
