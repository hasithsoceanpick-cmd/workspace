import { useMemo } from 'react';
import { usePlatform } from '../../platform/store';
import { setParams, type Params } from '../../lib/route';
import { addDays, daysBetween, fmtDay, fmtStamp, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { finished, finishedAt, statusLabel } from './labels';
import type { AnyTask, Contact } from './types';

export type FollowNote = { task_id: number; body: string; created_at: string; author_id: string | null };

/**
 * Follow-ups as one list: every task given to someone outside the app, filtered by person, owner and state, with the
 * whole title and the last note written out (made to be screenshotted, or copied as text, for a reminder).
 */
export default function FollowUpList({ params, tasks, contacts, notes, q, showOwner, onOpen }: {
  params: Params;
  tasks: AnyTask[];
  contacts: Contact[];
  notes: Map<number, FollowNote>;
  q: string;
  /** leads looking at everyone's: an Owner column and filter */
  showOwner: boolean;
  onOpen: (id: number) => void;
}) {
  const { person, me, toast } = usePlatform();
  const td = today();
  const st = ['late', 'week', 'done', 'all'].includes(params.st ?? '') ? params.st! : 'open';
  const who = Number(params.who) || 0;
  const own = showOwner ? params.own ?? '' : '';
  const contactOf = (id: number | null) => contacts.find(c => c.id === id);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return tasks.filter(t => {
      if (who && t.contact_id !== who) return false;
      if (own && t.assignee_id !== own) return false;
      const done = finished(t);
      const late = !done && !!t.due_date && t.due_date < td;
      if (st === 'open' && done) return false;
      if (st === 'late' && !late) return false;
      if (st === 'week' && (done || !t.due_date || t.due_date > addDays(td, 7))) return false;
      if (st === 'done' && !done) return false;
      if (!term) return true;
      const c = contactOf(t.contact_id);
      return [t.title, t.notes, c?.name ?? '', c?.organisation ?? '', notes.get(t.id)?.body ?? '']
        .some(x => x.toLowerCase().includes(term));
    }).sort((a, b) => st === 'done'
      ? (finishedAt(b) ?? '').localeCompare(finishedAt(a) ?? '')
      : (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999') || a.id - b.id);
  }, [tasks, who, own, st, q, notes, td]); // eslint-disable-line react-hooks/exhaustive-deps

  const lateN = rows.filter(t => !finished(t) && t.due_date && t.due_date < td).length;
  const people = contacts.filter(c => tasks.some(t => t.contact_id === c.id)).sort((a, b) => a.name.localeCompare(b.name));
  const owners = [...new Set(tasks.map(t => t.assignee_id))].map(id => person(id)).filter(p => !!p)
    .sort((a, b) => a!.full_name.localeCompare(b!.full_name));

  const dueText = (t: AnyTask) => {
    if (!t.due_date) return { text: 'No date', late: 0 };
    const late = finished(t) ? 0 : daysBetween(t.due_date, td);
    return { text: fmtDay(t.due_date), late };
  };
  const stateOf = (t: AnyTask) => {
    if (t.status === 'done') return { label: 'Done', cls: 'good' };
    if (t.status === 'review') return { label: 'Waiting for sign-off', cls: 's-review' };
    if (t.due_date && t.due_date < td) return { label: t.escalated_at ? 'Escalated' : 'Overdue', cls: t.escalated_at ? 'esc' : 'high' };
    if (t.due_date === td) return { label: 'Due today', cls: 's-doing' };
    return { label: statusLabel(t.status), cls: `s-${t.status}` };
  };

  async function copy() {
    const lines = rows.map((t, i) => {
      const c = contactOf(t.contact_id);
      const d = dueText(t);
      const n = notes.get(t.id);
      return `${i + 1}. ${t.title} — ${c?.name ?? ''}${c?.organisation ? ` (${c.organisation})` : ''} — `
        + (t.due_date ? `due ${d.text}${d.late > 0 ? ` (${d.late} day${d.late === 1 ? '' : 's'} late)` : ''}` : 'no date')
        + (finished(t) ? ' — done' : '')
        + (n ? `\n   Last note ${fmtDay(n.created_at.slice(0, 10))}: ${n.body.replace(/\s+/g, ' ').trim()}` : '');
    });
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast(`Copied ${rows.length} ${rows.length === 1 ? 'line' : 'lines'} — paste into an email or WhatsApp`);
    } catch { toast("Couldn't copy here — take a screenshot instead", 'error'); }
  }

  return (
    <div className="fu-listview">
      <div className="fu-filters">
        <select value={who || ''} onChange={e => setParams({ who: e.target.value })} aria-label="Person outside the app">
          <option value="">All people</option>
          {people.map(c => <option key={c.id} value={c.id}>{c.name}{c.organisation ? ` · ${c.organisation}` : ''}</option>)}
        </select>
        <select value={st} onChange={e => setParams({ st: e.target.value === 'open' ? '' : e.target.value })} aria-label="Which tasks">
          <option value="open">Open</option>
          <option value="late">Overdue only</option>
          <option value="week">Due within 7 days</option>
          <option value="done">Finished</option>
          <option value="all">All (open and finished)</option>
        </select>
        {showOwner && (
          <select value={own} onChange={e => setParams({ own: e.target.value })} aria-label="Who follows up">
            <option value="">Everyone following up</option>
            {owners.map(p => <option key={p!.id} value={p!.id}>{p!.id === me.id ? 'Me' : p!.full_name}</option>)}
          </select>
        )}
        <span className="grow" />
        <span className="muted small">{rows.length} {rows.length === 1 ? 'task' : 'tasks'}{lateN > 0 && <> · <span className="danger">{lateN} overdue</span></>}</span>
        <button className="btn sm" onClick={copy} disabled={!rows.length} title="Copy the list as text, to paste into a reminder">Copy as text</button>
      </div>

      {rows.length === 0 ? <div className="empty">Nothing here{q ? ' matches your search' : ''}.</div> : (
        <div className="fu-table-wrap">
          <table className="fu-table">
            <thead>
              <tr>
                <th className="num">#</th>
                <th>Task</th>
                <th>Given to</th>
                {showOwner && <th>Follows up</th>}
                <th>Deadline</th>
                <th>Status</th>
                <th>Last note</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t, i) => {
                const c = contactOf(t.contact_id);
                const d = dueText(t);
                const s = stateOf(t);
                const n = notes.get(t.id);
                return (
                  <tr key={t.id} className={d.late > 0 ? 'late' : finished(t) ? 'done' : ''} onClick={() => onOpen(t.id)} tabIndex={0}
                    onKeyDown={e => { if (e.key === 'Enter') onOpen(t.id); }}>
                    <td className="num muted" data-label="#">{i + 1}</td>
                    <td className="fu-task" data-label="Task">
                      <span className="fu-title">{t.title}</span>
                      {t.priority === 'high' && <span className="pill high">High</span>}
                    </td>
                    <td className="fu-who" data-label="Given to"><strong>{c?.name ?? ''}</strong>{c?.organisation && <span className="muted"> · {c.organisation}</span>}</td>
                    {showOwner && <td data-label="Follows up">{t.assignee_id === me.id ? 'Me' : firstName(person(t.assignee_id)?.full_name ?? '')}</td>}
                    <td className="fu-due" data-label="Deadline">
                      {d.text}
                      {d.late > 0 && <div className="danger strong small">{d.late} day{d.late === 1 ? '' : 's'} late</div>}
                      {finished(t) && finishedAt(t) && <div className="muted small">finished {fmtStamp(finishedAt(t)!)}</div>}
                    </td>
                    <td data-label="Status"><span className={`pill ${s.cls}`}>{s.label}</span></td>
                    <td className="fu-note" data-label="Last note">
                      {n ? <><span className="muted small">{fmtStamp(n.created_at)}{n.author_id && n.author_id !== me.id ? ` · ${firstName(person(n.author_id)?.full_name ?? '')}` : ''}</span><div>{n.body}</div></>
                        : <span className="muted">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
