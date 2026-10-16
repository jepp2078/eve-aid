import { describe, expect, it } from 'vitest';
import type { Notice } from '../../src/engine/types';
import type { LogEntry } from '../../src/sync/store';
import { addTodos, dropTodos, entryTodos, TODO_CAP, todoId, todosFor, todosFromLog, type Todo } from '../../src/sync/todos';

function entry(seq: number, notices: Notice[], opts: { undone?: boolean; type?: LogEntry['type'] } = {}): LogEntry {
  return { seq, at: 0, actor: 'amarr', type: opts.type ?? 'discover', round: 1, lines: [], notices, touchedPrivate: false, undone: opts.undone ?? false };
}
const todo = (to: Notice['to'], text: string, key?: string): Notice => (key === undefined ? { to, text, kind: 'todo' } : { to, text, kind: 'todo', key });
const info = (to: Notice['to'], text: string): Notice => ({ to, text, kind: 'info' });
const token = (round: number, to: string): Notice => todo('all', `Round ${round}: pass the first player token to ${to}`, 'firstPlayer');

describe('entryTodos', () => {
  it('takes the to-dos of an entry (never its news), each with the id of its place in the entry', () => {
    const e = entry(6, [info('all', 'Upkeep: confirm your upkeep on your device'), todo('caldari', 'Draw 1 Event card (reparations)'), token(2, 'Caldari')]);
    expect(entryTodos(e)).toStrictEqual([
      { id: '6:1', seq: 6, to: 'caldari', text: 'Draw 1 Event card (reparations)', key: null },
      { id: '6:2', seq: 6, to: 'all', text: 'Round 2: pass the first player token to Caldari', key: 'firstPlayer' },
    ]);
    expect(entryTodos({ ...e, undone: true })).toStrictEqual([]);
  });

  it('gives the setup notice the fixed id the Setup screen ticks before it is logged', () => {
    const e = entry(3, [todo('amarr', 'Draw 1 Event card, then draw 3 Mission cards and keep 1')], { type: 'setupFaction' });
    expect(entryTodos(e)[0]!.id).toBe('setup:0');
    expect(todoId(e, 0)).toBe('setup:0');
    expect(todoId({ seq: 9, type: 'discover' }, 2)).toBe('9:2');
  });
});

describe('the to-do list', () => {
  it('keeps every to-do until its entry is undone, however many entries come after it', () => {
    let todos: Todo[] = [];
    todos = addTodos(todos, entry(2, [todo('amarr', 'Draw 1 Event card, then draw 3 Mission cards and keep 1')], { type: 'setupFaction' }));
    for (let seq = 3; seq < 500; seq++) todos = addTodos(todos, entry(seq, [info('all', 'news')]));
    todos = addTodos(todos, entry(500, [todo('amarr', 'Move your surviving fleet')]));
    expect(todosFor(todos, 'amarr').map((t) => t.id)).toStrictEqual(['setup:0', '500:0']);
    expect(todosFor(dropTodos(todos, 500), 'amarr').map((t) => t.id)).toStrictEqual(['setup:0']);
  });

  it("lists a seat's own to-dos and everyone's, never another seat's; a device without a seat sees everyone's only", () => {
    const todos = todosFromLog([entry(4, [todo('amarr', 'A'), todo('caldari', 'C'), todo('all', 'everyone')])]);
    expect(todosFor(todos, 'amarr').map((t) => t.text)).toStrictEqual(['A', 'everyone']);
    expect(todosFor(todos, 'caldari').map((t) => t.text)).toStrictEqual(['C', 'everyone']);
    expect(todosFor(todos, null).map((t) => t.text)).toStrictEqual(['everyone']);
  });

  it('a newer "pass the first player token" replaces the older one, which comes back if the newer is undone (K1)', () => {
    let todos = addTodos([], entry(10, [token(2, 'Caldari'), todo('amarr', 'Raid on Caldari: move your raiding fleet', undefined)]));
    todos = addTodos(todos, entry(20, [token(3, 'Gallente')]));
    todos = addTodos(todos, entry(30, [token(4, 'Amarr')]));
    expect(todosFor(todos, 'amarr').map((t) => t.text)).toStrictEqual([
      'Raid on Caldari: move your raiding fleet',
      'Round 4: pass the first player token to Amarr',
    ]);
    expect(todosFor(dropTodos(todos, 30), 'amarr').map((t) => t.text)).toStrictEqual([
      'Raid on Caldari: move your raiding fleet',
      'Round 3: pass the first player token to Gallente',
    ]);
  });

  it(`stays within ${TODO_CAP}: replaced to-dos go first, then the oldest`, () => {
    let todos: Todo[] = [];
    for (let seq = 1; seq <= 10; seq++) todos = addTodos(todos, entry(seq, [token(seq, 'Amarr')]));
    for (let seq = 11; seq <= TODO_CAP + 9; seq++) todos = addTodos(todos, entry(seq, [todo('amarr', `t${seq}`)]));
    // 9 over: the 9 replaced token to-dos made room, the latest one stays
    expect(todos).toHaveLength(TODO_CAP);
    expect(todos.filter((t) => t.key !== null).map((t) => t.seq)).toStrictEqual([10]);
    expect(todosFor(todos, 'amarr')[0]!.text).toBe('Round 10: pass the first player token to Amarr');
    // nothing replaced is left: the oldest goes
    todos = addTodos(todos, entry(TODO_CAP + 10, [todo('amarr', 'one more')]));
    expect(todos).toHaveLength(TODO_CAP);
    expect(todos[0]!.text).toBe('t11');
    expect(todos.at(-1)!.text).toBe('one more');
  });

  it('builds the list of a whole log, skipping undone entries', () => {
    const log = [
      entry(1, [todo('amarr', 'kept')]),
      entry(2, [todo('amarr', 'undone')], { undone: true }),
      entry(3, [info('amarr', 'news')]),
    ];
    expect(todosFromLog(log)).toStrictEqual([{ id: '1:0', seq: 1, to: 'amarr', text: 'kept', key: null }]);
  });
});
