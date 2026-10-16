/**
 * Card text with its inline tokens drawn as icon + word ("Gain 2 ⬡ ISK"), ship tiers as small chips, keyword terms
 * (DIF, leader, retreat …) as tappable definition chips, and search words marked.
 */
import { Fragment, type ReactNode } from 'react';
import type { TermId } from '../../data/reference';
import { Icon, ResourceIcon, type IconName } from '../icons';
import { parseCardText, TOKEN_LABEL } from '../lib/cardText';
import { markParts, richParagraphs, shipTokens, type Rich } from '../lib/richText';
import { Term } from './Term';

const RESOURCE_TOKENS = { ISK: 'isk', MOON: 'moon', PLANETARY: 'planetary', COMPONENT: 'component' } as const;
const ICON_TOKENS: Record<string, IconName> = { RESEARCH: 'research', BP: 'bp', AIM: 'aim', DAMAGE: 'damage', CRIT: 'crit' };

export function Token({ token }: { token: string }) {
  const word = TOKEN_LABEL[token] ?? token;
  if (/^[ODU][12]$/.test(token)) return <span className="tier-chip">{token}</span>;
  const res = RESOURCE_TOKENS[token as keyof typeof RESOURCE_TOKENS];
  const icon = ICON_TOKENS[token];
  return (
    <span className="token">
      {res !== undefined ? <ResourceIcon kind={res} title={null} size="1.15em" /> : icon !== undefined ? <Icon name={icon} size="1.15em" /> : null}
      <span className="token-word">{word}</span>
    </span>
  );
}

/** Text with the search words wrapped in <mark>. */
export function Marked({ text, mark }: { text: string; mark?: string | null }) {
  if (mark === null || mark === undefined || mark.trim() === '') return <>{text}</>;
  return (
    <>
      {markParts(text, mark).map((p, i) =>
        p.mark ? (
          <mark key={i} className="hit">
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </>
  );
}

function segment(s: Rich): ReactNode {
  if (s.kind === 'token') {
    const token = <Token token={s.token} />;
    return s.term === undefined ? token : <Term term={s.term}>{token}</Term>;
  }
  const marked = s.mark ? <mark className="hit">{s.text}</mark> : s.text;
  const body = s.strong ? <strong>{marked}</strong> : marked;
  return s.kind === 'term' ? <Term term={s.term}>{body}</Term> : body;
}

/** Draws rich segments (from `richText` / `richParagraphs`). */
export function RichSegments({ segs }: { segs: Rich[] }) {
  return (
    <>
      {segs.map((s, i) => (
        <Fragment key={i}>{segment(s)}</Fragment>
      ))}
    </>
  );
}

export interface CardTextProps {
  text: string;
  className?: string;
  /** Keyword terms as definition chips (default true). */
  terms?: boolean;
  /** Search words to highlight. */
  mark?: string | null;
  /** The text uses the ships CSV's bracket words ("[Critical Damage]"). */
  ship?: boolean;
  /** Terms already given a chip in the surrounding block (each term gets one chip per block). */
  seen?: Set<TermId>;
}

export function CardText({ text, className, terms = true, mark = null, ship = false, seen }: CardTextProps) {
  const paragraphs = richParagraphs(parseCardText(ship ? shipTokens(text) : text), { terms, mark, seen });
  return (
    <div className={className === undefined ? 'card-text' : `card-text ${className}`}>
      {paragraphs.map((para, i) => (
        <p key={i}>
          <RichSegments segs={para} />
        </p>
      ))}
    </div>
  );
}
