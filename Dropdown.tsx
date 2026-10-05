import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface DropItem {
  key: string;
  label: ReactNode;
  hint?: ReactNode;
  active?: boolean;
  divider?: boolean;
  onSelect: () => void;
}

/** A small button that opens a list — used for the app and department switchers. */
export default function Dropdown({ label, items, title, className = '' }: {
  label: ReactNode; items: DropItem[]; title: string; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className={`dropdown ${className}`} ref={ref}>
      <button className={`switcher ${open ? 'on' : ''}`} onClick={() => setOpen(o => !o)} aria-haspopup="menu" aria-expanded={open} title={title}>
        <span className="switcher-label">{label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      {open && (
        <div className="popover drop-pop" role="menu">
          <div className="drop-title">{title}</div>
          {items.map(it => (
            <div key={it.key}>
              {it.divider && <div className="drop-divider" />}
              <button role="menuitem" className={`drop-item ${it.active ? 'active' : ''}`}
                onClick={() => { setOpen(false); it.onSelect(); }}>
                <span className="drop-label">{it.label}</span>
                {it.hint && <span className="drop-hint">{it.hint}</span>}
                {it.active && <span className="drop-check">✓</span>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
