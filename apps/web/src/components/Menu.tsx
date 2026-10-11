// Disclosure menu (button + popover list). Esc / outside click closes; focus returns to the trigger.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export interface MenuProps {
  /** Contents of the trigger button. */
  trigger: ReactNode;
  /** Accessible name of the trigger (required when the trigger is icon-only). */
  label: string;
  triggerClassName?: string;
  align?: 'start' | 'end';
  children: (close: () => void) => ReactNode;
}

export function Menu({ trigger, label, triggerClassName, align = 'end', children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    const first = wrap.current?.querySelector<HTMLElement>('.menu-popover a, .menu-popover button');
    first?.focus();
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };

  return (
    <div className="menu" ref={wrap}>
      <button
        ref={btn}
        type="button"
        className={triggerClassName ?? 'header-btn'}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        {trigger}
      </button>
      {open ? (
        <div id={id} className={`menu-popover menu-${align}`}>
          {children(close)}
        </div>
      ) : null}
    </div>
  );
}
