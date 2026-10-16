/**
 * A development card's or ship's name that shows the card itself, drawn as on the reference page, in a popover
 * beside it. Hover or keyboard focus shows it while it lasts; a tap (a touch screen) pins it until the next tap,
 * Escape, or a tap elsewhere. The popover never takes the pointer, so it can't flicker the hover; it is portalled to
 * <body> and kept 16 px from the screen edges, above the name when there is room, else below. When the screen is
 * wide enough, the photo of the printed card (if there is one) sits to the right of the drawn card.
 *
 * `NamedText` renders running text (a log line, a notice) with every card and ship name in it as one of these.
 * Never put either inside another button (a toggle row, a pick): the name is a button itself.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import type { Development } from '../../data/developments';
import type { Ship } from '../../data/ships';
import { cardImage } from '../lib/cardImages';
import { splitCardNames, type NamedCard } from '../lib/cardNames';
import { PHOTO_SIZE } from './CardPhoto';
import { DevCard } from './DevCard';
import { ShipCard } from './ShipCard';

interface NameProps {
  /** Replaces the plain inline look (e.g. a chip). */
  className?: string;
  /** Shown instead of the bare name (e.g. an icon and the name). */
  children?: ReactNode;
}

export function DevName({ dev, ...rest }: NameProps & { dev: Development }) {
  return <CardName card={{ kind: 'dev', dev }} {...rest} />;
}

export function ShipName({ ship, ...rest }: NameProps & { ship: Ship }) {
  return <CardName card={{ kind: 'ship', ship }} {...rest} />;
}

/** Running text with each development card and ship it names shown as a name that opens its card. */
export function NamedText({ text }: { text: string }) {
  return (
    <>
      {splitCardNames(text).map((part, i) => (typeof part === 'string' ? part : <CardName key={i} card={part} />))}
    </>
  );
}

function CardName({ card, className = 'card-name-link', children }: NameProps & { card: NamedCard }) {
  const [hover, setHover] = useState(false);
  const [pinned, setPinned] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const open = hover || pinned;

  useEffect(() => {
    if (!pinned) return;
    const onDown = (e: PointerEvent) => {
      if (!button.current?.contains(e.target as Node)) setPinned(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [pinned]);

  const close = () => {
    setHover(false);
    setPinned(false);
  };
  return (
    <>
      <button
        ref={button}
        type="button"
        className={className}
        aria-expanded={open}
        onPointerEnter={(e) => e.pointerType === 'mouse' && setHover(true)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setHover(false)}
        onFocus={() => setHover(true)}
        onBlur={close}
        onClick={(e) => {
          // A name inside a toggle (a table row, a card body) shows the card without toggling it.
          e.stopPropagation();
          setPinned((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key !== 'Escape' || !open) return;
          e.stopPropagation();
          close();
        }}
      >
        {children ?? (card.kind === 'dev' ? card.dev.name : card.ship.name)}
      </button>
      {open && <CardPeek card={card} anchor={button} />}
    </>
  );
}

const EDGE = 16;
const GAP = 10;
const MAX_W = 380;

function CardPeek({ card, anchor }: { card: NamedCard; anchor: RefObject<HTMLButtonElement | null> }) {
  const ref = useRef<HTMLDivElement>(null);
  const image = cardImage(card);
  const [photo, setPhoto] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = ref.current;
    const drawn = el?.firstElementChild;
    if (a === null || el === null || !(drawn instanceof HTMLElement)) return;
    const r = a.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(MAX_W, vw - 2 * EDGE);
    el.style.setProperty('--peek-card-w', `${width}px`);
    el.style.removeProperty('--peek-h');
    // The drawn card and the photo share one height: the photo's, or the drawn card's if that is taller (the photo
    // then grows with it). The photo only comes along when both fit side by side.
    const min = PHOTO_SIZE[card.kind];
    const h = Math.max(drawn.offsetHeight, min.h);
    const box = { w: Math.round((h * min.w) / min.h), h };
    const fits = image !== null && width + GAP + box.w <= vw - 2 * EDGE;
    setPhoto(fits ? box : null);
    const height = fits ? h : drawn.offsetHeight;
    if (fits) el.style.setProperty('--peek-h', `${h}px`);
    const total = fits ? width + GAP + box.w : width;
    el.style.left = `${Math.round(Math.min(Math.max(EDGE, r.left), vw - EDGE - total))}px`;
    const above = r.top - GAP - height;
    const top = above >= EDGE || r.bottom + GAP + height > vh - EDGE ? above : r.bottom + GAP;
    el.style.top = `${Math.round(Math.max(EDGE, top))}px`;
    el.style.visibility = 'visible';
  }, [anchor, card, image]);

  return createPortal(
    <div ref={ref} className="card-peek" role="tooltip" style={{ visibility: 'hidden' }}>
      <div className="card-peek-card">
        {card.kind === 'dev' ? <DevCard dev={card.dev} headingLevel={3} /> : <ShipCard ship={card.ship} headingLevel={3} />}
      </div>
      {photo !== null && image !== null && <img className="card-peek-photo" src={image} alt="" width={photo.w} height={photo.h} decoding="async" />}
    </div>,
    document.body,
  );
}
