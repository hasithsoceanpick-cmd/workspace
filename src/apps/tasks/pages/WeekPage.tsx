import { useEffect, useMemo, useState } from 'react';
import { useTaskApp } from '../store';
import { supabase } from '../../../supabase';
import { setParams, type Params } from '../../../lib/route';
import { addDays, daysBetween, dayBounds, fmtDay, localDayOf, startOfWeek, today } from '../../../lib/dates';
import { firstName } from '../../../lib/labels';
import { downloadXlsx, xDate } from '../../../platform/excel';
import Avatar from '../../../platform/Avatar';
import type { Task, TaskActivity } from '../types';

/** Weekly summary for leads: what got done, what slipped, whose deadlines moved. */
export default function WeekPage({ params }: { params: Params }) {
  const { dept, team, tasks, person, openTask, fail } = useTaskApp();
  const td = today();
  const thisWeek = startOfWeek(td);
  const start = params.w || addDays(thisWeek, -7);          // default: last full week
  const end = addDays(start, 6);
  const isCurrent = start === thisWeek;
  const [acts, setActs] = useState<TaskActivity[] | null>(null);

  useEffect(() => {
    let live = true;
    const [from] = dayBounds(start);
    const [to] = dayBounds(addDays(end, 1));
    setActs(null);
    supabase.from('task_activity').select('*').eq('department_id', dept!.id)
      .in('kind', ['due_date', 'created']).gte('created_at', from).lt('created_at', to).order('created_at')
      .then(({ data, error }) => { if (!live) return; if (error) fail(error); setActs((data as TaskActivity[]) ?? []); });
    return () => { live = false; };
  }, [start, end, dept, fail]);

  const byId = useMemo(() => new Map(tasks.map(t => [t.id, t])), [tasks]);
  const teamIds = new Set(team.map(p => p.id));
  const inWeek = (d: string) => d >= start && d <= end;
  const doneIn = tasks.filter(t => t.status === 'done' && t.completed_at && inWeek(localDayOf(t.completed_at)) && teamIds.has(t.assignee_id));
  const lateDone = doneIn.filter(t => localDayOf(t.completed_at!) > t.due_date);
  const overdue = tasks.filter(t => t.status !== 'done' && t.due_date < td && teamIds.has(t.assignee_id))
    .sort((a, b) => a.due_date.localeCompare(b.due_date));
  const moves = (acts ?? []).filter(a => a.kind === 'due_date' && byId.has(a.task_id) && teamIds.has(byId.get(a.task_id)!.assignee_id));
  const created = (acts ?? []).filter(a => a.kind === 'created' && byId.has(a.task_id) && teamIds.has(byId.get(a.task_id)!.assignee_id));

  const rows = team.map(p => {
    const done = doneIn.filter(t => t.assignee_id === p.id);
    const late = done.filter(t => localDayOf(t.completed_at!) > t.due_date).length;
    return {
      p,
      done: done.length,
      onTime: done.length - late,
      late,
      moved: moves.filter(m => byId.get(m.task_id)!.assignee_id === p.id).length,
      added: created.filter(c => byId.get(c.task_id)!.assignee_id === p.id).length,
      overdue: overdue.filter(t => t.assignee_id === p.id).length,
      open: tasks.filter(t => t.assignee_id === p.id && t.status !== 'done').length,
    };
  });
  const sum = rows.reduce((s, r) => ({ done: s.done + r.done, late: s.late + r.late, moved: s.moved + r.moved, added: s.added + r.added }),
    { done: 0, late: 0, moved: 0, added: 0 });
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—');
  const nameOf = (id: string | null | undefined) => person(id)?.full_name ?? 'Someone';

  async function exportWeek() {
    try {
      await downloadXlsx(`${dept!.name} week ${start}`, [
        {
          name: 'Summary',
          columns: [{ header: 'Person', width: 24 }, { header: 'Done', width: 8 }, { header: 'On time', width: 9 }, { header: 'Late', width: 8 },
            { header: 'On time %', width: 10 }, { header: 'Deadlines moved', width: 15 }, { header: 'New tasks', width: 10 },
            { header: 'Overdue now', width: 12 }, { header: 'Open now', width: 10 }],
          rows: rows.map(r => [r.p.full_name, r.done, r.onTime, r.late, r.done ? Math.round((r.onTime / r.done) * 100) : null, r.moved, r.added, r.overdue, r.open]),
        },
        {
          name: 'Deadlines moved',
          columns: [{ header: 'Moved on', width: 13 }, { header: 'Task', width: 44 }, { header: 'Owner', width: 20 }, { header: 'Moved by', width: 20 },
            { header: 'From', width: 13 }, { header: 'To', width: 13 }, { header: 'Times moved in total', width: 18 }],
          rows: moves.map(m => { const t = byId.get(m.task_id)!; return [xDate(m.created_at), t.title, nameOf(t.assignee_id), nameOf(m.actor_id), xDate(m.old_value), xDate(m.new_value), t.due_moves]; }),
        },
        {
          name: 'Completed late',
          columns: [{ header: 'Task', width: 44 }, { header: 'Owner', width: 20 }, { header: 'Deadline', width: 13 }, { header: 'Completed', width: 13 }, { header: 'Days late', width: 10 }],
          rows: lateDone.map(t => [t.title, nameOf(t.assignee_id), xDate(t.due_date), xDate(t.completed_at), daysBetween(t.due_date, localDayOf(t.completed_at!))]),
        },
        {
          name: 'Overdue now',
          columns: [{ header: 'Task', width: 44 }, { header: 'Owner', width: 20 }, { header: 'Deadline', width: 13 }, { header: 'Days late', width: 10 }, { header: 'Times moved', width: 12 }],
          rows: overdue.map(t => [t.title, nameOf(t.assignee_id), xDate(t.due_date), daysBetween(t.due_date, td), t.due_moves]),
        },
      ]);
    } catch (e) { fail(e); }
  }

  const taskLink = (t: Task) => <button className="link task-link" onClick={() => openTask(t.id)}>{t.title}</button>;

  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Weekly summary</h1>
          <div className="muted">{fmtDay(start)} – {fmtDay(end)}{isCurrent ? ' · this week so far' : ''}</div>
        </div>
        <div className="filters">
          <div className="cal-nav">
            <button className="icon-btn" onClick={() => setParams({ w: addDays(start, -7) })} aria-label="Previous week">‹</button>
            <button className="icon-btn" onClick={() => setParams({ w: addDays(start, 7) })} disabled={start >= thisWeek} aria-label="Next week">›</button>
            {!isCurrent && <button className="btn sm" onClick={() => setParams({ w: thisWeek })}>This week</button>}
            {start !== addDays(thisWeek, -7) && <button className="btn sm" onClick={() => setParams({ w: '' })}>Last week</button>}
          </div>
          <button className="btn sm" onClick={exportWeek} disabled={!acts}>Export to Excel</button>
        </div>
      </div>

      <div className="summary">
        <div className="sum-card"><div className="sum-num good">{sum.done}</div><div className="sum-label">completed · {pct(sum.done - sum.late, sum.done)} on time</div></div>
        <div className="sum-card"><div className={`sum-num ${sum.late ? 'danger' : ''}`}>{sum.late}</div><div className="sum-label">completed late</div></div>
        <div className="sum-card"><div className={`sum-num ${sum.moved ? 'warn' : ''}`}>{acts ? sum.moved : '…'}</div><div className="sum-label">deadlines moved</div></div>
        <div className="sum-card"><div className={`sum-num ${overdue.length ? 'danger' : ''}`}>{overdue.length}</div><div className="sum-label">overdue right now</div></div>
      </div>

      <div className="table-scroll">
        <table className="team-table">
          <thead>
            <tr>
              <th>Person</th><th className="num">Done</th><th className="num">On time</th><th className="num">Late</th>
              <th className="num">Deadlines moved</th><th className="num">New tasks</th><th className="num">Overdue now</th><th className="num">Open now</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.p.id}>
                <td><span className="person-cell"><Avatar p={r.p} size={26} /><span className="strong">{r.p.full_name}</span></span></td>
                <td className="num good">{r.done || <span className="muted">0</span>}</td>
                <td className="num">{r.done ? `${r.onTime} (${pct(r.onTime, r.done)})` : <span className="muted">—</span>}</td>
                <td className={`num ${r.late ? 'danger strong' : 'muted'}`}>{r.late}</td>
                <td className={`num ${r.moved ? 'warn strong' : 'muted'}`}>{acts ? r.moved : '…'}</td>
                <td className="num">{acts ? r.added : '…'}</td>
                <td className={`num ${r.overdue ? 'danger strong' : 'muted'}`}>{r.overdue}</td>
                <td className="num">{r.open}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="week-lists">
        <section className="person-card">
          <header><div className="strong">Deadlines moved</div><span className="count">{moves.length}</span></header>
          {moves.length === 0 ? <div className="muted small pad">None this week.</div> : (
            <ul className="day-log">
              {moves.map(m => {
                const t = byId.get(m.task_id)!;
                return (
                  <li key={m.id}>
                    <time>{fmtDay(localDayOf(m.created_at))}</time>
                    {taskLink(t)}
                    <div className="detail">
                      {firstName(nameOf(t.assignee_id))}'s · moved by {firstName(nameOf(m.actor_id))} · {m.old_value && fmtDay(m.old_value)} → {m.new_value && fmtDay(m.new_value)}
                      {t.due_moves > 1 && <span className="warn"> · moved {t.due_moves}× in total</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        <section className="person-card">
          <header><div className="strong">Completed late</div><span className="count">{lateDone.length}</span></header>
          {lateDone.length === 0 ? <div className="muted small pad">Everything finished this week was on time.</div> : (
            <ul className="day-log">
              {lateDone.map(t => (
                <li key={t.id}>
                  <time>{fmtDay(localDayOf(t.completed_at!))}</time>
                  {taskLink(t)}
                  <div className="detail">{firstName(nameOf(t.assignee_id))} · due {fmtDay(t.due_date)} · {daysBetween(t.due_date, localDayOf(t.completed_at!))}d late</div>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="person-card">
          <header><div className="strong">Overdue right now</div><span className="count">{overdue.length}</span></header>
          {overdue.length === 0 ? <div className="muted small pad">Nothing overdue.</div> : (
            <ul className="day-log">
              {overdue.map(t => (
                <li key={t.id}>
                  <time className="danger">{daysBetween(t.due_date, td)}d</time>
                  {taskLink(t)}
                  <div className="detail">{firstName(nameOf(t.assignee_id))} · due {fmtDay(t.due_date)}{t.due_moves ? ` · moved ${t.due_moves}×` : ''}</div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
