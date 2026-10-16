/**
 * Persistence for one game inside its Durable Object (`worker/room.ts`): the whole StoredGame as one JSON row in the
 * object's own SQLite database. A Durable Object runs one request at a time and its SQL calls are synchronous, so a
 * save is atomic and `GameHost` keeps its one-command-at-a-time guarantee. One row per save keeps the free plan's
 * written-rows budget at one row per command. A row may hold up to 2 MB; a long game is a few hundred KB.
 */
import type { Persistence, StoredGame } from '../server/games';
import { migrate } from '../server/migrate';

/** The part of Cloudflare's `SqlStorage` this store uses (also met by a `node:sqlite` adapter in the tests). */
export interface Sql {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

export function sqlStore(sql: Sql): Persistence {
  sql.exec('CREATE TABLE IF NOT EXISTS game (id INTEGER PRIMARY KEY CHECK (id = 1), code TEXT NOT NULL, json TEXT NOT NULL)');
  const row = () => sql.exec('SELECT code, json FROM game WHERE id = 1').toArray()[0] as { code: string; json: string } | undefined;
  return {
    loadAll() {
      const r = row();
      return r === undefined ? [] : [migrate(JSON.parse(r.json) as StoredGame)];
    },
    save(s) {
      sql.exec(
        'INSERT INTO game (id, code, json) VALUES (1, ?, ?) ON CONFLICT (id) DO UPDATE SET code = excluded.code, json = excluded.json',
        s.game.code,
        JSON.stringify(s),
      );
    },
    has: (code) => row()?.code === code,
  };
}
