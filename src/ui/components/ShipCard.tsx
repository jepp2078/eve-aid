/**
 * A compact ship card: name and strength, faction glyph · class · size · models, the stat line
 * (DIF ATK SUP RED HP SPD — each cell opens the stat's definition), the abilities with their tier badge
 * ("O1", "O2+D2", or "Basic" when always on) and the role line. Ability text shows dice results as icons and keyword
 * terms as definition chips. Used by the Reference ships browser and the Combat screen; `children` adds a footer
 * (e.g. combat controls). A mouse over the name shows the printed card's photo beside the card; `viewCard` adds a
 * "View card" link beside the strength.
 */
import { useRef, type ReactNode } from 'react';
import type { TermId } from '../../data/reference';
import type { Ship } from '../../data/ships';
import { STRENGTH } from '../../data/types';
import { FactionGlyph } from '../icons';
import { parseCardText } from '../lib/cardText';
import { factionName, SIZE_LABEL, TIER_LABEL } from '../lib/labels';
import { richParagraphs, richText, shipTokens } from '../lib/richText';
import { Marked, RichSegments } from './CardText';
import { CardPhoto, CardPhotoButton, usePhotoHover } from './CardPhoto';
import { Term } from './Term';

const STATS: { key: 'dif' | 'atk' | 'sup' | 'red' | 'hp' | 'spd'; label: string }[] = [
  { key: 'dif', label: 'DIF' },
  { key: 'atk', label: 'ATK' },
  { key: 'sup', label: 'SUP' },
  { key: 'red', label: 'RED' },
  { key: 'hp', label: 'HP' },
  { key: 'spd', label: 'SPD' },
];

export interface ShipCardProps {
  ship: Ship;
  /** Heading level of the ship's name, to fit the page outline. Default 3. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Search words to highlight. */
  mark?: string | null;
  /** Footer content under the role line. */
  children?: ReactNode;
  className?: string;
  /** Show a "View card" link to the printed card's photo. */
  viewCard?: boolean;
}

/** "O2+D2" with its meaning for screen readers. */
export function TierBadge({ requires }: { requires: readonly string[] }) {
  if (requires.length === 0) {
    return (
      <span className="tier-badge is-basic">
        Basic<span className="sr-only">: always active</span>
      </span>
    );
  }
  return (
    <span className="tier-badge">
      <span aria-hidden="true">{requires.join('+')}</span>
      <span className="sr-only">Needs {requires.map((t) => TIER_LABEL[t as keyof typeof TIER_LABEL] ?? t).join(' and ')}:</span>
    </span>
  );
}

export function ShipCard({ ship, headingLevel = 3, mark = null, children, className, viewCard = false }: ShipCardProps) {
  const Heading = `h${headingLevel}` as const;
  const article = useRef<HTMLElement>(null);
  const photo = usePhotoHover();
  const seen = new Set<TermId>(); // one definition chip per term per card
  const colon = ship.role.indexOf(':');
  const roleName = colon === -1 ? ship.role : ship.role.slice(0, colon);
  const roleText = colon === -1 ? '' : ship.role.slice(colon + 1).trim();
  const abilities = ship.abilities.map((a) => ({ a, paras: richParagraphs(parseCardText(shipTokens(a.text)), { seen, mark }) }));
  const role = richText(roleText, { seen, mark });

  return (
    <article ref={article} className={className === undefined ? 'ship-card' : `ship-card ${className}`} data-faction={ship.faction} data-ship={ship.id}>
      <header className={viewCard ? 'ship-head has-photo' : 'ship-head'}>
        <Heading className="ship-name" onPointerEnter={photo.onPointerEnter} onPointerLeave={photo.onPointerLeave}>
          <Marked text={ship.name} mark={mark} />
        </Heading>
        {photo.show && <CardPhoto card={{ kind: 'ship', ship }} beside={article} />}
        {viewCard && <CardPhotoButton card={{ kind: 'ship', ship }} />}
        <Term term="strength" variant="block" className="ship-strength" label={`Strength ${STRENGTH[ship.size]}`}>
          <span className="ship-strength-label">Strength</span>
          <span className="num">{STRENGTH[ship.size]}</span>
        </Term>
        <p className="ship-meta">
          <FactionGlyph faction={ship.faction} size="1em" />
          <span className="ship-faction">{factionName(ship.faction)}</span>
          <span aria-hidden="true">·</span>
          <span>
            <Marked text={ship.cls} mark={mark} />
          </span>
          <span aria-hidden="true">·</span>
          <span>{SIZE_LABEL[ship.size]}</span>
          <span aria-hidden="true">·</span>
          <span className="num">{ship.qty} models</span>
        </p>
      </header>
      <ul className="ship-stats" aria-label="Stats">
        {STATS.map((s) => (
          <li key={s.key}>
            <Term term={s.key} variant="block" className="ship-stat" label={`${s.label} ${ship[s.key]}`}>
              <span className="ship-stat-label">{s.label}</span>
              <span className="ship-stat-value num">{ship[s.key]}</span>
            </Term>
          </li>
        ))}
      </ul>
      {abilities.length > 0 && (
        <ul className="ship-abilities" aria-label="Abilities">
          {abilities.map(({ a, paras }) => (
            <li key={a.slot} className="ship-ability">
              <TierBadge requires={a.requires} />
              <div className="ship-ability-text">
                {paras.map((p, i) => (
                  <p key={i}>
                    <RichSegments segs={p} />
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="ship-role">
        <strong>
          <Marked text={roleName} mark={mark} />
        </strong>
        {roleText !== '' && (
          <>
            {' — '}
            <RichSegments segs={role} />
          </>
        )}
      </p>
      {children}
    </article>
  );
}
