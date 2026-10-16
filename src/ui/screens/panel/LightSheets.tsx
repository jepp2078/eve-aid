/**
 * The light game's record sheets: the board did the action, the app records what it gave. Gained VP (a card, a
 * discovery or anything else; missions and events keep their own buttons), Claimed a system (unclaimed or a rival's,
 * and the central system; on my turn) and Gained research (tokens placed right after by the research overlay). None is
 * an action: no cube. Like every sheet they are always mounted and keep their drafts through live updates.
 */
import { DEV } from '../../../data/developments';
import type { FactionId } from '../../../data/types';
import { FactionBadge } from '../../components/FactionBadge';
import { radioKeys, tabStop } from '../../components/radio';
import { useMe } from '../../hooks';
import { Icon, ResourceIcon } from '../../icons';
import { centralWords, factionName } from '../../lib/labels';
import {
  canLightClaim,
  gainVpCommand,
  lightClaimCommand,
  MAX_GAINED_RESEARCH,
  MAX_GAINED_VP,
  NEW_GAIN_VP,
  NEW_LIGHT_CLAIM,
  NEW_RESEARCH_TOKENS,
  researchTokensCommand,
  sanitizeGainVp,
  sanitizeLightClaim,
  sanitizeResearchTokens,
  VP_REASONS,
  type VpReason,
} from '../../lib/light';
import { ActionSheet, StepRow, Toggle, useSheetDraft } from './ActionSheet';

interface SheetProps {
  open: boolean;
  onClose: () => void;
}

const REASON_IDS = VP_REASONS.map((r) => r.id);

export function GainVpSheet({ open, onClose }: SheetProps) {
  const [draft, setDraft, reset] = useSheetDraft('gainVp', NEW_GAIN_VP, sanitizeGainVp);
  const pick = (reason: VpReason) => setDraft((d) => ({ ...d, reason }));
  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Gained VP"
      icon="vp"
      section="victory"
      command={gainVpCommand(draft)}
      head="Gain VP"
      confirmLabel={`Gain ${draft.vp} VP`}
      done={`Gained ${draft.vp} VP`}
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <p className="muted small">Missions and events have their own buttons.</p>
      <div className="step-list">
        <StepRow label="VP" icon={<ResourceIcon kind="vp" title={null} size="1.25rem" />} value={draft.vp} onChange={(vp) => setDraft((d) => ({ ...d, vp }))} min={1} max={MAX_GAINED_VP} />
      </div>
      <h3 className="sub-title" id="gain-vp-reason">
        Reason
      </h3>
      <div className="chip-row" role="radiogroup" aria-labelledby="gain-vp-reason" onKeyDown={radioKeys(REASON_IDS, draft.reason, pick)}>
        {VP_REASONS.map((r) => (
          <button
            key={r.id}
            type="button"
            role="radio"
            aria-checked={draft.reason === r.id}
            data-value={r.id}
            tabIndex={tabStop(REASON_IDS, draft.reason, r.id)}
            className={draft.reason === r.id ? 'chip is-selected' : 'chip'}
            onClick={() => pick(r.id)}
          >
            {r.label}
          </button>
        ))}
      </div>
    </ActionSheet>
  );
}

export function LightClaimSheet({ open, onClose }: SheetProps) {
  const { game, faction, me } = useMe();
  const [draft, setDraft, reset] = useSheetDraft('lightClaim', NEW_LIGHT_CLAIM, sanitizeLightClaim);
  if (game === null || faction === null || me === null) return null;

  const allowed = canLightClaim(game, faction);
  const words = centralWords(game.seats.length);
  const rivals = game.seats.filter((f) => f !== faction);
  const options: (FactionId | 'none')[] = ['none', ...rivals];
  const value = draft.from ?? 'none';
  const pick = (v: FactionId | 'none') => setDraft((d) => ({ ...d, from: v === 'none' ? null : v }));
  const systemsOf = (f: FactionId) => game.players[f]?.systems ?? 0;
  const enabled = (v: FactionId | 'none') => v === 'none' || systemsOf(v) > 0;

  const target = draft.from === null ? null : (game.players[draft.from] ?? null);
  const effects: string[] = [];
  if (target !== null) {
    if (target.systems > 0) effects.push(`${factionName(target.faction)}: Systems ${target.systems}→${target.systems - 1}`);
    if (me.completed.includes(DEV.invader)) effects.push('Invader: you gain 1 VP');
    if (target.completed.includes(DEV.civilianResistance)) effects.push(`${factionName(target.faction)}'s Civilian Resistance: pay them 3 ISK on the board`);
  }

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Claimed a system"
      icon="claim"
      section="claim"
      command={allowed.ok ? lightClaimCommand(draft) : null}
      hint={allowed.ok ? undefined : allowed.reason}
      head={draft.from === null ? 'Claim a system' : `Claim from ${factionName(draft.from)}`}
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <p className="muted small">Record a system you claimed on the board.</p>
      <h3 className="sub-title" id="light-claim-from">
        Whose system was it?
      </h3>
      <div className="chip-row" role="radiogroup" aria-labelledby="light-claim-from" onKeyDown={radioKeys(options, value, pick, enabled)}>
        {options.map((o) => (
          <button
            key={o}
            type="button"
            role="radio"
            aria-checked={o === value}
            data-value={o}
            tabIndex={tabStop(options, value, o, enabled)}
            disabled={!enabled(o)}
            className={o === value ? 'chip is-selected' : 'chip'}
            onClick={() => pick(o)}
          >
            {o === 'none' ? (
              'Unclaimed'
            ) : (
              <>
                <FactionBadge faction={o} size="sm" />
                {!enabled(o) && <span>No systems</span>}
              </>
            )}
          </button>
        ))}
      </div>
      {effects.length > 0 && (
        <div className="notice notice-info claim-effects">
          <Icon name="info" size="1.1rem" />
          <ul>
            {effects.map((e) => (
              <li key={e} className="num">
                {e}
              </li>
            ))}
          </ul>
        </div>
      )}
      <Toggle
        label={words.took}
        note={me.central ? `${words.held} already` : words.note}
        checked={draft.central}
        onChange={(central) => setDraft((d) => ({ ...d, central }))}
      />
    </ActionSheet>
  );
}

export function ResearchTokensSheet({ open, onClose }: SheetProps) {
  const [draft, setDraft, reset] = useSheetDraft('researchTokens', NEW_RESEARCH_TOKENS, sanitizeResearchTokens);
  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Gained research"
      icon="research"
      section="research"
      command={researchTokensCommand(draft)}
      head="Gain research"
      confirmLabel={`Gain ${draft.research} research`}
      done={`Gained ${draft.research} research`}
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <p className="muted small">You place them on your cards next.</p>
      <div className="step-list">
        <StepRow
          label="Research tokens"
          icon={<Icon name="research" size="1.25rem" />}
          value={draft.research}
          onChange={(research) => setDraft({ research })}
          min={1}
          max={MAX_GAINED_RESEARCH}
        />
      </div>
    </ActionSheet>
  );
}
