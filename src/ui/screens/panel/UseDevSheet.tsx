/**
 * Using a completed development (free, once per round): the card's text, then what the card asks for, with the live
 * before→after preview from the engine and a Confirm named after the consequence ("Use Galactic Trust Fund · +2 ISK").
 *
 * Per card: Mineral Market (give / get), Trade Contracts and Manufacturing Hub (one operation, the same rows as the
 * Trade and Manufacture sheets), Asteroid Mining (a mineral I have a belt of), Extracting Crew (planetary or moon),
 * Dirty Politics (whom to pay 5 ISK and take 1 VP from), Research Spy (a card another player completed that I
 * haven't, and that isn't in my area), the tactics and Strategic Reposition (an optional planetary or moon payment
 * for the stronger effect), Guerilla Warfare (the planetary or moon payment is its whole Use, so it is required).
 * Cards that need nothing just confirm.
 *
 * In a light game the board keeps the resources: every card just confirms (the app marks it used and puts the step
 * on the player's checklist), except Research Spy (a card) and Dirty Politics (a player).
 */
import type { RefId } from '../../../data/reference';
import { DEV, dev as devById } from '../../../data/developments';
import { BASIC_MINERALS, MINERALS, type BasicMineral, type DevId, type FactionId, type Material } from '../../../data/types';
import type { Command, GameMode } from '../../../engine/types';
import { DevCard } from '../../components/DevCard';
import { FactionBadge } from '../../components/FactionBadge';
import { MineralPicker } from '../../components/MineralPicker';
import { radioKeys, tabStop } from '../../components/radio';
import { useMe } from '../../hooks';
import { Icon, ResourceIcon, type IconName } from '../../icons';
import { EMPTY_USE, marketPick, sanitizeUse, spyTargets, useKind, useParams, type UseDraft } from '../../lib/devs';
import { RESOURCE_LABEL } from '../../lib/labels';
import { tradeOpIsk } from '../../lib/ops';
import { ActionSheet, Segmented, Tiles, useSheetDraft, type Option } from './ActionSheet';
import { DevPicker } from './DevPicker';
import { ManufactureOpRow } from './ManufactureSheet';
import { TradeOpRow } from './TradeSheet';

const MATERIALS: Material[] = ['planetary', 'moon'];

function sectionOf(id: DevId): RefId {
  if (id === DEV.tradeContracts) return 'trade';
  if (id === DEV.manufacturingHub) return 'manufacture';
  return devById(id).category === 'combat' ? 'combat' : 'research';
}

function iconOf(id: DevId): IconName {
  if (id === DEV.tradeContracts) return 'trade';
  if (id === DEV.manufacturingHub) return 'manufacture';
  return 'devCard';
}

/** The uncapped ISK change, so the preview can name ISK lost to the 49 cap (none in a light game: no ISK is kept). */
function iskNetOf(id: DevId, d: UseDraft, mode: GameMode): number | null {
  if (mode === 'light') return null;
  if (id === DEV.tradeContracts) return tradeOpIsk(d.trade);
  if (id === DEV.galacticTrustFund) return 2;
  return null;
}

