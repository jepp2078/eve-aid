/**
 * The to-do list at the table ("Draw 1 Event card, then draw 3 Mission cards", "Move your surviving fleet", "Amarr
 * took one of your systems"): every `todo` notice, kept by the host from the moment its command lands until that
 * command is undone, however long ago it was logged (the log itself keeps only its latest entries). Ticks are not kept
 * here: each device remembers its own (`ui/lib/notices`).
 *
 * A to-do with a `key` replaces older ones with the same key and addressee on the list (only the latest "pass the
 * first player token" matters); the older ones stay stored, so undoing the newer one brings them back.
 */
import type { FactionId } from '../data/types';
import type { LogEntry } from './store';

export interface Todo {
  /** `seq:index` of the notice in its log entry; the setup notice is `setup:index` (Setup ticks it before it is logged). */
  id: string;
  /** The log entry that added it. */
  seq: number;
  to: FactionId | 'all';
  text: string;
  /** A newer to-do with the same key and addressee replaces this one; null for most. */
  key: string | null;
}

/** To-dos kept per game: plenty for a long game night. Past it, replaced ones go first, then the oldest. */
export const TODO_CAP = 300;

/** A to-do's id: `seq:index`, except the setup notice (`setup:index`), which the Setup screen ticks before it is logged. */
export function todoId(e: Pick<LogEntry, 'seq' | 'type'>, index: number): string {
  return e.type === 'setupFaction' ? `setup:${index}` : `${e.seq}:${index}`;
}

/** The to-dos entry `e` adds (none once it is undone). */
export function entryTodos(e: LogEntry): Todo[] {
  if (e.undone) return [];
  return e.notices.flatMap((n, i) =>
    n.kind === 'todo' ? [{ id: todoId(e, i), seq: e.seq, to: n.to, text: n.text, key: n.key ?? null }] : [],
  );
}

/** Whether a later to-do in `todos` replaces the one at `i`. */
function replaced(todos: readonly Todo[], i: number): boolean {
  const t = todos[i]!;
  if (t.key === null) return false;
  for (let j = i + 1; j < todos.length; j++) {
    const u = todos[j]!;
    if (u.key === t.key && u.to === t.to) return true;
  }
  return false;
}

/** Keeps at most `TODO_CAP`: replaced to-dos go first (oldest first), then the oldest. */
function capped(todos: Todo[]): Todo[] {
  let over = todos.length - TODO_CAP;
  if (over <= 0) return todos;
  const drop = new Set<number>();
  for (let i = 0; i < todos.length && drop.size < over; i++) if (replaced(todos, i)) drop.add(i);
  over -= drop.size;
  const kept = todos.filter((_, i) => !drop.has(i));
  return over > 0 ? kept.slice(over) : kept;
}

/** `todos` plus those of `e`, a command that just landed. */
export function addTodos(todos: readonly Todo[], e: LogEntry): Todo[] {
  const fresh = entryTodos(e);
  return fresh.length === 0 ? [...todos] : capped([...todos, ...fresh]);
}

/** `todos` without those of entry `seq` (it was undone). */
export function dropTodos(todos: readonly Todo[], seq: number): Todo[] {
  return todos.filter((t) => t.seq !== seq);
}

/** What the device holding `actor`'s seat lists: its to-dos and everyone's, oldest first, minus replaced ones. */
export function todosFor(todos: readonly Todo[], actor: FactionId | null): Todo[] {
  return todos.filter((t, i) => (t.to === 'all' || t.to === actor) && !replaced(todos, i));
}

/** The to-dos of a whole log, oldest first: the list for a game saved before the host kept one. */
export function todosFromLog(log: readonly LogEntry[]): Todo[] {
  return log.reduce<Todo[]>((todos, e) => addTodos(todos, e), []);
}
