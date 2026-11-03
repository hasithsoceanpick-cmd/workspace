import { useMemo, useState, type DragEvent } from 'react';
import { useTaskApp } from './store';
import { fmtDay, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { finished } from './labels';
import type { UndatedTask } from './types';

/**
 * Calendar → "No date": tasks without a date for the people shown. Drag one onto a day to schedule it; drag a task
 * off the calendar into here to take its date off; or move every overdue task here in one go to reschedule them.
 */
export default function NoDateTray({ selected, multi }: { selected: string[]; multi: boolean }) {
  const { tasks, undated, person, openTask, updateTask, inInbox, canUndate, undateTasks, helperOnly, toast } = useTaskApp();
  const [over, setOver] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const td = today();

  const list = useMemo(() => undated
    .filter(t => selected.includes(t.assignee_id) && !inInbox(t) && !finished(t))
    .sort((a, b) => Number(!a.acknowledged_at) - Number(!b.acknowledged_at)
      || (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1) || a.id - b.id), [undated, selected, inInbox]);

  // overdue work I'm allowed to move here (my own, what I gave, or as a manager)
  const overdue = useMemo(() => tasks.filter(t =>
    selected.includes(t.assignee_id) && !finished(t) && t.due_date < td && !inInbox(t) && canUndate(t)), [tasks, selected, td, inInbox, canUndate]);

  async function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    const id = Number(e.dataTransfer.getData('text/plain').split(':')[0]);
    const t = tasks.find(x => x.id === id);
    if (!t) return;
    if (!canUndate(t)) {
      return toast(t.nature === 'project' || t.repeat ? 'Projects and repeating tasks always keep a date.'
        : 'Only whoever gave this task (or a manager) can take its date off.', 'error');
    }
    const r = await updateTask(t.id, { due_date: null });
    if (r) toast(`"${t.title}" moved to No date`);
  }

  async function moveOverdue() {
    setBusy(true);
    const n = await undateTasks(overdue.map(t => t.id));
    setBusy(false);
    setConfirm(false);
    if (n) toast(`${n} overdue ${n === 1 ? 'task' : 'tasks'} moved to No date — drag them onto the calendar to reschedule`);
  }

  const item = (t: UndatedTask) => {
    const p = person(t.assignee_id);
    const waiting = !t.acknowledged_at && t.created_by !== t.assignee_id;   // its owner picks the date on Got it
    const canDrag = !helperOnly(t);
    return (
      <div key={t.id} className={`chip tray-chip ${t.priority === 'high' ? 'high' : ''} ${waiting ? 'waiting' : ''}`}
        style={{ ['--c' as string]: p?.color ?? '#64748b' }}
        draggable={canDrag}
        onDragStart={e => { e.dataTransfer.setData('text/plain', `${t.id}:0`); e.dataTransfer.effectAllowed = 'move'; }}
        onClick={() => openTask(t.id)}
        title={`${t.title} — ${p?.full_name ?? ''}${waiting ? ` (${firstName(p?.full_name ?? '')} picks the date)` : ''}`}>
        {multi && <span className="chip-who">{firstName(p?.full_name ?? '')}</span>}
        <span className="chip-text">{t.title}</span>
        {waiting && <span className="tray-tag">{firstName(p?.full_name ?? '')} picks{t.latest_by ? ` · by ${fmtDay(t.latest_by)}` : ''}</span>}
        {t.due_moves > 0 && <span className="chip-moved" title={`Deadline moved ${t.due_moves}×`}>↻{t.due_moves}</span>}
      </div>
    );
  };

  return (
    <aside className={`nodate-tray ${over ? 'over' : ''}`} aria-label="No date"
      onDragOver={e => { e.preventDefault(); if (!over) setOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={drop}>
      <div className="tray-head">
        <strong>No date</strong> <span className="count">{list.length}</span>
      </div>
      <div className="muted tiny tray-hint">Drag a task here to take its date off · drag one onto a day to schedule it.</div>
      {overdue.length > 0 && (confirm ? (
        <div className="tray-confirm">
          <span className="small">Move {overdue.length} overdue {overdue.length === 1 ? 'task' : 'tasks'} here?{selected.length > 1 ? ' (everyone shown)' : ''}</span>
          <div className="row gap">
            <button className="btn primary sm" disabled={busy} onClick={moveOverdue}>{busy ? 'Moving…' : 'Move'}</button>
            <button className="btn sm" onClick={() => setConfirm(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <button className="btn sm tray-overdue" onClick={() => setConfirm(true)}>
          Move all {overdue.length} overdue here
        </button>
      ))}
      <div className="tray-list">
        {list.map(item)}
        {list.length === 0 && <div className="tray-empty muted small">Nothing without a date.</div>}
      </div>
    </aside>
  );
}
