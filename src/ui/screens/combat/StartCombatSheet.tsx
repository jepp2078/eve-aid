/**
 * Start combat: who I attack, whose home system the battle is in (if anyone's), who controls the
 * system (defaults to the home owner) and how many citadels are there (defaults to the home owner's home citadels).
 * Opened from the Combat tab and from the Panel's Move follow-ups. Rivals with no ships on the board are left out,
 * with a line saying so. A light game keeps no fleets or structures: every rival may be attacked, and the citadels are
 * counted on the board. The engine previews `combatStart` (it must be my turn, with no other combat on), and Confirm
 * is named after the consequence: "Attack Caldari".
 *
 * Mounted once by TabShell (always mounted; only opens and closes), so its draft survives live updates; the draft is
 * also kept in sessionStorage and reset after a successful start.
 */
import type { FactionId } from '../../../data/types';
import { BottomSheet } from '../../components/BottomSheet';
import { RulesLink } from '../../components/RulesLink';
import { Stepper } from '../../components/Stepper';
import { useCommand, useMe } from '../../hooks';
import { FactionGlyph, Icon } from '../../icons';
import { EMPTY_START, pickController, pickHome, sanitizeStart, shiplessText, startCommand, startPlan, whereText, type StartDraft } from '../../lib/combat';
import { factionName } from '../../lib/labels';
import { seatedFactions } from '../../lib/table';
import { Tiles, usePreview, useSheetDraft, type Option } from '../panel/ActionSheet';
import { CombatPreview } from './CombatParts';

export interface StartCombatSheetProps {
  open: boolean;
  onClose: () => void;
  /** The combat started (switch to the Combat tab). */
  onStarted: () => void;
}

const NOBODY = 'nobody';
type Choice = FactionId | typeof NOBODY;

export function StartCombatSheet({ open, onClose, onStarted }: StartCombatSheetProps) {
  const { game, faction } = useMe();
  const [draft, setDraft, reset] = useSheetDraft<StartDraft>('combat-start', EMPTY_START, sanitizeStart);
  const { run, disabled } = useCommand();
  const plan = game !== null && faction !== null ? startPlan(game, faction, draft) : null;
  const cmd = plan === null ? null : startCommand(plan);
  const preview = usePreview(open ? cmd : null);

  if (game === null || faction === null || plan === null) return null;
  const seated = seatedFactions(game);
  const factionOption = (f: FactionId, note?: string): Option<Choice> => ({
    value: f,
    label: factionName(f),
    icon: <FactionGlyph faction={f} size="1.25rem" />,
    note: note ?? (f === faction ? 'You' : game.players[f]?.name),
  });
  const nobody = (note: string): Option<Choice> => ({ value: NOBODY, label: 'Nobody', icon: <Icon name="close" size="1.25rem" />, note });

  const defenderOptions = plan.rivals.map((f) => factionOption(f));
  const shipless = shiplessText(plan.shipless);
  const homeOptions = [nobody('Open space'), ...seated.map((f) => factionOption(f))];
  // The engine reads "no controller" as "the home owner", so a home system always has a controller.
  const controllerOptions = [...(plan.homeOf === null ? [nobody('No citadels')] : []), ...seated.map((f) => factionOption(f, f === plan.homeOf ? 'Home owner' : undefined))];
  const owner = plan.controller === null ? null : (game.players[plan.controller] ?? null);
  const citadels = (n: number) => `${n} ${n === 1 ? 'citadel' : 'citadels'}`;
  const citadelNote =
    owner === null || plan.controller === null
      ? 'Only a controlled system has citadels'
      : game.mode === 'light'
        ? 'Count them on the board'
        : plan.controller === plan.homeOf
          ? `${factionName(plan.controller)} has ${citadels(owner.homeCitadels)} at home`
          : `${factionName(plan.controller)} has ${citadels(owner.structures.citadel)} on the board`;

  // The tiles always show what will be sent: `plan` resolves "follow the home owner" (and a missing controller in a
  // home system, as the engine does).
  const setHome = (v: Choice) => setDraft((d) => pickHome(d, v === NOBODY ? null : v));
  const setController = (v: Choice) => setDraft((d) => pickController(d, v === NOBODY ? null : v));

  const confirm = async () => {
    if (cmd === null || preview === null || !preview.ok || plan.defender === null) return;
    const ok = await run(cmd, { label: `Combat started: ${factionName(faction)} attacks ${factionName(plan.defender)}` });
    if (ok) {
      reset();
      onStarted();
    }
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title={
        <span className="as-title">
          <span className="as-name">
            <Icon name="combat" size="1.25rem" />
            Start combat
          </span>
        </span>
      }
      headerExtra={<RulesLink section="combat" />}
      footer={
        <div className="as-footer">
          <CombatPreview
            preview={preview}
            hint="Choose who you attack"
            ok={plan.defender === null ? '' : `${factionName(faction)} attacks ${factionName(plan.defender)} · ${whereText(plan)}`}
          />
          <button
            type="button"
            className="btn btn-primary btn-lg btn-block"
            disabled={disabled || cmd === null || preview === null || !preview.ok}
            onClick={() => void confirm()}
          >
            <Icon name="combat" />
            {plan.defender === null ? 'Attack' : `Attack ${factionName(plan.defender)}`}
          </button>
        </div>
      }
    >
      <div className="as-body">
        <p className="muted small">Your fleet entered a system with enemy ships. Set up the battle; both of you then place every ship you have in this system, you first.</p>
        <h3 className="sub-title">Who do you attack?</h3>
        <Tiles<Choice> label="Defender" options={defenderOptions} value={plan.defender} onChange={(v) => v !== NOBODY && setDraft((d) => ({ ...d, defender: v }))} columns={2} layout="row" />
        {shipless !== null && (
          <p className="hint-line">
            <Icon name="info" size="1.1rem" />
            <span>{shipless}</span>
          </p>
        )}
        <h3 className="sub-title">Whose home system is it?</h3>
        <Tiles<Choice> label="Home system of" options={homeOptions} value={plan.homeOf ?? NOBODY} onChange={setHome} columns={2} layout="row" />
        <h3 className="sub-title">Who controls the system?</h3>
        <Tiles<Choice> label="System controller" options={controllerOptions} value={plan.controller ?? NOBODY} onChange={setController} columns={2} layout="row" />
        {plan.homeOf !== null && <p className="muted small">A home system is controlled by its owner unless you pick someone else.</p>}
        <div className="step-row">
          <span className="step-row-label">
            <Icon name="structure" size="1.25rem" />
            <span className="step-row-text">
              <span>Citadels in the system</span>
              <span className="step-row-note">{citadelNote}</span>
            </span>
          </span>
          <Stepper
            label="Citadels in the system"
            hideLabel
            value={plan.citadels}
            onChange={(v) => setDraft((d) => ({ ...d, citadels: v }))}
            max={plan.citadelMax}
            disabled={plan.controller === null}
          />
        </div>
        <p className="notice notice-info">
          <Icon name="reference" size="1.25rem" />
          <span>Both players choose a strategy card face down before placing their fleets.</span>
        </p>
      </div>
    </BottomSheet>
  );
}
