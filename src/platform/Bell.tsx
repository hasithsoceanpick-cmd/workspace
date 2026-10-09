import { useEffect, useRef, useState } from 'react';
import { usePlatform } from './store';
import { ago } from '../lib/dates';
import type { Notice } from './types';
import { useOpenNotice } from './notices';

export default function Bell() {
  const { notices, unread, markRead, isAdmin, departments } = usePlatform();
  const openNotice = useOpenNotice();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  function click(n: Notice) {
    setOpen(false);
    openNotice(n);
  }

  const deptName = (id: string | null) => departments.find(d => d.id === id)?.name;
  const multi = isAdmin && departments.length > 1;

  return (
    <div className="bell" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen(o => !o)} aria-label="Notifications">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        {unread > 0 && <span className="dot-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="popover bell-pop">
          <div className="pop-head">
            <strong>Notifications</strong>
            {unread > 0 && <button className="link" onClick={() => markRead()}>Mark all read</button>}
          </div>
          <div className="pop-body">
            {notices.length === 0 && <div className="empty small">You're all caught up.</div>}
            {notices.map(n => (
              <button key={n.id} className={`notice-row ${n.read_at ? '' : 'unread'} k-${n.kind}`} onClick={() => click(n)}>
                <span className="n-dot" />
                <span className="n-body">
                  <span className="n-msg">{n.message}</span>
                  <span className="n-time">
                    {multi && deptName(n.department_id) && <span className="n-dept">{deptName(n.department_id)}</span>}
                    {ago(n.created_at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
