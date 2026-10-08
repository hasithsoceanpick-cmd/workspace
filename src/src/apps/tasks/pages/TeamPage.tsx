import { useMemo, useState, type DragEvent } from 'react';
import { useTaskApp } from '../store';
import { go, setParams, type Params } from '../../../lib/route';
import { addDays, daysBetween, fmtDue, fromISO, localDayOf, startOfWeek, today } from '../../../lib/dates';
import { firstName, roleLabel } from '../../../lib/labels';
import Avatar from '../../../platform/Avatar';
import type { Task } from '../types';
import { repeatLabel, statusLabel } from '../labels';
import MovedBadge from '../DueHistory';
import { finished, finishedAt } from '../labels';

const prioRank = { high: 0, normal: 1, low: 2 } as const;

/** "Who's on what": a column per person with the work they're carrying, or the workload table. */
export default function TeamPage({ params }: { params: Params }) {
  const view = params.view === 'table' ? 'table' : 'board';
  const { dept } = useTaskApp();
  return (
    <div className="page wide">
      <div className="page-head">
        <div>
          <h1>Who's on what</h1>
          <div className="muted">{dept?.name} · open work per person</div>
        </div>
        <div className="filters">
          {view === 'board' && <BoardFilters params={params} />}
          <div className="seg small">
            <button className={`seg-btn ${view === 'board' ? 'on' : ''}`} onClick={() => setParams({ view: '' })}>Board</button>
            <button className={`seg-btn ${view === 'table' ? 'on' : ''}`} onClick={() => setParams({ view: 'table' })}>Table</button>
          </div>
        </div>
      </div>
      {view === 'board' ? <Board params={params} /> : <TeamTable />}
    </div>
  );
}

function BoardFilters({ params }: { params: Params }) {
  return (
    <>
      <select value={params.show ?? ''} onChange={e => setParams({ show: e.target.value })} aria-label="Which tasks">
        <option value="">All open work</option>
        <option value="overdue">Overdue only</option>
        <option value="week">Due within 7 days</option>
      </select>
      <label className="check-label">
        <input type="checkbox" checked={params.helping !== '0'} onChange={e => setParams({ helping: e.target.checked ? '' : '0' })} /> Show helping
      </label>
    </>
  );
}

