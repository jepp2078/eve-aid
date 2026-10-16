/** Which address to show other players (QR, big monospace URL). Phones can't open the laptop's `localhost`. */

export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || h === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(h);
}

function trim(url: string): string {
  return url.replace(/\/+$/, '');
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

/**
 * `urls` come from the host, likeliest phone-reachable first; `origin` is this page's. A page opened through a
 * non-loopback address already proved that address works, so it is shared as is; on the laptop itself the host's
 * first LAN url is shared instead.
 */
export function bestShareUrl(urls: readonly string[], origin: string): string {
  if (!isLoopbackHost(hostnameOf(origin))) return trim(origin);
  return trim(urls[0] ?? origin);
}

/** The host's other addresses, for an "other addresses" disclosure. */
export function otherShareUrls(urls: readonly string[], best: string): string[] {
  return urls.map(trim).filter((u) => u !== trim(best));
}

export function joinUrl(base: string, code: string): string {
  return `${trim(base)}/#/join/${code}`;
}
