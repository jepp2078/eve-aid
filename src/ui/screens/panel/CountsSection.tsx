/**
 * "Board counts", collapsed by default: systems, the central system, structures by type, home citadels, belts by
 * mineral, locked home belts and ships by name. "Correct counts" opens a sheet with steppers on a local draft of
 * changes; saving sends one `adjust` with `correction: true` (logged, no Lobbyist).
 */
import { useState, type ReactNode } from 'react';
import { shipsOf } from '../../../data/ships';
import { ShipName } from '../../components/CardName';
import { CardPhotoButton } from '../../components/CardPhoto';
import { MINERALS, type StructureType } from '../../../data/types';
import type { PlayerPublic } from '../../../engine/types';
import { useMe } from '../../hooks';
import { Icon, ResourceIcon } from '../../icons';
import { countsCommand, countsEdits, emptyCounts, sanitizeCounts, type CountsDraft } from '../../lib/adjust';
import { centralWords, RESOURCE_LABEL, STRUCTURE_LABEL } from '../../lib/labels';
import { ActionSheet, StepRow, Toggle, useSheetDraft } from './ActionSheet';
import { STRUCTURES } from '../../lib/build';

const NO_EDITS = emptyCounts();

function Row({ label, value }: { label: ReactNode; value: string | number }) {
  return (
    <div className="count-row">
      <dt>{label}</dt>
      <dd className="num">{value}</dd>
    </div>
  );
}

function CountsSheet({ open, onClose, me, seats }: { open: boolean; onClose: () => void; me: PlayerPublic; seats: number }) {
  const [d, setD, reset] = useSheetDraft<CountsDraft>('counts', NO_EDITS, sanitizeCounts);
  const n = countsEdits(d);
  const field = (key: 'systems' | 'homeCitadels' | 'lockedHomeBelts', label: string, max?: number) => (
    <StepRow
      label={label}
      value={me[key] + d[key]}
      min={0}
      max={max}
      onChange={(v) => setD((x) => ({ ...x, [key]: v - me[key] }))}
      note={d[key] !== 0 ? `was ${me[key]}` : null}
    />
  );
  const central = d.central ?? me.central;
  const words = centralWords(seats);

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Correct board counts"
      icon="edit"
      section="claim"
      size="full"
      command={countsCommand(d)}
      head={n === 1 ? 'Save 1 correction' : `Save ${n} corrections`}
      done={n === 1 ? 'Corrected 1 board count' : `Corrected ${n} board counts`}
      hint="Match the counts to the board"
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <p className="muted small">Make the app match the board. Saved as a correction: logged for everyone, no Lobbyist.</p>
      <h3 className="sub-title">Control</h3>
      <div className="step-list">{field('systems', 'Systems (not home)')}</div>
      <Toggle label={words.name} note={central ? words.held : words.notHeld} checked={central} onChange={(on) => setD((x) => ({ ...x, central: on === me.central ? null : on }))} />
      <h3 className="sub-title">Structures</h3>
      <div className="step-list">
        {STRUCTURES.map((s: StructureType) => (
          <StepRow
            key={s}
            label={STRUCTURE_LABEL[s]}
            value={me.structures[s] + d.structures[s]}
            onChange={(v) => setD((x) => ({ ...x, structures: { ...x.structures, [s]: v - me.structures[s] } }))}
            max={13}
            note={d.structures[s] !== 0 ? `was ${me.structures[s]}` : null}
          />
        ))}
        {field('homeCitadels', 'Home citadels')}
      </div>
      <h3 className="sub-title">Asteroid belts</h3>
      <div className="step-list">
        {MINERALS.map((m) => (
          <StepRow
            key={m}
            label={`${RESOURCE_LABEL[m]} belts`}
            icon={<ResourceIcon kind={m} title={null} size="1.25rem" />}
            value={me.belts[m] + d.belts[m]}
            onChange={(v) => setD((x) => ({ ...x, belts: { ...x.belts, [m]: v - me.belts[m] } }))}
            note={d.belts[m] !== 0 ? `was ${me.belts[m]}` : null}
          />
        ))}
        {field('lockedHomeBelts', 'Locked home belts', 2)}
      </div>
      <h3 className="sub-title">Ships on the board</h3>
      <div className="step-list">
        {shipsOf(me.faction).map((s) => {
          const owned = me.ships[s.id] ?? 0;
          const delta = d.ships[s.id] ?? 0;
          return (
            <StepRow
              key={s.id}
              label={s.name}
              value={owned + delta}
              max={s.qty}
              onChange={(v) =>
                setD((x) => {
                  const ships = { ...x.ships, [s.id]: v - owned };
                  if (ships[s.id] === 0) delete ships[s.id];
                  return { ...x, ships };
                })
              }
              note={delta !== 0 ? `was ${owned}` : `of ${s.qty}`}
            />
          );
        })}
      </div>
      {n > 0 && (
        <button type="button" className="btn-link" onClick={reset}>
          Discard these corrections
        </button>
      )}
    </ActionSheet>
  );
}

export function CountsSection() {
  const { game, me } = useMe();
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  if (me === null) return null;
  const seats = game?.seats.length ?? 0;
  const ships = shipsOf(me.faction).filter((s) => (me.ships[s.id] ?? 0) > 0);
  const structures = STRUCTURES.filter((s) => me.structures[s] > 0);
  const belts = MINERALS.filter((m) => me.belts[m] > 0);

  return (
    <section className="counts" aria-labelledby="counts-title">
      <h2 className="counts-heading">
        <button type="button" id="counts-title" className="counts-toggle" aria-expanded={open} aria-controls="counts-body" onClick={() => setOpen(!open)}>
          <span>Board counts</span>
          <span className="counts-summary num">
            {me.systems} {me.systems === 1 ? 'system' : 'systems'} · {Object.values(me.ships).reduce((a, b) => a + b, 0)} ships
          </span>
          <Icon name={open ? 'chevronUp' : 'chevronDown'} size="1.25rem" />
        </button>
      </h2>
      {open && (
        <div id="counts-body" className="counts-body">
          <dl className="count-list">
            <Row label="Systems (not home)" value={me.systems} />
            <Row label={centralWords(seats).name} value={me.central ? 'Yours' : 'No'} />
            {structures.length === 0 ? (
              <Row label="Structures" value="None" />
            ) : (
              structures.map((s) => <Row key={s} label={STRUCTURE_LABEL[s]} value={s === 'citadel' && me.homeCitadels > 0 ? `${me.structures[s]} (${me.homeCitadels} at home)` : me.structures[s]} />)
            )}
            <Row label="Belts" value={belts.length === 0 ? 'None' : belts.map((m) => `${RESOURCE_LABEL[m]} ${me.belts[m]}`).join(' · ')} />
            <Row label="Locked home belts" value={me.lockedHomeBelts} />
            {ships.map((s) => (
              <Row
                key={s.id}
                label={
                  <>
                    <ShipName ship={s} />
                    <CardPhotoButton card={{ kind: 'ship', ship: s }} />
                  </>
                }
                value={`×${me.ships[s.id]}`}
              />
            ))}
          </dl>
          <button type="button" className="btn btn-secondary btn-block" onClick={() => setSheet(true)}>
            <Icon name="edit" />
            Correct counts
          </button>
        </div>
      )}
      <CountsSheet open={sheet} onClose={() => setSheet(false)} me={me} seats={seats} />
    </section>
  );
}
