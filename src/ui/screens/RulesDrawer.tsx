/**
 * The contextual rules drawer, mounted once for the whole game (GameScreen wraps every phase in `RulesProvider`).
 * `RulesLink` / `useRulesDrawer().open(section)` open it as a half-height sheet with the Reference at that section;
 * the screen underneath keeps its state (the sheet is a portal; nothing below re-mounts). An expand button switches
 * to nearly full height for longer reading.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RefId } from '../../data/reference';
import { BottomSheet } from '../components/BottomSheet';
import { RulesDrawerContext, type RulesDrawerApi } from '../components/RulesLink';
import { Icon } from '../icons';
import { ReferenceView, type RefTarget } from './Reference';

export function RulesProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ open: boolean; target: RefTarget | null }>({ open: false, target: null });
  const seq = useRef(0);
  const api = useMemo<RulesDrawerApi>(
    () => ({
      available: true,
      open: (section: RefId, anchor?: string) => {
        seq.current += 1;
        const n = seq.current;
        setState({ open: true, target: { section, anchor, n } });
      },
      close: () => setState((s) => ({ ...s, open: false })),
    }),
    [],
  );
  return (
    <RulesDrawerContext.Provider value={api}>
      {children}
      <RulesDrawer open={state.open} target={state.target} onClose={api.close} />
    </RulesDrawerContext.Provider>
  );
}

function RulesDrawer({ open, target, onClose }: { open: boolean; target: RefTarget | null; onClose: () => void }) {
  const [full, setFull] = useState(false);
  useEffect(() => {
    if (!open) setFull(false);
  }, [open]);
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Rules"
      size={full ? 'full' : 'half'}
      headerExtra={
        <button type="button" className="icon-btn" aria-pressed={full} aria-label="Full height" onClick={() => setFull((f) => !f)}>
          <Icon name={full ? 'chevronDown' : 'chevronUp'} />
        </button>
      }
    >
      {target !== null && <ReferenceView mode="drawer" target={target} />}
    </BottomSheet>
  );
}
