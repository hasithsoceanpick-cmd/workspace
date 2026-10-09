import { useEffect, useState } from 'react';
import { supabase } from '../../supabase';
import { go } from '../../lib/route';
import { daysBetween, fmtDay, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { useTaskApp } from '../../apps/tasks/store';

type CItem = { id: number; name: string; series_id: number | null; active: boolean };

/** Home screen panel: obligations due in the next 30 days (and any already late). */
export default function ComplianceHome() {
  const { dept, tasks, person, openTask } = useTaskApp();
  const [items, setItems] = useState<CItem[] | null>(null);
  useEffect(() => {
    supabase.from('compliance_items').select('id,name,series_id,active').eq('department_id', dept!.id)
      .then(({ data }) => setItems((data ?? []) as CItem[]));
  }, [dept]);
  const td = today();
  const rows = (items ?? []).filter(i => i.active && i.series_id !== null).map(i => {
    const cur = tasks.filter(t => t.series_id === i.series_id && t.status !== 'done').sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
    return { i, cur };
  }).filter(r => r.cur && daysBetween(td, r.cur.due_date) <= 30).sort((a, b) => a.cur!.due_date.localeCompare(b.cur!.due_date));

  return (
    <section className="home-panel">
      <div className="hp-head"><h2>Compliance — next 30 days</h2><button className="link" onClick={() => go('tasks', 'x-compliance')}>Calendar</button></div>
      {items === null ? <div className="muted small">Loading…</div> : rows.length === 0 ? <div className="muted small">Nothing due in the next 30 days.</div> : (
        <ul className="hp-list">
          {rows.map(({ i, cur }) => {
            const left = daysBetween(td, cur!.due_date);
            return (
              <li key={i.id}>
                <button className="hp-row" onClick={() => openTask(cur!.id)}>
                  <span className="grow">{i.name}</span>
                  <span className="muted small">{firstName(person(cur!.assignee_id)?.full_name ?? '')}</span>
                  <span className={`co-left ${cur!.status === 'review' ? 'ok' : left < 0 ? 'late' : left <= 7 ? 'soon' : ''}`}>
                    {cur!.status === 'review' ? 'finished' : left < 0 ? `${-left}d late` : left === 0 ? 'today' : `${fmtDay(cur!.due_date)} · ${left}d`}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
