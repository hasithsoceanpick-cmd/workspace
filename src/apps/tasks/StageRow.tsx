import { useTaskApp } from './store';
import { go } from '../../lib/route';
import { daysBetween, fmtDue, today } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import type { ChecklistItem } from './types';

/** One of my project stages, in a list (Today, Tasks): tick it, or open its project. */
export default function StageRow({ s }: { s: ChecklistItem }) {
  const { tasks, toggleStage, person } = useTaskApp();
  const t = tasks.find(x => x.id === s.task_id);
  const td = today();
  const late = !s.done && !!s.due_date && s.due_date < td;
  return (
    <div className={`task-row stage-row ${late ? 'overdue' : ''} ${s.done ? 'done' : ''}`}
      onClick={() => go('tasks', 'project', { id: String(s.task_id) })}>
      <button className={`check ${s.done ? 'on' : ''}`} onClick={e => { e.stopPropagation(); toggleStage(s); }}
        aria-label={s.done ? `Not done: ${s.body}` : `Done: ${s.body}`}>
        <svg viewBox="0 0 16 16" width="12" height="12"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
      <div className="tr-main">
        <div className="stage-of">◆ Stage of <strong>{t?.title ?? 'a project'}</strong>{t && <> · {firstName(person(t.assignee_id)?.full_name ?? '')}'s project</>}</div>
        <div className="tr-title">{s.body}</div>
      </div>
      <span className={`tr-due ${late ? 'danger' : ''}`}>
        {s.due_date ? (late ? `${fmtDue(s.due_date)} · ${daysBetween(s.due_date, td)}d late` : fmtDue(s.due_date)) : ''}
      </span>
    </div>
  );
}
