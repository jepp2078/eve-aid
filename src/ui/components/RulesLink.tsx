/**
 * Links into the rules drawer. The drawer itself is mounted once by `RulesProvider` (screens/RulesDrawer.tsx); these
 * only need its context, so any screen or sheet can use them.
 *
 *   <RulesLink section="trade" />                    a 44 px "?" button → drawer at Trade
 *   <RulesLink section="combat" label="Combat rules" />   "? Combat rules"
 *   const rules = useRulesDrawer(); rules.open('raids')   for other triggers
 *   <InterpretationLink n={4} />                     "House rule 4" → drawer at that interpretation
 *
 * Outside a provider `useRulesDrawer().available` is false and the links render nothing.
 */
import { createContext, useContext } from 'react';
import { refSection, type RefId } from '../../data/reference';
import { Icon } from '../icons';
import { interpretationAnchor } from '../lib/refNav';

export interface RulesDrawerApi {
  /** False outside a RulesProvider (then `open` does nothing). */
  available: boolean;
  /** Opens the drawer at a section (and optionally an anchor inside it, e.g. `interpretationAnchor(4)`). */
  open: (section: RefId, anchor?: string) => void;
  close: () => void;
}

const NONE: RulesDrawerApi = { available: false, open: () => {}, close: () => {} };

export const RulesDrawerContext = createContext<RulesDrawerApi>(NONE);

export function useRulesDrawer(): RulesDrawerApi {
  return useContext(RulesDrawerContext);
}

export type RulesNav = (section: RefId, anchor?: string) => void;

/** In-place navigation inside an open Reference view; its links use this instead of opening the drawer. */
export const RulesNavContext = createContext<RulesNav | null>(null);

/** Where a "see the rules" link should go: the Reference view it sits in, else the drawer, else nowhere (null). */
export function useRulesNav(): RulesNav | null {
  const local = useContext(RulesNavContext);
  const drawer = useRulesDrawer();
  return local ?? (drawer.available ? drawer.open : null);
}

export interface RulesLinkProps {
  section: RefId;
  /** Visible text after the "?"; without it the button is icon-only, named "Rules: <section title>". */
  label?: string;
  className?: string;
}

export function RulesLink({ section, label, className }: RulesLinkProps) {
  const go = useRulesNav();
  if (go === null) return null;
  const cls = ['rules-link', label !== undefined && 'has-label', className].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={cls}
      aria-label={label === undefined ? `Rules: ${refSection(section).title}` : undefined}
      aria-haspopup="dialog"
      onClick={() => go(section)}
    >
      <Icon name="help" size="1.375rem" />
      {label !== undefined && <span>{label}</span>}
    </button>
  );
}

/** The "house interpretation" badge as a link to that numbered item (for values that depend on it). */
export function InterpretationLink({ n, className }: { n: number; className?: string }) {
  const go = useRulesNav();
  if (go === null) return null;
  return (
    <button
      type="button"
      className={className === undefined ? 'house-badge house-link' : `house-badge house-link ${className}`}
      aria-haspopup="dialog"
      onClick={() => go('interpretations', interpretationAnchor(n))}
    >
      <Icon name="ruling" size="1.1em" />
      <span>House rule {n}</span>
    </button>
  );
}
