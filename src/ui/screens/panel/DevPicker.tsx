/**
 * Choosing one development card: category chips (All + the categories on offer, with counts) over the cards grouped
 * by category, cheapest first, as the Setup screen shows them (`DevCard` with its toggle). `DevPicker` sits inline
 * (the add-card overlay, Research Spy); `DevPickerSheet` is a full-height sheet with a "Choose …" button, opened
 * from another sheet (Research fill/swap, fetching a card while distributing research).
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { DevCategory, Development } from '../../../data/developments';
import type { DevId } from '../../../data/types';
import { BottomSheet } from '../../components/BottomSheet';
import { DevCard } from '../../components/DevCard';
import { useFeedback } from '../../components/Toast';
import { CATEGORY_LABEL } from '../../lib/labels';
import { devsByCategory } from '../../lib/setup';

export interface DevPickerProps {
  /** The cards on offer. */
  devs: readonly Development[];
  value: DevId | null;
  onChange: (id: DevId) => void;
  /** Accessible name of the category filter. */
  label: string;
  /** A reason a card can't be chosen (shown dimmed; a tap says why). */
  blocked?: (d: Development) => string | null;
}

export function DevPicker({ devs, value, onChange, label, blocked }: DevPickerProps) {
  const { toast } = useFeedback();
  const [filter, setFilter] = useState<DevCategory | 'all'>('all');
  const groups = useMemo(() => devsByCategory(devs).filter((g) => g.devs.length > 0), [devs]);
  const shown = groups.some((g) => g.category === filter) ? filter : 'all';

  if (devs.length === 0) return null;
  return (
    <div className="dev-picker">
      {groups.length > 1 && (
        <div className="chip-row chip-scroll" role="radiogroup" aria-label={label}>
          {(['all', ...groups.map((g) => g.category)] as const).map((c) => (
            <button key={c} type="button" role="radio" aria-checked={shown === c} className={shown === c ? 'chip is-selected' : 'chip'} onClick={() => setFilter(c)}>
              {c === 'all' ? 'All' : CATEGORY_LABEL[c]}
              <span className="num faint">{c === 'all' ? devs.length : groups.find((g) => g.category === c)!.devs.length}</span>
            </button>
          ))}
        </div>
      )}
      {groups
        .filter((g) => shown === 'all' || g.category === shown)
        .map((g) => (
          <section key={g.category} className="stack-sm" aria-label={CATEGORY_LABEL[g.category]}>
            <h3 className="caps faint">{CATEGORY_LABEL[g.category]}</h3>
            {g.devs.map((d) => {
              const why = blocked?.(d) ?? null;
              return (
                <DevCard
                  key={d.id}
                  dev={d}
                  selected={value === d.id}
                  blocked={why}
                  onToggle={() => {
                    if (why !== null) toast(why, 'info');
                    else onChange(d.id);
                  }}
                />
              );
            })}
          </section>
        ))}
    </div>
  );
}

export interface DevPickerSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  devs: readonly Development[];
  /** The chosen card; the sheet closes itself. */
  onPick: (id: DevId) => void;
  /** Confirm's label for the selected card ("Swap in Large Hull"). */
  confirm: (d: Development) => string;
  /** Shown above the cards. */
  intro?: ReactNode;
  /** Shown when no card is on offer. */
  empty?: string;
}

export function DevPickerSheet({ open, onClose, title, devs, onPick, confirm, intro, empty = 'No card can be chosen' }: DevPickerSheetProps) {
  const [value, setValue] = useState<DevId | null>(null);
  // Every opening starts without a selection.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setValue(null);
  }
  const chosen = devs.find((d) => d.id === value) ?? null;
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      size="full"
      title={title}
      footer={
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block as-confirm"
          disabled={chosen === null}
          onClick={() => {
            if (chosen === null) return;
            onPick(chosen.id);
            onClose();
          }}
        >
          {chosen === null ? 'Choose a card above' : confirm(chosen)}
        </button>
      }
    >
      <div className="as-body">
        {intro}
        {devs.length === 0 ? <p className="muted">{empty}</p> : <DevPicker devs={devs} value={value} onChange={setValue} label="Category" />}
      </div>
    </BottomSheet>
  );
}
