/**
 * The in-game shell for rounds (actions, upkeep, game over): header + turn strip on top, the tab content, and a
 * bottom tab bar Panel · Table · Combat · Reference (icon + label; Combat carries a badge while a fight is on).
 * Panel is my faction (Task 13), Table everyone's public state and the log (Task 14), Combat the battle (Task 15),
 * Reference the rules reference (Task 16). The Start combat sheet is mounted here once, so the Combat tab and the
 * Panel's Move follow-ups open the same sheet (and draft); the two players in a combat get a banner under the turn
 * strip on every other tab.
 */
import { useEffect, useRef, useState } from 'react';
import { TurnStrip } from '../components/TurnStrip';
import { buzz, useBottomInset, useMe } from '../hooks';
import { Icon, type IconName } from '../icons';
import { formatCode } from '../lib/code';
import { combatBanner } from '../lib/combat';
import { factionName } from '../lib/labels';
import { turnStatus } from '../lib/turn';
import { CombatBanner } from './combat/CombatBanner';
import { CombatScreen } from './combat/CombatScreen';
import { StartCombatSheet } from './combat/StartCombatSheet';
import { useCombatDraftCleanup } from './combat/useCombatDrafts';
import { GameHeader } from './GameHeader';
import { PanelScreen } from './panel/PanelScreen';
import { useRoundSummary } from './panel/UpkeepSheet';
import { ReferenceScreen } from './Reference';
import { TableScreen } from './Table';
import { useNoticeToasts } from './useNoticeToasts';

export type Tab = 'panel' | 'table' | 'combat' | 'reference';

/**
 * Toasts sit above the tab bar, and above the Panel's sticky turn controls or upkeep Confirm bar or the Combat tab's
 * action bar while they show (TurnControls publishes its live height as --tc-h, the upkeep bar as --uk-h, the combat
 * footer as --cf-h). Every screen is imported statically:
 * a lazily loaded tab could fail to load on a flaky LAN and take the app down; vite.config.ts splits React into its
 * own chunk to keep the bundle size in check.
 */
const BOTTOM_INSET = 'calc(var(--tabbar-h) + var(--tc-h, 0px) + var(--uk-h, 0px) + var(--cf-h, 0px) + var(--safe-bottom))';

const TABS: { id: Tab; label: string; icon: IconName }[] = [
  { id: 'panel', label: 'Panel', icon: 'panel' },
  { id: 'table', label: 'Table', icon: 'table' },
  { id: 'combat', label: 'Combat', icon: 'combat' },
  { id: 'reference', label: 'Reference', icon: 'reference' },
];

const TAB_KEY = 'eve:tab';

function loadTab(): Tab {
  try {
    const t = sessionStorage.getItem(TAB_KEY);
    return TABS.some((x) => x.id === t) ? (t as Tab) : 'panel';
  } catch {
    return 'panel';
  }
}

export function TabShell() {
  const { code, game, faction, me } = useMe();
  const [tab, setTabState] = useState<Tab>(loadTab);
  const [startOpen, setStartOpen] = useState(false);
  useBottomInset(BOTTOM_INSET);
  // Notices from other devices (a claim, a raid, an attack…), then what a finished upkeep did, on whichever tab is
  // open. In this order, so the round summary wins when both arrive with the same update.
  useNoticeToasts();
  useRoundSummary();
  useCombatDraftCleanup();

  const setTab = (t: Tab) => {
    setTabState(t);
    try {
      sessionStorage.setItem(TAB_KEY, t);
    } catch {
      // remembered only for this page view
    }
    window.scrollTo({ top: 0 });
  };

  // One haptic tick when it becomes this device's turn (Android only; the strip says it in words too).
  const mine = game !== null && turnStatus(game, faction).kind === 'mine';
  const wasMine = useRef(mine);
  useEffect(() => {
    if (mine && !wasMine.current) buzz();
    wasMine.current = mine;
  }, [mine]);

  if (code === null || game === null || faction === null || me === null) return null;
  const myCombat = combatBanner(game, faction);

  return (
    <div className="screen shell">
      <GameHeader code={code} faction={faction} title={factionName(faction)} subtitle={`${me.name} · ${formatCode(code)}`}>
        <TurnStrip game={game} me={faction} onOpen={() => setTab('table')} />
        {tab !== 'combat' && <CombatBanner onOpen={() => setTab('combat')} />}
      </GameHeader>
      <main className="shell-main" role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'panel' ? (
          <PanelScreen onOpenCombat={() => setTab('combat')} onStartCombat={() => setStartOpen(true)} />
        ) : tab === 'table' ? (
          <TableScreen onOpenCombat={() => setTab('combat')} />
        ) : tab === 'combat' ? (
          <CombatScreen onStartCombat={() => setStartOpen(true)} />
        ) : (
          <ReferenceScreen />
        )}
      </main>
      <nav className="tabbar" aria-label="Sections">
        <div className="tabbar-inner" role="tablist">
          {TABS.map((t) => {
            const badge = t.id === 'combat' && game.combat !== null;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`tabpanel-${t.id}`}
                className={tab === t.id ? 'tab is-current' : 'tab'}
                onClick={() => setTab(t.id)}
              >
                <span className="tab-icon">
                  <Icon name={t.icon} />
                  {badge && <span className="tab-badge" aria-hidden="true" />}
                </span>
                <span className="tab-label">{t.label}</span>
                {badge && <span className="sr-only">{myCombat?.urgent ? '(combat: your move)' : '(combat in progress)'}</span>}
              </button>
            );
          })}
        </div>
      </nav>
      <StartCombatSheet
        open={startOpen}
        onClose={() => setStartOpen(false)}
        onStarted={() => {
          setStartOpen(false);
          setTab('combat');
        }}
      />
    </div>
  );
}
