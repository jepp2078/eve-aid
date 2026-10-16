/**
 * The Panel's to-do checklist ("Draw an Event or Mission card", "Amarr took one of your systems"): the host keeps each
 * seat's to-dos until their command is undone, however old (`sync/todos`), and this device remembers which ones it
 * ticked. `info` notices (a combat stage prompt, the upkeep starting, the verge) never land there — they are toasted
 * once when they arrive (`arrivedNotices`) and stay in the log. A to-do is identified by its log entry and position
 * (`seq:index`); the setup notice has the fixed id `setup:<index>`, so the Setup screen can tick it before its log
 * entry exists. Ticks are remembered per game on this device profile (saved with `savePref(noticesPref(code), …)`),
 * pruned to the to-dos still listed.
 */
import type { NoticeKind } from '../../engine/types';
import { todoId, type Todo } from '../../sync/todos';

export interface PanelNotice {
  id: string;
  text: string;
  /** Addressed to everyone rather than to me alone. */
  toAll: boolean;
  kind: NoticeKind;
}

export function noticeId(seq: number, index: number): string {
  return `${seq}:${index}`;
}

/** The setup notice's id (the Setup screen's checklist and the Panel share it). */
export const SETUP_NOTICE_ID = todoId({ seq: 0, type: 'setupFaction' }, 0);

/** `ticks` with `id` ticked or unticked (a new set). */
export function withTick(ticks: ReadonlySet<string>, id: string, on: boolean): Set<string> {
  const next = new Set(ticks);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

/** The per-profile preference holding a game's ticked notice ids. */
export function noticesPref(code: string): string {
  return `notices:${code}`;
}

/** My to-dos (as the host sends them: mine and everyone's, oldest first) as checklist cards. */
export function panelTodos(todos: readonly Todo[]): PanelNotice[] {
  return todos.map((t) => ({ id: t.id, text: t.text, toAll: t.to === 'all', kind: 'todo' }));
}

export function parseTicks(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Ticks of to-dos still listed (`visible`), so the stored list never outgrows the to-do list. */
export function serializeTicks(ticks: ReadonlySet<string>, visible: readonly string[]): string {
  return JSON.stringify(visible.filter((id) => ticks.has(id)));
}
