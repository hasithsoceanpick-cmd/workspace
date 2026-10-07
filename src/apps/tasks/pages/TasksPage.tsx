import { useMemo, useState, type FormEvent } from 'react';
import { useTaskApp } from '../store';
import { setParams, type Params } from '../../../lib/route';
import { addDays, fmtDay, localDayOf, startOfWeek, today } from '../../../lib/dates';
import { firstName } from '../../../lib/labels';
import type { Task } from '../types';
import TaskRow from '../TaskRow';
import { exportTasks } from '../export';

const prioRank = { high: 0, normal: 1, low: 2 } as const;
const byDue = (a: Task, b: Task) =>
  a.due_date.localeCompare(b.due_date) || prioRank[a.priority] - prioRank[b.priority] || a.id - b.id;

export default function TasksPage({ params }: { params: Params }) {
  const { me, isLead, inDept, team, tasks, person, loaded, createTask, toast, fail, helpersOf, progressOf, dept } = useTaskApp();
  const [exporting, setExporting] = useState(false);
  async function doExport() {
    setExporting(true);
    try {
      await exportTasks({ deptName: dept!.name, deptId: dept!.id, tasks, person, helpersOf, progressOf });
    } catch (e) { fail(e); }
    setExporting(false);
  }
  // the admin visiting another department has no tasks of their own there → show everyone
  const who = isLead ? params.who || (inDept ? 'me' : 'all') : 'me';
  const show = params.show === 'done' ? 'done' : 'open';
  const q = (params.q ?? '').toLowerCase();

  const mine = useMemo(() => tasks.filter(t => {
    if (who === 'me') return t.assignee_id === me.id;
    if (who === 'all') return true;
    if (who === 'byme') return t.created_by === me.id && t.assignee_id !== me.id;
    return t.assignee_id === who;
  }), [tasks, who, me.id]);

  // tasks this person helps on (shown in their own group, never mixed with their own work)
  const helperId = who === 'me' ? me.id : who === 'all' || who === 'byme' ? null : who;
  const helping = useMemo(() => !helperId ? [] : tasks.filter(t =>
    t.assignee_id !== helperId && helpersOf(t.id).includes(helperId) &&
    (show === 'done' ? t.status === 'done' : t.status !== 'done') &&
    (!q || t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q))).sort(byDue), [tasks, helperId, helpersOf, show, q]);

  const filtered = useMemo(() => mine.filter(t =>
    (show === 'done' ? t.status === 'done' : t.status !== 'done') &&
    (!q || t.title.toLowerCase().includes(q) || t.notes.toLowerCase().includes(q))), [mine, show, q]);

  const td = today();
  const groups = useMemo(() => {
    if (show === 'done') {
      const sorted = [...filtered].sort((a, b) => (b.completed_at ?? '').localeCompare(a.completed_at ?? '')).slice(0, 150);
      const map = new Map<string, Task[]>();
      for (const t of sorted) {
        const d = t.completed_at ? localDayOf(t.completed_at) : t.due_date;
        const label = d === td ? 'Completed today' : d === addDays(td, -1) ? 'Yesterday' : fmtDay(d);
        if (!map.has(label)) map.set(label, []);
        map.get(label)!.push(t);
      }
      return [...map.entries()].map(([label, items]) => ({ label, items, tone: '' }));
    }
    const endOfWeek = addDays(startOfWeek(td), 6);
    const endOfNext = addDays(endOfWeek, 7);
    const buckets: { label: string; tone: string; test: (d: string) => boolean }[] = [
      { label: 'Overdue', tone: 'danger', test: d => d < td },
      { label: 'Today', tone: 'accent', test: d => d === td },
      { label: 'Tomorrow', tone: '', test: d => d === addDays(td, 1) },
      { label: 'Later this week', tone: '', test: d => d > addDays(td, 1) && d <= endOfWeek },
      { label: 'Next week', tone: '', test: d => d > endOfWeek && d <= endOfNext && d > addDays(td, 1) },
      { label: 'Later', tone: '', test: d => d > endOfNext },
    ];
    const sorted = [...filtered].sort(byDue);
    return buckets
      .map(b => ({ label: b.label, tone: b.tone, items: sorted.filter(t => b.test(t.due_date)) }))
      .filter(g => g.items.length);
  }, [filtered, show, td]);

  const openAll = mine.filter(t => t.status !== 'done');
  const stats = {
    open: openAll.length,
    overdue: openAll.filter(t => t.due_date < td).length,
    today: openAll.filter(t => t.due_date === td).length,
  };

  const title =
    who === 'me' ? 'My tasks' : who === 'all' ? "Everyone's tasks" : who === 'byme' ? 'Assigned by me'
      : `${firstName(person(who)?.full_name ?? '')}'s tasks`;
  const showWho = who === 'all' || who === 'byme';

  // quick add
  const [qa, setQa] = useState({ title: '', due: '', assignee: '' });
  const defaultAssignee = team.some(p => p.id === me.id) ? me.id : team[0]?.id ?? '';
  const qaAssignee = qa.assignee || (who !== 'me' && who !== 'all' && who !== 'byme' ? who : defaultAssignee);
  async function quickAdd(e: FormEvent) {
    e.preventDefault();
    if (!qa.title.trim()) return;
    const t = await createTask({
      title: qa.title.trim(), notes: '', status: 'todo', priority: 'normal',
      due_date: qa.due || td, assignee_id: qaAssignee,
    });
    if (t) {
      toast(t.assignee_id === me.id ? 'Task added' : `Assigned to ${firstName(person(t.assignee_id)?.full_name ?? '')}`);
      setQa(s => ({ ...s, title: '' }));
    }
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <div className="stats">
            <span>{stats.open} open</span>
            {stats.overdue > 0 && <span className="danger">{stats.overdue} overdue</span>}
            {stats.today > 0 && <span className="accent">{stats.today} due today</span>}
          </div>
        </div>
        <div className="filters">
          {isLead && (
            <select value={who} onChange={e => setParams({ who: e.target.value })} aria-label="Whose tasks">
              {inDept && <option value="me">My tasks</option>}
              <option value="all">Everyone</option>
              <option value="byme">Assigned by me</option>
              <optgroup label="Person">
                {team.filter(p => p.id !== me.id).map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
              </optgroup>
            </select>
          )}
          <div className="seg small">
            <button className={`seg-btn ${show === 'open' ? 'on' : ''}`} onClick={() => setParams({ show: '' })}>Open</button>
            <button className={`seg-btn ${show === 'done' ? 'on' : ''}`} onClick={() => setParams({ show: 'done' })}>Done</button>
          </div>
          <input className="search" type="search" placeholder="Search…" defaultValue={params.q ?? ''}
            onChange={e => setParams({ q: e.target.value })} />
          <button className="btn sm" onClick={doExport} disabled={exporting || !loaded}
            title="Download every task you can see as an Excel file (also a handy backup)">
            {exporting ? 'Preparing…' : 'Export to Excel'}
          </button>
        </div>
      </div>

      {show === 'open' && team.length > 0 && (
        <form className="quick-add" onSubmit={quickAdd}>
          <span className="qa-plus">+</span>
          <input className="qa-title" placeholder="Add a task — type and press Enter" value={qa.title}
            onChange={e => setQa(s => ({ ...s, title: e.target.value }))} />
          {team.length > 1 && (
            <select value={qaAssignee} onChange={e => setQa(s => ({ ...s, assignee: e.target.value }))} aria-label="Assign to">
              {team.map(p => <option key={p.id} value={p.id}>{p.id === me.id ? 'Me' : p.full_name}</option>)}
            </select>
          )}
          <input type="date" value={qa.due || td} onChange={e => setQa(s => ({ ...s, due: e.target.value }))} aria-label="Deadline" />
          <button className="btn primary sm" disabled={!qa.title.trim()}>Add</button>
        </form>
      )}

      {!loaded ? <div className="empty">Loading…</div> : groups.length === 0 && helping.length === 0 ? (
        <div className="empty">
          {q ? 'No tasks match your search.' : show === 'done' ? 'Nothing completed yet.' : 'Nothing open here.'}
        </div>
      ) : (
        groups.map(g => (
          <section key={g.label} className="group">
            <h2 className={g.tone}>{g.label} <span className="count">{g.items.length}</span></h2>
            <div className="list">
              {g.items.map(t => <TaskRow key={t.id} t={t} showWho={showWho} />)}
            </div>
          </section>
        ))
      )}

      {loaded && helping.length > 0 && (
        <section className="group helping-group">
          <h2>Helping on <span className="count">{helping.length}</span></h2>
          <div className="list">
            {helping.map(t => <TaskRow key={t.id} t={t} showWho />)}
          </div>
        </section>
      )}
    </div>
  );
}
