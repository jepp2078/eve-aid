/**
 * Claim: +1 system. Optionally the system was taken from another player (their count drops; Invader gives me 1 VP;
 * their Civilian Resistance makes me pay them 3 ISK, shown before confirming), optionally it holds asteroid belts and
 * structures (they move to me, and leave the rival) and optionally it is the central system. With Deployable Infrastructure, a successful claim opens the structure offer.
 */
import { DEV } from '../../../data/developments';
import { FACTIONS, type FactionId, type Mineral, type StructureType } from '../../../data/types';
import type { Command, PlayerPublic } from '../../../engine/types';
import { FactionBadge } from '../../components/FactionBadge';
import { radioKeys, tabStop } from '../../components/radio';
import { useMe } from '../../hooks';
import { Icon } from '../../icons';
import { cubeCostLabel } from '../../lib/actions';
import { isRecord } from '../../lib/drafts';
import { centralWords, factionName } from '../../lib/labels';
import { contentsOf, EMPTY_CONTENTS, sanitizeContents, STRUCTURE_TYPES, type ContentsDraft } from '../../lib/ops';
import { changeText, diffPlayer } from '../../lib/preview';
import { ActionSheet, Toggle, usePreview, useSheetDraft } from './ActionSheet';
import { ContentsFields } from './ContentsFields';

interface ClaimDraft {
  from: FactionId | null;
  central: boolean;
  /** What the system holds (belts and structures), which moves to me. */
  contents: ContentsDraft;
}
const NEW_CLAIM: ClaimDraft = { from: null, central: false, contents: EMPTY_CONTENTS };

function sanitizeClaim(raw: unknown): ClaimDraft | null {
  if (!isRecord(raw)) return null;
  const from = FACTIONS.includes(raw.from as FactionId) ? (raw.from as FactionId) : null;
  return { from, central: raw.central === true, contents: sanitizeContents(raw.contents) };
}

/** The structures of `target` that can change hands: all but their home Citadels. */
function theirStructures(target: PlayerPublic): Partial<Record<StructureType, number>> {
  return { ...target.structures, citadel: Math.max(0, target.structures.citadel - target.homeCitadels) };
}

export function ClaimSheet({ open, onClose, onDeployable }: { open: boolean; onClose: () => void; onDeployable: () => void }) {
  const { game, faction, me } = useMe();
  const [draft, setDraft, reset] = useSheetDraft('claim', NEW_CLAIM, sanitizeClaim);
  const cmd: Command = { type: 'action', action: 'claim', from: draft.from, central: draft.central, contents: contentsOf(draft.contents) };
  // Computed here (only while open) for the rival's side, and handed to the frame for the footer.
  const preview = usePreview(open ? cmd : null);
  if (game === null || faction === null || me === null) return null;
  const words = centralWords(game.seats.length);

  const rivals = game.seats.filter((f) => f !== faction);
  const options: (FactionId | 'none')[] = ['none', ...rivals];
  const value = draft.from ?? 'none';
  // A new owner means a new list: an unclaimed system has no structures, and a rival's stock caps what can move.
  const pick = (v: FactionId | 'none') => setDraft((d) => ({ ...d, from: v === 'none' ? null : v, contents: EMPTY_CONTENTS }));
  const enabled = (v: FactionId | 'none') => v === 'none' || (game.players[v]?.systems ?? 0) > 0;

  const target = draft.from === null ? null : (game.players[draft.from] ?? null);
  const theirs =
    preview?.ok && target !== null && draft.from !== null
      ? diffPlayer(target, preview.result.game.players[draft.from]!, null, null).filter((c) => c.kind === 'res' || (c.kind === 'count' && (c.id === 'systems' || c.id.startsWith('belt:') || c.id.startsWith('structure:'))))
      : [];
  const consequences: string[] = [];
  if (target !== null && me.completed.includes(DEV.invader)) consequences.push('Invader: you gain 1 VP');
  if (target !== null && target.completed.includes(DEV.civilianResistance)) consequences.push(`${factionName(target.faction)}'s Civilian Resistance: you pay them 3 ISK`);

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Claim"
      icon="claim"
      cube={cubeCostLabel(me.cubesUsed)}
      section="claim"
      command={cmd}
      preview={preview}
      head={draft.from === null ? 'Claim a system' : `Claim from ${factionName(draft.from)}`}
      onDone={(ok, p) => {
        if (!ok) return;
        reset();
        onClose();
        if (p.result.game.turn?.deployable === true) onDeployable();
      }}
    >
      <p className="muted small">Put your control token on a system where you have a fleet.</p>
      <h3 className="sub-title" id="claim-from">
        Whose system was it?
      </h3>
      <div className="pick-list" role="radiogroup" aria-labelledby="claim-from" onKeyDown={radioKeys(options, value, pick, enabled)}>
        {options.map((o) => {
          const on = o === value;
          const p = o === 'none' ? null : game.players[o];
          return (
            <button
              key={o}
              type="button"
              role="radio"
              aria-checked={on}
              data-value={o}
              tabIndex={tabStop(options, value, o, enabled)}
              disabled={!enabled(o)}
              className={on ? 'pick is-selected' : 'pick'}
              onClick={() => pick(o)}
            >
              {o === 'none' ? (
                <span className="pick-main">Unclaimed system</span>
              ) : (
                <span className="pick-main">
                  <FactionBadge faction={o} player={p?.name} />
                </span>
              )}
              {p != null && (
                <span className="pick-note num">
                  {p.systems} {p.systems === 1 ? 'system' : 'systems'}
                </span>
              )}
              {on && <Icon name="check" size="1.1rem" className="pick-check" />}
            </button>
          );
        })}
      </div>
      {target !== null && (theirs.length > 0 || consequences.length > 0) && (
        <div className="notice notice-info claim-effects">
          <Icon name="info" size="1.1rem" />
          <ul>
            {theirs.map((c, i) => (
              <li key={i} className="num">
                {factionName(target.faction)}: {changeText(c)}
              </li>
            ))}
            {consequences.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      )}
      <h3 className="sub-title" id="claim-contents">
        What was in the system? (optional)
      </h3>
      <p className="muted small">
        {target === null
          ? 'Asteroid belts there are yours to mine in upkeep (a double belt counts 2).'
          : `Their belts and structures there become yours, and ${factionName(target.faction)} loses them (home Citadels can’t be taken).`}
      </p>
      <ContentsFields
        value={draft.contents}
        onChange={(contents) => setDraft((d) => ({ ...d, contents }))}
        structures={target === null ? [] : STRUCTURE_TYPES}
        maxBelts={target === null ? undefined : (target.belts as Record<Mineral, number>)}
        maxStructures={target === null ? undefined : theirStructures(target)}
      />
      <Toggle label={words.claim} note={words.note} checked={draft.central} onChange={(central) => setDraft((d) => ({ ...d, central }))} />
    </ActionSheet>
  );
}
