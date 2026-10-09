import { useMemo, useState } from 'react';
import { useTaskApp } from '../store';
import { go } from '../../../lib/route';
import { addDays, daysBetween, fmtDay, fmtLong, localDayOf, toISO, today, weekdayShort } from '../../../lib/dates';
import { firstName } from '../../../lib/labels';
import { useFeatures } from '../../../features/useFeatures';
import Avatar from '../../../platform/Avatar';
import TaskRow from '../TaskRow';
import { finished, isLate } from '../labels';
import { ReminderForm, ReminderItem, useReminders } from '../Reminders';
import { isDue } from '../reminders';
import type { Task } from '../types';

const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };

/** Managers and senior executives land here: what needs them today, across the team. */
export default function HomePage() {
  const { me, team, tasks, person, openTask, canCheck, checkerOf, inbox, newTask, loaded } = useTaskApp();
  const features = useFeatures('tasks').filter(f => f.homePanel);
  const { list: reminders } = useReminders();
  const [adding, setAdding] = useState(false);
  const td = today();
  const weekEnd = addDays(td, 6);
  const teamIds = useMemo(() => new Set(team.map(p => p.id)), [team]);
  const teamTasks = useMemo(() => tasks.filter(t => teamIds.has(t.assignee_id)), [tasks, teamIds]);

  const toSignOff = tasks.filter(t => t.status === 'review' && canCheck(t) && checkerOf(t)?.id === me.id)
    .sort((a, b) => (a.submitted_at ?? '').localeCompare(b.submitted_at ?? ''));
  const overdue = teamTasks.filter(t => isLate(t, td));
  const escalated = overdue.filter(t => t.escalated_at);
  const unopened = teamTasks.filter(t => !t.acknowledged_at && t.assignee_id !== me.id && !finished(t))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const dueWeek = teamTasks.filter(t => !finished(t) && t.due_date >= td && t.due_date <= weekEnd)
    .sort((a, b) => a.due_date.localeCompare(b.due_date));

  const byPerson = team.map(p => {
    const late = overdue.filter(t => t.assignee_id === p.id);
    const oldest = late.reduce((m, t) => Math.max(m, daysBetween(t.due_date, td)), 0);
    return { p, late: late.length, oldest, esc: late.filter(t => t.escalated_at).length };
  }).filter(r => r.late > 0).sort((a, b) => b.late - a.late || b.oldest - a.oldest);

  const myRem = (reminders ?? []).filter(r => r.user_id === me.id && !r.done_at && (isDue(r) || toISO(new Date(r.remind_at)) === td));
  const age = (t: Task) => { const d = daysBetween(localDayOf(t.created_at), td); return d === 0 ? 'today' : `${d}d`; };

  const tiles = [
    { n: toSignOff.length, label: 'waiting for your sign-off', tone: toSignOff.length ? 'warn' : '', go: () => go('tasks', 'list') },
    { n: overdue.length, label: 'overdue in the team', tone: overdue.length ? 'danger' : '', go: () => go('tasks', 'team', { show: 'overdue' }) },
    { n: escalated.length, label: 'escalated (3+ days late)', tone: escalated.length ? 'danger' : '', go: () => go('tasks', 'team', { show: 'overdue' }) },
    { n: unopened.length, label: 'not opened yet', tone: unopened.length ? 'accent' : '', go: () => document.getElementById('home-unopened')?.scrollIntoView({ behavior: 'smooth' }) },
    { n: dueWeek.length, label: 'due in the next 7 days', tone: '', go: () => go('tasks', 'calendar', { view: 'week' }) },
  ];

  const row = (t: Task, extra?: string) => (
    <li key={t.id}>
      <button className="hp-row" onClick={() => openTask(t.id)}>
        <Avatar p={person(t.assignee_id)} size={20} />
        <span className="grow">{t.title}</span>
        {t.escalated_at && !finished(t) && <span className="pill esc">Escalated</span>}
        {extra && <span className="muted small">{extra}</span>}
      </button>
    </li>
  );

  if (!loaded) return <div className="page"><div className="empty">Loading…</div></div>;

  return (
    <div className="page wide home-page">
      <div className="page-head">
        <div>
          <h1>{greeting()}, {firstName(me.full_name)}</h1>
          <div className="muted">{fmtLong(td)}</div>
        </div>
        <div className="filters">
          <button className="btn sm" onClick={() => setAdding(a => !a)}>{adding ? 'Close' : '+ Reminder'}</button>
          {team.length > 0 && <button className="btn primary sm" onClick={() => newTask()}>+ New task</button>}
        </div>
      </div>
      {adding && <div className="card"><ReminderForm onSaved={() => setAdding(false)} /></div>}

      {inbox.length > 0 && (
        <button className="new-banner" onClick={() => go('tasks', 'new')}>
          <strong>{inbox.length} new task{inbox.length === 1 ? '' : 's'} for you</strong> — open them and press Got it →
        </button>
      )}

      <div className="tiles">
        {tiles.map(t => (
          <button key={t.label} className={`tile ${t.tone}`} onClick={t.go}>
            <span className="tile-num">{t.n}</span>
            <span className="tile-label">{t.label}</span>
          </button>
        ))}
      </div>

      <div className="home-grid">
        <section className="home-panel">
          <div className="hp-head"><h2>Waiting for your sign-off</h2></div>
          {toSignOff.length === 0 ? <div className="muted small">Nothing waiting for you.</div> : (
            <div className="list">{toSignOff.slice(0, 6).map(t => <TaskRow key={t.id} t={t} showWho />)}</div>
          )}
          {toSignOff.length > 6 && <button className="link" onClick={() => go('tasks', 'list')}>All {toSignOff.length}</button>}
        </section>

        <section className="home-panel">
          <div className="hp-head"><h2>Overdue by person</h2><button className="link" onClick={() => go('tasks', 'team', { show: 'overdue' })}>Board</button></div>
          {byPerson.length === 0 ? <div className="muted small">Nobody is behind. </div> : (
            <ul className="hp-list">
              {byPerson.map(r => (
                <li key={r.p.id}>
                  <button className="hp-row" onClick={() => go('tasks', 'list', { who: r.p.id })}>
                    <Avatar p={r.p} size={22} />
                    <span className="grow">{r.p.id === me.id ? 'You' : r.p.full_name}</span>
                    {r.esc > 0 && <span className="pill esc">{r.esc} escalated</span>}
                    <span className="danger strong">{r.late}</span>
                    <span className="muted small">oldest {r.oldest}d</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="home-panel" id="home-unopened">
          <div className="hp-head"><h2>Not opened yet</h2></div>
          {unopened.length === 0 ? <div className="muted small">Everyone has seen their new work.</div> : (
            <ul className="hp-list">{unopened.slice(0, 8).map(t => row(t, `${firstName(person(t.assignee_id)?.full_name ?? '')} · given ${age(t)}`))}</ul>
          )}
        </section>

        <section className="home-panel">
          <div className="hp-head"><h2>Due in the next 7 days</h2><button className="link" onClick={() => go('tasks', 'calendar', { view: 'week' })}>Calendar</button></div>
          {dueWeek.length === 0 ? <div className="muted small">Nothing due this week.</div> : (
            <ul className="hp-list">
              {dueWeek.slice(0, 10).map(t => row(t, t.due_date === td ? 'today' : `${weekdayShort(t.due_date)} ${fmtDay(t.due_date).split(' ').slice(1).join(' ')}`))}
            </ul>
          )}
          {dueWeek.length > 10 && <div className="muted small">and {dueWeek.length - 10} more</div>}
        </section>

        <section className="home-panel">
          <div className="hp-head"><h2>Your reminders today</h2><button className="link" onClick={() => go('tasks', 'reminders')}>All</button></div>
          {myRem.length === 0 ? <div className="muted small">None today. Use <strong>+ Reminder</strong> to add one.</div> : (
            <ul className="rem-list">{myRem.map(r => <ReminderItem key={r.id} r={r} compact />)}</ul>
          )}
        </section>

        {features.map(f => { const P = f.homePanel!; return <P key={f.key} />; })}
      </div>
    </div>
  );
}
