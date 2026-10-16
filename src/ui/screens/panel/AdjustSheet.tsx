/**
 * Free bookkeeping behind the pencil: change any resource or VP by hand, with a reason chip (Event, Mission or
 * Correction; a Correction doesn't pay anyone's Lobbyist). A light game's pencil changes only what a light game
 * adjusts: VP, systems and the central system. Also the Mission sheet: a completed mission's VP.
 * All are free and allowed any time in the action and upkeep phases.
 */
import { ISK_CAP, MINERAL_CAP } from '../../../data/costs';
import type { Command } from '../../../engine/types';
import { useMe } from '../../hooks';
import { Icon, ResourceIcon } from '../../icons';
import {
  adjustCommand,
  EMPTY_ADJUST,
  EMPTY_LIGHT_ADJUST,
  lightAdjustCommand,
  REASONS,
  RES_KEYS,
  sanitizeAdjust,
  sanitizeLightAdjust,
  type AdjustDraft,
  type AdjustReason,
  type LightAdjustDraft,
} from '../../lib/adjust';
import { isRecord } from '../../lib/drafts';
import { centralWords, RESOURCE_LABEL, signed } from '../../lib/labels';
import { ActionSheet, Segmented, StepRow, Toggle, useSheetDraft } from './ActionSheet';

const fmt = (v: number) => signed(v);
/** A plain count with a real minus sign. */
const num = (v: number) => (v < 0 ? `\u2212${-v}` : String(v));

/** "Have 5", "5 → 8", and for ISK past the cap "40 → 49 (3 over the cap)". */
function afterNote(cur: number, d: number, cap: number | null): string {
  if (d === 0) return `Have ${num(cur)}`;
  const raw = cur + d;
  if (cap !== null && raw > cap) return `${num(cur)} → ${cap} (${raw - cap} over the cap)`;
  return `${num(cur)} → ${num(raw)}`;
}

/** The reason chips and what they mean for Lobbyist (both pencil sheets). */
function ReasonField({ value, onChange }: { value: AdjustReason | null; onChange: (r: AdjustReason | null) => void }) {
  return (
    <>
      <h3 className="sub-title" id="adjust-reason">
        Reason
      </h3>
      <Segmented<AdjustReason | 'none'>
        label="Reason"
        options={REASONS.map((r) => ({ value: r.id, label: r.label }))}
        value={value ?? 'none'}
        onChange={(v) => onChange(v === 'none' ? null : v)}
      />
      <p className="small faint">{value === 'correction' ? 'A correction does not pay Lobbyist.' : 'VP gained here pays other players’ Lobbyist; choose Correction to fix a mistake.'}</p>
    </>
  );
}

export function AdjustSheet(props: { open: boolean; onClose: () => void }) {
  const { game } = useMe();
  return game?.mode === 'light' ? <LightAdjustSheet {...props} /> : <FullAdjustSheet {...props} />;
}

function FullAdjustSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useMe();
  const [draft, setDraft, reset] = useSheetDraft<AdjustDraft>('adjust', EMPTY_ADJUST, sanitizeAdjust);
  const cmd = adjustCommand(draft);
  const changed = draft.vp !== 0 || RES_KEYS.some((k) => draft.res[k] !== 0);
  const reason = REASONS.find((r) => r.id === draft.reason)?.label ?? null;

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Adjust"
      icon="edit"
      section="turn"
      size="full"
      command={cmd}
      iskNet={draft.res.isk !== 0 ? draft.res.isk : null}
      head={reason === null ? 'Adjust' : `Adjust (${reason})`}
      hint={!changed ? 'Change a value with − / +' : 'Pick a reason: Event, Mission or Correction'}
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <p className="muted small">For card effects the app doesn't track, and for fixing mistakes. Everyone sees it in the log.</p>
      <ReasonField value={draft.reason} onChange={(reason) => setDraft((d) => ({ ...d, reason }))} />
      <h3 className="sub-title">Changes</h3>
      <div className="step-list">
        <StepRow
          label="VP"
          icon={<ResourceIcon kind="vp" title={null} size="1.25rem" />}
          value={draft.vp}
          onChange={(vp) => setDraft((d) => ({ ...d, vp }))}
          min={-(me?.vp ?? 0)}
          max={20}
          format={fmt}
          note={me === null ? null : afterNote(me.vp, draft.vp, null)}
        />
        {RES_KEYS.map((k) => (
          <StepRow
            key={k}
            label={RESOURCE_LABEL[k]}
            icon={<ResourceIcon kind={k} title={null} size="1.25rem" />}
            value={draft.res[k]}
            onChange={(v) => setDraft((d) => ({ ...d, res: { ...d.res, [k]: v } }))}
            min={-(me?.res[k] ?? 0)}
            max={k === 'isk' ? ISK_CAP : MINERAL_CAP}
            format={fmt}
            note={me === null ? null : afterNote(me.res[k], draft.res[k], k === 'isk' ? ISK_CAP : null)}
          />
        ))}
      </div>
      {changed && (
        <button type="button" className="btn-link" onClick={() => setDraft((d) => ({ ...EMPTY_ADJUST, reason: d.reason }))}>
          Reset changes
        </button>
      )}
    </ActionSheet>
  );
}

