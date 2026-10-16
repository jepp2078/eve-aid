/**
 * The header's overflow menu: a ⋮ button opening a short list of large items. Toggle items show their state with a
 * switch and a word. Closes on selection, Escape or a tap outside.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../icons';

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  onSelect: () => void;
  /** A toggle item: true/false shows On/Off. */
  checked?: boolean;
  disabled?: boolean;
  /** A short second line (e.g. why an item is unavailable). */
  note?: string;
}

export function Menu({ items, label = 'Menu' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current !== null && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    listRef.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const els = [...(listRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not([disabled])') ?? [])];
    const at = els.indexOf(document.activeElement as HTMLElement);
    els[(at + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
  };

  return (
    <div className="menu" ref={rootRef} onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu-list" role="menu" id={id} ref={listRef} aria-label={label}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
              aria-checked={item.checked}
              className="menu-item"
              disabled={item.disabled}
              tabIndex={-1}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon !== undefined && <Icon name={item.icon} size="1.25rem" />}
              <span className="menu-item-text">
                <span>{item.label}</span>
                {item.note !== undefined && <span className="menu-item-note">{item.note}</span>}
              </span>
              {item.checked !== undefined && (
                <span className={item.checked ? 'switch is-on' : 'switch'} aria-hidden="true">
                  <span className="switch-word">{item.checked ? 'On' : 'Off'}</span>
                  <span className="switch-knob" />
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
