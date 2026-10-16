/** The player asked for less motion: skip smooth scrolls, sweeps and slides. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
