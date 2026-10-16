/** A QR code as inline SVG: dark modules on a light tile with a 4-module quiet zone (scanners need both). */
import { useMemo } from 'react';
import { qrMatrix, qrPath } from '../lib/qr';

export function QrCode({ value, label, quiet = 4, className }: { value: string; label: string; quiet?: number; className?: string }) {
  const { d, n } = useMemo(() => {
    const m = qrMatrix(value);
    return { d: qrPath(m), n: m.length };
  }, [value]);
  const total = n + quiet * 2;
  return (
    <svg
      viewBox={`0 0 ${total} ${total}`}
      className={className === undefined ? 'qr' : `qr ${className}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
      focusable="false"
    >
      <rect className="qr-light" width={total} height={total} />
      <path className="qr-dark" d={d} transform={`translate(${quiet} ${quiet})`} />
    </svg>
  );
}
