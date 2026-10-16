import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createGame, emptyPrivate } from '../../src/engine/create';
import type { StoredGame } from '../../server/games';
import { fileStore, memoryStore } from '../../server/persist';
import { NOW } from '../engine/helpers';

/** While `cap` is set, every write takes at most that many bytes and says so, as a disk may (a short write). */
const disk = vi.hoisted(() => ({ cap: null as number | null }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  function writeSync(fd: number, data: string | NodeJS.ArrayBufferView, ...rest: unknown[]): number {
    if (disk.cap === null) return (fs.writeSync as (fd: number, data: unknown, ...rest: unknown[]) => number)(fd, data, ...rest);
    const bytes = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    const offset = typeof data === 'string' ? 0 : ((rest[0] as number | undefined) ?? 0);
    const length = typeof data === 'string' ? bytes.length : ((rest[1] as number | undefined) ?? bytes.length - offset);
    return fs.writeSync(fd, bytes, offset, Math.min(length, disk.cap));
  }
  return { ...fs, writeSync };
});

function stored(code: string): StoredGame {
  const game = createGame(code, 'device-a', 'Ana', 'amarr', NOW);
  game.logSeq = 1;
  game.history = [{ seq: 1, actor: 'amarr', touchedPrivate: false }];
  return {
    game,
    privs: { amarr: { ...emptyPrivate(), pendingResearch: 2, history: [{ seq: 1, area: [], pendingResearch: 0, pendingCards: 0 }] } },
    log: [{ seq: 1, at: NOW, actor: 'amarr', type: 'eventPlayed', round: 0, lines: ['Amarr played an Event card'],
      notices: [{ to: 'all', text: 'hi', kind: 'todo' }], touchedPrivate: false, undone: false }],
    undo: [{ seq: 1, before: createGame(code, 'device-a', 'Ana', 'amarr', NOW) }],
    todos: [{ id: '1:0', seq: 1, to: 'all', text: 'hi', key: null }],
  };
}

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'eve-persist-'));
  dirs.push(d);
  return d;
}
afterEach(() => {
  disk.cap = null;
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('fileStore', () => {
  it('round-trips games through one JSON file each and leaves no temp file behind', () => {
    const dir = join(tempDir(), 'nested', 'data'); // created on demand (mkdir -p)
    const store = fileStore(dir);
    expect(store.loadAll()).toStrictEqual([]);
    const a = stored('ABC234');
    const b = stored('XYZ789');
    store.save(a);
    store.save(b);
    expect(readdirSync(dir).sort()).toStrictEqual(['ABC234.json', 'XYZ789.json']);
    const loaded = fileStore(dir).loadAll().sort((x, y) => x.game.code.localeCompare(y.game.code));
    expect(loaded).toStrictEqual([a, b]);
  });

  it('overwrites a game on the next save, keeping the previous version as <code>.json.bak', () => {
    const dir = tempDir();
    const store = fileStore(dir);
    const a = stored('ABC234');
    store.save(a);
    const changed = { ...a, game: { ...a.game, round: 3 } };
    store.save(changed);
    expect(fileStore(dir).loadAll()).toStrictEqual([changed]);
    expect(readdirSync(dir).sort()).toStrictEqual(['ABC234.json', 'ABC234.json.bak']);
    expect(JSON.parse(readFileSync(join(dir, 'ABC234.json.bak'), 'utf8'))).toStrictEqual(a);
  });

  it('falls back to the backup when the main file is torn (a power cut mid-write) or missing (M8)', () => {
    const dir = tempDir();
    const store = fileStore(dir);
    const a = stored('ABC234');
    store.save(a);
    store.save({ ...a, game: { ...a.game, round: 3 } });
    const torn = readFileSync(join(dir, 'ABC234.json'), 'utf8').slice(0, 200);
    writeFileSync(join(dir, 'ABC234.json'), torn);
    const warnings: string[] = [];
    expect(fileStore(dir, { warn: (m) => warnings.push(m) }).loadAll()).toStrictEqual([a]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('ABC234.json');
    expect(warnings[0]).toContain('backup');

    rmSync(join(dir, 'ABC234.json'));
    expect(fileStore(dir, { warn: () => {} }).loadAll()).toStrictEqual([a]);
  });

  it('writes the whole game when the disk takes it a few bytes at a time (short writes)', () => {
    const dir = tempDir();
    const a = stored('ABC234');
    disk.cap = 7;
    fileStore(dir).save(a);
    disk.cap = null;
    expect(fileStore(dir).loadAll()).toStrictEqual([a]);
  });

  it('never moves a torn main file over a good backup: after a load from the backup, the next save keeps it', () => {
    const dir = tempDir();
    const a = stored('ABC234');
    fileStore(dir).save(a);
    fileStore(dir).save({ ...a, game: { ...a.game, round: 3 } });
    writeFileSync(join(dir, 'ABC234.json'), '{"game": '); // torn
    const store = fileStore(dir, { warn: () => {} });
    expect(store.loadAll()).toStrictEqual([a]); // from the backup
    const next = { ...a, game: { ...a.game, round: 4 } };
    store.save(next);
    expect(JSON.parse(readFileSync(join(dir, 'ABC234.json.bak'), 'utf8'))).toStrictEqual(a);
    expect(fileStore(dir).loadAll()).toStrictEqual([next]);

    // Without a backup, the torn file is simply replaced.
    writeFileSync(join(dir, 'XYZ789.json'), '{"game": ');
    store.save(stored('XYZ789'));
    expect(readdirSync(dir).filter((n) => n.startsWith('XYZ789')).sort()).toStrictEqual(['XYZ789.json']);
  });

  it('skips a game whose file and backup are both unreadable, but never gives its code to a new game', () => {
    const dir = tempDir();
    writeFileSync(join(dir, 'ABC234.json'), '{"game": ');
    writeFileSync(join(dir, 'ABC234.json.bak'), '');
    writeFileSync(join(dir, 'BAK234.json.bak'), '{');
    const warnings: string[] = [];
    const store = fileStore(dir, { warn: (m) => warnings.push(m) });
    expect(store.loadAll()).toStrictEqual([]);
    expect(warnings).toHaveLength(2);
    expect(store.has('ABC234')).toBe(true);
    expect(store.has('BAK234')).toBe(true);
    expect(store.has('XYZ789')).toBe(false);
    store.save(stored('XYZ789'));
    expect(store.has('XYZ789')).toBe(true);
  });

  it('skips files that are not readable games and says so', () => {
    const dir = tempDir();
    fileStore(dir).save(stored('ABC234'));
    writeFileSync(join(dir, 'BROKEN.json'), '{"game": ');
    writeFileSync(join(dir, 'notes.txt'), 'hello');
    writeFileSync(join(dir, 'ABC234.json.123.tmp'), '{}');
    const warnings: string[] = [];
    const loaded = fileStore(dir, { warn: (m) => warnings.push(m) }).loadAll();
    expect(loaded.map((s) => s.game.code)).toStrictEqual(['ABC234']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('BROKEN.json');
  });

  it('refuses a code that is not a plain room code', () => {
    const store = fileStore(tempDir());
    expect(() => store.save(stored('../evil'))).toThrow();
  });
});

describe('memoryStore', () => {
  it('round-trips games and hands out copies', () => {
    const store = memoryStore();
    const a = stored('ABC234');
    expect(store.has('ABC234')).toBe(false);
    store.save(a);
    expect(store.has('ABC234')).toBe(true);
    const [loaded] = store.loadAll();
    expect(loaded).toStrictEqual(a);
    expect(loaded).not.toBe(a);
    loaded!.game.round = 9;
    expect(store.loadAll()[0]!.game.round).toBe(0);
  });
});
