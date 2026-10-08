import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { supabase } from '../../supabase';
import { fmtDay, fmtStamp } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { useTaskApp } from './store';
import type { Task, TaskActivity } from './types';

/** Every deadline move of a task, oldest first. */
export async function loadDueMoves(taskId: number): Promise<TaskActivity[]> {
  const { data } = await supabase.from('task_activity').select('*')
    .eq('task_id', taskId).eq('kind', 'due_date').order('created_at');
  return (data as TaskActivity[]) ?? [];
}

export function DueMovesList({ task, moves }: { task: Task; moves: TaskActivity[] | null }) {
  const { person } = useTaskApp();
  if (!moves) return <div className="muted small">Loading…</div>;
  return (
    <ol className="due-moves">
      <li className="first">
        <span className="dm-when">Set</span>
        <span>first deadline <strong>{fmtDay(task.original_due ?? task.due_date)}</strong></span>
      </li>
      {moves.map(m => (
        <li key={m.id}>
          <span className="dm-when">{fmtStamp(m.created_at)}</span>
          <span>
            <strong>{firstName(person(m.actor_id)?.full_name ?? 'Someone')}</strong> moved it{' '}
            <span className="muted">{m.old_value ? fmtDay(m.old_value) : '—'}</span> → <strong>{m.new_value ? fmtDay(m.new_value) : '—'}</strong>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** "Moved 2×" on a task card; click for who moved it, when, and from/to which date. */
export default function MovedBadge({ task, compact = false }: { task: Task; compact?: boolean }) {
  const [open, setOpen] = useState<{ x: number; y: number } | null>(null);
  const [moves, setMoves] = useState<TaskActivity[] | null>(null);
  const pop = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const opened = Date.now();
    const close = (e: Event) => { if (!pop.current?.contains(e.target as Node)) setOpen(null); };
    // a scroll right after opening is the page settling, not the person scrolling away
    const scrolled = (e: Event) => { if (Date.now() - opened > 400) close(e); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(null); };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', scrolled, true);
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  if (!task.due_moves) return null;

  async function toggle(e: MouseEvent<HTMLButtonElement>) {
    e.stopPropagation();
    if (open) return setOpen(null);
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(r.left, window.innerWidth - 330);
    setOpen({ x: Math.max(8, x), y: r.bottom + 6 });
    setMoves(null);
    setMoves(await loadDueMoves(task.id));
  }

  const label = compact ? `↻${task.due_moves}` : `Moved ${task.due_moves}×`;
  return (
    <>
      <button type="button" className="pill moved" onClick={toggle} onMouseDown={e => e.stopPropagation()}
        title={`Deadline moved ${task.due_moves} time${task.due_moves === 1 ? '' : 's'} · first set for ${fmtDay(task.original_due ?? task.due_date)}`}
        aria-label={`Deadline moved ${task.due_moves} times, show history`}>
        {label}
      </button>
      {open && (
        <div ref={pop} className="popover due-pop" style={{ left: open.x, top: open.y }} onClick={e => e.stopPropagation()}
          role="dialog" aria-label="Deadline history">
          <div className="pop-head"><strong>Deadline history</strong></div>
          <div className="pop-body"><DueMovesList task={task} moves={moves} /></div>
        </div>
      )}
    </>
  );
}
