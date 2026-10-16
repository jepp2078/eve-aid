import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { Persistence, StoredGame } from './games';
import { migrate } from './migrate';

/** Room codes are the only file names; anything else would let a code walk out of the data directory. */
const CODE_FILE = /^([A-Z0-9]{1,16})\.json$/;
/** A game's file or its backup. */
const SAVED_FILE = /^([A-Z0-9]{1,16})\.json(?:\.bak)?$/;

function looksStored(x: unknown): x is StoredGame {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Partial<StoredGame>;
  return (
    typeof s.game === 'object' && s.game !== null && typeof s.game.code === 'string' &&
    typeof s.privs === 'object' && s.privs !== null && Array.isArray(s.log) && Array.isArray(s.undo)
  );
}

/** A game file read as far as its shape, before any migration; throws on a missing, torn or foreign file. */
function readGame(file: string, code: string): StoredGame {
  const s: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!looksStored(s) || s.game.code !== code) throw new Error('not a saved game');
  return s;
}

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Whether `file` reads as `code`'s game (`readGame`). */
function readable(file: string, code: string): boolean {
  try {
    readGame(file, code);
    return true;
  } catch {
    return false;
  }
}

/** Writes `text` to `file` and flushes it to the disk before returning. A write may take only part of it: the rest follows. */
function writeDurably(file: string, text: string): void {
  const bytes = Buffer.from(text, 'utf8');
  const fd = openSync(file, 'w');
  try {
    for (let done = 0; done < bytes.length; ) {
      const n = writeSync(fd, bytes, done, bytes.length - done);
      if (n <= 0) throw new Error(`Could not write ${file}: the disk took nothing`);
      done += n;
    }
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/** Flushes a directory's entries (the renames in it); not every platform can, which only costs durability. */
function syncDir(dir: string): void {
  try {
    const fd = openSync(dir, 'r');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  } catch {
    // e.g. Windows can't open a directory for fsync
  }
}

/**
 * One `<code>.json` per game in `dir` (created on demand), plus `<code>.json.bak`, its previous version. Each save
 * writes a temp file and flushes it to the disk, moves the current file to the backup, then renames the temp file into
 * place, so a crash or a power cut never leaves only a half-written game. A game whose file can't be read (torn,
 * missing) loads from its backup instead, with a warning; one whose backup can't be read either is skipped with a
 * warning, and its code is never given to a new game (`has`). A current file that can't be read is never moved over
 * the backup: the next save just replaces it.
 */
export function fileStore(dir: string, opts: { warn?: (message: string) => void } = {}): Persistence {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  return {
    loadAll() {
      mkdirSync(dir, { recursive: true });
      const games: StoredGame[] = [];
      const codes = new Set<string>();
      for (const name of readdirSync(dir)) {
        const m = SAVED_FILE.exec(name);
        if (m) codes.add(m[1]!);
      }
      for (const code of [...codes].sort()) {
        const file = join(dir, `${code}.json`);
        const backup = `${file}.bak`;
        let raw: StoredGame;
        try {
          raw = readGame(file, code);
        } catch (e) {
          try {
            raw = readGame(backup, code);
            warn(`Could not read ${file} (${reason(e)}); loaded its backup, ${backup}`);
          } catch (b) {
            warn(`Skipping ${file}: ${reason(e)}; its backup: ${reason(b)}`);
            continue;
          }
        }
        try {
          games.push(migrate(raw));
        } catch (e) {
          warn(`Skipping ${file}: ${reason(e)}`); // never fall back to an older backup over a newer save
        }
      }
      return games;
    },
    save(s) {
      const name = `${s.game.code}.json`;
      if (!CODE_FILE.test(name)) throw new Error(`Refusing to save a game with code ${JSON.stringify(s.game.code)}`);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, name);
      const tmp = `${file}.${process.pid}.tmp`;
      writeDurably(tmp, JSON.stringify(s));
      if (readable(file, s.game.code)) renameSync(file, `${file}.bak`);
      renameSync(tmp, file);
      syncDir(dir);
    },
    has(code) {
      return CODE_FILE.test(`${code}.json`) && (existsSync(join(dir, `${code}.json`)) || existsSync(join(dir, `${code}.json.bak`)));
    },
  };
}

/** Keeps games as JSON strings in memory (same round-trip as files): tests and throwaway hosts. */
export function memoryStore(): Persistence {
  const games = new Map<string, string>();
  return {
    loadAll: () => [...games.values()].map((json) => migrate(JSON.parse(json) as StoredGame)),
    save(s) {
      games.set(s.game.code, JSON.stringify(s));
    },
    has: (code) => games.has(code),
  };
}