/** A light game's pencil: VP, systems and the central system only (a light game adjusts nothing else). */
function LightAdjustSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { game, me } = useMe();
  const words = centralWords(game?.seats.length ?? 0);
  const [draft, setDraft, reset] = useSheetDraft<LightAdjustDraft>('lightAdjust', EMPTY_LIGHT_ADJUST, sanitizeLightAdjust);
  const held = me?.central ?? false;
  // A central change another phone already made is no change any more.
  const central = draft.central === held ? null : draft.central;
  const cmd = lightAdjustCommand({ ...draft, central });
  const changed = draft.vp !== 0 || draft.systems !== 0 || central !== null;
  const reason = REASONS.find((r) => r.id === draft.reason)?.label ?? null;
  const centralAfter = central ?? held;

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Adjust"
      icon="edit"
      section="turn"
      size="full"
      command={cmd}
      head={reason === null ? 'Adjust' : `Adjust (${reason})`}
      hint={!changed ? `Change a value with − / +, or ${words.name.toLowerCase()}` : 'Pick a reason: Event, Mission or Correction'}
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <p className="muted small">For fixing mistakes and anything the other buttons don't record. Everyone sees it in the log.</p>
      <ReasonField value={draft.reason} onChange={(r) => setDraft((d) => ({ ...d, reason: r }))} />
      <h3 className="sub-title">Changes</h3>
      <div className="step-list">
        <StepRow
          label="VP"
          icon={<ResourceIcon kind="vp" title={null} size="1.25rem" />}
          value={draft.vp}
          onChange={(vp) => setDraft((d) => ({ ...d, vp }))}
          min={-(me?.vp ?? 0)}
          max={20}
          format={fmt}
          note={me === null ? null : afterNote(me.vp, draft.vp, null)}
        />
        <StepRow
          label="Systems"
          icon={<Icon name="claim" size="1.25rem" />}
          value={draft.systems}
          onChange={(systems) => setDraft((d) => ({ ...d, systems }))}
          min={-(me?.systems ?? 0)}
          max={20}
          format={fmt}
          note={me === null ? null : afterNote(me.systems, draft.systems, null)}
        />
      </div>
      <Toggle
        label={words.name}
        note={centralAfter ? words.held : words.notHeld}
        checked={centralAfter}
        onChange={(on) => setDraft((d) => ({ ...d, central: on === held ? null : on }))}
      />
      {changed && (
        <button type="button" className="btn-link" onClick={() => setDraft((d) => ({ ...EMPTY_LIGHT_ADJUST, reason: d.reason }))}>
          Reset changes
        </button>
      )}
    </ActionSheet>
  );
}

const ONE_VP = { vp: 1 };
const sanitizeMission = (raw: unknown): { vp: number } | null => {
  const vp = isRecord(raw) ? raw.vp : undefined;
  return typeof vp === 'number' && Number.isInteger(vp) && vp >= 1 && vp <= 9 ? { vp } : null;
};

export function MissionSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [draft, setDraft, reset] = useSheetDraft('mission', ONE_VP, sanitizeMission);
  const cmd: Command = { type: 'missionComplete', vp: draft.vp };
  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Completed a mission"
      icon="vp"
      section="victory"
      command={cmd}
      head="Mission complete"
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <p className="muted small">Missions can be completed whenever their objective is met, even on someone else's turn.</p>
      <div className="step-list">
        <StepRow label="VP on the card" icon={<ResourceIcon kind="vp" title={null} size="1.25rem" />} value={draft.vp} onChange={(vp) => setDraft({ vp })} min={1} max={9} />
      </div>
    </ActionSheet>
  );
}
