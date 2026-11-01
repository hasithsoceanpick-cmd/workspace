import { useState } from 'react';
import { useTaskApp } from '../store';
import { daysBetween, fmtDay, fmtDue, fmtStamp, today } from '../../../lib/dates';
import { firstName } from '../../../lib/labels';
import Avatar from '../../../platform/Avatar';
import { remindLabel, repeatLabel } from '../labels';
import { hasDate, type AnyTask } from '../types';

/** Pick your own date: the box and its limit for work given without a deadline. */
function PickDate({ t, value, onChange }: { t: AnyTask; value: string; onChange: (v: string) => void }) {
  const td = today();
  return (
    <label className="new-pick">
      <span><strong>Pick your date</strong>{t.latest_by ? <> — any day up to <strong>{fmtDay(t.latest_by)}</strong></> : ' — any day you like'}</span>
      <input type="date" value={value} min={td} max={t.latest_by ?? undefined} onChange={e => onChange(e.target.value)} aria-label={`Your date for ${t.title}`} />
    </label>
  );
}

/** Work someone gave me that I haven't opened yet. It joins my lists only after "Got it". */
export default function NewPage() {
  const { inbox, person, openTask, acknowledge, toast, progressOf, loaded } = useTaskApp();
  const [busy, setBusy] = useState(false);
  const [dates, setDates] = useState<Record<number, string>>({});
  const td = today();
  const open = inbox.filter(t => !t.due_date && !dates[t.id]).length;   // still need a date

  async function gotOne(t: AnyTask) {
    const due = t.due_date ? undefined : dates[t.id];
    if (!t.due_date && !due) return toast('Pick your date first.', 'error');
    if (due && t.latest_by && due > t.latest_by) return toast(`Pick a date on or before ${fmtDay(t.latest_by)}.`, 'error');
    if (await acknowledge(t.id, due)) toast(due ? `Got it — due ${fmtDay(due)}, ${firstName(person(t.created_by)?.full_name ?? 'they')} has been told` : 'Got it — it is in your list now');
  }

  async function gotAll() {
    setBusy(true);
    let n = 0;
    for (const t of inbox) {
      const due = t.due_date ? undefined : dates[t.id];
      if (!t.due_date && !due) continue;
      if (await acknowledge(t.id, due)) n++;
    }
    setBusy(false);
    if (n) toast(`Got it — ${n === 1 ? 'it is' : 'they are'} in your list now${open ? ` (${open} still need${open === 1 ? 's' : ''} your date)` : ''}`);
    else toast('Pick your dates first.', 'error');
  }

  return (
    <div className="page new-page">
      <div className="page-head">
        <div>
          <h1>New for you</h1>
          <div className="muted">Work someone gave you. Press <strong>Got it</strong> to let them know you've seen it — it then moves into your lists.
            {inbox.some(t => !t.due_date) && <> Work given without a deadline needs <strong>your date</strong> first.</>}</div>
        </div>
        {inbox.length > 1 && <button className="btn primary sm" disabled={busy} onClick={gotAll}>Got it for all {inbox.length}</button>}
      </div>

      {!loaded ? <div className="empty">Loading…</div> : inbox.length === 0 ? (
        <div className="empty">Nothing new. You're all caught up.</div>
      ) : (
        <div className="new-list">
          {inbox.map(t => {
            const giver = person(t.created_by);
            const dated = hasDate(t);
            const late = dated && t.due_date < td;
            const prog = progressOf(t.id);
            return (
              <article key={t.id} className={`new-card ${late ? 'late' : ''} ${dated ? '' : 'undated'}`}>
                <header>
                  <Avatar p={giver} size={28} />
                  <div className="grow">
                    <div className="small"><strong>{giver?.full_name ?? 'Someone'}</strong> gave you this · {fmtStamp(t.created_at)}</div>
                  </div>
                  {t.priority === 'high' && <span className="pill high">High</span>}
                </header>
                <button className="new-title" onClick={() => openTask(t.id)}>{t.title}</button>
                {t.notes && <p className="new-notes">{t.notes.length > 220 ? t.notes.slice(0, 220) + '…' : t.notes}</p>}
                <div className="new-meta">
                  {dated
                    ? <span className={late ? 'danger' : ''}>Due {fmtDay(t.due_date)} · {late ? `${daysBetween(t.due_date, td)}d late` : fmtDue(t.due_date)}</span>
                    : <span className="no-date">No deadline — you pick the date</span>}
                  {t.repeat && <span>⟳ {repeatLabel(t.repeat)}</span>}
                  {t.remind_days && <span>reminder {remindLabel(t.remind_days)}</span>}
                  {prog && <span>☑ {prog.done}/{prog.total} steps</span>}
                  {t.needs_check && t.created_by && <span>{firstName(giver?.full_name ?? '')} signs it off</span>}
                </div>
                {!dated && <PickDate t={t} value={dates[t.id] ?? ''} onChange={v => setDates(d => ({ ...d, [t.id]: v }))} />}
                <footer>
                  <button className="btn sm" onClick={() => openTask(t.id)}>Open</button>
                  <button className="btn primary sm" disabled={!dated && !dates[t.id]} onClick={() => gotOne(t)}>Got it</button>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
