import type { Priority, Repeat, Status } from './types';

/** What people can pick. "Waiting for sign-off" is reached by marking a task Done (see 02_app_tasks.sql). */
export const STATUSES: { value: Status; label: string }[] = [
  { value: 'todo', label: 'To do' },
  { value: 'doing', label: 'In progress' },
  { value: 'waiting', label: 'Waiting' },
  { value: 'done', label: 'Done' },
];
export const statusLabel = (s: string) => s === 'review' ? 'Waiting for sign-off' : STATUSES.find(x => x.value === s)?.label ?? s;

/** The owner has finished it (it may still be waiting for sign-off). */
export const finished = (t: { status: string }) => t.status === 'done' || t.status === 'review';
/** When the owner finished it (sent for sign-off, or done). */
export const finishedAt = (t: { status: string; submitted_at?: string | null; completed_at: string | null }) =>
  finished(t) ? t.submitted_at ?? t.completed_at : null;
/** Past its deadline and not finished. */
export const isLate = (t: { status: string; due_date: string }, today: string) => !finished(t) && t.due_date < today;

export const REMINDS: { value: number; label: string }[] = [
  { value: 1, label: '1 day before' },
  { value: 2, label: '2 days before' },
  { value: 3, label: '3 days before' },
  { value: 5, label: '5 days before' },
  { value: 7, label: '1 week before' },
  { value: 14, label: '2 weeks before' },
  { value: 30, label: '1 month before' },
];
export const remindLabel = (n: number | null | undefined) => n ? REMINDS.find(r => r.value === n)?.label ?? `${n} days before` : '';

export const REPEATS: { value: Repeat; label: string; short: string }[] = [
  { value: 'weekly', label: 'Every week', short: 'Weekly' },
  { value: 'monthly', label: 'Every month', short: 'Monthly' },
  { value: 'quarterly', label: 'Every 3 months', short: 'Quarterly' },
  { value: 'yearly', label: 'Every year', short: 'Yearly' },
];
export const repeatLabel = (r: string | null | undefined) => REPEATS.find(x => x.value === r)?.short ?? '';

export const PRIORITIES: { value: Priority; label: string }[] = [
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];
