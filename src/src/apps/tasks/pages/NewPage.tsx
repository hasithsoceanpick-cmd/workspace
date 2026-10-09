import { useState } from 'react';
import { useTaskApp } from '../store';
import { daysBetween, fmtDay, fmtDue, fmtStamp, today } from '../../../lib/dates';
import { firstName } from '../../../lib/labels';
import Avatar from '../../../platform/Avatar';
import { remindLabel, repeatLabel } from '../labels';

/** Work someone gave me that I haven't opened yet. It joins my lists only after "Got it". */
export default function NewPage() {
  const { inbox, person, openTask, acknowledge, toast, progressOf, loaded } = useTaskApp();
  const [busy, setBusy] = useState(false);
  const td = today();

  async function gotAll() {
    setBusy(true);
    for (const t of inbox) await acknowledge(t.id);
    setBusy(false);
    toast(`Got it — ${inbox.length === 1 ? 'it is' : 'they are'} in your list now`);
  }

  return (
    <div className="page new-page">
      <div className="page-head">
        <div>
          <h1>New for you</h1>
          <div className="muted">Work someone gave you. Press <strong>Got it</strong> to let them know you've seen it — it then moves into your lists.</div>
        </div>
        {inbox.length > 1 && <button className="btn primary sm" disabled={busy} onClick={gotAll}>Got it for all {inbox.length}</button>}
      </div>

      {!loaded ? <div className="empty">Loading…</div> : inbox.length === 0 ? (
        <div className="empty">Nothing new. You're all caught up.</div>
      ) : (
        <div className="new-list">
          {inbox.map(t => {
            const giver = person(t.created_by);
            const late = t.due_date < td;
            const prog = progressOf(t.id);
            return (
              <article key={t.id} className={`new-card ${late ? 'late' : ''}`}>
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
                  <span className={late ? 'danger' : ''}>Due {fmtDay(t.due_date)} · {late ? `${daysBetween(t.due_date, td)}d late` : fmtDue(t.due_date)}</span>
                  {t.repeat && <span>⟳ {repeatLabel(t.repeat)}</span>}
                  {t.remind_days && <span>reminder {remindLabel(t.remind_days)}</span>}
                  {prog && <span>☑ {prog.done}/{prog.total} steps</span>}
                  {t.needs_check && t.created_by && <span>{firstName(giver?.full_name ?? '')} signs it off</span>}
                </div>
                <footer>
                  <button className="btn sm" onClick={() => openTask(t.id)}>Open</button>
                  <button className="btn primary sm" onClick={async () => { await acknowledge(t.id); toast('Got it — it is in your list now'); }}>Got it</button>
                </footer>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
