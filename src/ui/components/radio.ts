/** Arrow-key movement for custom radio groups (tiles, chips): one tab stop, arrows select and move focus. */
import type { KeyboardEvent } from 'react';

export function radioKeys<T extends string>(values: readonly T[], value: T | null, onChange: (v: T) => void, enabled: (v: T) => boolean = () => true) {
  return (e: KeyboardEvent<HTMLElement>) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (dir === 0) return;
    const usable = values.filter(enabled);
    if (usable.length === 0) return;
    e.preventDefault();
    const at = value === null ? -1 : usable.indexOf(value);
    const next = usable[(at + dir + usable.length) % usable.length]!;
    onChange(next);
    e.currentTarget.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
  };
}

/** The roving tab stop: the selected item, or the first usable one when nothing is selected. */
export function tabStop<T extends string>(values: readonly T[], value: T | null, v: T, enabled: (v: T) => boolean = () => true): 0 | -1 {
  const stop = value !== null && values.includes(value) ? value : values.find(enabled);
  return v === stop ? 0 : -1;
}
