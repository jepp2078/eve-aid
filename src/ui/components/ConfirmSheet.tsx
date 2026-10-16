/**
 * A confirmation, only for things that can't simply be undone (seat takeover, Pass, force-advance, ending the game).
 * Both buttons name their outcome ("Take over seat" / "Keep looking"), never Yes/No.
 */
import type { ReactNode } from 'react';
import { BottomSheet } from './BottomSheet';

export interface ConfirmSheetProps {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** `danger` for destructive outcomes. */
  tone?: 'default' | 'danger';
  busy?: boolean;
}

export function ConfirmSheet({ open, title, children, confirmLabel, cancelLabel, onConfirm, onCancel, tone = 'default', busy = false }: ConfirmSheetProps) {
  return (
    <BottomSheet
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <div className="confirm-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className={tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="confirm-body">{children}</div>
    </BottomSheet>
  );
}