export function UseDevSheet({ open, onClose, dev }: { open: boolean; onClose: () => void; dev: DevId | null }) {
  const { game, faction, me, priv } = useMe();
  const [stored, setDraft, reset] = useSheetDraft<UseDraft>('use', EMPTY_USE, sanitizeUse);
  if (dev === null || game === null || faction === null || me === null) return null;
  // Mineral Market never offers a mineral I don't hold as the one to give (the stored default is pyrite).
  const draft = { ...stored, ...marketPick(stored, me.res) };

  const d = devById(dev);
  const kind = useKind(dev, game.mode);
  const light = game.mode === 'light';
  const params = kind === null ? null : useParams(kind, draft);
  const mustPay = dev === DEV.guerillaWarfare;
  const unpaid = mustPay && params !== null && params.kind === 'payMaterial' && params.material === null;
  const cmd: Command | null = params === null || unpaid ? null : { type: 'useDev', dev, params };
  const set = (patch: Partial<UseDraft>) => setDraft((x) => ({ ...x, ...patch }));

  let body = null;
  let hint = kind === 'payMaterial' && mustPay ? 'Choose what to spend' : 'Make a choice above';
  switch (kind) {
    case 'mineralMarket': {
      const opts = (disable: (m: BasicMineral) => boolean): Option<BasicMineral>[] =>
        BASIC_MINERALS.map((m) => ({ value: m, label: RESOURCE_LABEL[m], icon: <ResourceIcon kind={m} title={null} size="1.5rem" />, note: `Have ${me.res[m]}`, disabled: disable(m) }));
      body = (
        <>
          <h3 className="sub-title">Give 1</h3>
          <Tiles
            label="Mineral to give"
            options={opts((m) => me.res[m] < 1)}
            value={draft.from}
            onChange={(from) => set({ from, to: draft.to === from ? BASIC_MINERALS.find((m) => m !== from)! : draft.to })}
            columns={3}
          />
          <h3 className="sub-title">Get 1</h3>
          <Tiles label="Mineral to get" options={opts((m) => m === draft.from)} value={draft.to} onChange={(to) => set({ to })} columns={3} />
        </>
      );
      break;
    }
    case 'trade':
      body = <TradeOpRow op={draft.trade} index={0} onChange={(trade) => set({ trade })} />;
      break;
    case 'manufacture':
      body = <ManufactureOpRow op={draft.manufacture} index={0} onChange={(manufacture) => set({ manufacture })} />;
      break;
    case 'mineral': {
      const belts = MINERALS.filter((m) => me.belts[m] > 0);
      hint = belts.length === 0 ? 'You have no asteroid belts' : 'Choose the mineral';
      body =
        belts.length === 0 ? (
          <p className="notice notice-info">
            <Icon name="info" size="1.25rem" />
            <span>You need an asteroid belt: this gives 1 mineral of a colour you have a belt of.</span>
          </p>
        ) : (
          <>
            <h3 className="sub-title">A mineral you have a belt of</h3>
            <MineralPicker
              label="Mineral"
              options={belts}
              value={draft.mineral !== null && belts.includes(draft.mineral) ? draft.mineral : null}
              onChange={(mineral) => set({ mineral })}
              note={(m) => `${me.belts[m]} ${me.belts[m] === 1 ? 'belt' : 'belts'} · have ${me.res[m]}`}
            />
          </>
        );
      break;
    }
    case 'material':
      body = (
        <Tiles
          label="Material"
          options={MATERIALS.map((m) => ({ value: m, label: RESOURCE_LABEL[m], icon: <ResourceIcon kind={m} title={null} size="1.5rem" />, note: `Have ${me.res[m]}` }))}
          value={draft.material}
          onChange={(material) => set({ material })}
          columns={2}
        />
      );
      break;
    case 'target': {
      const rivals = game.seats.filter((f) => f !== faction);
      const enabled = (f: FactionId) => (game.players[f]?.vp ?? 0) > 0;
      hint = 'Choose a player';
      body = (
        <>
          <h3 className="sub-title" id="use-target">
            Pay 5 ISK to, and take 1 VP from
          </h3>
          <div className="pick-list" role="radiogroup" aria-labelledby="use-target" onKeyDown={radioKeys(rivals, draft.target, (target) => set({ target }), enabled)}>
            {rivals.map((f) => {
              const p = game.players[f];
              const on = draft.target === f;
              return (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  data-value={f}
                  tabIndex={tabStop(rivals, draft.target, f, enabled)}
                  disabled={!enabled(f)}
                  className={on ? 'pick is-selected' : 'pick'}
                  onClick={() => set({ target: f })}
                >
                  <span className="pick-main">
                    <FactionBadge faction={f} player={p?.name} />
                  </span>
                  <span className="pick-note num">{(p?.vp ?? 0) > 0 ? `${p?.vp} VP` : 'No VP'}</span>
                  {on && <Icon name="check" size="1.1rem" className="pick-check" />}
                </button>
              );
            })}
          </div>
        </>
      );
      break;
    }
    case 'dev': {
      const targets = spyTargets(game, faction, priv?.area ?? []);
      hint = targets.length === 0 ? 'Nothing to copy yet' : 'Choose the card to complete';
      body =
        targets.length === 0 ? (
          <p className="notice notice-info">
            <Icon name="info" size="1.25rem" />
            <span>No other player has completed a card you could take: one you haven’t completed and that isn’t in your area.</span>
          </p>
        ) : (
          <>
            <h3 className="sub-title">Complete a card another player has completed</h3>
            <p className="small muted">Research Spy is discarded; the card you choose becomes yours, completed.</p>
            <DevPicker
              devs={targets}
              value={draft.dev !== null && targets.some((t) => t.id === draft.dev) ? draft.dev : null}
              onChange={(id) => set({ dev: id })}
              label="Category"
              blocked={(t) => (t.prerequisite !== null && !me.completed.includes(t.prerequisite) ? `Needs ${devById(t.prerequisite).name} completed first` : null)}
            />
          </>
        );
      break;
    }
    case 'payMaterial':
      body = (
        <>
          <h3 className="sub-title">{mustPay ? 'Spend 1 planetary or moon material for +1 strength' : 'Pay for the stronger effect (optional)'}</h3>
          <Segmented<'none' | Material>
            label="Payment"
            options={[
              ...(mustPay ? [] : [{ value: 'none' as const, label: 'No payment' }]),
              ...MATERIALS.map((m) => ({ value: m, label: `${RESOURCE_LABEL[m]} (${me.res[m]})`, icon: <ResourceIcon kind={m} title={null} size="1.1rem" />, disabled: me.res[m] < 1 })),
            ]}
            // A required payment starts with nothing chosen (no radio on).
            value={(draft.pay ?? (mustPay ? '' : 'none')) as 'none' | Material}
            onChange={(v) => set({ pay: v === 'none' ? null : v })}
          />
          <p className="small muted">The app taps the card and takes the payment; apply the effect at the table.</p>
        </>
      );
      break;
    case 'none':
      if (light) body = <p className="small muted">The app marks the card used this round; anything to do on the board goes on your checklist.</p>;
      break;
    default:
      break;
  }

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Use a development"
      icon={iconOf(dev)}
      section={sectionOf(dev)}
      size={kind === 'none' || kind === 'material' || kind === 'payMaterial' ? 'auto' : 'full'}
      command={cmd}
      iskNet={iskNetOf(dev, draft, game.mode)}
      head={kind === 'dev' && params !== null && params.kind === 'dev' ? `Use ${d.name}: complete ${devById(params.dev).name}` : `Use ${d.name}`}
      hint={hint}
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <DevCard dev={d} headingLevel={3} viewCard />
      {body}
    </ActionSheet>
  );
}
