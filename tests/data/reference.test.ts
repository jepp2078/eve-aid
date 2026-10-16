import { describe, expect, it } from 'vitest';
import { CUBE_COST, MANUFACTURE, MANUFACTURE_YIELD, SHIP_COST, SLOT_LIMIT, STRUCTURE_COST, TRADE, UNLOCK_BELT_COST } from '../../src/data/costs';
import { BLACK_FACES, WHITE_FACES } from '../../src/data/dice';
import { DEVELOPMENTS } from '../../src/data/developments';
import {
  bodyBlocks,
  buildRows,
  COST_TABLES,
  cubeRows,
  diceFaces,
  GLOSSARY,
  manufactureRows,
  REF_IDS,
  REFERENCE,
  refSection,
  searchReference,
  slotRows,
  TERM_IDS,
  tradeRows,
  type SearchResult,
} from '../../src/data/reference';
import { SHIPS } from '../../src/data/ships';

function inRange(text: string, r: { start: number; end: number }): string {
  return text.slice(r.start, r.end).toLowerCase();
}

describe('reference sections', () => {
  it('every section has a title, a non-empty body and keywords', () => {
    for (const s of REFERENCE) {
      expect(s.title.trim(), s.id).not.toBe('');
      expect(s.body.trim().length, s.id).toBeGreaterThan(80);
      expect(s.keywords.length, s.id).toBeGreaterThan(0);
    }
  });

  it('has unique ids', () => {
    const ids = REFERENCE.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has exactly one section for every RefId and nothing else', () => {
    expect([...REFERENCE.map((s) => s.id)].sort()).toEqual([...REF_IDS].sort());
    for (const id of REF_IDS) expect(refSection(id).id).toBe(id);
  });

  it('fills every data placeholder', () => {
    for (const s of REFERENCE) expect(s.body, s.id).not.toMatch(/[{}]/);
  });

  it('lists the 10 rule interpretations, numbered in order', () => {
    const s = REFERENCE.find((x) => x.title === 'Rule interpretations');
    expect(s).toBeDefined();
    const items = s!.body.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(items.map((l) => Number(l.split('.')[0]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    for (const l of items) expect(l.length, l).toBeGreaterThan(20);
  });

  it('describes all 10 upkeep steps', () => {
    const items = refSection('upkeep').body.split('\n').filter((l) => /^\d+\. /.test(l));
    expect(items.map((l) => Number(l.split('.')[0]))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('notes the cards that act in upkeep and Fleet Supremacy as a VP source', () => {
    const upkeep = refSection('upkeep').body;
    expect(upkeep).toContain('Fleet Supremacy');
    expect(upkeep).toContain('Research Lab');
    expect(refSection('victory').body).toContain('Fleet Supremacy');
  });

  it('says how the app records discovered basic minerals', () => {
    expect(refSection('discovery').body).toMatch(/In the app, pick which basic minerals/);
  });

  it('explains scorekeeper games: what the app tracks, what stays on the board, and how to pick one', () => {
    const s = refSection('light-games');
    expect(s.title).toBe('Scorekeeper games');
    for (const tracked of ['VP', 'central system', 'development area', 'turn', 'combat', 'upkeep', 'rules reference']) expect(s.body, tracked).toContain(tracked);
    const board = s.body.slice(s.body.indexOf('## What stays on the board'));
    for (const kept of ['ISK', 'minerals', 'materials', 'ships', 'structures', 'belts', 'action cubes']) expect(board, kept).toContain(kept);
    expect(s.body).toContain('Game mode');
  });

  it('declares data views only where a table belongs', () => {
    const views = Object.fromEntries(REFERENCE.filter((s) => s.view !== null).map((s) => [s.id, s.view]));
    expect(views).toEqual({ turn: 'cubes', trade: 'trade', manufacture: 'manufacture', build: 'build', dice: 'dice' });
  });
});

describe('bodyBlocks', () => {
  it('splits headings, bullets, numbered items, paragraphs and the view marker', () => {
    expect(bodyBlocks('Intro line.\n## Sub\n- one\n- two\n1. first\n\n@view\nLast.')).toStrictEqual([
      { kind: 'p', text: 'Intro line.' },
      { kind: 'h', text: 'Sub' },
      { kind: 'li', text: 'one' },
      { kind: 'li', text: 'two' },
      { kind: 'ol', n: 1, text: 'first' },
      { kind: 'view' },
      { kind: 'p', text: 'Last.' },
    ]);
  });
});

describe('cost tables come from costs.ts', () => {
  it('trade rows carry the TRADE prices', () => {
    const component = tradeRows().find((r) => r.id === 'component');
    expect(component).toMatchObject({ sell: 6, buy: 7 });
    expect(component).toMatchObject(TRADE.component);
    for (const row of tradeRows()) {
      for (const item of row.items) {
        const key = row.count === 3 ? 'triple' : item;
        expect(TRADE[key as keyof typeof TRADE]).toEqual({ sell: row.sell, buy: row.buy });
      }
    }
  });

  it('merges trade items that share a price and keeps every item', () => {
    const rows = tradeRows();
    expect(rows.map((r) => r.id)).toEqual(['component', 'planetary-moon', 'morphite', 'pyrite-mexallon-tritanium', 'triple']);
    expect(rows.find((r) => r.id === 'triple')).toMatchObject({ count: 3, sell: 5, buy: 8 });
  });

  it('manufacture rows carry the MANUFACTURE recipes and yields', () => {
    const rows = manufactureRows();
    expect(rows.map((r) => r.output)).toEqual(Object.keys(MANUFACTURE));
    const research = rows.find((r) => r.output === 'research')!;
    expect(research.gain).toBe(MANUFACTURE_YIELD.research);
    expect(research.options).toEqual([MANUFACTURE.research.basic, MANUFACTURE.research.morphite]);
  });

  it('build rows carry ship, structure and belt costs', () => {
    const rows = buildRows();
    expect(rows.find((r) => r.id === 'small')).toMatchObject({ group: 'ship', ...SHIP_COST.small, needs: null });
    expect(rows.find((r) => r.id === 'large')).toMatchObject({ group: 'ship', ...SHIP_COST.large, needs: 'large-hull' });
    expect(rows.find((r) => r.id === 'citadel')).toMatchObject({ group: 'structure', ...STRUCTURE_COST.citadel });
    expect(rows.find((r) => r.id === 'belt')).toMatchObject({ group: 'belt', ...UNLOCK_BELT_COST, pay: {} });
  });

  it('cube and slot rows carry CUBE_COST and SLOT_LIMIT', () => {
    expect(cubeRows()).toEqual(CUBE_COST.map((isk, i) => ({ cube: i + 1, isk })));
    expect(Object.fromEntries(slotRows().map((r) => [r.action, r.slots]))).toEqual(SLOT_LIMIT);
  });

  it('dice faces come from dice.ts, one entry per side', () => {
    expect(diceFaces('white')).toEqual(WHITE_FACES);
    expect(diceFaces('black')).toEqual(BLACK_FACES);
  });

  it('cost search text is generated from the rows', () => {
    const trade = COST_TABLES.find((t) => t.id === 'trade')!;
    expect(trade.text).toContain('Component: sell 6 ISK, buy 7 ISK');
  });
});

describe('glossary', () => {
  it('defines every keyword term in a few lines and points at a section', () => {
    for (const id of TERM_IDS) {
      const g = GLOSSARY[id];
      expect(g.label, id).not.toBe('');
      expect(g.text.length, id).toBeGreaterThan(30);
      expect(g.text.length, id).toBeLessThan(220);
      expect(REF_IDS).toContain(g.see);
    }
  });
});

describe('searchReference', () => {
  const has = (results: SearchResult[], kind: SearchResult['kind'], id: string) => results.some((r) => r.kind === kind && r.id === id);

  it('finds the Trade section for "morphite"', () => {
    expect(has(searchReference('morphite'), 'rule', 'trade')).toBe(true);
  });

  it('returns nothing for an empty or one-letter query', () => {
    expect(searchReference('')).toEqual([]);
    expect(searchReference('  ')).toEqual([]);
    expect(searchReference('a')).toEqual([]);
  });

  it('ranks a title match first, case-insensitively', () => {
    expect(searchReference('raids')[0]).toMatchObject({ kind: 'rule', id: 'raids' });
    expect(searchReference('RAIDS')[0]).toMatchObject({ kind: 'rule', id: 'raids' });
    const combat = searchReference('combat');
    expect(combat[0]!.title.toLowerCase().startsWith('combat')).toBe(true);
    // every title match comes before every body-only match
    const titled = combat.map((r) => r.titleMatch !== null);
    expect(titled.indexOf(false)).toBeGreaterThan(titled.lastIndexOf(true));
  });

  it('finds the Scorekeeper games section for "scorekeeper" and "light"', () => {
    expect(searchReference('scorekeeper')[0]).toMatchObject({ kind: 'rule', id: 'light-games', title: 'Scorekeeper games' });
    expect(has(searchReference('light'), 'rule', 'light-games')).toBe(true);
    expect(has(searchReference('light game'), 'rule', 'light-games')).toBe(true);
  });

  it('finds a ship by its ability text', () => {
    const results = searchReference('jump');
    const redeemer = results.find((r) => r.kind === 'ship' && r.id === 'redeemer');
    expect(redeemer).toBeDefined();
    expect(redeemer!.title).toBe('Redeemer');
    expect(inRange(redeemer!.snippet, redeemer!.snippetMatch!)).toBe('jump');
  });

  it('finds a development by name', () => {
    expect(searchReference('lobbyist')[0]).toMatchObject({ kind: 'dev', id: 'lobbyist', title: 'Lobbyist' });
    const hull = searchReference('medium hull');
    expect(hull[0]).toMatchObject({ kind: 'dev', id: 'medium-hull' });
  });

  it('finds cost tables', () => {
    expect(has(searchReference('sell'), 'cost', 'trade')).toBe(true);
    expect(has(searchReference('citadel'), 'cost', 'build')).toBe(true);
  });

  it('matches at the start of words only', () => {
    const lock = searchReference('lock');
    expect(has(lock, 'rule', 'combat')).toBe(true); // "Lock-on"
    for (const r of lock) {
      if (r.snippetMatch !== null) expect(r.snippet.slice(r.snippetMatch.start - 1, r.snippetMatch.start)).not.toMatch(/[a-z0-9]/i);
    }
    expect(has(lock, 'rule', 'build')).toBe(false); // only "unlocks" there
  });

  it('needs every word of a multi-word query', () => {
    const results = searchReference('black dice');
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.kind).not.toBe('dev');
    expect(searchReference('morphite zebra')).toEqual([]);
  });

  it('reports match positions that point at the query', () => {
    for (const q of ['morphite', 'leader', 'raid', 'jump', 'Citadel']) {
      for (const r of searchReference(q)) {
        if (r.titleMatch !== null) expect(inRange(r.title, r.titleMatch)).toBe(q.toLowerCase());
        if (r.snippetMatch !== null) expect(inRange(r.snippet, r.snippetMatch)).toBe(q.toLowerCase());
        expect(r.titleMatch !== null || r.snippetMatch !== null || r.snippet.length > 0).toBe(true);
      }
    }
  });

  it('keeps snippets short', () => {
    for (const r of searchReference('ship')) expect(r.snippet.length).toBeLessThanOrEqual(160);
  });

  it('covers every ship and development', () => {
    for (const s of SHIPS) expect(has(searchReference(s.name), 'ship', s.id), s.name).toBe(true);
    for (const d of DEVELOPMENTS) expect(has(searchReference(d.name), 'dev', d.id), d.name).toBe(true);
  });
});
