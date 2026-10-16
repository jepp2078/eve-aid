import { describe, expect, it } from 'vitest';
import { REF_IDS } from '../../src/data/reference';
import {
  addSearch,
  addViewed,
  anchorOf,
  entryTitle,
  MAX_RECENT_SEARCHES,
  MAX_RECENT_VIEWED,
  navFor,
  parseRecents,
  parseScale,
  stepScale,
  TEXT_SCALES,
  topicFor,
  topicOf,
  TOPICS,
  type NavState,
  type Recents,
} from '../../src/ui/lib/refNav';

const EMPTY: Recents = { searches: [], viewed: [] };

describe('topics', () => {
  it('puts every rules section in exactly one topic', () => {
    for (const id of REF_IDS) expect(TOPICS.filter((t) => t.sections.includes(id)), id).toHaveLength(1);
    expect(TOPICS.flatMap((t) => t.sections)).toHaveLength(REF_IDS.length);
  });

  it('includes the costs, ships, developments, dice and interpretations chips', () => {
    expect(TOPICS.map((t) => t.id)).toEqual(expect.arrayContaining(['costs', 'ships', 'devs', 'dice', 'interpretations']));
    for (const id of ['costs', 'ships', 'devs'] as const) expect(TOPICS.find((t) => t.id === id)!.sections).toEqual([]);
  });

  it('finds the topic of a section and of a search entry', () => {
    expect(topicOf('raids')).toBe('upkeep');
    expect(topicOf('interpretations')).toBe('interpretations');
    expect(topicFor({ kind: 'rule', id: 'trade' })).toBe('actions');
    expect(topicFor({ kind: 'cost', id: 'trade' })).toBe('costs');
    expect(topicFor({ kind: 'ship', id: 'redeemer' })).toBe('ships');
    expect(topicFor({ kind: 'dev', id: 'lobbyist' })).toBe('devs');
  });

  it('names an anchor per entry', () => {
    expect(anchorOf({ kind: 'rule', id: 'trade' })).toBe('rule:trade');
    expect(anchorOf({ kind: 'ship', id: 'sin' })).toBe('ship:sin');
  });
});

describe('navFor', () => {
  const nav: NavState = { topic: 'actions', faction: 'amarr', size: 'large', sort: 'name', cat: 'all' };

  it('keeps the All developments filter when jumping to a card (e.g. a prerequisite)', () => {
    expect(navFor(nav, { kind: 'dev', id: 'medium-hull' })).toEqual({ ...nav, topic: 'devs', cat: 'all' });
  });

  it('switches another category to the card\'s own', () => {
    expect(navFor({ ...nav, cat: 'combat' }, { kind: 'dev', id: 'medium-hull' })).toMatchObject({ topic: 'devs', cat: 'spaceships' });
  });

  it('shows a ship under its faction with every size', () => {
    expect(navFor(nav, { kind: 'ship', id: 'sin' })).toEqual({ ...nav, topic: 'ships', faction: 'gallente', size: 'all' });
  });

  it('only changes the topic for rules and costs', () => {
    expect(navFor(nav, { kind: 'rule', id: 'raids' })).toEqual({ ...nav, topic: 'upkeep' });
    expect(navFor(nav, { kind: 'cost', id: 'build' })).toEqual({ ...nav, topic: 'costs' });
  });
});

describe('text size', () => {
  it('never goes below the default size and clamps at both ends', () => {
    expect(TEXT_SCALES[0]).toBe(1);
    expect(stepScale(1, -1)).toBe(1);
    expect(stepScale(1, 1)).toBe(TEXT_SCALES[1]);
    const max = TEXT_SCALES[TEXT_SCALES.length - 1]!;
    expect(stepScale(max, 1)).toBe(max);
  });

  it('parses a stored value, falling back to the default', () => {
    expect(parseScale(null)).toBe(1);
    expect(parseScale('nonsense')).toBe(1);
    expect(parseScale('1.25')).toBe(1.25);
    expect(parseScale('0.5')).toBe(1);
    expect(parseScale('9')).toBe(1);
  });
});

describe('recents', () => {
  it('keeps the latest searches first, without duplicates, capped', () => {
    let r = EMPTY;
    for (const q of ['trade', 'raid', ' Trade ', 'a', 'b1', 'c2', 'd3', 'e4']) r = addSearch(r, q);
    expect(r.searches[0]).toBe('e4');
    expect(r.searches).toHaveLength(MAX_RECENT_SEARCHES);
    expect(r.searches.filter((q) => q.toLowerCase() === 'trade')).toHaveLength(1);
    expect(r.searches).not.toContain('a'); // too short to search
  });

  it('keeps the latest viewed entries first, without duplicates, capped', () => {
    let r = EMPTY;
    r = addViewed(r, { kind: 'rule', id: 'trade' });
    r = addViewed(r, { kind: 'ship', id: 'sin' });
    r = addViewed(r, { kind: 'rule', id: 'trade' });
    expect(r.viewed).toEqual([
      { kind: 'rule', id: 'trade' },
      { kind: 'ship', id: 'sin' },
    ]);
    for (let i = 0; i < 10; i++) r = addViewed(r, { kind: 'rule', id: REF_IDS[i]! });
    expect(r.viewed).toHaveLength(MAX_RECENT_VIEWED);
  });

  it('parses stored recents and drops anything unknown', () => {
    expect(parseRecents(null)).toEqual(EMPTY);
    expect(parseRecents('{oops')).toEqual(EMPTY);
    expect(
      parseRecents(
        JSON.stringify({
          searches: ['raid', 3],
          viewed: [{ kind: 'ship', id: 'sin' }, { kind: 'ship', id: 'no-such-ship' }, { kind: 'bogus', id: 'x' }],
        }),
      ),
    ).toEqual({ searches: ['raid'], viewed: [{ kind: 'ship', id: 'sin' }] });
  });

  it('titles an entry from the data', () => {
    expect(entryTitle({ kind: 'rule', id: 'raids' })).toBe('Raids');
    expect(entryTitle({ kind: 'cost', id: 'trade' })).toBe('Trade prices');
    expect(entryTitle({ kind: 'ship', id: 'sin' })).toBe('Sin');
    expect(entryTitle({ kind: 'dev', id: 'lobbyist' })).toBe('Lobbyist');
    expect(entryTitle({ kind: 'dev', id: 'nope' })).toBeNull();
  });
});
