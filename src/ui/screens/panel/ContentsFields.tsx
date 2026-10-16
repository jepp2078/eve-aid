/**
 * Steppers for what a system holds (asteroid belts per mineral, structures by type): shared by Claim (what the claimed
 * system holds; it moves to me) and the upkeep (what enemy ships occupy; it pays nothing). Everything starts at 0, so
 * the quick path stays quick. `maxBelts` / `maxStructures` cap a stepper (what the rival or I actually have).
 */
import { MINERALS, type Mineral, type StructureType } from '../../../data/types';
import { ResourceIcon } from '../../icons';
import { RESOURCE_LABEL, STRUCTURE_LABEL } from '../../lib/labels';
import type { ContentsDraft } from '../../lib/ops';
import { StepRow } from './ActionSheet';

export function ContentsFields({
  value,
  onChange,
  structures,
  maxBelts,
  maxStructures,
  beltLabel = (m) => `${RESOURCE_LABEL[m]} belts`,
  structureLabel = (s) => STRUCTURE_LABEL[s],
}: {
  value: ContentsDraft;
  onChange: (next: ContentsDraft) => void;
  /** Which structure types to offer (none for belts only). */
  structures: StructureType[];
  maxBelts?: Partial<Record<Mineral, number>>;
  maxStructures?: Partial<Record<StructureType, number>>;
  beltLabel?: (m: Mineral) => string;
  structureLabel?: (s: StructureType) => string;
}) {
  return (
    <div className="step-list">
      {MINERALS.filter((m) => (maxBelts?.[m] ?? 99) > 0 || value.belts[m] > 0).map((m) => (
        <StepRow
          key={m}
          label={beltLabel(m)}
          icon={<ResourceIcon kind={m} title={null} size="1.25rem" />}
          value={value.belts[m]}
          max={Math.max(value.belts[m], maxBelts?.[m] ?? 9)}
          onChange={(v) => onChange({ ...value, belts: { ...value.belts, [m]: v } })}
        />
      ))}
      {structures
        .filter((s) => (maxStructures?.[s] ?? 99) > 0 || value.structures[s] > 0)
        .map((s) => (
          <StepRow
            key={s}
            label={structureLabel(s)}
            value={value.structures[s]}
            max={Math.max(value.structures[s], maxStructures?.[s] ?? 9)}
            onChange={(v) => onChange({ ...value, structures: { ...value.structures, [s]: v } })}
          />
        ))}
    </div>
  );
}
