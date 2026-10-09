import { supabase } from '../../supabase';
import { go } from '../../lib/route';
import { fmtDay } from '../../lib/dates';
import { firstName } from '../../lib/labels';
import { statusLabel } from './labels';
import type { SearchProvider } from '../../platform/slots';

/** Ctrl+K search: task titles, notes, comments and checklist steps (only tasks you can already see). */
export const tasksSearch: SearchProvider = {
  app: 'tasks',
  label: 'Tasks',
  async search(q, deptId, ctx) {
    const { data, error } = await supabase.rpc('tasks_search', { p_q: q, p_dept: deptId });
    if (error) throw error;
    return ((data ?? []) as { id: number; title: string; status: string; due_date: string; assignee_id: string; found_in: string; snippet: string }[])
      .map(r => ({
        key: `t${r.id}`,
        title: r.title,
        detail: `${firstName(ctx.nameOf(r.assignee_id))} · ${statusLabel(r.status)} · due ${fmtDay(r.due_date)}`,
        snippet: r.found_in === 'title' ? '' : `${r.found_in === 'comment' ? 'Comment: ' : r.found_in === 'step' ? 'Step: ' : ''}${r.snippet}`,
        done: r.status === 'done',
        open: () => go('tasks', 'list', { task: String(r.id) }),
      }));
  },
};
