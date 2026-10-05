import type { MouseEvent } from 'react';
import { useTaskApp } from './store';
import type { Task } from './types';
import { daysBetween, fmtDue, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { statusLabel } from './labels';
import Avatar from '../../platform/Avatar';

export default function TaskRow({ t, showWho }: { t: Task; showWho: boolean }) {
  const { openTask, updateTask, person, me, toast } = useTaskApp();
  const done = t.status === 'done';
  const overdue = !done && t.due_date < today();
  const who = person(t.assignee_id);
  const by = person(t.created_by);

  async function toggle(e: MouseEvent) {
    e.stopPropagation();
    const r = await updateTask(t.id, { status: done ? 'todo' : 'done' });
    if (r) toast(done ? 'Reopened' : 'Marked done');
  }

  return (
    <div className={`task-row ${overdue ? 'overdue' : ''} ${done ? 'done' : ''}`} onClick={() => openTask(t.id)}>
      <button className={`check ${done ? 'on' : ''}`} onClick={toggle} aria-label={done ? 'Reopen' : 'Mark done'}>
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div className="tr-main">
        <div className="tr-title">{t.title}</div>
        <div className="tr-meta">
          {t.priority === 'high' && <span className="pill high">High</span>}
          {(t.status === 'doing' || t.status === 'waiting') && <span className={`pill s-${t.status}`}>{statusLabel(t.status)}</span>}
          {t.priority === 'low' && <span className="pill low">Low</span>}
          {t.created_by && t.created_by !== t.assignee_id && t.created_by !== me.id && by && (
            <span className="muted">from {firstName(by.full_name)}</span>
          )}
          {t.notes && <span className="muted" title="Has notes">≡</span>}
        </div>
      </div>
      {showWho && (
        <span className="tr-who">
          <Avatar p={who} size={22} />
          <span className="hide-sm">{firstName(who?.full_name ?? '')}</span>
        </span>
      )}
      <span className={`tr-due ${overdue ? 'danger' : ''}`}>
        {done ? '' : overdue ? `${fmtDue(t.due_date)} · ${daysBetween(t.due_date, today())}d late` : fmtDue(t.due_date)}
      </span>
    </div>
  );
}
