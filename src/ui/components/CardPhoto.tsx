/**
 * The photo of a printed card on its own, beside a drawn card, while the mouse is over its name. For names that can't
 * be a `CardName` button because they sit inside another control (the development picker's toggle rows). Mouse only:
 * there a tap belongs to the control. The photo goes to the right of the drawn card, else to its left, else over the
 * card's right end, and stays 16 px inside the screen; it never takes the pointer.
 *
 * `PhotoHoverName` is such a name on its own: a span that shows the photo beside itself while the mouse is over it.
 *
 * `CardPhotoButton` is the way in for touch screens (and anyone else): a "View card" link that opens the photo in a
 * modal dialog; a tap anywhere or Escape closes it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { cardImage } from '../lib/cardImages';
import type { NamedCard } from '../lib/cardNames';

const EDGE = 16;
const GAP = 10;
/** Development cards are 2:3, ship cards the taller 63 × 88 mm. */
export const PHOTO_SIZE = { dev: { w: 240, h: 360 }, ship: { w: 250, h: 349 } } as const;

/** Hover handlers for the name, and whether the photo is showing. */
export function usePhotoHover(): { show: boolean; onPointerEnter: (e: PointerEvent) => void; onPointerLeave: () => void } {
  const [show, setShow] = useState(false);
  return {
    show,
    onPointerEnter: (e) => e.pointerType === 'mouse' && setShow(true),
    onPointerLeave: () => setShow(false),
  };
}

export function CardPhoto({ card, beside }: { card: NamedCard; beside: RefObject<HTMLElement | null> }) {
  const ref = useRef<HTMLImageElement>(null);
  const image = cardImage(card);
  const size = PHOTO_SIZE[card.kind];
  useLayoutEffect(() => {
    const b = beside.current;
    const el = ref.current;
    if (b === null || el === null) return;
    const r = b.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const left =
      r.right + GAP + size.w <= vw - EDGE ? r.right + GAP : r.left - GAP - size.w >= EDGE ? r.left - GAP - size.w : Math.max(EDGE, Math.min(r.right, vw - EDGE) - size.w);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(Math.min(Math.max(EDGE, r.top), vh - EDGE - size.h))}px`;
    el.style.visibility = 'visible';
  }, [beside, size]);

  if (image === null) return null;
  return createPortal(
    <img ref={ref} className="card-photo-float" src={image} alt="" width={size.w} height={size.h} decoding="async" style={{ visibility: 'hidden' }} />,
    document.body,
  );
}

/** A card's name inside another control (a details summary); a mouse over it shows the photo beside it. */
export function PhotoHoverName({ card, className, children }: { card: NamedCard; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const photo = usePhotoHover();
  return (
    <>
      <span ref={ref} className={className} onPointerEnter={photo.onPointerEnter} onPointerLeave={photo.onPointerLeave}>
        {children}
      </span>
      {photo.show && <CardPhoto card={card} beside={ref} />}
    </>
  );
}

function cardName(card: NamedCard): string {
  return card.kind === 'dev' ? card.dev.name : card.ship.name;
}

/** "View card", opening the photo full size; nothing when the card has no photo. */
export function CardPhotoButton({ card }: { card: NamedCard }) {
  const image = cardImage(card);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);

  if (image === null) return null;
  const name = cardName(card);
  return (
    <>
      <button type="button" className="btn-link card-photo-btn" aria-haspopup="dialog" onClick={() => setOpen(true)}>
        View card<span className="sr-only">: {name}</span>
      </button>
      {/* Portalled, so a tap in the dialog is not a tap inside the card (which would toggle it). */}
      {open &&
        createPortal(
          <dialog ref={dialog} className="card-photo-dialog" aria-label={name} onClose={() => setOpen(false)} onClick={() => dialog.current?.close()}>
            <img src={image} alt={`The printed ${name} card`} decoding="async" />
            <p className="small muted">Tap anywhere to close</p>
          </dialog>,
          document.body,
        )}
    </>
  );
}
