import { Icon } from '../icons';

export interface SnackbarAction {
  label: string;
  onAction: () => void;
}

/** "Built Caracal · Undo": what just happened, with one optional action. Rendered by the feedback host. */
export function Snackbar({ text, action, onDone }: { text: string; action: SnackbarAction | null; onDone?: () => void }) {
  return (
    <div className="snackbar">
      <Icon name="check" className="snackbar-icon" />
      <span className="snackbar-text">{text}</span>
      {action !== null && (
        <button
          type="button"
          className="snackbar-action"
          onClick={() => {
            onDone?.();
            action.onAction();
          }}
        >
          <Icon name="undo" size="1.25em" />
          {action.label}
        </button>
      )}
    </div>
  );
}
