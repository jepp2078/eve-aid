/**
 * Rules, ability and card text as segments the UI can draw: keyword terms (DIF, leader, retreat …) become tappable
 * term segments (first occurrence per block only, so a paragraph isn't a sea of chips), search words are marked, and
 * card tokens ([DAMAGE], [CRIT]) stay tokens. Ship ability text from the CSV uses its own bracket words
 * ("[Critical Damage]"); `shipTokens` maps those to the card tokens first.
 */
import { TERM_IDS, type TermId } from '../../data/reference';
import type { Paragraph } from './cardText';

export type Rich =
  | { kind: 'text'; text: string; strong?: true; mark?: true }
  | { kind: 'term'; term: TermId; text: string; strong?: true; mark?: true }
  | { kind: 'token'; token: string; term?: TermId };

export interface RichOptions {
  /** Terms that already have a chip in this block; shared across the block's lines. */
  seen?: Set<TermId>;
  /** Make keyword terms tappable (default true). */
  terms?: boolean;
  /** Search words to highlight. */
  mark?: string | null;
}

/** How each term shows up in text. The stat abbreviations count only in capitals ("red" is a colour). */
export const TERM_PATTERNS: Record<TermId, RegExp> = {
  dif: /\bDIF\b/,
  atk: /\bATK\b/,
  sup: /\bSUP\b/,
  red: /\bRED\b/,
  hp: /\bHP\b/,
  spd: /\bSPD\b/,
  lock: /\block(?:ed\b|[- ]?(?:on|in)\b)|\baim(?:s|ing)?\b/i,
  crit: /\bcrit(?:s\b|ical(?: damage)?\b|\b)/i,
  leader: /\bleaders?\b/i,
  support: /\bsupport(?:s|ing|ed)?\b/i,
  orbit: /\borbits?\b/i,
  retreat: /\bretreat(?:s|ing|ed)?\b/i,
  reparations: /\breparations?\b/i,
  strength: /\bstrength\b/i,
};

const GLOBAL: [TermId, RegExp][] = TERM_IDS.map((id) => [id, new RegExp(TERM_PATTERNS[id].source, `${TERM_PATTERNS[id].flags}g`)]);

/** Card tokens that are also glossary terms (the first one in a block gets the definition). */
const TOKEN_TERM: Record<string, TermId> = { AIM: 'lock', CRIT: 'crit' };

type Part = { text: string } | { term: TermId; text: string };

function splitTerms(text: string, seen: Set<TermId>): Part[] {
  const out: Part[] = [];
  let at = 0;
  for (;;) {
    let best: { term: TermId; index: number; length: number } | null = null;
    for (const [id, re] of GLOBAL) {
      if (seen.has(id)) continue;
      re.lastIndex = at;
      const m = re.exec(text);
      if (m === null) continue;
      if (best === null || m.index < best.index || (m.index === best.index && m[0].length > best.length)) {
        best = { term: id, index: m.index, length: m[0].length };
      }
    }
    if (best === null) break;
    if (best.index > at) out.push({ text: text.slice(at, best.index) });
    out.push({ term: best.term, text: text.slice(best.index, best.index + best.length) });
    seen.add(best.term);
    at = best.index + best.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

function markWords(mark: string | null | undefined): string[] {
  return (mark ?? '')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
}

/** Splits `text` around the search words (each matched where a word starts, case-insensitively). */
export function markParts(text: string, mark: string | null | undefined): { text: string; mark?: true }[] {
  const words = markWords(mark);
  if (words.length === 0 || text === '') return [{ text }];
  const lower = text.toLowerCase();
  const out: { text: string; mark?: true }[] = [];
  let at = 0;
  for (;;) {
    let best: { index: number; length: number } | null = null;
    for (const w of words) {
      for (let i = lower.indexOf(w, at); i !== -1; i = lower.indexOf(w, i + 1)) {
        if (i > 0 && /[a-z0-9]/.test(lower[i - 1]!)) continue;
        if (best === null || i < best.index || (i === best.index && w.length > best.length)) best = { index: i, length: w.length };
        break;
      }
    }
    if (best === null) break;
    if (best.index > at) out.push({ text: text.slice(at, best.index) });
    out.push({ text: text.slice(best.index, best.index + best.length), mark: true });
    at = best.index + best.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

function enrich(text: string, strong: boolean, opts: RichOptions, seen: Set<TermId>): Rich[] {
  const parts: Part[] = opts.terms === false ? [{ text }] : splitTerms(text, seen);
  const out: Rich[] = [];
  for (const p of parts) {
    if ('term' in p) {
      const seg: Rich = { kind: 'term', term: p.term, text: p.text };
      if (strong) seg.strong = true;
      if (markParts(p.text, opts.mark).some((m) => m.mark)) seg.mark = true;
      out.push(seg);
      continue;
    }
    for (const m of markParts(p.text, opts.mark)) {
      const seg: Rich = { kind: 'text', text: m.text };
      if (strong) seg.strong = true;
      if (m.mark) seg.mark = true;
      out.push(seg);
    }
  }
  return out;
}

/** One line of plain text (rules prose). */
export function richText(text: string, opts: RichOptions = {}): Rich[] {
  return enrich(text, false, opts, opts.seen ?? new Set());
}

/** Card text paragraphs (from `parseCardText`); terms get a chip once per card. */
export function richParagraphs(paragraphs: Paragraph[], opts: RichOptions = {}): Rich[][] {
  const seen = opts.seen ?? new Set<TermId>();
  return paragraphs.map((para) =>
    para.flatMap((seg): Rich[] => {
      if (seg.kind === 'text') return enrich(seg.text, seg.strong === true, opts, seen);
      const term = TOKEN_TERM[seg.token];
      if (term !== undefined && opts.terms !== false && !seen.has(term)) {
        seen.add(term);
        return [{ kind: 'token', token: seg.token, term }];
      }
      return [{ kind: 'token', token: seg.token }];
    }),
  );
}

const SHIP_TOKEN: Record<string, string> = {
  'critical damage': 'CRIT',
  damage: 'DAMAGE',
  aim: 'AIM',
  'planetary material': 'PLANETARY',
  'moon material': 'MOON',
};

/** Ship ability text with the CSV's bracket words turned into card tokens ("[Critical Damage]" → "[CRIT]"). */
export function shipTokens(text: string): string {
  return text.replace(/\[([^\]]+)\]/g, (whole, word: string) => {
    const token = SHIP_TOKEN[word.trim().toLowerCase()];
    return token === undefined ? whole : `[${token}]`;
  });
}
