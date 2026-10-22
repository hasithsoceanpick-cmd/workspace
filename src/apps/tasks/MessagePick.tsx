import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../supabase';
import { usePlatform } from '../../platform/store';
import type { WorkPickProps } from '../../platform/slots';
import { fmtDue, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { finished, statusLabel } from './labels';
import { fmtWhen, loadReminders } from './reminders';
import type { Reminder } from './types';

interface Row { id: number; title: string; sub: string; for_id: string | null; remind_at?: string; late?: boolean }

/** Messages → Attach → Task / Reminder: pick one of yours to show as a card in the message. */
export default function MessagePick({ kind, onPick, onCancel }: WorkPickProps) {
  const { me, dept, person, fail } = usePlatform();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [q, setQ] = useState('');
  const who = (id: string | null) => (id === me.id ? 'You' : firstName(person(id)?.full_name ?? ''));

  useEffect(() => {
    (async () => {
      try {
        if (kind === 'task') {
          const { data, error } = await supabase.from('tasks').select('id,title,status,due_date,assignee_id')
            .eq('department_id', dept!.id).neq('status', 'done').order('due_date').limit(400);
          if (error) throw error;
          const td = today();
          setRows(((data ?? []) as { id: number; title: string; status: string; due_date: string; assignee_id: string }[]).map(t => ({
            id: t.id, title: t.title, for_id: t.assignee_id, late: !finished(t) && t.due_date < td,
            sub: `${who(t.assignee_id)} · due ${fmtDue(t.due_date)}${t.status === 'review' ? ` · ${statusLabel(t.status)}` : ''}`,
          })));
        } else {
          const list = (await loadReminders()).filter((r: Reminder) => !r.done_at);
          setRows(list.map(r => ({ id: r.id, title: r.body, for_id: r.user_id, remind_at: r.remind_at, sub: `${r.user_id === me.id ? 'For you' : `For ${who(r.user_id)}`} · ${fmtWhen(r.remind_at)}` })));
        }
      } catch (e) { fail(e); setRows([]); }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, dept?.id]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (rows ?? []).filter(r => !t || r.title.toLowerCase().includes(t)).slice(0, 60);
  }, [rows, q]);

  const label = kind === 'task' ? 'task' : 'reminder';
  return (
    <>
      <div className="modal-backdrop" onClick={onCancel} />
      <div className="modal msg-pick" role="dialog" aria-label={`Attach a ${label}`}>
        <div className="modal-head">
          <strong>Attach a {label}</strong>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">✕</button>
        </div>
        <div className="modal-body">
          <input autoFocus placeholder={`Find a ${label}…`} value={q} onChange={e => setQ(e.target.value)} aria-label={`Find a ${label}`}
            onKeyDown={e => { if (e.key === 'Enter' && shown[0]) { const r = shown[0]; onPick({ kind, ref_id: r.id, title: r.title, for_id: r.for_id, remind_at: r.remind_at ?? null }); } }} />
          <div className="pick-list">
            {rows === null && <div className="muted small pad">Loading…</div>}
            {shown.map(r => (
              <button key={r.id} className="pick-row" onClick={() => onPick({ kind, ref_id: r.id, title: r.title, for_id: r.for_id, remind_at: r.remind_at ?? null })}>
                <span className="pick-title">{r.title}</span>
                <span className={`muted tiny ${r.late ? 'danger' : ''}`}>{r.sub}</span>
              </button>
            ))}
            {rows && !shown.length && <div className="muted small pad">{q ? 'Nothing matches.' : kind === 'task' ? 'No open tasks.' : 'No reminders coming up.'}</div>}
          </div>
          <p className="muted tiny">
            {kind === 'task'
              ? "Everyone in the chat sees the card. People who aren't working on the task see its title but can't open it."
              : 'They see what and when, and can press Remind me too.'}
          </p>
        </div>
      </div>
    </>
  );
}
