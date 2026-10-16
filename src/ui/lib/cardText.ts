/**
 * Card text from the data files carries inline tokens (`[ISK]`, `[DAMAGE]`, `[O1]`) and `\n` paragraph breaks.
 * This splits it into segments the UI renders with icons; the word "Use" opening a paragraph or sentence is marked
 * strong, as printed (the rest of its trigger, "in combat", is regular weight).
.
 */
export type Segment = { kind: 'text'; text: string; strong?: true } | { kind: 'token'; token: string };
export type Paragraph = Segment[];

/** The word a token stands for (also the accessible name of its icon). */
export const TOKEN_LABEL: Record<string, string> = {
  ISK: 'ISK',
  MOON: 'moon',
  PLANETARY: 'planetary',
  COMPONENT: 'component',
  RESEARCH: 'research',
  BP: 'BP',
  AIM: 'aim',
  DAMAGE: 'damage',
  CRIT: 'crit',
  O1: 'O1',
  O2: 'O2',
  D1: 'D1',
  D2: 'D2',
  U1: 'U1',
  U2: 'U2',
};

export function parseCardText(text: string): Paragraph[] {
  return text.split('\n').map(parseParagraph);
}

/** The sentence printed on a card that owes its owner a new development card (`addsCard`). */
export const ADD_CARD_SENTENCE = 'Add a new development card to your development area.';

/** The text a card shows: its own, then the printed "add a new card" sentence when it owes one. */
export function devCardText(d: { text: string; addsCard: boolean }): string {
  return d.addsCard ? `${d.text}\n${ADD_CARD_SENTENCE}` : d.text;
}

/** Splits the word "Use" out of `text` where it opens the paragraph (`first`) or a sentence, marked strong. */
function strongUse(text: string, first: boolean): Segment[] {
  const out: Segment[] = [];
  const re = /(?<=^|[.!?:]\s+)Use\b/g;
  let at = 0;
  for (let m = re.exec(text); m !== null; m = re.exec(text)) {
    if (m.index === 0 && !first) continue;
    if (m.index > at) out.push({ kind: 'text', text: text.slice(at, m.index) });
    out.push({ kind: 'text', text: m[0], strong: true });
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ kind: 'text', text: text.slice(at) });
  return out;
}

function parseParagraph(line: string): Paragraph {
  const out: Segment[] = [];
  const re = /\[([A-Z0-9_]+)\]/g;
  let at = 0;
  const text = (t: string) => out.push(...strongUse(t, out.length === 0));
  for (let m = re.exec(line); m !== null; m = re.exec(line)) {
    if (m.index > at) text(line.slice(at, m.index));
    out.push({ kind: 'token', token: m[1]! });
    at = m.index + m[0].length;
  }
  if (at < line.length) text(line.slice(at));
  return out;
}
