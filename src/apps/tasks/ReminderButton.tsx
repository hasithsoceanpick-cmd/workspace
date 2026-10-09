import { useEffect, useRef, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import { go } from '../../lib/route';
import { ReminderForm, ReminderItem, useReminders } from './Reminders';
import { isDue } from './reminders';

/**
 * Top-bar button for quick reminders (shown to people who have the Tasks app).
 * Also nudges the database to send any reminder that's due, in case its every-minute job isn't running.
 */
export default function ReminderButton() {
  const { me, refreshNotices } = usePlatform();
  const { list, reload } = useReminders();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const { data } = await supabase.rpc('task_reminders_due');
      if (Number(data) > 0) { refreshNotices(); reload(); }
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, [refreshNotices, reload]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  const mine = (list ?? []).filter(r => r.user_id === me.id && !r.done_at);
  const due = mine.filter(isDue);
  const next = [...due, ...mine.filter(r => !isDue(r))].slice(0, 5);

  return (
    <div className="rem-btn" ref={ref}>
      <button className={`icon-btn ${open ? 'on' : ''}`} onClick={() => setOpen(o => !o)} aria-label="Reminders" title="Reminders">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2" /><path d="M5 3 2 6" /><path d="m22 6-3-3" />
        </svg>
        {due.length > 0 && <span className="dot-count">{due.length}</span>}
      </button>
      {open && (
        <div className="popover rem-pop">
          <div className="pop-head"><strong>Reminders</strong>
            <button className="link" onClick={() => { setOpen(false); go('tasks', 'reminders'); }}>All reminders</button>
          </div>
          <div className="pop-body">
            <ReminderForm />
            {next.length > 0 ? (
              <ul className="rem-list">{next.map(r => <ReminderItem key={r.id} r={r} compact />)}</ul>
            ) : <div className="muted small pad">Nothing coming up.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
