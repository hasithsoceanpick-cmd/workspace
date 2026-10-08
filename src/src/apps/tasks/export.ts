import { supabase } from '../../supabase';
import { downloadXlsx, xDate, type XSheet } from '../../platform/excel';
import { today } from '../../lib/dates';
import type { Profile } from '../../platform/types';
import { finished, isLate, remindLabel, repeatLabel, statusLabel } from './labels';
import type { Task, TaskActivity } from './types';

/**
 * Download the tasks this person can see in the department as an Excel file:
 * a Tasks sheet and a Deadline moves sheet. It doubles as a backup.
 */
export async function exportTasks(opts: {
  deptName: string; deptId: string; tasks: Task[];
  person: (id: string | null | undefined) => Profile | undefined;
  helpersOf: (id: number) => string[];
  progressOf: (id: number) => { done: number; total: number } | null;
}) {
  const { tasks, person, helpersOf, progressOf } = opts;
  const name = (id: string | null | undefined) => person(id)?.full_name ?? '';
  const td = today();
  const sorted = [...tasks].sort((a, b) =>
    Number(finished(a)) - Number(finished(b)) || a.due_date.localeCompare(b.due_date) || a.id - b.id);

  const taskSheet: XSheet = {
    name: 'Tasks',
    columns: [
      { header: 'Task #', width: 8 }, { header: 'Title', width: 44 }, { header: 'Owner', width: 20 },
      { header: 'Helpers', width: 24 }, { header: 'Status', width: 20 }, { header: 'Priority', width: 10 },
      { header: 'Deadline', width: 13 }, { header: 'First deadline', width: 14 }, { header: 'Times moved', width: 12 },
      { header: 'Overdue days', width: 13 }, { header: 'Repeats', width: 11 }, { header: 'Checklist', width: 10 },
      { header: 'Assigned by', width: 20 }, { header: 'Created', width: 13 }, { header: 'Finished', width: 13 },
      { header: 'Signed off by', width: 18 }, { header: 'Times sent back', width: 14 }, { header: 'Early reminder', width: 15 },
      { header: 'Notes', width: 50 },
    ],
    rows: sorted.map(t => {
      const p = progressOf(t.id);
      const late = isLate(t, td)
        ? Math.round((Date.parse(td) - Date.parse(t.due_date)) / 86400000) : null;
      return [
        t.id, t.title, name(t.assignee_id), helpersOf(t.id).map(name).join(', '), statusLabel(t.status),
        t.priority[0].toUpperCase() + t.priority.slice(1), xDate(t.due_date), xDate(t.original_due ?? t.due_date),
        t.due_moves ?? 0, late, repeatLabel(t.repeat), p ? `${p.done}/${p.total}` : '', name(t.created_by),
        xDate(t.created_at), xDate(t.submitted_at ?? t.completed_at), name(t.checked_by), t.sent_back_n || null,
        remindLabel(t.remind_days), t.notes,
      ];
    }),
  };

  // deadline moves for these tasks, in batches
  const ids = sorted.filter(t => t.due_moves > 0).map(t => t.id);
  const moves: TaskActivity[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('task_activity').select('*').eq('kind', 'due_date').in('task_id', ids.slice(i, i + 200));
    moves.push(...((data as TaskActivity[]) ?? []));
  }
  const byId = new Map(sorted.map(t => [t.id, t]));
  moves.sort((a, b) => a.created_at.localeCompare(b.created_at));
  const moveSheet: XSheet = {
    name: 'Deadline moves',
    columns: [
      { header: 'Task #', width: 8 }, { header: 'Title', width: 44 }, { header: 'Owner', width: 20 },
      { header: 'Moved on', width: 13 }, { header: 'Moved by', width: 20 }, { header: 'From', width: 13 }, { header: 'To', width: 13 },
    ],
    rows: moves.map(m => {
      const t = byId.get(m.task_id);
      return [m.task_id, t?.title ?? '', name(t?.assignee_id), xDate(m.created_at), name(m.actor_id), xDate(m.old_value), xDate(m.new_value)];
    }),
  };

  await downloadXlsx(`${opts.deptName} tasks ${td}`, [taskSheet, moveSheet]);
}
