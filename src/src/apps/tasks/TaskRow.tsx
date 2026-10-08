import type { MouseEvent } from 'react';
import { useTaskApp } from './store';
import type { Task } from './types';
import { daysBetween, fmtDue, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { finished, isLate, repeatLabel, statusLabel } from './labels';
import MovedBadge from './DueHistory';
import Avatar from '../../platform/Avatar';

export default function TaskRow({ t, showWho }: { t: Task; showWho: boolean }) {
  const { openTask, updateTask, person, me, toast, helpersOf, helperOnly, progressOf, canCheck, checkerOf } = useTaskApp();
  const helping = helperOnly(t);
  const helpers = helpersOf(t.id);
  const prog = progressOf(t.id);
  const done = t.status === 'done';
  const review = t.status === 'review';
  const overdue = isLate(t, today());
  const isNew = !t.acknowledged_at && t.assignee_id === me.id;
  const unseen = !t.acknowledged_at && t.assignee_id !== me.id && t.created_by === me.id;
  const who = person(t.assignee_id);
  const by = person(t.created_by);

  async function toggle(e: MouseEvent) {
    e.stopPropagation();
    if (helping) return toast(`Only ${firstName(who?.full_name ?? 'the owner')} can mark this done.`, 'error');
    if (review && !canCheck(t)) return toast(`Waiting for ${firstName(checkerOf(t)?.full_name ?? 'the checker')} to sign it off.`);
    const r = await updateTask(t.id, { status: done ? 'todo' : 'done' });
    if (!r) return;
    if (r.status === 'review') toast(`Sent to ${firstName(checkerOf(r)?.full_name ?? 'the checker')} for sign-off`);
    else if (done) toast('Reopened');
    else if (review) toast(t.repeat && !t.next_task_id ? 'Signed off — the next one has been created' : 'Signed off');
    else toast(t.repeat && !t.next_task_id ? 'Done — the next one has been created' : 'Marked done');
  }

  return (
    <div className={`task-row ${overdue ? 'overdue' : ''} ${done ? 'done' : ''} ${review ? 'review' : ''} ${isNew ? 'is-new' : ''}`} onClick={() => openTask(t.id)}>
      <button className={`check ${done ? 'on' : ''} ${review ? 'half' : ''} ${helping ? 'locked' : ''}`} onClick={toggle}
        aria-label={helping ? 'Only the owner can mark this done' : done ? 'Reopen' : review ? (canCheck(t) ? 'Sign off' : 'Waiting for sign-off') : 'Mark done'}
        title={review ? (canCheck(t) ? 'Sign it off' : 'Waiting for sign-off') : undefined}>
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div className="tr-main">
        <div className="tr-title">{t.title}</div>
        <div className="tr-meta">
          {isNew && <span className="pill new" title="Someone gave you this — open it and press Got it">New</span>}
          {review && <span className="pill s-review">{canCheck(t) ? 'Sign off' : 'Waiting for sign-off'}</span>}
          {unseen && <span className="pill unseen" title={`${firstName(who?.full_name ?? '')} hasn't opened it yet`}>Not opened yet</span>}
          {t.priority === 'high' && <span className="pill high">High</span>}
          {(t.status === 'doing' || t.status === 'waiting') && <span className={`pill s-${t.status}`}>{statusLabel(t.status)}</span>}
          {t.priority === 'low' && <span className="pill low">Low</span>}
          {t.created_by && t.created_by !== t.assignee_id && t.created_by !== me.id && by && (
            <span className="muted">from {firstName(by.full_name)}</span>
          )}
          {prog && <span className={`pill prog ${prog.done === prog.total ? 'full' : ''}`} title="Checklist">☑ {prog.done}/{prog.total}</span>}
          {helping && <span className="pill helping">Helping</span>}
          {t.repeat && <span className="pill repeat" title="Repeats: the next one is created when this is done">⟳ {repeatLabel(t.repeat)}</span>}
          <MovedBadge task={t} />
          {t.notes && <span className="muted" title="Has notes">≡</span>}
        </div>
      </div>
      {(showWho || helping) && (
        <span className="tr-who">
          <Avatar p={who} size={22} />
          <span className="hide-sm">{firstName(who?.full_name ?? '')}</span>
        </span>
      )}
      {helpers.length > 0 && (
        <span className="tr-helpers" title={`Helpers: ${helpers.map(h => person(h)?.full_name ?? '').join(', ')}`}>
          {helpers.slice(0, 3).map(h => <Avatar key={h} p={person(h)} size={18} />)}
          {helpers.length > 3 && <span className="more">+{helpers.length - 3}</span>}
        </span>
      )}
      <span className={`tr-due ${overdue ? 'danger' : ''}`}>
        {!finished(t) && t.due_moves > 0 && t.original_due && t.original_due !== t.due_date && (
          <s className="was" title="First deadline">{fmtDue(t.original_due)}</s>
        )}
        {finished(t) ? '' : overdue ? `${fmtDue(t.due_date)} · ${daysBetween(t.due_date, today())}d late` : fmtDue(t.due_date)}
      </span>
    </div>
  );
}
