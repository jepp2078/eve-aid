/** A heading whose level follows where the view is placed (the Reference tab or the rules drawer). */
import type { HTMLAttributes } from 'react';

export function H({ level, ...rest }: { level: number } & HTMLAttributes<HTMLHeadingElement>) {
  const Tag = `h${Math.min(6, Math.max(1, level))}` as 'h1';
  return <Tag {...rest} />;
}

/** A heading level for components that take one (ShipCard, DevCard), clamped to h2–h6. */
export function cardLevel(n: number): 2 | 3 | 4 | 5 | 6 {
  return Math.min(6, Math.max(2, n)) as 2 | 3 | 4 | 5 | 6;
}
