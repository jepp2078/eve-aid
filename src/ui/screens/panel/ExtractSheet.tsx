/** Extract: take one planetary and/or one moon material, as printed on the system. */
import type { Command } from '../../../engine/types';
import { useMe } from '../../hooks';
import { Icon, ResourceIcon } from '../../icons';
import { cubeCostLabel } from '../../lib/actions';
import { isRecord } from '../../lib/drafts';
import { ActionSheet, useSheetDraft } from './ActionSheet';

interface ExtractDraft {
  planetary: boolean;
  moon: boolean;
}
const NOTHING: ExtractDraft = { planetary: false, moon: false };

function sanitizeExtract(raw: unknown): ExtractDraft | null {
  return isRecord(raw) ? { planetary: raw.planetary === true, moon: raw.moon === true } : null;
}

export function ExtractSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useMe();
  const [draft, setDraft, reset] = useSheetDraft('extract', NOTHING, sanitizeExtract);
  const any = draft.planetary || draft.moon;
  const cmd: Command | null = any ? { type: 'action', action: 'extract', planetary: draft.planetary, moon: draft.moon } : null;
  const what = draft.planetary && draft.moon ? 'both' : draft.planetary ? 'planetary' : 'moon';

  return (
    <ActionSheet
      open={open}
      onClose={onClose}
      title="Extract"
      icon="extract"
      cube={me === null ? null : cubeCostLabel(me.cubesUsed)}
      section="extract"
      command={cmd}
      head={any ? `Extract ${what}` : 'Extract'}
      hint="Pick what the system shows"
      onDone={(ok) => {
        if (!ok) return;
        reset();
        onClose();
      }}
    >
      <p className="muted small">Choose a system you control; take one of each material printed on it.</p>
      <div className="tiles tiles-2" role="group" aria-label="Materials to extract">
        {(['planetary', 'moon'] as const).map((k) => (
          <button
            key={k}
            type="button"
            role="checkbox"
            aria-checked={draft[k]}
            className={draft[k] ? 'tile tile-lg is-selected' : 'tile tile-lg'}
            onClick={() => setDraft((d) => ({ ...d, [k]: !d[k] }))}
          >
            <ResourceIcon kind={k} title={null} size="2rem" />
            <span className="tile-name">{k === 'planetary' ? 'Planetary material' : 'Moon material'}</span>
            <span className="tile-note">{draft[k] ? 'Taking +1' : 'Not taking'}</span>
            {draft[k] && (
              <span className="tile-check" aria-hidden="true">
                <Icon name="check" size="1.1rem" />
              </span>
            )}
          </button>
        ))}
      </div>
    </ActionSheet>
  );
}
