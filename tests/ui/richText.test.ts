import { describe, expect, it } from 'vitest';
import { DEVELOPMENTS } from '../../src/data/developments';
import { TERM_IDS, type TermId } from '../../src/data/reference';
import { SHIPS } from '../../src/data/ships';
import { parseCardText } from '../../src/ui/lib/cardText';
import { markParts, richParagraphs, richText, shipTokens, TERM_PATTERNS, type Rich } from '../../src/ui/lib/richText';

const terms = (segs: Rich[]): string[] => segs.filter((s) => s.kind === 'term').map((s) => (s as { term: TermId }).term);
const plain = (segs: Rich[]): string => segs.map((s) => (s.kind === 'token' ? `[${s.token}]` : s.text)).join('');

describe('richText', () => {
  it('turns keyword terms into term segments and keeps the text intact', () => {
    const line = 'The leader adds its ATK; supports add SUP to the orbit.';
    const segs = richText(line);
    expect(plain(segs)).toBe(line);
    expect(terms(segs)).toEqual(['leader', 'atk', 'support', 'sup', 'orbit']);
  });

  it('chips only the first occurrence of a term, across lines sharing `seen`', () => {
    const seen = new Set<TermId>();
    expect(terms(richText('Retreat: a retreating side gets +1 DIF.', { seen }))).toEqual(['retreat', 'dif']);
    expect(terms(richText('After a retreat the DIF bonus ends.', { seen }))).toEqual([]);
  });

  it('matches the stat abbreviations only in capitals', () => {
    expect(terms(richText('Morphite cards are red.'))).toEqual([]);
    expect(terms(richText('+1 RED and +1 HP'))).toEqual(['red', 'hp']);
  });

  it('knows lock-on, aim, crit and strength in their usual forms', () => {
    expect(terms(richText('Lock-on needs aims.'))).toEqual(['lock']);
    expect(terms(richText('a critical damage result'))).toEqual(['crit']);
    expect(terms(richText('Fleet strength 3'))).toEqual(['strength']);
    expect(terms(richText('reparations for losses'))).toEqual(['reparations']);
  });

  it('can leave terms plain', () => {
    expect(terms(richText('The leader rolls ATK.', { terms: false }))).toEqual([]);
  });

  it('marks search words at word starts, case-insensitively', () => {
    const segs = richText('Raids happen in upkeep; a raid steals VP.', { terms: false, mark: 'raid' });
    expect(segs.filter((s) => s.kind === 'text' && s.mark).map((s) => (s as { text: string }).text)).toEqual(['Raid', 'raid']);
    expect(plain(segs)).toBe('Raids happen in upkeep; a raid steals VP.');
  });

  it('marks a whole term chip that contains a search word', () => {
    const segs = richText('The leader attacks.', { mark: 'lead' });
    expect(segs.find((s) => s.kind === 'term')).toMatchObject({ term: 'leader', mark: true });
  });

  it('has a pattern for every glossary term', () => {
    expect(Object.keys(TERM_PATTERNS).sort()).toEqual([...TERM_IDS].sort());
  });
});

describe('markParts', () => {
  it('splits text into marked and unmarked parts', () => {
    expect(markParts('Black dice deal damage', 'dice dam')).toStrictEqual([
      { text: 'Black ' },
      { text: 'dice', mark: true },
      { text: ' deal ' },
      { text: 'dam', mark: true },
      { text: 'age' },
    ]);
  });

  it('returns the text whole without a mark', () => {
    expect(markParts('Text', null)).toStrictEqual([{ text: 'Text' }]);
    expect(markParts('Text', ' ')).toStrictEqual([{ text: 'Text' }]);
  });
});

describe('richParagraphs (card text)', () => {
  it('keeps tokens and the strong "Use" keyword, and adds terms', () => {
    const [p] = richParagraphs(parseCardText('Use in combat: Cancel one [DAMAGE] result.\nYour citadels have 2 strength.'));
    expect(p![0]).toStrictEqual({ kind: 'text', text: 'Use', strong: true });
    expect(p!.some((s) => s.kind === 'token' && s.token === 'DAMAGE')).toBe(true);
  });

  it('gives the first AIM and CRIT tokens their term', () => {
    const [p] = richParagraphs(parseCardText('[CRIT] = +1 [AIM] result, +1 [AIM] again.'));
    const tokens = p!.filter((s) => s.kind === 'token');
    expect(tokens).toStrictEqual([
      { kind: 'token', token: 'CRIT', term: 'crit' },
      { kind: 'token', token: 'AIM', term: 'lock' },
      { kind: 'token', token: 'AIM' },
    ]);
  });

  it('renders every development without losing text', () => {
    for (const d of DEVELOPMENTS) {
      const paras = parseCardText(d.text);
      const rich = richParagraphs(paras);
      expect(rich.map(plain), d.name).toEqual(paras.map((p) => p.map((s) => (s.kind === 'token' ? `[${s.token}]` : s.text)).join('')));
    }
  });
});

describe('shipTokens', () => {
  it('maps the ship CSV tokens to card tokens', () => {
    expect(shipTokens('[Critical Damage] = +1 [Aim] result or +2 [Damage] results.')).toBe('[CRIT] = +1 [AIM] result or +2 [DAMAGE] results.');
    expect(shipTokens('Spend one [Planetary Material] or [Moon Material].')).toBe('Spend one [PLANETARY] or [MOON].');
  });

  it('leaves no unknown bracket token in any ship ability', () => {
    for (const s of SHIPS) for (const a of s.abilities) expect(shipTokens(a.text), `${s.name}: ${a.text}`).not.toMatch(/\[[^\]]*[a-z][^\]]*\]/);
  });
});
