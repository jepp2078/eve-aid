/** Which counters changed between two snapshots (for the Panel's +4 / −5 delta chips). */
export function valueDeltas(prev: Readonly<Record<string, number>>, next: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(next)) {
    const before = prev[k];
    if (before !== undefined && before !== v) out[k] = v - before;
  }
  return out;
}
