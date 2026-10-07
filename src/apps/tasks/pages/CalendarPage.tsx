import { useMemo, useState, type DragEvent } from 'react';
import { useTaskApp } from '../store';
import { setParams, type Params } from '../../../lib/route';
import {
  addDays, addMonths, dayNum, fmtDay, fmtMonth, fmtWeekRange, fromISO, monthGrid, today, weekDays, weekdayShort,
} from '../../../lib/dates';
import { firstName } from '../../../lib/labels';
import type { Task } from '../types';
import Avatar from '../../../platform/Avatar';

const MAX_IN_CELL = 4;
const prioRank = { high: 0, normal: 1, low: 2 } as const;

export default function CalendarPage({ params }: { params: Params }) {
  const { me, isLead, team, tasks, person, openTask, newTask, updateTask, canAssignTo, toast, helpersOf, helperOnly } = useTaskApp();
  const view = params.view === 'week' ? 'week' : 'month';
  const anchor = params.d || today();
  const td = today();
  const showDone = params.done !== '0';

  const selected = useMemo(() => {
    if (!isLead) return [me.id];
    const ids = (params.p ?? '').split(',').filter(id => team.some(t => t.id === id));
    return ids.length ? ids : team.map(p => p.id);
  }, [isLead, params.p, team, me.id]);
  const allSelected = selected.length === team.length;
  const multi = selected.length > 1;

  const byDate = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      // own work, plus work a selected person is helping on
      if (!selected.includes(t.assignee_id) && !helpersOf(t.id).some(h => selected.includes(h))) continue;
      if (!showDone && t.status === 'done') continue;
      if (!m.has(t.due_date)) m.set(t.due_date, []);
      m.get(t.due_date)!.push(t);
    }
    for (const list of m.values()) {
      list.sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done')
        || prioRank[a.priority] - prioRank[b.priority]
        || (person(a.assignee_id)?.full_name ?? '').localeCompare(person(b.assignee_id)?.full_name ?? ''));
    }
    return m;
  }, [tasks, selected, showDone, person, helpersOf]);

  function togglePerson(id: string) {
    let next: string[];
    if (allSelected) next = [id];
    else if (selected.includes(id)) next = selected.filter(x => x !== id);
    else next = [...selected, id];
    setParams({ p: next.length && next.length < team.length ? next.join(',') : '' });
  }

  const step = (n: number) => setParams({ d: view === 'month' ? addMonths(anchor, n) : addDays(anchor, 7 * n) });

  // drag & drop to move deadlines (and, in week view, to hand work to someone else)
  const [over, setOver] = useState<string | null>(null);
  async function drop(e: DragEvent, date: string, personId?: string) {
    e.preventDefault();
    setOver(null);
    const [rawId, fromHelperRow] = e.dataTransfer.getData('text/plain').split(':');
    const t = tasks.find(x => x.id === Number(rawId));
    if (!t) return;
    const patch: { due_date?: string; assignee_id?: string } = {};
    if (t.due_date !== date) patch.due_date = date;
    if (personId && personId !== t.assignee_id && fromHelperRow !== '1') {
      if (!canAssignTo(personId)) return toast("You can't assign work to that person.", 'error');
      patch.assignee_id = personId;
    }
    if (!Object.keys(patch).length) return;
    const r = await updateTask(t.id, patch);
    if (r) {
      const parts = [];
      if (patch.assignee_id) parts.push(`to ${firstName(person(patch.assignee_id)?.full_name ?? '')}`);
      if (patch.due_date) parts.push(`to ${fmtDay(patch.due_date)}`);
      toast(`Moved ${parts.join(', ')}`);
    }
  }
  const dropProps = (key: string, date: string, personId?: string) => ({
    onDragOver: (e: DragEvent) => { e.preventDefault(); if (over !== key) setOver(key); },
    onDragLeave: () => setOver(o => (o === key ? null : o)),
    onDrop: (e: DragEvent) => drop(e, date, personId),
  });

  /** rowPerson: in week view, the person whose row this chip sits in */
  const chip = (t: Task, rowPerson?: string) => {
    const asHelper = rowPerson ? rowPerson !== t.assignee_id : !selected.includes(t.assignee_id);
    const p = person(asHelper && rowPerson ? rowPerson : t.assignee_id);
    const done = t.status === 'done';
    const late = !done && t.due_date < td;
    const canDrag = !helperOnly(t);
    return (
      <div
        key={t.id}
        className={`chip ${done ? 'done' : ''} ${late ? 'late' : ''} ${t.priority === 'high' ? 'high' : ''} ${asHelper ? 'helper' : ''}`}
        style={{ ['--c' as string]: p?.color ?? '#64748b' }}
        draggable={canDrag}
        onDragStart={e => { e.dataTransfer.setData('text/plain', `${t.id}:${asHelper ? 1 : 0}`); e.dataTransfer.effectAllowed = 'move'; }}
        onClick={e => { e.stopPropagation(); openTask(t.id); }}
        title={`${t.title} — ${person(t.assignee_id)?.full_name ?? ''}${asHelper ? ` (helping: ${p?.full_name ?? ''})` : ''}${late ? ' (overdue)' : ''}`}
      >
        {multi && view === 'month' && <span className="chip-who">{firstName(p?.full_name ?? '')}</span>}
        <span className="chip-text">{t.title}</span>
      </div>
    );
  };

  return (
    <div className="page wide">
      <div className="page-head">
        <div className="cal-nav">
          <button className="btn sm" onClick={() => setParams({ d: '' })}>Today</button>
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous">‹</button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next">›</button>
          <h1>{view === 'month' ? fmtMonth(anchor) : fmtWeekRange(anchor)}</h1>
        </div>
        <div className="filters">
          <label className="check-label">
            <input type="checkbox" checked={showDone} onChange={e => setParams({ done: e.target.checked ? '' : '0' })} /> Show done
          </label>
          <div className="seg small">
            <button className={`seg-btn ${view === 'week' ? 'on' : ''}`} onClick={() => setParams({ view: 'week' })}>Week</button>
            <button className={`seg-btn ${view === 'month' ? 'on' : ''}`} onClick={() => setParams({ view: '' })}>Month</button>
          </div>
        </div>
      </div>

      {isLead && team.length > 1 && (
        <div className="people-filter">
          <button className={`pchip ${allSelected ? 'on' : ''}`} onClick={() => setParams({ p: '' })}>Everyone</button>
          {team.map(p => (
            <button key={p.id} className={`pchip ${!allSelected && selected.includes(p.id) ? 'on' : ''}`}
              style={{ ['--c' as string]: p.color }} onClick={() => togglePerson(p.id)}>
              <span className="pdot" />{p.id === me.id ? 'Me' : firstName(p.full_name)}
            </button>
          ))}
        </div>
      )}

      {view === 'month' ? (
        <div className="month">
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <div key={d} className="month-dow">{d}</div>)}
          {monthGrid(anchor).map(d => {
            const items = byDate.get(d) ?? [];
            const inMonth = fromISO(d).getMonth() === fromISO(anchor).getMonth();
            const wkend = ['Sat', 'Sun'].includes(weekdayShort(d));
            return (
              <div key={d}
                className={`mcell ${inMonth ? '' : 'out'} ${d === td ? 'today' : ''} ${wkend ? 'wkend' : ''} ${over === d ? 'over' : ''}`}
                onClick={() => newTask({ due_date: d, assignee_id: selected.length === 1 ? selected[0] : undefined })}
                {...dropProps(d, d)}
              >
                <div className="mcell-head">
                  <span className="dnum">{dayNum(d)}</span>
                </div>
                <div className="mcell-items">
                  {items.slice(0, MAX_IN_CELL).map(t => chip(t))}
                  {items.length > MAX_IN_CELL && (
                    <button className="more" onClick={e => { e.stopPropagation(); setParams({ view: 'week', d }); }}>
                      +{items.length - MAX_IN_CELL} more
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="week-scroll">
          <div className="week">
            <div className="week-corner" />
            {weekDays(anchor).map(d => (
              <div key={d} className={`week-dow ${d === td ? 'today' : ''}`}>
                <span>{weekdayShort(d)}</span> <strong>{dayNum(d)}</strong>
              </div>
            ))}
            {selected.map(pid => {
              const p = person(pid);
              const days = weekDays(anchor);
              const open = days.reduce((n, d) => n + (byDate.get(d) ?? []).filter(t => t.assignee_id === pid && t.status !== 'done').length, 0);
              return [
                <div key={pid} className="week-person">
                  <Avatar p={p} size={26} />
                  <div>
                    <div className="strong">{pid === me.id ? 'Me' : p?.full_name}</div>
                    <div className="muted tiny">{open} open this week</div>
                  </div>
                </div>,
                ...days.map(d => {
                  const key = `${pid}|${d}`;
                  const items = (byDate.get(d) ?? []).filter(t => t.assignee_id === pid || helpersOf(t.id).includes(pid));
                  return (
                    <div key={key} className={`wcell ${d === td ? 'today' : ''} ${over === key ? 'over' : ''}`}
                      onClick={() => newTask({ due_date: d, assignee_id: pid })}
                      {...dropProps(key, d, pid)}>
                      {items.map(t => chip(t, pid))}
                    </div>
                  );
                }),
              ];
            })}
          </div>
        </div>
      )}
      <p className="hint">Click a day to add a task · drag a task to move its deadline{isLead && view === 'week' ? ' or hand it to someone else' : ''} · dashed = helping on.</p>
    </div>
  );
}
