/**
 * A compact development card: name, cost (research tokens), keyword chip, prerequisite and text.
 *
 * With `onToggle` the card's head (check box, name, cost) is a toggle button whose accessible name is just
 * "<name>, <cost> research" and whose description is the card text; the text itself sits outside the button. A tap
 * anywhere on the card body toggles too (the button stays the keyboard and screen-reader control). The
 * prerequisite link is its own button. Ids come from `useId`, so the same card can render twice on one page; the
 * article carries `data-dev="<id>"` for scrolling to it. Keyword terms in the text are definition chips (buttons), so a
 * tap on them never toggles the card, and neither does a tap inside their (portalled) popover. The static variant's heading level follows `headingLevel`.
 * A mouse over the name shows the printed card's photo beside the card, in both variants. `viewCard` adds a "View card"
 * link beside the cost to the static variant (the toggle variant has it in the footer).
 */
import { useId, useRef, type MouseEvent, type ReactNode } from 'react';
import { dev as devById, type Development } from '../../data/developments';
import type { DevId } from '../../data/types';
import { Icon } from '../icons';
import { bodyTapToggles } from '../lib/bodyTap';
import { devCardText } from '../lib/cardText';
import { KEYWORD_LABEL } from '../lib/labels';
import { CardText, Marked } from './CardText';
import { DevName } from './CardName';
import { CardPhoto, CardPhotoButton, usePhotoHover } from './CardPhoto';

/** "⚗ 3"; screen readers hear ", 3 research" (the comma separates it from a name before it). */
export function DevCost({ cost }: { cost: number }) {
  return (
    <span className="dev-cost">
      <span className="sr-only">, </span>
      <Icon name="research" size="1em" />
      <span className="num">{cost}</span>
      <span className="sr-only"> research</span>
    </span>
  );
}

export interface DevCardProps {
  dev: Development;
  selected?: boolean;
  onToggle?: () => void;
  /** Can't be selected right now (shown dimmed; the reason goes to assistive tech). */
  blocked?: string | null;
  onPrerequisite?: (id: DevId) => void;
  /** Extra content under the text (e.g. token progress, Complete/Use buttons). */
  children?: ReactNode;
  /** Heading level of the name in the static (no-toggle) variant, to fit the page outline. Default 3. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Search words to highlight in the text. */
  mark?: string | null;
  /** Static variant: show a "View card" link to the printed card's photo. */
  viewCard?: boolean;
}

export function DevCard({ dev, selected = false, onToggle, blocked = null, onPrerequisite, children, headingLevel = 3, mark = null, viewCard = false }: DevCardProps) {
  const uid = useId();
  const Heading = `h${headingLevel}` as const;
  const bodyId = `${uid}-body`;
  const blockedId = `${uid}-blocked`;
  const isBlocked = blocked !== null && !selected;
  const prereq = dev.prerequisite;
  const article = useRef<HTMLElement>(null);
  const photo = usePhotoHover();

  const toggleFromBody = (e: MouseEvent<HTMLElement>) => {
    if (onToggle === undefined || !bodyTapToggles(e.currentTarget, e.target)) return;
    onToggle();
  };

  const className = ['dev-card', onToggle !== undefined && 'has-toggle', selected && 'is-selected', isBlocked && 'is-blocked'].filter(Boolean).join(' ');
  return (
    <article ref={article} className={className} data-dev={dev.id} onClick={toggleFromBody}>
      {onToggle !== undefined ? (
        <button
          type="button"
          className="dev-head dev-toggle"
          aria-pressed={selected}
          aria-disabled={isBlocked}
          aria-describedby={isBlocked ? `${blockedId} ${bodyId}` : bodyId}
          onClick={onToggle}
        >
          <span className={selected ? 'dev-check is-on' : 'dev-check'} aria-hidden="true">
            {selected && <Icon name="check" size="1rem" />}
          </span>
          {/* The name can't be a CardName button inside this toggle; a mouse over it shows the card's photo instead. */}
          <span className="dev-name" onPointerEnter={photo.onPointerEnter} onPointerLeave={photo.onPointerLeave}>
            {dev.name}
          </span>
          {photo.show && <CardPhoto card={{ kind: 'dev', dev }} beside={article} />}
          <DevCost cost={dev.cost} />
        </button>
      ) : (
        <div className="dev-head">
          <Heading className="dev-name" onPointerEnter={photo.onPointerEnter} onPointerLeave={photo.onPointerLeave}>
            <Marked text={dev.name} mark={mark} />
          </Heading>
          {photo.show && <CardPhoto card={{ kind: 'dev', dev }} beside={article} />}
          {viewCard && <CardPhotoButton card={{ kind: 'dev', dev }} />}
          <DevCost cost={dev.cost} />
        </div>
      )}
      <div className="dev-body" id={bodyId}>
        {dev.keyword !== null && <span className="dev-keyword">{KEYWORD_LABEL[dev.keyword]}</span>}
        <CardText text={devCardText(dev)} mark={mark} />
      </div>
      {isBlocked && (
        <span id={blockedId} className="sr-only">
          {blocked}
        </span>
      )}
      {(prereq !== null || children !== undefined || onToggle !== undefined) && (
        <div className="dev-foot">
          {prereq !== null &&
            (onPrerequisite !== undefined ? (
              <button type="button" className="btn-link dev-prereq" onClick={() => onPrerequisite(prereq)}>
                Requires {devById(prereq).name}
              </button>
            ) : (
              <span className="dev-prereq small muted">
                Requires <DevName dev={devById(prereq)} />
              </span>
            ))}
          {children}
          {onToggle !== undefined && <CardPhotoButton card={{ kind: 'dev', dev }} />}
        </div>
      )}
    </article>
  );
}
