/** QR codes as one SVG path (uqr does the encoding). */
import { encode } from 'uqr';

/** Dark (true) and light modules, without a quiet zone. */
export function qrMatrix(text: string): boolean[][] {
  return encode(text, { ecc: 'M', border: 0 }).data;
}

/** One `h`/`v` rectangle per horizontal run of dark modules, in module units. */
export function qrPath(m: readonly (readonly boolean[])[]): string {
  const parts: string[] = [];
  m.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x++;
      const w = x - start;
      parts.push(`M${start} ${y}h${w}v1h-${w}z`);
    }
  });
  return parts.join(' ');
}
