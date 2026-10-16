/** Pick one mineral from large tiles (crystal shape + card colour + name); a radio group with arrow keys. */
import { MINERALS, type Mineral } from '../../data/types';
import { Icon, ResourceIcon } from '../icons';
import { RESOURCE_LABEL } from '../lib/labels';
import { radioKeys, tabStop } from './radio';

export interface MineralPickerProps {
  value: Mineral | null;
  onChange: (m: Mineral) => void;
  /** Accessible name of the group. */
  label: string;
  options?: readonly Mineral[];
  /** A short line under each name (e.g. "+1 now"). */
  note?: (m: Mineral) => string | null;
  disabled?: boolean;
}

export function MineralPicker({ value, onChange, label, options = MINERALS, note, disabled = false }: MineralPickerProps) {
  const enabled = () => !disabled;
  return (
    <div className="mineral-picker" role="radiogroup" aria-label={label} onKeyDown={radioKeys(options, value, onChange, enabled)}>
      {options.map((m) => {
        const checked = value === m;
        const line = note?.(m) ?? null;
        return (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={checked}
            data-value={m}
            tabIndex={tabStop(options, value, m, enabled)}
            disabled={disabled}
            className={checked ? 'mineral-tile is-selected' : 'mineral-tile'}
            onClick={() => onChange(m)}
          >
            <ResourceIcon kind={m} title={null} size="2.25rem" />
            <span className="mineral-name">{RESOURCE_LABEL[m]}</span>
            {line !== null && <span className="mineral-note small muted">{line}</span>}
            {checked && (
              <span className="tile-check" aria-hidden="true">
                <Icon name="check" size="1.1rem" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
