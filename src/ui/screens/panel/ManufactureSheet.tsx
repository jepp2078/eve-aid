/**
 * Manufacture: up to three conversions, each a row with the output and, where the recipe offers it, the payment
 * (basic minerals or morphite), plus the recipe line ("2 Mexallon → 1 Component"). Research made here must be
 * placed at once (Task 13b's overlay); a card is a notice to draw one. `ManufactureOpRow` is reused by the
 * Manufacturing Hub development (Task 13b).
 */
import type { ManufactureOutput } from '../../../data/costs';
import type { ManufactureOp } from '../../../engine/types';
import { useMe } from '../../hooks';
import { Icon, ResourceIcon } from '../../icons';
import { cubeCostLabel } from '../../lib/actions';
import { MANUFACTURE_OUTPUTS, manufactureOpText, MAX_OPS, newManufactureOp, OUTPUT_LABEL, payOptions, sanitizeManufactureOps, setManufactureOutput } from '../../lib/ops';
import { ActionSheet, Segmented, Tiles, useSheetDraft, type Option } from './ActionSheet';
import type { OpRowProps } from './TradeSheet';

const FIRST: ManufactureOp[] = [newManufactureOp()];

const OUTPUT_OPTIONS: Option<ManufactureOutput>[] = MANUFACTURE_OUTPUTS.map((o) => ({
  value: o,
  label: o === 'card' ? 'Card' : OUTPUT_LABEL[o],
  icon:
    o === 'research' ? (
      <Icon name="research" size="1.5rem" />
    ) : o === 'card' ? (
      <Icon name="reference" size="1.5rem" />
    ) : (
      <ResourceIcon kind={o} title={null} size="1.5rem" />
    ),
  note: o === 'research' ? '×2' : undefined,
}));

/** One manufacture operation: output, payment where there is a choice, and the recipe line. */
export function ManufactureOpRow({ op, index, onChange, onRemove }: OpRowProps<ManufactureOp>) {
  const pays = payOptions(op.output);
  return (
    <fieldset className="op-row">
      <legend className="op-legend">
        <span>Operation {index + 1}</span>
      </legend>
      {onRemove !== undefined && (
        <button type="button" className="icon-btn op-remove" onClick={onRemove} aria-label={`Remove operation ${index + 1}`}>
          <Icon name="close" size="1.25rem" />
        </button>
      )}
      <Tiles label={`Operation ${index + 1}: what to make`} options={OUTPUT_OPTIONS} value={op.output} onChange={(o) => onChange(setManufactureOutput(op, o))} columns={3} />
      {pays.length > 1 && (
        <Segmented
          label={`Operation ${index + 1}: pay with`}
          options={[
            { value: 'basic', label: 'Basic minerals' },
            { value: 'morphite', label: 'Morphite', icon: <ResourceIcon kind="morphite" title={null} size="1.1rem" /> },
          ]}
          value={op.pay}
          onChange={(pay) => onChange({ ...op, pay })}
        />
      )}
      <p className="op-line num">{manufactureOpText(op)}</p>
    </fieldset>
  );
}

export function ManufactureSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useMe();
  const [ops, setOps, reset] = useSheetDraft<ManufactureOp[]>('manufacture', FIRST, sanitizeManufactureOps);
  const head = ops.length === 1 ? `Make ${OUTPUT_LABEL[ops[0]!.output].toLowerCase().replace(/^vp$/, 'VP')}` : `Manufacture ${ops.length} operations`;

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Manufacture"
      icon="manufacture"
      cube={me === null ? null : cubeCostLabel(me.cubesUsed)}
      section="manufacture"
      size="full"
      command={{ type: 'action', action: 'manufacture', ops }}
      head={head}
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <p className="muted small">Up to {MAX_OPS} operations, in order; the same one may repeat. Research you make is placed right away.</p>
      {ops.map((op, i) => (
        <ManufactureOpRow
          key={i}
          op={op}
          index={i}
          onChange={(next) => setOps((all) => all.map((o, j) => (j === i ? next : o)))}
          onRemove={ops.length > 1 ? () => setOps((all) => all.filter((_, j) => j !== i)) : undefined}
        />
      ))}
      {ops.length < MAX_OPS && (
        <button type="button" className="btn btn-secondary btn-block" onClick={() => setOps((all) => [...all, newManufactureOp()])}>
          <Icon name="plus" />
          Add operation ({ops.length + 1} of {MAX_OPS})
        </button>
      )}
    </ActionSheet>
  );
}
