/**
 * Move: the sheet first takes the action (spends the cube; fleets move on the board). Once the Move is taken, for
 * the rest of the turn the same sheet holds the follow-ups, also reachable from the "Move follow-ups" card on the
 * Panel: Discovery rewards (one row per token type, basic minerals by colour), an automatic claim by fleet strength
 * (with the central flag; may offer Deployable Infrastructure), black-ops jump payments, and starting a battle (the
 * Start combat sheet; the battle itself runs in the Combat tab).
 */
import { ISK_CAP, MINERAL_CAP } from '../../../data/costs';
import { BASIC_MINERALS, type ResourceKey } from '../../../data/types';
import type { Command } from '../../../engine/types';
import { useMe } from '../../hooks';
import { Icon, ResourceIcon, type IconName } from '../../icons';
import { cubeCostLabel } from '../../lib/actions';
import { isRecord } from '../../lib/drafts';
import { centralWords, RESOURCE_LABEL } from '../../lib/labels';
import { contentsOf, discoveryRewards, discoveryText, EMPTY_CONTENTS, EMPTY_DISCOVERY, sanitizeContents, sanitizeDiscovery, type ContentsDraft, type DiscoveryDraft } from '../../lib/ops';
import { ActionSheet, Segmented, StepRow, Toggle, useSheetDraft, type Option } from './ActionSheet';
import { ContentsFields } from './ContentsFields';

export type MoveTab = 'discovery' | 'claim' | 'jump' | 'combat';

const TABS: Option<MoveTab>[] = [
  { value: 'discovery', label: 'Discovery' },
  { value: 'claim', label: 'Claim' },
  { value: 'jump', label: 'Jump' },
  { value: 'combat', label: 'Battle' },
];

interface JumpDraft {
  planetary: number;
  moon: number;
}
const NO_JUMP: JumpDraft = { planetary: 0, moon: 0 };
interface AutoDraft {
  central: boolean;
  /** The belts in the claimed system (it was unclaimed, so no structures). */
  contents: ContentsDraft;
}
const NO_AUTO: AutoDraft = { central: false, contents: EMPTY_CONTENTS };

const small = (x: unknown): number => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 99 ? x : 0);
const sanitizeJump = (raw: unknown): JumpDraft | null => (isRecord(raw) ? { planetary: small(raw.planetary), moon: small(raw.moon) } : null);
const sanitizeAuto = (raw: unknown): AutoDraft | null => (isRecord(raw) ? { central: raw.central === true, contents: sanitizeContents(raw.contents) } : null);

/** Whether this device's player has taken a Move this turn (the follow-ups apply). */
export function inMoveFollowUps(game: ReturnType<typeof useMe>['game'], faction: ReturnType<typeof useMe>['faction']): boolean {
  return game !== null && game.phase === 'actions' && game.turn !== null && game.turn.faction === faction && game.turn.actionTaken === 'move';
}

export interface MoveSheetProps {
  open: boolean;
  onClose: () => void;
  tab: MoveTab;
  onTab: (t: MoveTab) => void;
  /** A claim made Deployable Infrastructure available: open its sheet. */
  onDeployable: () => void;
  /** Go to the Combat tab (the battle in progress). */
  onOpenCombat: () => void;
  /** Open the Start combat sheet. */
  onStartCombat: () => void;
}

const DISCOVERY_ROWS: { key: keyof DiscoveryDraft; label: string; icon: IconName | 'res' }[] = [
  { key: 'research', label: 'Research tokens', icon: 'research' },
  { key: 'control', label: 'Control (systems)', icon: 'claim' },
  { key: 'moon', label: 'Moon material', icon: 'res' },
  { key: 'planetary', label: 'Planetary material', icon: 'res' },
  { key: 'component', label: 'Component', icon: 'res' },
  { key: 'card', label: 'Event or Mission card', icon: 'reference' },
  { key: 'isk', label: 'ISK', icon: 'res' },
];