function Board({ params }: { params: Params }) {
  const { me, team, tasks, person, openTask, helpersOf, helperOnly, progressOf, canAssignTo, updateTask, toast } = useTaskApp();
  const td = today();
  const showHelping = params.helping !== '0';
  const [over, setOver] = useState<string | null>(null);

  const keep = (t: Task) =>
    !finished(t) &&
    (params.show === 'overdue' ? t.due_date < td : params.show === 'week' ? t.due_date <= addDays(td, 7) : true);
  const order = (a: Task, b: Task) =>
    Number(b.due_date < td) - Number(a.due_date < td) || a.due_date.localeCompare(b.due_date)
    || prioRank[a.priority] - prioRank[b.priority] || a.id - b.id;

  const columns = useMemo(() => team.map(p => {
    const own = tasks.filter(t => t.assignee_id === p.id && keep(t)).sort(order);
    const helping = showHelping ? tasks.filter(t => t.assignee_id !== p.id && keep(t) && helpersOf(t.id).includes(p.id)).sort(order) : [];
    const allOpen = tasks.filter(t => t.assignee_id === p.id && !finished(t));
    return {
      p, own, helping,
      open: allOpen.length,
      overdue: allOpen.filter(t => t.due_date < td).length,
      today: allOpen.filter(t => t.due_date === td).length,
    };
  }), [team, tasks, helpersOf, showHelping, params.show, td]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalOpen = columns.reduce((n, c) => n + c.open, 0);
  const totalLate = columns.reduce((n, c) => n + c.overdue, 0);

  async function drop(e: DragEvent, to: string) {
    e.preventDefault();
    setOver(null);
    const t = tasks.find(x => x.id === Number(e.dataTransfer.getData('text/x-board')));
    if (!t || t.assignee_id === to) return;
    if (!canAssignTo(to)) return toast("You can't assign work to that person.", 'error');
    const r = await updateTask(t.id, { assignee_id: to });
    if (r) toast(`Handed to ${firstName(person(to)?.full_name ?? '')}`);
  }

  const card = (t: Task, helpingFor?: string) => {
    const late = t.due_date < td;
    const prog = progressOf(t.id);
    const canDrag = !helpingFor && !helperOnly(t);
    return (
      <div key={`${t.id}-${helpingFor ?? ''}`} className={`bcard ${late ? 'late' : ''} ${t.priority === 'high' ? 'high' : ''} ${helpingFor ? 'helping' : ''}`}
        draggable={canDrag}
        onDragStart={e => { e.dataTransfer.setData('text/x-board', String(t.id)); e.dataTransfer.effectAllowed = 'move'; }}
        onClick={() => openTask(t.id)} role="button" tabIndex={0}
        onKeyDown={e => { if (e.key === 'Enter') openTask(t.id); }}>
        <div className="bcard-title">{t.title}</div>
        <div className="bcard-meta">
          <span className={late ? 'danger strong' : 'muted'}>
            {late ? `${daysBetween(t.due_date, td)}d late` : fmtDue(t.due_date)}
          </span>
          {(t.status === 'doing' || t.status === 'waiting') && <span className={`pill s-${t.status}`}>{statusLabel(t.status)}</span>}
          {t.priority === 'high' && <span className="pill high">High</span>}
          {prog && <span className={`pill prog ${prog.done === prog.total ? 'full' : ''}`}>☑ {prog.done}/{prog.total}</span>}
          {t.repeat && <span className="pill repeat" title={`Repeats ${repeatLabel(t.repeat).toLowerCase()}`}>⟳</span>}
          <MovedBadge task={t} compact />
          {helpingFor && <span className="muted tiny">for {firstName(person(t.assignee_id)?.full_name ?? '')}</span>}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="board-sum muted small">
        {totalOpen} open task{totalOpen === 1 ? '' : 's'} across {team.length} {team.length === 1 ? 'person' : 'people'}
        {totalLate > 0 && <> · <span className="danger strong">{totalLate} overdue</span></>}
      </div>
      <div className="board">
        {columns.map(c => (
          <section key={c.p.id} className={`bcol ${over === c.p.id ? 'over' : ''}`}
            onDragOver={e => { if (e.dataTransfer.types.includes('text/x-board')) { e.preventDefault(); if (over !== c.p.id) setOver(c.p.id); } }}
            onDragLeave={() => setOver(o => (o === c.p.id ? null : o))}
            onDrop={e => drop(e, c.p.id)}>
            <header className="bcol-head" style={{ ['--c' as string]: c.p.color }}>
              <Avatar p={c.p} size={28} />
              <div className="grow">
                <button className="link strong bcol-name" onClick={() => go('tasks', 'list', { who: c.p.id === me.id ? 'me' : c.p.id })}>
                  {c.p.id === me.id ? `${c.p.full_name} (me)` : c.p.full_name}
                </button>
                <div className="muted tiny">{roleLabel(c.p.role)}</div>
              </div>
            </header>
            <div className="bcol-stats">
              <span><strong>{c.open}</strong> open</span>
              <span className={c.overdue ? 'danger strong' : 'muted'}>{c.overdue} overdue</span>
              <span className={c.today ? 'accent strong' : 'muted'}>{c.today} today</span>
            </div>
            <div className="bcol-body">
              {c.own.length === 0 && c.helping.length === 0 && <div className="bcol-empty">Nothing here</div>}
              {c.own.map(t => card(t))}
              {c.helping.length > 0 && <div className="bcol-sub">Helping on</div>}
              {c.helping.map(t => card(t, c.p.id))}
            </div>
          </section>
        ))}
      </div>
      <p className="hint">Click a card to open it · drag a card to another person to hand it over · dashed = helping on someone else's task.</p>
    </>
  );
}

function TeamTable() {
  const { me, isAdmin, team, tasks } = useTaskApp();
  const td = today();
  const weekStart = startOfWeek(td);
  const weekEnd = addDays(weekStart, 6);

  const rows = team.map(p => {
    const mine = tasks.filter(t => t.assignee_id === p.id);
    const open = mine.filter(t => !finished(t));
    const doneDays = mine.map(finishedAt).filter((x): x is string => !!x).map(localDayOf);
    return {
      p,
      open: open.length,
      overdue: open.filter(t => t.due_date < td).length,
      today: open.filter(t => t.due_date === td).length,
      week: open.filter(t => t.due_date >= td && t.due_date <= weekEnd).length,
      moved: open.filter(t => t.due_moves > 0).length,
      doneToday: doneDays.filter(d => d === td).length,
      doneWeek: doneDays.filter(d => d >= weekStart).length,
    };
  });

  return (
    <>
      <div className="table-scroll">
        <table className="team-table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th className="num">Open</th>
              <th className="num">Overdue</th>
              <th className="num">Due today</th>
              <th className="num">Due this week</th>
              <th className="num">Deadline moved</th>
              <th className="num">Done today</th>
              <th className="num">Done this week</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.p.id}>
                <td>
                  <button className="person-cell person-link" onClick={() => go('tasks', 'list', { who: r.p.id === me.id ? 'me' : r.p.id })}>
                    <Avatar p={r.p} size={28} />
                    <span className="strong">{r.p.full_name}{r.p.id === me.id ? ' (me)' : ''}</span>
                  </button>
                </td>
                <td className="muted">{roleLabel(r.p.role)}</td>
                <td className="num">{r.open}</td>
                <td className={`num ${r.overdue ? 'danger strong' : 'muted'}`}>{r.overdue}</td>
                <td className={`num ${r.today ? 'accent strong' : 'muted'}`}>{r.today}</td>
                <td className="num">{r.week}</td>
                <td className={`num ${r.moved ? 'warn strong' : 'muted'}`}>{r.moved}</td>
                <td className="num good">{r.doneToday || <span className="muted">0</span>}</td>
                <td className="num">{r.doneWeek}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        Week of {fromISO(weekStart).getDate()} {fromISO(weekStart).toLocaleString('en', { month: 'short' })} · click a name to see their tasks.
        {isAdmin ? ' Roles, colours and who belongs to this department are managed in the Admin console.' : ''}
      </p>
    </>
  );
}
