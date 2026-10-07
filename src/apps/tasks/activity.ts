import type { TaskActivity as Activity } from './types';
import { fmtDay } from '../../lib/dates';
import { repeatLabel, statusLabel } from './labels';

/** Turn a history entry into a short verb + optional detail. */
export function describe(a: Activity, nameOf: (id: string | null) => string): { verb: string; detail?: string; tone?: string } {
  switch (a.kind) {
    case 'created':
      return { verb: 'created' };
    case 'status':
      if (a.new_value === 'done') return { verb: 'completed', tone: 'good' };
      if (a.old_value === 'done') return { verb: 'reopened' };
      if (a.new_value === 'doing') return { verb: 'started' };
      if (a.new_value === 'waiting') return { verb: 'marked waiting', tone: 'warn' };
      return { verb: `set to ${statusLabel(a.new_value ?? '')}` };
    case 'due_date':
      return {
        verb: 'moved deadline',
        detail: `${a.old_value ? fmtDay(a.old_value) : '—'} → ${a.new_value ? fmtDay(a.new_value) : '—'}`,
        tone: 'warn',
      };
    case 'assignee':
      return { verb: 'reassigned', detail: `${nameOf(a.old_value)} → ${nameOf(a.new_value)}` };
    case 'edited':
      return { verb: 'edited', detail: a.new_value ?? undefined };
    case 'comment':
      return { verb: 'commented', detail: a.new_value ?? undefined };
    case 'helper_added':
      return { verb: 'added helper', detail: nameOf(a.new_value) };
    case 'helper_removed':
      return { verb: 'removed helper', detail: nameOf(a.old_value) };
    case 'repeated':
      return { verb: 'set up the next one', detail: `repeats ${repeatLabel(a.new_value).toLowerCase()} · after #${a.old_value}` };
    case 'step':
      return a.old_value === 'done'
        ? { verb: 'ticked a step', detail: a.new_value ?? undefined, tone: 'good' }
        : { verb: 'unticked a step', detail: a.new_value ?? undefined };
    default:
      return { verb: a.kind };
  }
}
