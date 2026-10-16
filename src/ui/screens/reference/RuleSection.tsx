/**
 * One rules section: title, paragraphs, bullets, numbered steps and sub-headings from the section body, keyword terms
 * as definition chips (once per section), search words marked, and the section's data table where its body says
 * `@view` (else at the end). The Rule interpretations items each carry the "House interpretation" badge.
 */
import { useId, type ReactNode } from 'react';
import { bodyBlocks, type BodyBlock, type RefSection as Section, type TermId } from '../../../data/reference';
import { Marked, RichSegments } from '../../components/CardText';
import { Icon } from '../../icons';
import { richText } from '../../lib/richText';
import { anchorOf, interpretationAnchor } from '../../lib/refNav';
import { DataView } from './CostTables';
import { H } from './H';

export function HouseBadge() {
  return (
    <span className="house-badge">
      <Icon name="ruling" size="1.1em" />
      House interpretation
    </span>
  );
}

export function RuleSection({ section, level, mark, flash }: { section: Section; level: number; mark: string | null; flash: string | null }) {
  const blocks = bodyBlocks(section.body);
  const seen = new Set<TermId>();
  const rich = (text: string) => <RichSegments segs={richText(text, { seen, mark })} />;
  const anchor = anchorOf({ kind: 'rule', id: section.id });
  const titleId = useId();
  const interp = section.id === 'interpretations';

  const out: ReactNode[] = [];
  let viewShown = false;
  for (let i = 0; i < blocks.length; ) {
    const b = blocks[i]!;
    if (b.kind === 'li' || b.kind === 'ol') {
      const start = i;
      const run: BodyBlock[] = [];
      while (i < blocks.length && blocks[i]!.kind === b.kind) run.push(blocks[i++]!);
      if (b.kind === 'li') {
        out.push(
          <ul key={start} className="ref-bullets">
            {run.map((x, j) => (
              <li key={j}>{rich((x as { text: string }).text)}</li>
            ))}
          </ul>,
        );
      } else {
        const items = run as Extract<BodyBlock, { kind: 'ol' }>[];
        out.push(
          <ol key={start} className={interp ? 'ref-steps ref-interp' : 'ref-steps'} start={items[0]!.n}>
            {items.map((x) => {
              const a = interpretationAnchor(x.n);
              return (
                <li key={x.n} data-anchor={interp ? a : undefined} className={interp && flash === a ? 'is-flash' : undefined}>
                  <span className="ref-num num" aria-hidden="true">
                    {x.n}
                  </span>
                  <div className="ref-step-body">
                    {interp && <HouseBadge />}
                    <p>{rich(x.text)}</p>
                  </div>
                </li>
              );
            })}
          </ol>,
        );
      }
      continue;
    }
    if (b.kind === 'h') {
      out.push(
        <H key={i} level={level + 1} className="ref-sub">
          <Marked text={b.text} mark={mark} />
        </H>,
      );
    } else if (b.kind === 'p') {
      out.push(<p key={i}>{rich(b.text)}</p>);
    } else if (section.view !== null && !viewShown) {
      viewShown = true;
      out.push(<DataView key={i} view={section.view} />);
    }
    i++;
  }
  if (section.view !== null && !viewShown) out.push(<DataView key="view" view={section.view} />);

  return (
    <section className={flash === anchor ? 'ref-section is-flash' : 'ref-section'} data-anchor={anchor} aria-labelledby={titleId}>
      <H level={level} id={titleId} className="ref-section-title">
        <Marked text={section.title} mark={mark} />
      </H>
      {out}
    </section>
  );
}