export function MoveSheet({ open, onClose, tab, onTab, onDeployable, onOpenCombat, onStartCombat }: MoveSheetProps) {
  const { game, faction, me } = useMe();
  const [discovery, setDiscovery, resetDiscovery] = useSheetDraft<DiscoveryDraft>('discovery', EMPTY_DISCOVERY, sanitizeDiscovery);
  const [jump, setJump, resetJump] = useSheetDraft<JumpDraft>('jump', NO_JUMP, sanitizeJump);
  const [auto, setAuto] = useSheetDraft('autoclaim', NO_AUTO, sanitizeAuto);
  const [belts, setBelts, resetBelts] = useSheetDraft<ContentsDraft>('discoveryBelts', EMPTY_CONTENTS, sanitizeContents);

  const following = inMoveFollowUps(game, faction);
  const central = centralWords(game?.seats.length ?? 0);
  const cube = me === null ? null : cubeCostLabel(me.cubesUsed);

  if (!following) {
    return (
      <ActionSheet
        open={open}
        onClose={onClose}
        title="Move"
        icon="move"
        cube={cube}
        section="move"
        command={{ type: 'action', action: 'move' }}
        head="Take Move action"
        done="Move taken"
      >
        <p>Move your fleets on the board, then take the action here.</p>
        <p className="muted">
          This sheet then helps with what the move caused: discovery tokens, a free claim by fleet strength, jump payments or a battle.
        </p>
      </ActionSheet>
    );
  }

  const tabs = <Segmented label="Move follow-ups" options={TABS} value={tab} onChange={onTab} />;
  const common = { open, onClose, title: 'Move follow-ups', icon: 'move' as const, section: 'move' as const };

  if (tab === 'discovery') {
    const rewards = discoveryRewards(discovery, belts);
    const cmd: Command | null = rewards.length === 0 ? null : { type: 'discover', rewards };
    const set = (k: keyof DiscoveryDraft) => (v: number) => setDiscovery((d) => ({ ...d, [k]: v }));
    return (
      <ActionSheet
        {...common}
        section="discovery"
        command={cmd}
        iskNet={discovery.isk > 0 ? discovery.isk : null}
        head="Record discovery"
        hint="Count the discovery tokens you drew"
        done={`Discovered ${discoveryText(discovery)}`}
        onDone={(ok) => {
          if (!ok) return;
          resetDiscovery();
          resetBelts();
        }}
      >
        {tabs}
        <p className="muted small">Record what the discovery tokens gave you; every amount can be edited.</p>
        <h3 className="sub-title">Basic minerals (cards drawn)</h3>
        <div className="step-list">
          {BASIC_MINERALS.map((m) => (
            <StepRow key={m} label={RESOURCE_LABEL[m]} icon={<ResourceIcon kind={m} title={null} size="1.25rem" />} value={discovery[m]} onChange={set(m)} max={MINERAL_CAP} />
          ))}
        </div>
        <h3 className="sub-title">Other tokens</h3>
        <div className="step-list">
          {DISCOVERY_ROWS.map((r) => (
            <StepRow
              key={r.key}
              label={r.label}
              icon={r.icon === 'res' ? <ResourceIcon kind={r.key as ResourceKey} title={null} size="1.25rem" /> : <Icon name={r.icon} size="1.25rem" />}
              value={discovery[r.key]}
              onChange={set(r.key)}
              max={r.key === 'isk' ? ISK_CAP : 9}
            />
          ))}
        </div>
        {discovery.control > 0 && (
          <>
            <h3 className="sub-title">Asteroid belts in the systems you gained</h3>
            <p className="muted small">Optional. They are yours to mine in upkeep (a double belt counts 2).</p>
            <ContentsFields value={belts} onChange={setBelts} structures={[]} />
          </>
        )}
      </ActionSheet>
    );
  }

  if (tab === 'claim') {
    return (
      <ActionSheet
        {...common}
        section="claim"
        command={{ type: 'autoClaim', central: auto.central, contents: contentsOf(auto.contents) }}
        head="Claim by fleet strength"
        done="System claimed by fleet strength"
        onDone={(ok, p) => {
          if (!ok) return;
          setAuto(NO_AUTO);
          if (p.result.game.turn?.deployable === true) onDeployable();
        }}
      >
        {tabs}
        <p>
          Your fleet ended its move in an <strong>unclaimed</strong> system with strength 3 or more (ships already there count): put your control token
          there. No action needed.
        </p>
        <h3 className="sub-title">Asteroid belts in the system (optional)</h3>
        <ContentsFields value={auto.contents} onChange={(contents) => setAuto((a) => ({ ...a, contents }))} structures={[]} />
        <Toggle label={central.claim} note={central.note} checked={auto.central} onChange={(central) => setAuto((a) => ({ ...a, central }))} />
      </ActionSheet>
    );
  }

  if (tab === 'jump') {
    const cmd: Command | null = jump.planetary + jump.moon === 0 ? null : { type: 'payJump', planetary: jump.planetary, moon: jump.moon };
    return (
      <ActionSheet
        {...common}
        command={cmd}
        head="Pay for the jump"
        hint="Choose the materials the jump costs"
        onDone={(ok) => ok && resetJump()}
      >
        {tabs}
        <p className="muted small">Black Ops battleships (U1) pay one planetary or moon material for each system they jump through.</p>
        <div className="step-list">
          <StepRow
            label="Planetary material"
            icon={<ResourceIcon kind="planetary" title={null} size="1.25rem" />}
            value={jump.planetary}
            onChange={(planetary) => setJump((j) => ({ ...j, planetary }))}
            max={Math.max(jump.planetary, me?.res.planetary ?? 0)}
            note={`You have ${me?.res.planetary ?? 0}`}
          />
          <StepRow
            label="Moon material"
            icon={<ResourceIcon kind="moon" title={null} size="1.25rem" />}
            value={jump.moon}
            onChange={(moon) => setJump((j) => ({ ...j, moon }))}
            max={Math.max(jump.moon, me?.res.moon ?? 0)}
            note={`You have ${me?.res.moon ?? 0}`}
          />
        </div>
      </ActionSheet>
    );
  }

  return (
    <ActionSheet
      {...common}
      section="combat"
      command={null}
      head="Start combat"
      footer={
        <button
          type="button"
          className="btn btn-primary btn-lg btn-block"
          onClick={() => {
            onClose();
            if (game?.combat) onOpenCombat();
            else onStartCombat();
          }}
        >
          <Icon name="combat" />
          {game?.combat ? 'Open the battle in Combat' : 'Start combat'}
        </button>
      }
    >
      {tabs}
      <p>Your fleet entered a system with enemy ships: a battle starts.</p>
      <p className="muted">Pick the defender and the system; then both sides assign their fleets in the Combat tab, where everyone can follow along.</p>
    </ActionSheet>
  );
}

/** On the Panel while my Move's follow-ups apply (until I end the turn). "Start combat" becomes "Open combat" once one runs. */
export function MoveFollowUpsCard({ onOpen, combatOn = false }: { onOpen: (tab: MoveTab) => void; combatOn?: boolean }) {
  const items: { tab: MoveTab; label: string; icon: IconName }[] = [
    { tab: 'discovery', label: 'Discovery', icon: 'search' },
    { tab: 'claim', label: 'Claim by strength', icon: 'claim' },
    { tab: 'jump', label: 'Jump payment', icon: 'move' },
    { tab: 'combat', label: combatOn ? 'Open combat' : 'Start combat', icon: 'combat' },
  ];
  return (
    <section className="card follow" aria-labelledby="follow-title">
      <h2 id="follow-title" className="follow-title">
        <Icon name="move" size="1.25rem" />
        Move follow-ups
      </h2>
      <p className="small muted">Record what your move caused, then end your turn.</p>
      <div className="follow-grid">
        {items.map((i) => (
          <button key={i.tab} type="button" className="btn btn-secondary follow-btn" onClick={() => onOpen(i.tab)}>
            <Icon name={i.icon} size="1.25rem" />
            <span>{i.label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
