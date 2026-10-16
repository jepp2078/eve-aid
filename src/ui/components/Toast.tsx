/**
 * Toasts and the undo snackbar share one slot at the bottom of the screen (above the tab bar or a sticky footer):
 * a new message replaces the current one. Semantic tones always carry an icon and words. While a bottom sheet is
 * open, the message shows inside the sheet's footer instead (`useFeedbackSlot`), so it never covers the sheet's
 * inputs and stays inside the modal dialog for screen readers.
 *
 *   const { toast, snackbar } = useFeedback();
 *   toast('Not your turn', 'danger');
 *   snackbar('Trade', { label: 'Undo', onAction: undo });
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../icons';
import { Snackbar, type SnackbarAction } from './Snackbar';

export type ToastTone = 'info' | 'ok' | 'warn' | 'danger';

export const TOAST_MS = 4000;
export const SNACKBAR_MS = 6000;

interface Item {
  id: number;
  kind: 'toast' | 'snackbar';
  text: string;
  tone: ToastTone;
  action: SnackbarAction | null;
}

export interface Feedback {
  toast: (text: string, tone?: ToastTone) => void;
  snackbar: (text: string, action?: SnackbarAction) => void;
  dismiss: () => void;
}

const FeedbackContext = createContext<Feedback | null>(null);

/** Registers an element (an open sheet's footer slot) to hold the messages; returns the unregister function. */
type RegisterSlot = (el: HTMLElement) => () => void;
const SlotContext = createContext<RegisterSlot | null>(null);

/**
 * For bottom sheets: while `active`, messages render into `el` (the newest registered slot wins) instead of the
 * fixed region at the bottom of the screen.
 */
export function useFeedbackSlot(el: HTMLElement | null, active: boolean): void {
  const register = useContext(SlotContext);
  useEffect(() => {
    if (register === null || el === null || !active) return;
    return register(el);
  }, [register, el, active]);
}

const TONE_ICON: Record<ToastTone, IconName> = { info: 'info', ok: 'check', warn: 'warn', danger: 'danger' };

/** A message with an icon in its tone; the text carries the meaning, the icon backs it up. */
export function Toast({ text, tone }: { text: string; tone: ToastTone }) {
  return (
    <div className={`toast toast-${tone}`}>
      <Icon name={TONE_ICON[tone]} className="toast-icon" />
      <span className="toast-text">{text}</span>
    </div>
  );
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [item, setItem] = useState<Item | null>(null);
  const nextId = useRef(0);

  const toast = useCallback((text: string, tone: ToastTone = 'info') => {
    setItem({ id: ++nextId.current, kind: 'toast', text, tone, action: null });
  }, []);
  const snackbar = useCallback((text: string, action?: SnackbarAction) => {
    setItem({ id: ++nextId.current, kind: 'snackbar', text, tone: 'ok', action: action ?? null });
  }, []);
  const dismiss = useCallback(() => setItem(null), []);
  const api = useMemo(() => ({ toast, snackbar, dismiss }), [toast, snackbar, dismiss]);

  useEffect(() => {
    if (item === null) return;
    const t = setTimeout(() => setItem((cur) => (cur?.id === item.id ? null : cur)), item.kind === 'toast' ? TOAST_MS : SNACKBAR_MS);
    return () => clearTimeout(t);
  }, [item]);

  const [slots, setSlots] = useState<HTMLElement[]>([]);
  const register = useCallback<RegisterSlot>((el) => {
    setSlots((s) => [...s.filter((x) => x !== el), el]);
    return () => setSlots((s) => s.filter((x) => x !== el));
  }, []);
  const slot = slots[slots.length - 1] ?? null;

  const urgent = item?.tone === 'danger';
  const body =
    item === null ? null : item.kind === 'snackbar' ? (
      <Snackbar text={item.text} action={item.action} onDone={dismiss} />
    ) : (
      <Toast text={item.text} tone={item.tone} />
    );
  return (
    <FeedbackContext.Provider value={api}>
      <SlotContext.Provider value={register}>{children}</SlotContext.Provider>
      {slot !== null &&
        item !== null &&
        createPortal(
          <div className="feedback-item is-inline" key={item.id} role={urgent ? 'alert' : undefined}>
            {body}
          </div>,
          slot,
        )}
      <div className="feedback-region" role="status" aria-live="polite">
        {slot === null && item !== null && !urgent && (
          <div className="feedback-item" key={item.id}>
            {body}
          </div>
        )}
      </div>
      <div className="feedback-region" role="alert">
        {slot === null && item !== null && urgent && (
          <div className="feedback-item" key={item.id}>
            {body}
          </div>
        )}
      </div>
    </FeedbackContext.Provider>
  );
}

export function useFeedback(): Feedback {
  const v = useContext(FeedbackContext);
  if (v === null) throw new Error('useFeedback needs a <FeedbackProvider>');
  return v;
}
