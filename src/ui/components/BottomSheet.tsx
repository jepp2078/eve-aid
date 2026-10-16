/**
 * A bottom sheet: the home of every action and confirmation. Closes by dragging the header down, the Close button,
 * the backdrop or Escape (unless `dismissible` is false, for rules-mandated sheets).
 *
 * `blocking` is for a rules-mandated step that blocks one screen but not the app: it can't be dismissed, and it
 * leaves the tab bar uncovered and usable (so it is not an `aria-modal` dialog and doesn't trap Tab).
 *
 * The sheet is portalled to <body> but stays in the caller's React tree at a stable position, so its children keep
 * their state (a half-built draft) across parent re-renders and live game updates. Its children unmount only when
 * the sheet finishes closing. While open, toasts and the undo snackbar appear at the top of its footer (or at its
 * bottom edge without a footer), so they never cover the sheet's inputs.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons';
import { prefersReducedMotion } from '../lib/motion';
import { useFeedbackSlot } from './Toast';

export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Sticky footer, e.g. the before→after row and the Confirm button. */
  footer?: ReactNode;
  /** Extra header content next to the title, e.g. a `?` rules link. */
  headerExtra?: ReactNode;
  /** `half`: a fixed ~60% of the screen (the rules drawer); `full`: nearly the whole screen (QR invite, long lists). */
  size?: 'auto' | 'half' | 'full';
  dismissible?: boolean;
  /** A rules-mandated step over one screen: not dismissible, the tab bar stays visible and usable. */
  blocking?: boolean;
}

const CLOSE_DRAG_PX = 96;
const CLOSE_VELOCITY = 0.6; // px/ms
const EXIT_MS = 200;

let locks = 0;
function lockScroll(): () => void {
  if (locks++ === 0) document.body.style.overflow = 'hidden';
  return () => {
    if (--locks === 0) document.body.style.overflow = '';
  };
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function BottomSheet({ open, onClose, title, children, footer, headerExtra, size = 'auto', dismissible: canDismiss = true, blocking = false }: BottomSheetProps) {
  const dismissible = canDismiss && !blocking;
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>(open ? 'open' : 'closed');
  const [drag, setDrag] = useState(0);
  const sheetRef = useRef<HTMLElement>(null);
  // While open, toasts and the undo snackbar show in this sheet's footer instead of over its content.
  const [feedbackSlot, setFeedbackSlot] = useState<HTMLDivElement | null>(null);
  useFeedbackSlot(feedbackSlot, open);
  const dragStart = useRef<{ y: number; t: number; id: number } | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) {
      setPhase('open');
      return;
    }
    setPhase((p) => (p === 'closed' ? 'closed' : 'closing'));
    const t = setTimeout(() => setPhase('closed'), prefersReducedMotion() ? 0 : EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  const mounted = phase !== 'closed';

  // While mounted: lock page scroll, move focus into the sheet, and give it back afterwards.
  useEffect(() => {
    if (!mounted) return;
    const unlock = lockScroll();
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    sheetRef.current?.focus({ preventScroll: true });
    return () => {
      unlock();
      // Only when focus went nowhere with this sheet: if another sheet opened meanwhile (Move → Start combat), keep it.
      const lost = document.activeElement === null || document.activeElement === document.body;
      if (lost && previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [mounted]);

  if (!mounted) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape' && dismissible) {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab' || blocking || sheetRef.current === null) return;
    const items = [...sheetRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
    const first = items[0];
    const last = items[items.length - 1];
    if (first === undefined || last === undefined) return;
    if (e.shiftKey && (document.activeElement === first || document.activeElement === sheetRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (!dismissible || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    dragStart.current = { y: e.clientY, t: e.timeStamp, id: e.pointerId };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const s = dragStart.current;
    if (s === null || s.id !== e.pointerId) return;
    setDrag(Math.max(0, e.clientY - s.y));
  };
  const endDrag = (e: PointerEvent<HTMLElement>) => {
    const s = dragStart.current;
    if (s === null || s.id !== e.pointerId) return;
    dragStart.current = null;
    const dy = Math.max(0, e.clientY - s.y);
    const velocity = dy / Math.max(1, e.timeStamp - s.t);
    setDrag(0);
    if (dy > CLOSE_DRAG_PX || (dy > 24 && velocity > CLOSE_VELOCITY)) onClose();
  };

  return createPortal(
    <div className={['sheet-layer', phase === 'closing' && 'is-closing', blocking && 'is-blocking'].filter(Boolean).join(' ')}>
      <div className="sheet-backdrop" onClick={dismissible ? onClose : undefined} aria-hidden="true" />
      <section
        ref={sheetRef}
        className={`sheet sheet-${size}`}
        role="dialog"
        aria-modal={!blocking}
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={drag > 0 ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
      >
        <header
          className={dismissible ? 'sheet-header is-draggable' : 'sheet-header'}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          {dismissible && <div className="sheet-grip" aria-hidden="true" />}
          <h2 id={titleId} className="sheet-title">
            {title}
          </h2>
          {headerExtra}
          {dismissible && (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
              <Icon name="close" />
            </button>
          )}
        </header>
        <div className="sheet-body">{children}</div>
        {footer !== undefined ? (
          <footer className="sheet-footer">
            <div className="sheet-feedback" ref={setFeedbackSlot} aria-live="polite" />
            {footer}
          </footer>
        ) : (
          <div className="sheet-feedback sheet-feedback-solo" ref={setFeedbackSlot} aria-live="polite" />
        )}
      </section>
    </div>,
    document.body,
  );
}
