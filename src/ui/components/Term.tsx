/**
 * A keyword term in rules, ability or card text (DIF, leader, retreat …): a small tappable chip that opens a two- or
 * three-line definition with a link to the full rules. One popover is open at a time; it closes on a tap elsewhere,
 * Escape, Tab, scrolling or resizing.
 *
 * The popover is portalled next to the open sheet (so it stays inside the dialog) or to <body>, positioned by the
 * chip and kept 16 px from the screen edges.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { GLOSSARY, refSection, type TermId } from '../../data/reference';
import { Icon } from '../icons';
import { useRulesNav } from './RulesLink';

/** Closes whichever popover is open, so opening another one replaces it. */
let closeOpen: (() => void) | null = null;

export interface TermProps {
  term: TermId;
  children: ReactNode;
  /** `inline` (default): a chip in running text. `block`: the caller styles the button (e.g. a ship stat cell). */
  variant?: 'inline' | 'block';
  className?: string;
  /** Accessible name when the visible content needs more words (e.g. "DIF 3"). */
  label?: string;
}

export function Term({ term, children, variant = 'inline', className, label }: TermProps) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const mine = () => setOpen(false);
    closeOpen?.();
    closeOpen = mine;
    return () => {
      if (closeOpen === mine) closeOpen = null;
    };
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus({ preventScroll: true });
  };

  const cls = [variant === 'inline' ? 'term' : 'term-block', open && 'is-open', className].filter(Boolean).join(' ');
  return (
    <>
      <button
        ref={button}
        type="button"
        className={cls}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
      </button>
      {open && <TermPopover id={id} term={term} anchor={button} onClose={close} />}
    </>
  );
}

const EDGE = 16;
const GAP = 8;
const MAX_W = 320;

function TermPopover({ id, term, anchor, onClose }: { id: string; term: TermId; anchor: RefObject<HTMLButtonElement | null>; onClose: (refocus: boolean) => void }) {
  const entry = GLOSSARY[term];
  const go = useRulesNav();
  const ref = useRef<HTMLDivElement>(null);
  const [host] = useState<HTMLElement>(() => anchor.current?.closest<HTMLElement>('.sheet-layer') ?? document.body);
  const latestClose = useRef(onClose);
  useLayoutEffect(() => {
    latestClose.current = onClose;
  });

  // Place it under the chip (or above when there is no room), inside the screen edges; then take focus.
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = ref.current;
    if (a === null || el === null) return;
    const r = a.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const width = Math.min(MAX_W, vw - 2 * EDGE);
    el.style.width = `${width}px`;
    el.style.left = `${Math.round(Math.min(Math.max(EDGE, r.left + r.width / 2 - width / 2), vw - EDGE - width))}px`;
    const h = el.offsetHeight;
    const below = r.bottom + GAP;
    const top = below + h <= vh - EDGE || r.top - GAP - h < EDGE ? below : r.top - GAP - h;
    el.style.top = `${Math.round(Math.max(EDGE, top))}px`;
    el.style.visibility = 'visible';
    el.focus({ preventScroll: true });
  }, [anchor]);

  // Tap elsewhere, scroll or resize closes it.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchor.current?.contains(t)) return;
      latestClose.current(false);
    };
    const onMove = () => latestClose.current(false);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [anchor]);

  // Escape, or tabbing out of it, returns to the chip. The key stops here so it doesn't also reach the sheet the
  // term sits in (React events bubble through the portal to it).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Escape' && e.key !== 'Tab') return;
    e.stopPropagation();
    const buttons = ref.current?.querySelectorAll('button') ?? [];
    const last = buttons[buttons.length - 1];
    const leaving = e.key === 'Escape' || e.shiftKey || last === undefined || e.target === last;
    if (!leaving) return;
    e.preventDefault();
    onClose(true);
  };

  return createPortal(
    <div
      ref={ref}
      id={id}
      className="term-pop"
      role="dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      // React events bubble through the portal to the term's ancestors (a DevCard toggles on a body tap): stop here.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ visibility: 'hidden' }}
    >
      <p className="term-pop-title" id={`${id}-title`}>
        {entry.label}
      </p>
      <p className="term-pop-text" id={`${id}-text`}>
        {entry.text}
      </p>
      {go !== null && (
        <button
          type="button"
          className="btn-link term-pop-more"
          onClick={() => {
            onClose(false);
            go(entry.see);
          }}
        >
          Rules: {refSection(entry.see).title}
          <Icon name="chevronRight" size="1.1em" />
        </button>
      )}
    </div>,
    host,
  );
}
